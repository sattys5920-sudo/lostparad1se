// 심부름 — 게시판에 붙고, 받고, 나르고, 먼저 놓는 사람이 가진다.
//
// **붙이는 것은 운영자뿐이다.** 서버가 때맞춰 알아서 붙이는 길은 없다.
// 판에 붙는 심부름이 전부 사람 손을 거치면, 지금 이 판에서 무슨 일이
// 일어나기를 바라는지가 그대로 게시판에 붙는다.
//
// 붙고 난 뒤의 규칙은 누가 붙였든 같다. 받는 사람에게는 운영자가
// 붙였다는 티가 안 난다 — 티가 나면 그건 게임 안의 일이 아니라 게임
// 밖의 일이 된다.
//
// ## 물건이 새지 않게
//
// 받는 순간 출발 방에 물건이 나타나는데, 그 물건은 **받은 사람에게만**
// 있다. 여럿이 같은 심부름을 받으면 각자의 비커가 각자에게만 보인다 —
// 문서 하나에 「누가 받았고 어디까지 했나」만 적고, 투영이 본인 몫만
// 떼어 보낸다. 남의 응답에는 물건도 그 사람이 받았다는 사실도 없다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

import {
  BOARD_BY_ID,
  ERRANDS_PER_BOARD,
  ERRANDS_PER_PERSON,
  ERRANDS,
  ERRAND_BY_ID,
  atBoard,
  atThing,
  isExpired,
  thingCellOf,
  type ThingIcon,
} from '../../shared/rules/errand'
import { TILE_BY_ID, type Cell, type TileId } from '../../shared/rules/board'
import { earn } from '../../shared/rules/resources'
import type { PawnDoc } from '../../shared/model'
import { requireHost } from './host'
import { freshNow, myPawn } from './turn'
import { refreshViews } from './views'
import { gameRef, requireUid } from './index'

const db = getFirestore()

/** 등록해 둔 일거리. 운영자가 고친다. */
/** 지금 판에 붙어 있거나 끝난 것. */
const postedOf = (gameId: string) => gameRef(gameId).collection('errands')

/** 받은 사람 하나의 진행. */
export interface Taker {
  /** 받은 시각. */
  tookMs: number
  /** 물건을 집었는가. 집기 전에는 출발 방에 놓여 있다. */
  carrying: boolean
}

/** 게시판에 붙은 한 장. **적힌 내용은 붙일 때 베껴 둔다.** */
export interface ErrandDoc {
  specId: string
  boardId: string
  /** 붙일 때의 내용. 나중에 운영자가 풀을 고쳐도 이 장은 안 바뀐다. */
  thing: string
  icon: ThingIcon
  from: TileId
  to: TileId
  coins: number
  limitMin: number
  text: string
  /** 출발 방 어디에 놓였는가. 붙일 때 한 번 정하고 안 움직인다. */
  cell: Cell
  postedMs: number
  day: number
  /** 받은 사람들. 키가 사람이다. */
  takers: Record<string, Taker>
  /** 먼저 놓은 사람. 끝났다는 뜻이다. */
  doneBy: string | null
  doneMs: number | null
  /** 시간이 지나 떼어졌는가. */
  expired: boolean
}

const liveOf = (d: ErrandDoc): boolean => d.doneBy === null && !d.expired

/**
 * 시간이 지난 것을 떼어낸다. **받은 사람 전원 실패다.**
 *
 * 시계를 보는 일이라 누가 서버를 두드릴 때 같이 한다(refreshViews 를
 * 부르는 길목마다). 아무도 안 두드리면 아무 일도 안 일어나는데,
 * 그때는 볼 사람도 없다.
 */
export async function sweepErrands(gameId: string, nowMs: number): Promise<boolean> {
  const snap = await postedOf(gameId).where('expired', '==', false).get()
  const batch = db.batch()
  let any = false
  for (const d of snap.docs) {
    const e = d.data() as ErrandDoc
    if (e.doneBy !== null) continue
    if (!isExpired(e.postedMs, e.limitMin, nowMs)) continue
    batch.update(d.ref, { expired: true, takers: {} })
    any = true
  }
  if (any) await batch.commit()
  return any
}

/** 내가 지금 받아 둔 심부름. 없으면 null. */
async function mineNow(gameId: string, uid: string): Promise<{ id: string; doc: ErrandDoc } | null> {
  const snap = await postedOf(gameId).where('expired', '==', false).get()
  for (const d of snap.docs) {
    const e = d.data() as ErrandDoc
    if (liveOf(e) && e.takers[uid]) return { id: d.id, doc: e }
  }
  return null
}

/**
 * 방금 졌는가. **「받은 적이 없다」와 「졌다」는 다른 말이다.**
 *
 * 남이 먼저 놓으면 내 손의 물건이 사라지는데, 그때 아무 설명이 없으면
 * 「눌렀는데 아무 일도 안 일어났다」가 된다.
 */
async function loserOf(gameId: string, uid: string): Promise<ErrandDoc | null> {
  const snap = await postedOf(gameId).get()
  for (const d of snap.docs) {
    const e = d.data() as ErrandDoc
    if (e.doneBy !== null && e.doneBy !== uid && e.takers?.[uid]) return e
  }
  return null
}

// ── 운영자 ──────────────────────────────────────────────────────

/** 풀 전체와 지금 판 위의 상황. **운영자만 본다.** */
export const hostErrands = onCall<{ gameId: string }>(async (req) => {
  requireHost(req.auth)
  const { gameId } = req.data
  const { nowMs } = await freshNow(gameId)
  const posted = await postedOf(gameId).get()
  return {
    nowMs,
    // **풀은 데이터 파일이다.** 판마다 베껴 두지 않는다 — 고칠 수
    // 없는 목록을 판마다 복사해 두면 판끼리 어긋날 자리만 생긴다
    pool: ERRANDS,
    posted: posted.docs.map((d) => {
      const e = d.data() as ErrandDoc
      return {
        id: d.id,
        specId: e.specId,
        boardId: e.boardId,
        board: BOARD_BY_ID[e.boardId]?.name ?? e.boardId,
        thing: e.thing,
        postedMs: e.postedMs,
        limitMin: e.limitMin,
        day: e.day,
        /** 몇 명이 받았나. **누구인지는 안 보낸다** — 경주하는 중이다 */
        takers: Object.keys(e.takers ?? {}).length,
        doneBy: e.doneBy,
        expired: e.expired,
      }
    }),
  }
})

/**
 * 고른 게시판에 한 장 붙인다.
 *
 * **같은 심부름은 하루에 한 번만.** 자동 배치가 없으니 이 규칙도
 * 여기 하나에만 있으면 된다 — 손으로 뚫을 수 있는 문을 남기지 않는다.
 */
export const hostPostErrand = onCall<{ gameId: string; specId: string; boardId: string }>(async (req) => {
  requireHost(req.auth)
  const { gameId, specId, boardId } = req.data
  const board = BOARD_BY_ID[boardId]
  if (!board) throw new HttpsError('invalid-argument', '그런 게시판이 없다.')

  const { game, nowMs } = await freshNow(gameId)
  const spec = ERRAND_BY_ID[String(specId)]
  if (!spec) throw new HttpsError('not-found', '그런 심부름이 없다.')

  const all = await postedOf(gameId).get()
  const rows = all.docs.map((d) => d.data() as ErrandDoc)
  if (rows.some((e) => e.specId === spec.id && e.day === game.day)) {
    throw new HttpsError('failed-precondition', '오늘 이미 나간 심부름이다.')
  }
  const onBoard = rows.filter((e) => e.boardId === boardId && liveOf(e)).length
  if (onBoard >= ERRANDS_PER_BOARD) {
    throw new HttpsError('failed-precondition', `${board.name} 게시판이 꽉 찼다.`)
  }

  const doc: ErrandDoc = {
    specId: spec.id,
    boardId,
    thing: spec.thing,
    icon: spec.icon ?? 'box',
    from: spec.from,
    to: spec.to,
    coins: spec.coins,
    limitMin: spec.limitMin,
    text: spec.text,
    // **자리는 지금 정해서 적어 둔다.** 그때그때 계산하면 나중에
    // 운영자가 풀의 출발 방을 고쳤을 때 판 위의 물건이 순간이동한다
    cell: thingCellOf(spec.id, spec.from),
    postedMs: nowMs,
    day: game.day,
    takers: {},
    doneBy: null,
    doneMs: null,
    expired: false,
  }
  const ref = await postedOf(gameId).add(doc)
  await refreshViews(gameId)
  return { posted: ref.id, board: board.name }
})

// ── 사람 ────────────────────────────────────────────────────────

/** 게시판 앞에서 한 장 받는다. **한 사람에 하나뿐이다.** */
export const takeErrand = onCall<{ gameId: string; errandId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, errandId } = req.data
  const { game, nowMs } = await freshNow(gameId)
  await sweepErrands(gameId, nowMs)

  // **지워진 사람은 못 받는다.** 없는 사람에게 일을 맡길 수는 없다
  if (game.invisibleId === uid) throw new HttpsError('failed-precondition', '오늘은 받을 수 없다.')

  const pawn = await myPawn(gameId, uid)
  if (await mineNow(gameId, uid)) {
    throw new HttpsError('failed-precondition', `한 번에 ${ERRANDS_PER_PERSON}개까지다. 하던 것을 끝내거나 포기해라.`)
  }

  const ref = postedOf(gameId).doc(String(errandId))
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpsError('not-found', '그런 심부름이 없다.')
    const e = snap.data() as ErrandDoc
    if (!liveOf(e)) throw new HttpsError('failed-precondition', '이미 끝난 심부름이다.')
    const board = BOARD_BY_ID[e.boardId]
    if (!board || !atBoard((pawn.at ?? null) as Cell | null, board)) {
      throw new HttpsError('failed-precondition', '게시판 앞에 서야 받는다.')
    }
    if (e.takers[uid]) throw new HttpsError('failed-precondition', '이미 받았다.')
    // **여럿이 같은 것을 받는다.** 각자 경주한다
    tx.update(ref, { [`takers.${uid}`]: { tookMs: nowMs, carrying: false } })
  })
  await refreshViews(gameId)
  return { took: errandId, from: TILE_BY_ID[(await ref.get()).get('from') as TileId].name }
})

/** 출발 방에서 물건을 집는다. **내 것만 집는다.** */
export const pickUpThing = onCall<{ gameId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const { nowMs } = await freshNow(gameId)
  await sweepErrands(gameId, nowMs)
  const pawn = await myPawn(gameId, uid)
  const mine = await mineNow(gameId, uid)
  if (!mine) throw new HttpsError('failed-precondition', '받아 둔 심부름이 없다.')
  if (mine.doc.takers[uid]?.carrying) throw new HttpsError('failed-precondition', '이미 들고 있다.')
  if (pawn.tileId !== mine.doc.from) {
    throw new HttpsError('failed-precondition', `${TILE_BY_ID[mine.doc.from].name}에 가야 있다.`)
  }
  /*
   * **물건 옆에 서야 집는다.** 방에 들어서는 것만으로 집히면 물건이
   * 바닥에 놓여 있다는 말이 무색해진다 — 찾아가는 몇 걸음이 일이다.
   */
  if (!atThing((pawn.at ?? null) as Cell | null, mine.doc.cell ?? null)) {
    throw new HttpsError('failed-precondition', '물건 옆에 서야 집는다.')
  }
  await postedOf(gameId).doc(mine.id).update({ [`takers.${uid}.carrying`]: true })
  await refreshViews(gameId)
  return { carrying: mine.doc.thing }
})

/**
 * 도착 방에 놓는다. **먼저 놓은 사람이 가진다.**
 *
 * 나머지는 그 순간 실패다 — 들고 있던 것이 사라진다. 트랜잭션 안에서
 * 「아직 아무도 안 놓았는가」를 보고 정하므로, 둘이 같은 순간에 놓아도
 * 하나만 이긴다.
 */
export const dropThing = onCall<{ gameId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const { game, nowMs } = await freshNow(gameId)
  await sweepErrands(gameId, nowMs)
  const pawn = await myPawn(gameId, uid)
  const mine = await mineNow(gameId, uid)
  if (!mine) {
    const lost = await loserOf(gameId, uid)
    throw new HttpsError('failed-precondition', lost ? '누가 먼저 놓았다.' : '받아 둔 심부름이 없다.')
  }
  if (!mine.doc.takers[uid]?.carrying) throw new HttpsError('failed-precondition', '아직 물건을 안 집었다.')
  if (pawn.tileId !== mine.doc.to) {
    throw new HttpsError('failed-precondition', `${TILE_BY_ID[mine.doc.to].name}에 놓아야 한다.`)
  }

  const ref = postedOf(gameId).doc(mine.id)
  const meRef = gameRef(gameId).collection('pawns').doc(uid)
  const coins = await db.runTransaction(async (tx) => {
    const [snap, meSnap] = await Promise.all([tx.get(ref), tx.get(meRef)])
    const e = snap.data() as ErrandDoc
    if (!liveOf(e)) throw new HttpsError('failed-precondition', '누가 먼저 놓았다.')
    if (!e.takers[uid]?.carrying) throw new HttpsError('failed-precondition', '아직 물건을 안 집었다.')
    /*
     * 끝났다. **받은 사람 목록은 지우지 않는다.**
     *
     * 지우면 늦은 사람이 「받아 둔 심부름이 없다」는 말을 듣는다 —
     * 졌다는 사실과 애초에 안 받았다는 사실이 같은 말이 된다. 목록을
     * 남겨 두면 아래(loserOf)가 그 둘을 가른다. 물건은 doneBy 가
     * 찬 순간 사라진다 — 투영이 끝난 심부름을 안 싣는다.
     */
    tx.update(ref, { doneBy: uid, doneMs: nowMs })
    tx.update(meRef, { resources: earn(meSnap.data() as PawnDoc, { money: e.coins }) })
    return e.coins
  })

  await gameRef(gameId).collection('events').add({
    atMs: nowMs,
    day: game.day,
    kind: 'errandDone',
    playerId: uid,
    team: pawn.team,
    tileId: mine.doc.to,
    detail: { specId: mine.doc.specId, coins },
  })
  await refreshViews(gameId)
  return { done: true, coins }
})

/** 그만둔다. 들고 있던 것이 사라지고 **남은 사람은 계속한다.** */
export const giveUpErrand = onCall<{ gameId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const mine = await mineNow(gameId, uid)
  if (!mine) throw new HttpsError('failed-precondition', '받아 둔 심부름이 없다.')
  await postedOf(gameId).doc(mine.id).update({ [`takers.${uid}`]: FieldValue.delete() })
  await refreshViews(gameId)
  return { gaveUp: mine.doc.specId }
})

/** 사람 하나를 목록에서 뺀다. 투명인간이 되면 서버가 대신 부른다. */
export async function dropAllErrands(gameId: string, uid: string): Promise<boolean> {
  const mine = await mineNow(gameId, uid)
  if (!mine) return false
  await postedOf(gameId).doc(mine.id).update({ [`takers.${uid}`]: FieldValue.delete() })
  return true
}

/** 투영이 쓴다. 지금 붙어 있는 것과 내가 받은 것. */
export async function errandWorld(gameId: string): Promise<{
  posted: (ErrandDoc & { id: string })[]
}> {
  const snap = await postedOf(gameId).where('expired', '==', false).get()
  return {
    posted: snap.docs.map((d) => ({ ...(d.data() as ErrandDoc), id: d.id })).filter((e) => liveOf(e)),
  }
}
