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
  ACTION_TOKEN_COST,
  PRODUCE_YIELD,
  STUDY_YIELD,
  checkStand,
  ownerLookup,
  type ActionKind,
} from '../../shared/rules/actions'
import { gain, pay } from '../../shared/rules/resources'
import { type Resource, type TeamId } from '../../shared/rules/v2'
import { TILE_BY_ID, type TileId } from '../../shared/rules/board'
import { SHOP_TILE, shopItemById, shopPriceFor } from '../../shared/rules/shop'
import { putItem, type Satchel } from '../../shared/rules/items'
import type { TeamDoc } from '../../shared/model'
import { refreshViews } from './views'
import { freshNow, myPawn, requireAwake, tileStates } from './turn'
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
): Promise<{ got: Partial<Record<Resource, number>>; left: number }> {
  const { game, nowMs } = await freshNow(gameId)
  if (!TILE_BY_ID[targetTile]) throw new HttpsError('invalid-argument', '그런 칸은 없다.')
  if (!game.phaseNow?.open) {
    throw new HttpsError('failed-precondition', '페이즈에만 할 수 있다. 자유 시간에는 만나고 거래한다.')
  }

  const ref = gameRef(gameId)
  const pawn = await myPawn(gameId, uid)
  requireAwake(pawn, nowMs)

  const tileSnap = await ref.collection('tiles').get()
  const tiles = tileStates(tileSnap.docs)
  const stand = checkStand({ kind, standingOn: pawn.tileId, targetTile, team: pawn.team, ownerOf: ownerLookup(tiles) })
  if (!stand.ok) throw new HttpsError('failed-precondition', STAND_MESSAGE[stand.reason as string] ?? '자리가 아니다.')

  const cost = ACTION_TOKEN_COST[kind]
  const teamRef = ref.collection('teams').doc(pawn.team)
  const left = await db.runTransaction(async (tx) => {
    const team = (await tx.get(teamRef)).data() as TeamDoc
    const held = team.phaseTokens ?? 0
    if (held < cost) throw new HttpsError('failed-precondition', '팀 토큰이 모자라다.')
    const after = held - cost
    tx.update(teamRef, { phaseTokens: after, resources: gain(team.resources, got) })
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
  return { got, left }
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

  const shopSnap = await ref.collection('tiles').doc(SHOP_TILE).get()
  const owner = (shopSnap.data() as { ownerTeam?: TeamId | null } | undefined)?.ownerTeam ?? null
  const price = shopPriceFor(item, pawn.team, owner)

  await db.runTransaction(async (tx) => {
    const mineRef = ref.collection('teams').doc(pawn.team)
    const hisRef = price.payTo ? ref.collection('teams').doc(price.payTo) : null
    // **값은 팀 금고에서, 물건은 산 사람 주머니로.** 물건이 팀 것이던
    // 때에는 상점에 다녀온 사람과 쓰는 사람이 달라도 됐다
    const meRef = ref.collection('pawns').doc(uid)
    const [mineSnap, hisSnap, meSnap] = await Promise.all([
      tx.get(mineRef),
      hisRef ? tx.get(hisRef) : null,
      tx.get(meRef),
    ])
    const mine = mineSnap.data() as TeamDoc
    const left = pay(mine.resources, price.cost)
    if (!left) throw new HttpsError('failed-precondition', '돈이 모자라다.')

    tx.update(mineRef, { resources: left })
    if (item.gives) {
      const bag = (meSnap.data() as { items?: Satchel } | undefined)?.items
      tx.update(meRef, { items: putItem(bag, item.gives) })
    }
    // 낸 값은 사라지지 않는다. 상점 주인 팀 금고로 넘어간다
    if (hisRef && hisSnap) {
      const his = hisSnap.data() as TeamDoc
      tx.update(hisRef, { resources: gain(his.resources, price.cost) })
    }
    tx.set(ref.collection('events').doc(), {
      atMs: nowMs,
      day: game.day,
      kind: 'shopBought',
      team: pawn.team,
      playerId: uid,
      tileId: SHOP_TILE,
      detail: { item: item.id, paidTo: price.payTo, owned: price.owned },
    })
  })

  await refreshViews(gameId)
  return { item: item.id, cost: price.cost, paidTo: price.payTo, owned: price.owned }
})
