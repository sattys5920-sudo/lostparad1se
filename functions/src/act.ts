// 자판기 — 사는 것과 파는 것.
//
// **토큰은 안 든다.** 한때 여기에 생산·공부가 있었고 그것들이 팀
// 토큰을 먹었는데, 페이즈에 토큰을 쓰는 길을 점령(이동)과 연구
// 둘로 좁히면서 같이 없앴다. 남은 둘은 돈으로만 오간다 — 대신
// 기계까지 걸어가야 하고, **자유 시간에만** 열린다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

import { earn as earnPurse, pay, purseOf } from '../../shared/rules/resources'
import { type Cell } from '../../shared/rules/board'
import { atVending, priceOf, shopItemById } from '../../shared/rules/shop'
import { CROP_BY_ID } from '../../shared/rules/crop'
import { josa } from '../../shared/text'
import { putItem } from '../../shared/rules/items'
import type { PawnDoc } from '../../shared/model'
import { note } from './records'
import { refreshViews } from './views'
import { freshNow, mustBeFreeTime, myPawn, requireAwake } from './turn'
import { gameRef, requireUid } from './index'

const db = getFirestore()

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
  // 자판기는 자유 시간의 것이다. 파는 쪽만 막고 사는 쪽을 열어 두면
  // 같은 기계의 반쪽만 잠기는 셈이라 둘 다 막는다
  mustBeFreeTime(game, '자판기를 쓸')
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
  mustBeFreeTime(game, '자판기를 쓸')
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
