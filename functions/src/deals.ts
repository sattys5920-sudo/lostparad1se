// 마주 보고 하는 거래 — 서버 쪽.
//
// 판정은 shared/rules/deal.ts 의 순수 함수가 한다. 여기서 하는 일은
// 재료를 모아 주고, 결과를 적고, **성립 직전에 양쪽 소지품을 다시
// 세는 것**이다.
//
// 거래판(games/{id}/deals/{dealId})은 마주 앉은 둘이 직접 구독한다.
// views 를 거치면 반 박자가 늦어서, 상대가 물건을 올리는 것이 안
// 보인다 — 그러면 흥정이 아니다.
//
// **쪽지는 접힌 채로 간다.** 거래판에는 장수만 적고, 어느 쪽지인지는
// secret 아래에 둔다. 성립해야 받는 쪽 손에 들어가고, 그때부터 읽힌다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

import {
  DEAL_ASK_MS,
  afterReady,
  afterStake,
  askExpired,
  canReady,
  dealHasAnything,
  isSideA,
  newDeal,
  readyToSettle,
  robotSwapNo,
  ROBOT_SWAP_MESSAGE,
  shortOf,
  sideOf,
  SHORT_MESSAGE,
  type Holdings,
  type Stake,
} from '../../shared/rules/deal'
import { ITEM_KINDS, type Satchel } from '../../shared/rules/items'
import { MAX_CARRIED_ROBOTS, ROBOTS_PER_TEAM } from '../../shared/rules/occupy'
import { cellsTouch } from '../../shared/rules/board'
import { purseOf } from '../../shared/rules/resources'
import type { GameDoc, PawnDoc, TeamDoc } from '../../shared/model'
import { refreshViews } from './views'
import { freshNow, myPawn, refuseIfInvisible } from './turn'
import { note, noteAll } from './records'
import { logSecret } from './qaLog'
import { gameRef, nowOf, requireUid } from './index'
import { docId } from './ids'
import {
  LIVE,
  asDoc,
  dealLocksOf,
  dealSlipsOf,
  dealsOf,
  endDeal,
  liveDealOf,
  slipsOf,
  sweepDeals,
  type DealDoc,
  type DealLockDoc,
} from './dealroom'

const db = getFirestore()

const NO_DEAL = '그런 거래가 없다.'

/** 덜어 낸 숫자 하나. 음수도 소수도 안 받는다. */
const n = (v: unknown): number => {
  const x = Math.floor(Number(v) || 0)
  return x > 0 ? x : 0
}

/** 클라이언트가 보낸 더미를 규칙이 아는 모양으로 깎는다. */
function cleanStake(raw: unknown): Stake {
  const r = (raw ?? {}) as Partial<Stake>
  const items: Satchel = {}
  for (const k of ITEM_KINDS) {
    const c = n((r.items as Record<string, unknown> | undefined)?.[k])
    if (c > 0) items[k] = c
  }
  return {
    money: n(r.money),
    knowledge: n(r.knowledge),
    slips: n(r.slips),
    robots: n(r.robots),
    items,
  }
}

/** 그 사람이 지금 내놓을 수 있는 것 전부. 올릴 때도 성립 직전에도 이걸로 잰다. */
async function holdingsOf(gameId: string, uid: string, pawn: PawnDoc): Promise<Holdings> {
  const ref = gameRef(gameId)
  const [slips, bots] = await Promise.all([
    slipsOf(gameId).where('heldBy', '==', uid).get(),
    ref.collection('robots').where('carriedBy', '==', uid).get(),
  ])
  // 돈과 지식은 **우리 팀 금고**에서 올린다. 물건·쪽지·로봇은 내 것이다
  const purse = purseOf((await ref.collection('teams').doc(pawn.team).get()).data() as TeamDoc | undefined)
  return {
    money: purse.money,
    knowledge: purse.knowledge,
    items: pawn.items ?? {},
    slips: slips.size,
    robots: bots.size,
  }
}

/** 거래를 걸자고 청한다. 답이 없으면 열다섯 초 뒤에 사라진다 — 값도 안 든다. */
export const askDeal = onCall<{ gameId: string; toPlayerId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const toPlayerId = docId(req.data.toPlayerId, '그런 사람이 없다.')
  const { game, nowMs } = await freshNow(gameId)
  // **페이즈 중에도 흥정한다.** 마주 선 둘이 물건을 주고받는 일은
  // 점령과 같이 일어나도 이상하지 않다 — 옆 칸에 서 있어야 하는
  // 것은 그대로다
  if (toPlayerId === uid) throw new HttpsError('invalid-argument', '나에게는 못 건넨다.')

  await sweepDeals(gameId, nowMs)
  const mine = await myPawn(gameId, uid)
  if (mine.tileId === null) throw new HttpsError('failed-precondition', '걷는 중이다.')
  const theirSnap = await gameRef(gameId).collection('pawns').doc(toPlayerId).get()
  if (!theirSnap.exists) throw new HttpsError('not-found', '그런 사람이 없다.')
  const their = theirSnap.data() as PawnDoc
  /*
   * **옆 칸이면 된다. 방을 묻지 않는다.**
   *
   * 전에는 「같은 방 + 옆 칸」이었다. 방을 묻는 줄이 복도를 막고
   * 있었다 — 복도에서 마주친 둘은 각자 마지막으로 들어간 방이
   * 달라서, 어깨를 맞대고 서 있어도 남남이었다.
   *
   * 방 조건은 없어도 잃는 것이 없다. 방과 방은 떨어져 있어서 서로
   * 다른 방에 선 두 사람의 칸이 닿을 수가 없다.
   */
  if (!cellsTouch(mine.at, their.at)) {
    throw new HttpsError('failed-precondition', '바로 옆 칸에 서야 말을 꺼낼 수 있다.')
  }
  refuseIfInvisible(game.invisibleId, uid, toPlayerId, '거래할')

  const busy = (who: string) => (who === uid ? '이미 거래 중이다.' : '상대가 이미 거래 중이다.')
  // 자리표를 안 남긴 옛 거래도 걸러 낸다. 빠른 길이고, 갈림은 아래 트랜잭션이 한다
  for (const who of [uid, toPlayerId]) {
    if (await liveDealOf(gameId, who)) throw new HttpsError('failed-precondition', busy(who))
  }

  /*
   * **한 사람에 살아 있는 거래 하나 — 트랜잭션으로 지킨다.**
   *
   * 위의 liveDealOf 는 질의라 트랜잭션 밖이다. 둘이 같은 셋째에게 같은
   * 순간에 청하면(한 사람이 두 번 눌러도) 둘 다 「거래 중이 아니다」를 보고
   * 둘 다 판을 만들었다 — 100번에 37번. 사람마다 자리표(dealLocks)를 두고
   * 읽기와 쓰기를 한 트랜잭션에 넣는다. 자리표가 가리키는 거래가 아직
   * 살아 있으면 거절하고, 아니면 새 판을 만들며 둘의 자리표를 덮어쓴다.
   * 같은 자리표를 두고 다투는 둘 중 늦은 쪽은 다시 읽고 여기서 걸린다.
   */
  const tile = mine.tileId
  const dealId = await db.runTransaction(async (tx) => {
    const who = [uid, toPlayerId]
    const locks = await Promise.all(who.map((id) => tx.get(dealLocksOf(gameId).doc(id))))
    const live = await Promise.all(
      locks.map(async (lock) => {
        const id = lock.exists ? ((lock.data() as DealLockDoc).dealId ?? null) : null
        if (!id) return false
        const d = await tx.get(dealsOf(gameId).doc(id))
        return d.exists && LIVE.includes((d.data() as DealDoc).status)
      }),
    )
    for (const [i, id] of who.entries()) if (live[i]) throw new HttpsError('failed-precondition', busy(id))

    const doc = dealsOf(gameId).doc()
    tx.set(
      doc,
      asDoc(
        newDeal({
          askedBy: uid,
          a: { playerId: uid, team: mine.team },
          b: { playerId: toPlayerId, team: their.team },
          tileId: tile,
          nowMs,
        }),
      ),
    )
    tx.set(dealSlipsOf(gameId).doc(doc.id), { a: [], b: [] })
    const lock: DealLockDoc = { dealId: doc.id, atMs: nowMs }
    for (const id of who) tx.set(dealLocksOf(gameId).doc(id), lock)
    return doc.id
  })
  await logSecret(gameId, 'dealAsked', nowMs, uid, { dealId }, { day: game.day, tileId: tile, targetId: toPlayerId })
  return { id: dealId, expiresAtMs: nowMs + DEAL_ASK_MS }
})

/** 청한 거래를 받거나 물린다. */
export const answerDeal = onCall<{ gameId: string; dealId: string; accept: boolean }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, accept } = req.data
  const dealId = docId(req.data.dealId, NO_DEAL)
  const { game, nowMs } = await freshNow(gameId)
  const out = await db.runTransaction(async (tx) => {
    const ref = dealsOf(gameId).doc(dealId)
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpsError('not-found', '그런 거래가 없다.')
    const deal = snap.data() as DealDoc
    if (deal.status !== 'asking') throw new HttpsError('failed-precondition', '이미 지나간 거래다.')
    if (deal.askedBy === uid) throw new HttpsError('permission-denied', '청한 쪽은 못 받는다.')
    if (!sideOf(deal, uid)) throw new HttpsError('permission-denied', '이 거래의 사람이 아니다.')
    if (askExpired(deal, nowMs)) {
      tx.update(ref, { status: 'gone', why: '답이 없어 사라졌다.' })
      throw new HttpsError('failed-precondition', '이미 사라진 요청이다.')
    }
    if (!accept) {
      tx.update(ref, { status: 'gone', why: '거절했다.' })
      return { ok: true, open: false }
    }
    tx.update(ref, { status: 'open' })
    return { ok: true, open: true }
  })
  await logSecret(gameId, 'dealAnswered', nowMs, uid, { dealId, accept: out.open }, { day: game.day })
  return out
})

/** 탁자에 올리거나 내린다. **둘의 준비가 함께 풀린다.** */
export const stakeDeal = onCall<{ gameId: string; dealId: string; stake: unknown }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const dealId = docId(req.data.dealId, NO_DEAL)
  const stake = cleanStake(req.data.stake)
  const { nowMs } = await freshNow(gameId)
  await sweepDeals(gameId, nowMs)

  const pawn = await myPawn(gameId, uid)
  const have = await holdingsOf(gameId, uid, pawn)
  const short = shortOf(stake, have)
  if (short) throw new HttpsError('failed-precondition', SHORT_MESSAGE[short])

  // 쪽지는 어느 것을 올렸는지 서버만 안다. 장수만 거래판에 적는다.
  // 0장이면 묻지 않는다 — limit(0)은 Firestore가 거절한다
  const slipIds =
    stake.slips > 0
      ? (await slipsOf(gameId).where('heldBy', '==', uid).limit(stake.slips).get()).docs.map((d) => d.id)
      : []

  return db.runTransaction(async (tx) => {
    const ref = dealsOf(gameId).doc(dealId)
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpsError('not-found', '그런 거래가 없다.')
    const deal = snap.data() as DealDoc
    if (deal.status !== 'open' && deal.status !== 'settling') {
      throw new HttpsError('failed-precondition', '올릴 수 있는 거래가 아니다.')
    }
    if (!sideOf(deal, uid)) throw new HttpsError('permission-denied', '이 거래의 사람이 아니다.')
    const next = afterStake(deal, uid, stake)
    tx.update(ref, { ...asDoc(next) })
    const key = isSideA(deal, uid) ? 'a' : 'b'
    tx.set(dealSlipsOf(gameId).doc(dealId), { [key]: slipIds }, { merge: true })
    return { ok: true }
  })
})

/** 준비를 누르거나 무른다. 둘 다 눌리면 세기 시작한다. */
export const readyDeal = onCall<{ gameId: string; dealId: string; ready: boolean }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, ready } = req.data
  const dealId = docId(req.data.dealId, NO_DEAL)
  const { nowMs } = await freshNow(gameId)
  return db.runTransaction(async (tx) => {
    const ref = dealsOf(gameId).doc(dealId)
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpsError('not-found', '그런 거래가 없다.')
    const deal = snap.data() as DealDoc
    if (!sideOf(deal, uid)) throw new HttpsError('permission-denied', '이 거래의 사람이 아니다.')
    if (ready && !canReady(deal, uid)) {
      throw new HttpsError('failed-precondition', dealHasAnything(deal) ? '지금은 못 누른다.' : '탁자가 비었다.')
    }
    const next = afterReady(deal, uid, ready, nowMs)
    tx.update(ref, { ...asDoc(next) })
    return { ok: true, settleAtMs: next.settleAtMs }
  })
})

/** 거래를 접는다. 세는 중에도 누구든 무를 수 있다. */
export const cancelDeal = onCall<{ gameId: string; dealId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const dealId = docId(req.data.dealId, NO_DEAL)
  const snap = await dealsOf(gameId).doc(dealId).get()
  if (!snap.exists) return { ok: true }
  const deal = snap.data() as DealDoc
  if (!sideOf(deal, uid)) throw new HttpsError('permission-denied', '이 거래의 사람이 아니다.')
  if (!LIVE.includes(deal.status)) return { ok: true }
  await endDeal(gameId, dealId, '한 사람이 나갔다.')
  await logSecret(gameId, 'dealCancelled', nowOf((await gameRef(gameId).get()).data() as GameDoc), uid, { dealId })
  return { ok: true }
})

/**
 * 성립시킨다. **세던 시각이 지나야 하고, 그때 다시 센다.**
 *
 * 둘 다 부를 수 있고 몇 번 불러도 한 번만 먹는다 — 트랜잭션 안에서
 * 상태를 다시 보고, 이미 끝난 판이면 그대로 끝난 것으로 답한다.
 */
export const settleDeal = onCall<{ gameId: string; dealId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const dealId = docId(req.data.dealId, NO_DEAL)
  const { game, nowMs } = await freshNow(gameId)
  const ref = gameRef(gameId)

  const peek = await dealsOf(gameId).doc(dealId).get()
  if (!peek.exists) throw new HttpsError('not-found', '그런 거래가 없다.')
  const seen = peek.data() as DealDoc
  if (seen.status === 'done') return { ok: true, already: true }
  if (!sideOf(seen, uid)) throw new HttpsError('permission-denied', '이 거래의 사람이 아니다.')
  if (!readyToSettle(seen, nowMs)) throw new HttpsError('failed-precondition', '아직 성립할 때가 아니다.')

  // 트랜잭션 밖에서 미리 읽는다 — 안에서는 읽기 뒤에 쓸 수 없다
  const slipPlan = (await dealSlipsOf(gameId).doc(dealId).get()).data() as
    | { a?: string[]; b?: string[] }
    | undefined
  const [aPawn, bPawn] = await Promise.all([
    ref.collection('pawns').doc(seen.aId).get(),
    ref.collection('pawns').doc(seen.bId).get(),
  ])
  const a = aPawn.data() as PawnDoc
  const b = bPawn.data() as PawnDoc
  // 옆 칸이면 된다 — 복도에서 마주 선 둘도 흥정한다
  if (!cellsTouch(a.at, b.at)) {
    await endDeal(gameId, dealId, '자리를 잃어 사라졌다.')
    throw new HttpsError('failed-precondition', '거래가 사라졌다.')
  }
  const [aHave, bHave] = await Promise.all([
    holdingsOf(gameId, seen.aId, a),
    holdingsOf(gameId, seen.bId, b),
  ])
  const aShort = shortOf(seen.a.stake, aHave)
  const bShort = shortOf(seen.b.stake, bHave)
  if (aShort || bShort) {
    const why = `${aShort ? '상대' : '우리'} 쪽 ${SHORT_MESSAGE[(aShort ?? bShort) as never]}`
    await dealsOf(gameId).doc(dealId).update({ status: 'open', why, 'a.ready': false, 'b.ready': false })
    throw new HttpsError('failed-precondition', why)
  }

  // limit(0)은 Firestore가 거절한다 — 안 올렸으면 묻지도 않는다
  const botsOf = async (who: string, howMany: number) =>
    howMany > 0
      ? (await ref.collection('robots').where('carriedBy', '==', who).limit(howMany).get()).docs
      : []
  const [aBots, bBots] = await Promise.all([
    botsOf(seen.aId, seen.a.stake.robots),
    botsOf(seen.bId, seen.b.stake.robots),
  ])

  /*
   * **받는 쪽 한도.** 받은 로봇은 손에 드니 두 기까지이고, 다른 팀에서
   * 넘어오면 팀 한도도 본다. 넘치면 성립하지 않고 탁자로 돌아간다
   */
  if (aBots.length > 0 || bBots.length > 0) {
    const [aHeld, bHeld, aTeamBots, bTeamBots] = await Promise.all([
      ref.collection('robots').where('carriedBy', '==', seen.aId).get(),
      ref.collection('robots').where('carriedBy', '==', seen.bId).get(),
      ref.collection('robots').where('team', '==', a.team).get(),
      ref.collection('robots').where('team', '==', b.team).get(),
    ])
    const caps = { sameTeam: a.team === b.team, carryCap: MAX_CARRIED_ROBOTS, teamCap: ROBOTS_PER_TEAM }
    const aNo = robotSwapNo({ ...caps, carried: aHeld.size, gives: aBots.length, gets: bBots.length, teamRobots: aTeamBots.size })
    const bNo = robotSwapNo({ ...caps, carried: bHeld.size, gives: bBots.length, gets: aBots.length, teamRobots: bTeamBots.size })
    const no = aNo ?? bNo
    if (no) {
      // 탁자는 둘이 같이 본다 — 누구 쪽인지 대지 않고 까닭만 적는다
      const why = ROBOT_SWAP_MESSAGE[no]
      await dealsOf(gameId).doc(dealId).update({ status: 'open', why, 'a.ready': false, 'b.ready': false })
      throw new HttpsError('failed-precondition', why)
    }
  }

  await db.runTransaction(async (tx) => {
    const dealRef = dealsOf(gameId).doc(dealId)
    const fresh = await tx.get(dealRef)
    const d = fresh.data() as DealDoc
    // **여기서 한 번만 먹는다.** 둘이 같이 불러도 나중 쪽은 그냥 끝난다
    if (d.status !== 'settling') throw new HttpsError('failed-precondition', '이미 지나갔다.')

    /*
     * **팀 금고에서 팀 금고로.** 돈과 지식은 팀 것이라, 마주 선 둘이
     * 한 거래가 두 팀 금고를 움직인다. 같은 팀끼리면 같은 금고라
     * 오간 것이 없다 — 안 건드린다.
     */
    const aTeamRef = ref.collection('teams').doc(a.team)
    const bTeamRef = ref.collection('teams').doc(b.team)
    const [aTeamSnap, bTeamSnap] = await Promise.all([tx.get(aTeamRef), tx.get(bTeamRef)])
    const move = (had: Record<string, number>, give: Stake, get: Stake) => ({
      money: Math.max(0, (had.money ?? 0) - give.money + get.money),
      knowledge: Math.max(0, (had.knowledge ?? 0) - give.knowledge + get.knowledge),
    })
    if (a.team !== b.team) {
      tx.update(aTeamRef, { resources: move(purseOf(aTeamSnap.data() as TeamDoc | undefined), d.a.stake, d.b.stake) })
      tx.update(bTeamRef, { resources: move(purseOf(bTeamSnap.data() as TeamDoc | undefined), d.b.stake, d.a.stake) })
    }

    // 개인 것 — 주머니. 거는 데도 성립하는 데도 값은 안 든다
    const bag = (base: Satchel, give: Satchel, get: Satchel): Satchel => {
      const out: Satchel = { ...base }
      for (const k of ITEM_KINDS) {
        const v = (out[k] ?? 0) - (give[k] ?? 0) + (get[k] ?? 0)
        if (v > 0) out[k] = v
        else delete out[k]
      }
      return out
    }

    tx.update(aPawn.ref, {
      items: bag(a.items ?? {}, d.a.stake.items, d.b.stake.items),
    })
    tx.update(bPawn.ref, {
      items: bag(b.items ?? {}, d.b.stake.items, d.a.stake.items),
    })

    // 쪽지 — 접힌 채로 손이 바뀐다. 받는 쪽은 이제부터 읽을 수 있다
    for (const id of (slipPlan?.a ?? []).slice(0, d.a.stake.slips)) {
      tx.update(slipsOf(gameId).doc(id), { heldBy: d.bId })
    }
    for (const id of (slipPlan?.b ?? []).slice(0, d.b.stake.slips)) {
      tx.update(slipsOf(gameId).doc(id), { heldBy: d.aId })
    }

    // 로봇 — 들고 있는 것만 넘어간다. 받은 사람 손에 들리고, 그 팀 머릿수가 된다
    for (const r of aBots.slice(0, d.a.stake.robots)) {
      tx.update(r.ref, { carriedBy: d.bId, team: d.b.team, tileId: b.tileId ?? r.get('tileId'), placedBy: null })
    }
    for (const r of bBots.slice(0, d.b.stake.robots)) {
      tx.update(r.ref, { carriedBy: d.aId, team: d.a.team, tileId: a.tileId ?? r.get('tileId'), placedBy: null })
    }

    tx.update(dealRef, { status: 'done', why: '' })

    // **개인 미션이 이 줄을 센다** — 「세 팀 모두와 한 번씩」이 여기서 나온다.
    // 트랜잭션 안에 두어야 재시도돼도 판당 한 줄이다
    tx.set(ref.collection('events').doc(), {
      atMs: nowMs,
      day: game.day,
      kind: 'tradeAccepted',
      team: d.b.team,
      detail: { fromTeam: d.a.team },
    })
  })

  // 거래 한 줄. 양쪽을 한 줄에 적어 두면 받기만 한 사람도 거래한 것으로 세어진다
  const askedIsA = seen.askedBy === seen.aId
  await note(
    gameId,
    'trade',
    nowMs,
    { id: seen.askedBy, team: askedIsA ? seen.a.team : seen.b.team },
    {
      otherId: askedIsA ? seen.bId : seen.aId,
      otherTeam: askedIsA ? seen.b.team : seen.a.team,
      tileId: seen.tileId,
    },
  )
  // 짝이 손을 바꿨으면 따로 한 줄 — 심부름꾼의 「내가 만든 짝이 끝날 때 남의 것」이 이 줄을 따라간다
  await noteAll(gameId, [
    ...aBots.slice(0, seen.a.stake.robots).map((r) => ({
      kind: 'robotOwner' as const,
      atMs: nowMs,
      actorId: seen.bId,
      actorTeam: seen.b.team,
      otherId: seen.aId,
      otherTeam: seen.a.team,
      subjectId: r.id,
    })),
    ...bBots.slice(0, seen.b.stake.robots).map((r) => ({
      kind: 'robotOwner' as const,
      atMs: nowMs,
      actorId: seen.aId,
      actorTeam: seen.a.team,
      otherId: seen.bId,
      otherTeam: seen.b.team,
      subjectId: r.id,
    })),
  ])
  /*
   * 쪽지가 손을 바꿨으면 한 장에 한 줄 — **직접 건넨 것과 같은 slipGive** 다.
   * 도서부의 「남에게 건넨 쪽지」가 거래로 넘긴 것도 센다
   */
  const handed = [
    ...(slipPlan?.a ?? []).slice(0, seen.a.stake.slips).map((id) => ({ id, from: 'a' as const })),
    ...(slipPlan?.b ?? []).slice(0, seen.b.stake.slips).map((id) => ({ id, from: 'b' as const })),
  ]
  if (handed.length > 0) {
    const owners = await Promise.all(handed.map((h) => slipsOf(gameId).doc(h.id).get()))
    // **손으로 쓴 빈 종이는 안 센다** — 개인 미션은 운영자가 놓은 쪽지(56장) 몫이다.
    // 이제 쪽지가 손을 바꾸는 길은 거래뿐이라, 빈 종이를 사서 돌리며 세지 못하게 여기서 거른다
    const counted = handed
      .map((h, i) => ({ h, doc: owners[i].data() as { subjectId?: string; noteId?: string } | undefined }))
      .filter((x) => Boolean(x.doc?.noteId))
    if (counted.length > 0) await noteAll(
      gameId,
      counted.map(({ h, doc }) => ({
        kind: 'slipGive' as const,
        atMs: nowMs,
        actorId: h.from === 'a' ? seen.aId : seen.bId,
        actorTeam: h.from === 'a' ? seen.a.team : seen.b.team,
        otherId: h.from === 'a' ? seen.bId : seen.aId,
        otherTeam: h.from === 'a' ? seen.b.team : seen.a.team,
        tileId: seen.tileId,
        subjectId: h.id,
        ownerId: doc?.subjectId ?? null,
      })),
    )
  }
  await logSecret(gameId, 'dealSettled', nowMs, seen.askedBy, { dealId }, {
    day: game.day,
    tileId: seen.tileId,
    targetId: askedIsA ? seen.bId : seen.aId,
  })
  await refreshViews(gameId)
  return { ok: true, already: false }
})

/** 화면이 지금 판을 물을 때. 시든 것을 접고 나서 답한다. */
export const dealNow = onCall<{ gameId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const { nowMs } = await freshNow(gameId)
  await sweepDeals(gameId, nowMs)
  return { id: await liveDealOf(gameId, uid), nowMs }
})
