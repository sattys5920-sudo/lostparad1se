// 손으로 쓰는 물건 — 자물쇠 · 락픽 · 빈 종이 · 지우개 · 테이프 · 덫.
//
// 넷 다 페이즈 행동이 아니다. 「쓰기」한 번으로 그 자리에서 쓰이고,
// **문은 여기 하나뿐이다.** (행동에 딸린 물건이 있으면 phaseAct 가
// 알아서 뺀다 — 지금은 없다)
//
// 한 문으로 모은 값이 크다. 물건을 빼는 자리가 한 군데라, 「효과는
// 났는데 물건이 안 줄었다」가 생길 수 없다. 갈래마다 콜러블을 따로
// 두면 넷 중 하나에서 반드시 빠뜨린다 — 행동 값이 그랬다(occupy 의
// charged 주석).
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

import { LOCK_MS, PAPER_MAX, countOf, isHandItem, takeItem, type ItemKind, type Satchel } from '../../shared/rules/items'
import { TILE_BY_ID, canRoamTo, isAlleyCell, isHallCell, roomOfCell, type TileId } from '../../shared/rules/board'
import { canHoldFlags } from '../../shared/rules/flag'
import { trapsOf, type TrapSetDoc } from './trap'
import type { GameDoc, PawnDoc, TileDoc } from '../../shared/model'
import type { TeamId } from '../../shared/rules/v2'
import type { SlipDoc } from './slips'
import { freshNow, refuseIfSnared } from './turn'
import { refreshViews } from './views'
import { bumpSlips } from './qaLog'
import { takenCells } from './notes'
import { atPaper, dropCellNear } from '../../shared/rules/quiz'
import type { Cell } from '../../shared/rules/board'
import { note } from './records'
import { logSecret } from './qaLog'
import { gameRef, requireUid } from './index'

const db = getFirestore()

const slipsOf = (gameId: string) => gameRef(gameId).collection('secret').doc('slips').collection('items')

/**
 * 오늘 지워진 표를 세는 곳. **secret 아래다.**
 *
 * 문서 하나가 「그날 그 사람」이라, 두 번 지우면 수만 올라간다.
 * 여기 든 수는 어떤 view 로도, 운영자 대시보드로도 안 나간다 —
 * 「저 사람이 지웠다」는 곧 「저 사람은 표를 받았다」이고, 득표수가
 * 새면 무기명이라는 말이 거짓이 된다.
 */
const erasedOf = (gameId: string) => gameRef(gameId).collection('secret').doc('erased').collection('items')
export const erasedKey = (day: number, targetId: string) => `d${day}:${targetId}`

export interface ErasedDoc {
  day: number
  targetId: string
  n: number
}

/** 그날 지워진 표. 집계(settleBallots)만 읽는다. */
export async function erasedOn(gameId: string, day: number): Promise<Record<string, number>> {
  const snap = await erasedOf(gameId).where('day', '==', day).get()
  const out: Record<string, number> = {}
  for (const d of snap.docs) {
    const e = d.data() as ErasedDoc
    out[e.targetId] = (out[e.targetId] ?? 0) + (e.n ?? 0)
  }
  return out
}

interface UseInput {
  gameId: string
  kind: ItemKind
  /** 빈 종이에 적을 말. */
  text?: string
  /** 테이프로 붙일 조각. */
  scrapId?: string
  /** 락픽으로 딸 문 — 들어가려던 방. */
  tileId?: string
}

/** 덫을 놓을 자리는 지금 선 복도 칸이다. 방 안에는 못 놓는다 */

/**
 * 물건 하나를 쓴다.
 *
 * **효과보다 물건을 먼저 본다.** 없으면 아무 일도 안 일어나고 아무
 * 것도 안 줄어든다. 되는지 보는 것과 무는 것 사이에 다른 쓰기가
 * 끼어들지 못하게, 둘 다 한 트랜잭션 안에서 한다.
 */
export const useItem = onCall<UseInput>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const kind = req.data.kind
  if (!isHandItem(kind)) throw new HttpsError('invalid-argument', '손으로 쓰는 물건이 아니다.')

  const { game, nowMs } = await freshNow(gameId)
  await refuseIfSnared(gameId, uid, nowMs)
  const ref = gameRef(gameId)
  const meRef = ref.collection('pawns').doc(uid)

  // 적어 낸 것부터 본다. 서 있는지보다 먼저다 — 빈 종이에 빈 말을
  // 쓰겠다는 요청은 어디에 서 있든 거절이다
  const text = String(req.data.text ?? '').trim().slice(0, PAPER_MAX)
  if (kind === 'paper' && text === '') throw new HttpsError('invalid-argument', '적을 말이 없다.')

  const day = game.day
  /*
   * 빈 종이를 놓을 칸. **트랜잭션 밖에서 미리 센다** — 종이가 놓인 칸을
   * 훑는 질의는 트랜잭션 안에서 못 한다. 둘이 같은 순간 같은 칸을 고르면
   * 한 칸에 두 장이 겹칠 수 있는데, 둘 다 보이고 둘 다 주워진다 — 잃는
   * 것이 없어 그대로 둔다
   */
  const paperTaken = kind === 'paper' ? await takenCells(gameId) : new Set<string>()
  let said = ''
  let locked: { team: TeamId; tileId: TileId } | null = null
  let picked: { team: TeamId; tileId: TileId } | null = null

  await db.runTransaction(async (tx) => {
    const meSnap = await tx.get(meRef)
    if (!meSnap.exists) throw new HttpsError('permission-denied', '이 판에 없는 사람이다.')
    const me = meSnap.data() as PawnDoc
    const here = (me.tileId ?? null) as TileId | null
    const team = me.team as TeamId

    const bag = (me as { items?: Satchel }).items
    if (countOf(bag, kind) <= 0) throw new HttpsError('failed-precondition', '그 물건이 없다.')

    // 지우개 말고는 전부 **선 자리에서** 하는 일이다
    if (kind !== 'eraser' && here === null) {
      throw new HttpsError('failed-precondition', '걷는 중이다.')
    }

    if (kind === 'lock') {
      // **자물쇠는 점령전 중에만 건다.** 그 페이즈가 끝나거나 락픽으로 따면 사라진다
      if (!game.phaseNow?.open) throw new HttpsError('failed-precondition', '자물쇠는 점령전 중에만 걸 수 있다.')
      // **서 있는 방에 건다.** 복도에서 예전에 들렀던 방을 잠그지 못한다. 2-3 교실은 누구의 방도 아니다
      // 칸을 모르는 옛 말(at 없음)은 선 방(tileId)을 믿는다
      if (me.at && roomOfCell(me.at.x, me.at.y) !== here) throw new HttpsError('failed-precondition', '잠글 방 안에 서야 한다.')
      if (!canHoldFlags(here as TileId)) throw new HttpsError('failed-precondition', `${TILE_BY_ID[here as TileId].name}은 잠글 수 없다.`)
      const tileRef = ref.collection('tiles').doc(here as TileId)
      // **트랜잭션 안에서 페이즈를 다시 본다.** 닫히는 순간 건 자물쇠가 다음 페이즈까지 남지 않게
      const [t, gNow] = await Promise.all([
        tx.get(tileRef).then((x) => x.data() as TileDoc | undefined),
        tx.get(ref).then((x) => x.data() as (GameDoc & { closingNo?: number }) | undefined),
      ])
      if (!gNow?.phaseNow?.open || gNow.closingNo === gNow.phaseNow.no || gNow.phaseNow.no !== game.phaseNow.no) {
        throw new HttpsError('failed-precondition', '자물쇠는 점령전 중에만 걸 수 있다.')
      }
      const until = t?.lockUntilMs ?? 0
      // **덮어 걸 수 없다.** 남의 자물쇠 위에 내 것을 걸 수 있으면
      // 잠갔다는 사실이 아무 뜻이 없고, 우리 것 위에 또 걸면 한
      // 시간이 두 시간이 된다
      if (until > nowMs) throw new HttpsError('failed-precondition', '이미 잠겨 있다.')
      // 페이즈 끝까지. 끝나는 시각을 모르면 한 시간(LOCK_MS) — closePhase 가 어차피 걷는다
      tx.update(tileRef, { lockedBy: team, lockUntilMs: game.phaseNow?.endsAtMs ?? nowMs + LOCK_MS })
      said = `${TILE_BY_ID[here as TileId].name} 문을 잠갔다.`
      locked = { team, tileId: here as TileId }
    }

    /*
     * **락픽 — 남의 자물쇠를 딴다.**
     *
     * 선 자리가 아니라 **들어가려던 방**의 문이다. 걷는 중이면 문 앞에
     * 선 것이 아니라 못 딴다. 따면 자물쇠가 통째로 없어진다 — 딴 팀만
     * 드나드는 것이 아니라 누구나 드나든다. 들어가는 것은 따로다(한 번
     * 더 걸음) — 따고 나서 정원이 차 있을 수도 있다.
     */
    if (kind === 'lockpick') {
      const to = String(req.data.tileId ?? '') as TileId
      if (!TILE_BY_ID[to]) throw new HttpsError('invalid-argument', '그런 방은 없다.')
      if (to === here) throw new HttpsError('failed-precondition', '이미 그 방 안이다.')
      if (!canRoamTo(here as TileId, to)) throw new HttpsError('failed-precondition', '거기까지는 복도가 안 이어진다.')
      const tileRef = ref.collection('tiles').doc(to)
      const t = (await tx.get(tileRef)).data() as TileDoc | undefined
      const by = t?.lockedBy ?? null
      // 시각이 지난 자물쇠는 없는 것이다 — 그냥 들어가면 된다. 락픽을 안 문다
      if (!by || (t?.lockUntilMs ?? 0) <= nowMs) throw new HttpsError('failed-precondition', '잠겨 있지 않다.')
      if (by === team) throw new HttpsError('failed-precondition', '우리 분단 자물쇠다. 그냥 들어가면 된다.')
      tx.update(tileRef, { lockedBy: null, lockUntilMs: 0 })
      said = `${TILE_BY_ID[to].name} 자물쇠를 땄다.`
      picked = { team: by as TeamId, tileId: to }
    }

    if (kind === 'paper') {
      /*
       * **발밑 옆 칸에 놓는다.** 운영자가 놓은 쪽지와 똑같이 맵 바닥에
       * 종이가 그려지고, 그 옆에 서서 짚어야 줍는다. 전에는 방 바닥에만
       * 두어서 맵에 안 보였고, 가진 것 목록을 열어 봐야 있는 줄 알았다
       */
      const at = (me.at ?? null) as Cell | null
      const cell = at ? dropCellNear(at, paperTaken) : null
      if (!cell) throw new HttpsError('failed-precondition', '여기에는 놓을 자리가 없다.')
      const doc: SlipDoc = {
        textId: '',
        text,
        // **누구의 비밀도 아니다.** 손으로 쓴 종이라 주인이 없다 —
        // 주운 사람에게 「누구의 일이다」가 안 붙는다
        subjectId: '',
        // 운영자 이력이 「손글씨 · 누구」로 보인다. 어떤 투영에도 안 실린다
        writtenBy: uid,
        tileId: null,
        x: cell.x,
        y: cell.y,
        placedTile: here,
        placedAtMs: nowMs,
        heldBy: null,
        readBy: [],
        tornBy: null,
        tornAt: null,
        atMs: nowMs,
      }
      tx.set(slipsOf(gameId).doc(), doc)
      // 쪽지 문서 하나가 생긴다 — 불변식의 기대 장수도 하나 올린다
      bumpSlips(tx, gameId, 1)
      said = '바닥에 놓았다.'
    }

    if (kind === 'eraser') {
      const key = erasedKey(day, uid)
      const eRef = erasedOf(gameId).doc(key)
      // **표를 세기 전에만 쓴다.** 센 뒤에 지우면 효과 없이 지우개만 닳는다
      const counted = await tx.get(gameRef(gameId).collection('secret').doc('ballotDays').collection('items').doc(`d${day}`))
      if (counted.exists) throw new HttpsError('failed-precondition', '오늘 표는 이미 셌다. 지우개는 표를 세기 전에만 쓴다.')
      const had = ((await tx.get(eRef)).data() as ErasedDoc | undefined)?.n ?? 0
      tx.set(eRef, { day, targetId: uid, n: had + 1 })
      /*
       * **몇 장이었는지 안 알려 준다.** 「지울 표가 없다」도 안 한다 —
       * 그 한 줄이 「오늘 나는 안전하다」를 알려 주기 때문이다. 한 장도
       * 안 적혔어도 지우개는 똑같이 닳는다.
       */
      said = '한 장 지웠다.'
    }

    if (kind === 'trap') {
      const at = me.at ?? null
      // **복도에도 방 안에도 놓는다.** 문턱처럼 어느 쪽도 아닌 칸만 안 된다
      if (!at || (!isHallCell(at.x, at.y) && roomOfCell(at.x, at.y) === null)) {
        throw new HttpsError('failed-precondition', '여기에는 못 놓는다.')
      }
      // 뒷골목은 땅 싸움 밖이다. 오락하러 온 사람을 묶는 덫은 없다
      if (isAlleyCell(at.x, at.y)) throw new HttpsError('failed-precondition', '뒷골목에는 덫을 못 놓는다.')
      // 한 칸에 하나. 우리 것이든 남의 것이든 겹쳐 놓지 않는다
      const dup = await tx.get(trapsOf(gameId).where('x', '==', at.x).where('y', '==', at.y))
      if (!dup.empty) throw new HttpsError('failed-precondition', '여기에는 이미 놓여 있다.')
      const doc: TrapSetDoc = { x: at.x, y: at.y, team, byPlayerId: uid, atMs: nowMs }
      tx.set(trapsOf(gameId).doc(), doc)
      said = '덫을 놓았다.'
    }

    if (kind === 'tape') {
      const scrapId = String(req.data.scrapId ?? '')
      const scrapRef = slipsOf(gameId).doc(scrapId)
      const snap = await tx.get(scrapRef)
      if (!snap.exists) throw new HttpsError('not-found', '그런 조각이 없다.')
      const s = snap.data() as SlipDoc
      // **비밀 쪽지(56장)도 붙인다.** 찢긴 종이가 바닥에 남아 있으면 무엇이든 된다.
      // 조각 없이 사라진 옛 판의 56장(tornAt 이 비어 있다)은 아래에서 걸린다
      if (s.tornBy === null || (s.tornAt ?? null) === null) throw new HttpsError('failed-precondition', '여기 없는 조각이다.')
      // 칸에 떨어진 조각은 **그 옆에 서야** 붙인다. 칸 없는 옛 조각은 그 방에 서 있으면 된다
      const cellOk =
        typeof s.x === 'number' && typeof s.y === 'number'
          ? atPaper((me.at ?? null) as Cell | null, { x: s.x, y: s.y })
          : s.tornAt === here
      if (!cellOk) throw new HttpsError('failed-precondition', '찢긴 종이 옆에 서야 한다.')
      // **접힌 채로 온다.** 붙였다고 읽히지는 않는다 — 읽기는 읽기다
      tx.update(scrapRef, { tornBy: null, tornAt: null, heldBy: uid, tileId: null, x: null, y: null })
      said = '조각을 붙였다.'
    }

    const left = takeItem(bag, kind)
    if (!left) throw new HttpsError('failed-precondition', '그 물건이 없다.')
    tx.update(meRef, { items: left })
  })

  const lockedResult = locked as { team: TeamId; tileId: TileId } | null
  const pickedResult = picked as { team: TeamId; tileId: TileId } | null
  // **공개 로그에 안 싣는다.** 누가 땄는지는 운영자만 본다
  if (pickedResult) await logSecret(gameId, 'lockPicked', nowMs, uid, { team: pickedResult.team }, { day, tileId: pickedResult.tileId })
  if (lockedResult) await note(gameId, 'roomLock', nowMs, { id: uid, team: lockedResult.team }, { tileId: lockedResult.tileId })
  await refreshViews(gameId)
  return { used: kind, said }
})
