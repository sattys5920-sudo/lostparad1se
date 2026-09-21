// 손으로 쓰는 물건 — 자물쇠 · 빈 종이 · 지우개 · 테이프.
//
// 호루라기와 명찰은 행동에 딸려 있어서 phaseAct 가 알아서 하나를
// 뺀다. 나머지 넷은 페이즈 행동이 아니다. 「쓰기」한 번으로 그 자리에서
// 쓰이고, **문은 여기 하나뿐이다.**
//
// 한 문으로 모은 값이 크다. 물건을 빼는 자리가 한 군데라, 「효과는
// 났는데 물건이 안 줄었다」가 생길 수 없다. 갈래마다 콜러블을 따로
// 두면 넷 중 하나에서 반드시 빠뜨린다 — 행동 값이 그랬다(occupy 의
// charged 주석).
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

import { LOCK_MS, PAPER_MAX, countOf, isHandItem, takeItem, type ItemKind, type Satchel } from '../../shared/rules/items'
import { TILE_BY_ID, type TileId } from '../../shared/rules/board'
import type { PawnDoc, TileDoc } from '../../shared/model'
import type { TeamId } from '../../shared/rules/v2'
import type { SlipDoc } from './slips'
import { freshNow } from './turn'
import { refreshViews } from './views'
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
}

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
  const ref = gameRef(gameId)
  const meRef = ref.collection('pawns').doc(uid)

  // 적어 낸 것부터 본다. 서 있는지보다 먼저다 — 빈 종이에 빈 말을
  // 쓰겠다는 요청은 어디에 서 있든 거절이다
  const text = String(req.data.text ?? '').trim().slice(0, PAPER_MAX)
  if (kind === 'paper' && text === '') throw new HttpsError('invalid-argument', '적을 말이 없다.')

  const day = game.phaseNow?.day ?? game.day
  let said = ''

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
      throw new HttpsError('failed-precondition', '걷는 중이다. 도착해야 쓸 수 있다.')
    }

    if (kind === 'lock') {
      const tileRef = ref.collection('tiles').doc(here as TileId)
      const t = (await tx.get(tileRef)).data() as TileDoc | undefined
      const until = t?.lockUntilMs ?? 0
      // **덮어 걸 수 없다.** 남의 자물쇠 위에 내 것을 걸 수 있으면
      // 잠갔다는 사실이 아무 뜻이 없고, 우리 것 위에 또 걸면 한
      // 시간이 두 시간이 된다
      if (until > nowMs) throw new HttpsError('failed-precondition', '이미 잠겨 있다.')
      tx.update(tileRef, { lockedBy: team, lockUntilMs: nowMs + LOCK_MS })
      said = `${TILE_BY_ID[here as TileId].name} 문을 잠갔다.`
    }

    if (kind === 'paper') {
      const doc: SlipDoc = {
        textId: '',
        text,
        // **누구의 비밀도 아니다.** 손으로 쓴 종이라 주인이 없다 —
        // 주운 사람에게 「누구의 일이다」가 안 붙는다
        subjectId: '',
        tileId: here,
        heldBy: null,
        readBy: [],
        tornBy: null,
        tornAt: null,
        atMs: nowMs,
      }
      tx.set(slipsOf(gameId).doc(), doc)
      said = `${TILE_BY_ID[here as TileId].name} 바닥에 놓았다.`
    }

    if (kind === 'eraser') {
      const key = erasedKey(day, uid)
      const eRef = erasedOf(gameId).doc(key)
      const had = ((await tx.get(eRef)).data() as ErasedDoc | undefined)?.n ?? 0
      tx.set(eRef, { day, targetId: uid, n: had + 1 })
      /*
       * **몇 장이었는지 안 알려 준다.** 「지울 표가 없다」도 안 한다 —
       * 그 한 줄이 「오늘 나는 안전하다」를 알려 주기 때문이다. 한 장도
       * 안 적혔어도 지우개는 똑같이 닳는다.
       */
      said = '한 장 지웠다.'
    }

    if (kind === 'tape') {
      const scrapId = String(req.data.scrapId ?? '')
      const scrapRef = slipsOf(gameId).doc(scrapId)
      const snap = await tx.get(scrapRef)
      if (!snap.exists) throw new HttpsError('not-found', '그런 조각이 없다.')
      const s = snap.data() as SlipDoc
      if (s.tornBy === null || (s.tornAt ?? null) !== here) {
        throw new HttpsError('failed-precondition', '여기 없는 조각이다.')
      }
      // **접힌 채로 온다.** 붙였다고 읽히지는 않는다 — 읽기는 읽기다
      tx.update(scrapRef, { tornBy: null, tornAt: null, heldBy: uid, tileId: null })
      said = '조각을 붙였다.'
    }

    const left = takeItem(bag, kind)
    if (!left) throw new HttpsError('failed-precondition', '그 물건이 없다.')
    tx.update(meRef, { items: left })
  })

  await refreshViews(gameId)
  return { used: kind, said }
})
