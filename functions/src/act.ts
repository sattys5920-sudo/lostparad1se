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
import { TILE_BY_ID, type Cell, type TileId } from '../../shared/rules/board'
import { atVending, priceOf, shopItemById } from '../../shared/rules/shop'
import { CROP_BY_ID } from '../../shared/rules/crop'
import { josa } from '../../shared/text'
import { putItem } from '../../shared/rules/items'
import type { PawnDoc, TeamDoc } from '../../shared/model'
import { note } from './records'
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
    throw new HttpsError('failed-precondition', '페이즈에만 할 수 있다.')
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
 * 자판기에서 물건을 산다. **기계 앞에 서 있어야 한다.**
 *
 * **값은 누구에게나 같다.** 한때는 상점이 차지할 수 있는 방이라
 * 쥔 팀은 1코인이고 나머지는 붙은 값을 그 팀 금고에 냈다. 기계가
 * 복도로 나가면서 그 갈래가 통째로 없어졌다 — 복도는 아무도 못
 * 차지하므로 받아 갈 주인이 없고, 낸 돈은 판에서 사라진다.
 *
 * 토큰은 들지 않는다. 사는 것은 시간을 쓰는 일이 아니라 돈을 쓰는
 * 일이다 — 그 대신 기계까지 걸어가야 한다.
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
  /*
   * **기계 앞에 서야 산다.** 방이 아니라 자리를 본다.
   *
   * 전에는 「매점」이라는 방에 서 있으면 됐다. 그러면 그 방을 차지한
   * 팀이 사고파는 길목을 쥔다 — 자판기를 복도로 내보낸 까닭이다.
   */
  const spot = atVending((pawn.at ?? null) as Cell | null)
  if (!spot) throw new HttpsError('failed-precondition', '자판기 앞에 서야 산다.')

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
      detail: { item: item.id, cost: cost.money, at: spot.id },
    })
  })

  // **매점 단골이 이 줄을 센다.** 이벤트로만 남기면 판정이 못 읽는다 —
  // 미션은 기록 계층만 본다. 매입(vendSell)과 갈라 둔 까닭도 그것이다
  await note(gameId, 'vendBuy', nowMs, { id: uid, team: pawn.team }, { subjectId: item.id })
  await refreshViews(gameId)
  return { item: item.id, cost: cost.money }
})

/**
 * 매입구 — 딴 작물을 기계에 넣는다.
 *
 * **값은 표에 적힌 그대로다.** 흥정도, 떨이도, 많이 넣으면 깎이는
 * 일도 없다 — 주인 없는 기계라 흥정할 상대가 없다. 그래서 정원에서
 * 나오는 돈은 「무엇이 열렸나」로만 갈린다.
 *
 * 사는 것과 같은 자리에서 한다. 기계 한 대에 넣는 구멍과 나오는
 * 구멍이 따로 있을 뿐이다.
 */
export const sellCrop = onCall<{ gameId: string; cropId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const spec = CROP_BY_ID[String(req.data.cropId)]
  if (!spec) throw new HttpsError('invalid-argument', '그런 작물은 없다.')

  const { nowMs, game } = await freshNow(gameId)
  const ref = gameRef(gameId)
  const pawn = await myPawn(gameId, uid)
  requireAwake(pawn, nowMs)
  const spot = atVending((pawn.at ?? null) as Cell | null)
  if (!spot) throw new HttpsError('failed-precondition', '자판기 앞에 서야 넣는다.')

  await db.runTransaction(async (tx) => {
    const meRef = ref.collection('pawns').doc(uid)
    const meNow = (await tx.get(meRef)).data() as PawnDoc
    const have = (meNow.crops ?? {})[spec.id] ?? 0
    if (have < 1) throw new HttpsError('failed-precondition', `${spec.name}${josa(spec.name, '이/가')} 없다.`)
    // **돈은 개인 지갑으로.** 딴 사람이 가진다 — 정원의 규칙 그대로다
    tx.update(meRef, {
      [`crops.${spec.id}`]: have - 1,
      resources: earnPurse(meNow, { money: spec.price }),
    })
    tx.set(ref.collection('events').doc(), {
      atMs: nowMs,
      day: game.day,
      kind: 'cropSold',
      team: pawn.team,
      playerId: uid,
      detail: { crop: spec.id, paid: spec.price, at: spot.id },
    })
  })

  // 파는 것은 사는 것이 아니다. 매점 단골의 「세 번 산다」에 안 든다
  await note(gameId, 'vendSell', nowMs, { id: uid, team: pawn.team }, { subjectId: spec.id })
  await refreshViews(gameId)
  return { crop: spec.id, paid: spec.price }
})
