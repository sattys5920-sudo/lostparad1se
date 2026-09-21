// 팀 토큰을 쓰는 행동 — 생산 · 공부.
//
// **페이즈에만 한다.** 자유 시간은 만나고 거래하고 이야기하는 시간이고,
// 값을 치르는 일은 종이 친 뒤에 한다. 그래서 여기서 나가는 토큰은
// 페이즈 상자(TeamDoc.phaseTokens) 하나뿐이다 — 자유 시간용 상자를
// 따로 두면 화면에 주머니가 둘이 되고, 어느 쪽에서 빠지는지 아무도
// 모른다.
//
// 네 가지가 매번 같은 순서로 확인된다.
//
//   1. 판을 따라잡는다
//   2. 페이즈가 열려 있는가
//   3. 발이 묶였는가 · 서 있는 자리가 맞는가
//   4. 팀 토큰이 있는가
//
// 토큰은 **행동이 성립할 때** 뺀다. 자리가 틀렸으면 아무것도 빠지지
// 않는다. 빼는 것과 버는 것을 한 트랜잭션에 넣는다 — 넷이 한 주머니를
// 나눠 쓰므로, 따로 적으면 같은 토큰을 둘이 쓴다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

import {
  ACTION_MINUTES,
  ACTION_TOKEN_COST,
  PRODUCE_YIELD,
  STUDY_YIELD,
  checkStand,
  ownerLookup,
  type ActionKind,
} from '../../shared/rules/actions'
import { earn as earnPurse, pay, purseOf } from '../../shared/rules/resources'
import { type Resource } from '../../shared/rules/v2'
import { TILE_BY_ID, type TileId } from '../../shared/rules/board'
import { SHOP_TILE, priceOf, shopItemById } from '../../shared/rules/shop'
import { putItem } from '../../shared/rules/items'
import type { PawnDoc, TeamDoc } from '../../shared/model'
import { refreshViews } from './views'
import { freshNow, myPawn, requireAwake, requireFree, tileStates } from './turn'
import { gameRef, requireUid } from './index'

const db = getFirestore()

const STAND_MESSAGE: Record<string, string> = {
  walking: '걷는 중이다.',
  notThere: '그 칸에 서 있어야 한다.',
  notOurTile: '우리 칸이 아니다.',
  notOurZone: '우리 땅에서만 할 수 있다.',
  ourTile: '우리 칸이다.',
  notEnemyTile: '남의 칸이 아니다.',
}

/**
 * 생산·공부 한 번.
 *
 * **페이즈에만 된다.** 자유 시간에 부르면 거절한다 — 그 시간은
 * 만나고 거래하는 시간이라 값을 치를 것이 없다.
 *
 * 빼는 것과 버는 것이 한 트랜잭션이다. 페이즈 상자는 넷이 나눠 쓰는
 * 한 주머니라, 읽고 쓰는 사이에 남이 끼어들면 같은 토큰이 두 번 나간다.
 */
async function earn(
  gameId: string,
  uid: string,
  kind: ActionKind,
  targetTile: TileId,
  got: Partial<Record<Resource, number>>,
): Promise<{ got: Partial<Record<Resource, number>>; left: number; minutes: number }> {
  const { game, nowMs } = await freshNow(gameId)
  if (!TILE_BY_ID[targetTile]) throw new HttpsError('invalid-argument', '그런 칸은 없다.')
  if (!game.phaseNow?.open) {
    throw new HttpsError('failed-precondition', '페이즈에만 할 수 있다. 자유 시간에는 만나고 거래한다.')
  }

  const ref = gameRef(gameId)
  const pawn = await myPawn(gameId, uid)
  requireAwake(pawn, nowMs)
  requireFree(pawn, nowMs)

  const tileSnap = await ref.collection('tiles').get()
  const tiles = tileStates(tileSnap.docs)
  const stand = checkStand({ kind, standingOn: pawn.tileId, targetTile, team: pawn.team, ownerOf: ownerLookup(tiles) })
  if (!stand.ok) throw new HttpsError('failed-precondition', STAND_MESSAGE[stand.reason as string] ?? '자리가 아니다.')

  const cost = ACTION_TOKEN_COST[kind]
  const teamRef = ref.collection('teams').doc(pawn.team)
  const meRef = ref.collection('pawns').doc(uid)
  const left = await db.runTransaction(async (tx) => {
    const [teamSnap, meSnap] = await Promise.all([tx.get(teamRef), tx.get(meRef)])
    const team = teamSnap.data() as TeamDoc
    const held = team.phaseTokens ?? 0
    if (held < cost) throw new HttpsError('failed-precondition', '팀 토큰이 모자라다.')
    const after = held - cost
    /*
     * **번 것은 번 사람 지갑에 들어간다.** 토큰은 팀 것이고 벌이는
     * 개인 것이다 — 시간은 팀이 나눠 쓰지만 주머니는 각자다.
     */
    const me = meSnap.data() as PawnDoc
    tx.update(teamRef, { phaseTokens: after })
    tx.update(meRef, { resources: earnPurse(me, got) })
    /*
     * **하는 동안 그 자리에 묶인다.**
     *
     * 값만 물리고 시간을 안 물리면, 토큰이 남아 있는 한 한 방에 서서
     * 연달아 찍어 낸다 — 페이즈가 「토큰이 몇 개인가」로만 갈리고
     * 몸이 어디 있었는지는 아무 뜻이 없어진다.
     *
     * 번 것은 지금 들어온다. 끝날 때 넣으려면 누군가 그 시각에
     * 서버를 두드려 줘야 하는데, 혼자 확인하는 판에서는 아무도 안
     * 두드려서 낸 토큰만 사라진다.
     */
    tx.update(meRef, {
      busyUntilMs: nowMs + ACTION_MINUTES[kind] * 60_000,
      busyKind: kind === 'produce' ? '생산' : '공부',
    })
    tx.set(ref.collection('events').doc(), {
      atMs: nowMs,
      day: game.day,
      kind,
      team: pawn.team,
      playerId: uid,
      tileId: targetTile,
      detail: { got },
    })
    return after
  })

  await refreshViews(gameId)
  return { got, left, minutes: ACTION_MINUTES[kind] }
}

// ── 생산 ────────────────────────────────────────────────────────

/** 우리 땅에서 돈을 만든다. 페이즈에만 한다. */
export const produce = onCall<{ gameId: string; tileId: TileId }>(async (req) => {
  const uid = requireUid(req.auth)
  return earn(req.data.gameId, uid, 'produce', req.data.tileId, PRODUCE_YIELD)
})

// ── 공부 ────────────────────────────────────────────────────────

/**
 * 우리 땅 위에서 지식을 번다. **생산의 짝이다.**
 *
 * 전에는 지식이 탐색과 문제지에서만 나왔다. 연구가 연구실 하나로
 * 몰리면서 지식이 판의 목줄이 되었는데, 버는 길이 운(탐색)과
 * 문제지뿐이면 연구실을 못 쥔 팀은 손쓸 방법이 없다.
 */
export const study = onCall<{ gameId: string; tileId: TileId }>(async (req) => {
  const uid = requireUid(req.auth)
  return earn(req.data.gameId, uid, 'study', req.data.tileId, STUDY_YIELD)
})

// ── 상점 ────────────────────────────────────────────────────────

/**
 * 상점에서 물건을 산다. **상점에 서 있어야 한다.**
 *
 * 값은 상점을 누가 쥐고 있느냐로 갈린다 — 차지한 팀은 무엇이든
 * 1코인이고 아무 데도 안 가지만, 나머지는 붙은 값을 그대로 **주인
 * 팀 금고에** 낸다. 아무도 안 쥐고 있으면 값은 그대로지만 받을 팀이
 * 없어 사라진다(shared/rules/shop.ts).
 *
 * 토큰은 들지 않는다. 사는 것은 시간을 쓰는 일이 아니라 돈을 쓰는
 * 일이다 — 그 대신 상점까지 걸어가야 한다.
 */
export const buyShopItem = onCall<{ gameId: string; itemId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, itemId } = req.data
  const item = shopItemById(itemId)
  if (!item) throw new HttpsError('invalid-argument', '그런 물건은 없다.')

  const { nowMs, game } = await freshNow(gameId)
  const ref = gameRef(gameId)
  const pawn = await myPawn(gameId, uid)
  requireAwake(pawn, nowMs)
  if (pawn.tileId !== SHOP_TILE) {
    throw new HttpsError('failed-precondition', `${TILE_BY_ID[SHOP_TILE].name}에 서야 살 수 있다.`)
  }

  // **값은 누구에게나 같다.** 차지한 팀도, 깎아 주는 자리도 없다 —
  // 기계는 복도에 서 있고 복도는 아무도 차지할 수 없다
  const cost = { money: priceOf(item) }

  /**
   * 하루 몫이 걸린 물건. **판 전체에서 그만큼까지다.**
   *
   * 이벤트를 세지 않고 칸 하나를 올린다. 세는 쪽은 색인이 필요하고,
   * 무엇보다 같은 순간 둘이 사면 둘 다 「아직 남았다」를 본다 —
   * 트랜잭션 안에서 올리는 칸이라야 열넷이 동시에 눌러도 하나다.
   */
  const stockRef = item.stockPerDay
    ? ref.collection('secret').doc('shopStock').collection('items').doc(`d${game.day}:${item.id}`)
    : null

  await db.runTransaction(async (tx) => {
    // **값은 팀 금고에서, 물건은 산 사람 주머니로.** 물건이 팀 것이던
    // 때에는 상점에 다녀온 사람과 쓰는 사람이 달라도 됐다
    const meRef = ref.collection('pawns').doc(uid)
    const [meSnap, stockSnap] = await Promise.all([tx.get(meRef), stockRef ? tx.get(stockRef) : null])
    const soldToday = ((stockSnap?.data() as { n?: number } | undefined)?.n ?? 0)
    if (stockRef && item.stockPerDay && soldToday >= item.stockPerDay) {
      throw new HttpsError('failed-precondition', `오늘 ${item.name}은(는) 다 나갔다.`)
    }
    /*
     * **내 지갑에서 낸다.** 팀 금고가 없어졌다.
     *
     * 그리고 **낸 돈은 사라진다.** 자판기는 복도에 서 있어서 아무도
     * 차지할 수 없는 기계다 — 값을 받아 갈 주인이 없다. 판에서 돈이
     * 빠져나가는 유일한 구멍이고, 그래서 하루 상한과 짝이 맞는다.
     */
    const meNow = meSnap.data() as PawnDoc
    const left = pay(purseOf(meNow), cost)
    if (!left) throw new HttpsError('failed-precondition', '돈이 모자라다.')

    if (stockRef) tx.set(stockRef, { day: game.day, itemId: item.id, n: soldToday + 1 })
    tx.update(meRef, {
      resources: left,
      ...(item.gives ? { items: putItem(meNow.items, item.gives) } : {}),
    })
    tx.set(ref.collection('events').doc(), {
      atMs: nowMs,
      day: game.day,
      kind: 'shopBought',
      team: pawn.team,
      playerId: uid,
      tileId: SHOP_TILE,
      detail: { item: item.id, cost: cost.money },
    })
  })

  await refreshViews(gameId)
  return { item: item.id, cost: cost.money }
})
