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
  shortOf,
  sideOf,
  SHORT_MESSAGE,
  type Holdings,
  type Stake,
} from '../../shared/rules/deal'
import { ITEM_KINDS, type Satchel } from '../../shared/rules/items'
import { TRADE_COST } from '../../shared/rules/occupy'
import { cellsTouch } from '../../shared/rules/board'
import type { PawnDoc, TeamDoc } from '../../shared/model'
import { refreshViews } from './views'
import { freshNow, myPawn, refuseIfInvisible } from './turn'
import { note, noteAll } from './records'
import { gameRef, requireUid } from './index'
import {
  LIVE,
  asDoc,
  dealSlipsOf,
  dealsOf,
  endDeal,
  liveDealOf,
  slipsOf,
  sweepDeals,
  type DealDoc,
} from './dealroom'

const db = getFirestore()

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
    tokens: n(r.tokens),
    slips: n(r.slips),
    robots: n(r.robots),
    items,
  }
}

/** 그 사람이 지금 내놓을 수 있는 것 전부. 올릴 때도 성립 직전에도 이걸로 잰다. */
async function holdingsOf(gameId: string, uid: string, pawn: PawnDoc): Promise<Holdings> {
  const ref = gameRef(gameId)
  const [teamSnap, slips, bots] = await Promise.all([
    ref.collection('teams').doc(pawn.team).get(),
    slipsOf(gameId).where('heldBy', '==', uid).get(),
    ref.collection('robots').where('carriedBy', '==', uid).get(),
  ])
  const team = teamSnap.data() as TeamDoc | undefined
  return {
    money: team?.resources?.money ?? 0,
    knowledge: team?.resources?.knowledge ?? 0,
    tokens: pawn.dealTokens ?? 0,
    items: pawn.items ?? {},
    slips: slips.size,
    robots: bots.size,
  }
}

/** 거래를 걸자고 청한다. 답이 없으면 열다섯 초 뒤에 사라진다 — 값도 안 든다. */
export const askDeal = onCall<{ gameId: string; toPlayerId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, toPlayerId } = req.data
  const { game, nowMs } = await freshNow(gameId)
  if (game.phaseNow?.open) throw new HttpsError('failed-precondition', '페이즈 중에는 거래하지 않는다.')
  if (toPlayerId === uid) throw new HttpsError('invalid-argument', '나에게는 못 건넨다.')

  await sweepDeals(gameId, nowMs)
  const mine = await myPawn(gameId, uid)
  if (mine.tileId === null) throw new HttpsError('failed-precondition', '걷는 중이다. 도착해야 말을 꺼낸다.')
  if ((mine.dealTokens ?? 0) < TRADE_COST) {
    throw new HttpsError('failed-precondition', '오늘 거래를 걸 토큰이 없다.')
  }
  const theirSnap = await gameRef(gameId).collection('pawns').doc(toPlayerId).get()
  if (!theirSnap.exists) throw new HttpsError('not-found', '그런 사람이 없다.')
  const their = theirSnap.data() as PawnDoc
  // **같은 방으로는 모자라다.** 마주 보고 물건을 주고받는 것이지
  // 교실 반대편에서 소리쳐 흥정하는 것이 아니다
  if (their.tileId !== mine.tileId) throw new HttpsError('failed-precondition', '같은 방에 있어야 한다.')
  if (!cellsTouch(mine.at, their.at)) {
    throw new HttpsError('failed-precondition', '바로 옆 칸에 서야 말을 꺼낼 수 있다.')
  }
  refuseIfInvisible(game.invisibleId, uid, toPlayerId, '거래할')

  for (const who of [uid, toPlayerId]) {
    if (await liveDealOf(gameId, who)) {
      throw new HttpsError('failed-precondition', who === uid ? '이미 거래 중이다.' : '상대가 이미 거래 중이다.')
    }
  }

  const doc = dealsOf(gameId).doc()
  await doc.set(
    asDoc(
      newDeal({
        askedBy: uid,
        a: { playerId: uid, team: mine.team },
        b: { playerId: toPlayerId, team: their.team },
        tileId: mine.tileId,
        nowMs,
      }),
    ),
  )
  await dealSlipsOf(gameId).doc(doc.id).set({ a: [], b: [] })
  return { id: doc.id, expiresAtMs: nowMs + DEAL_ASK_MS }
})

/** 청한 거래를 받거나 물린다. */
export const answerDeal = onCall<{ gameId: string; dealId: string; accept: boolean }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, dealId, accept } = req.data
  const { nowMs } = await freshNow(gameId)
  return db.runTransaction(async (tx) => {
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
})

/** 탁자에 올리거나 내린다. **둘의 준비가 함께 풀린다.** */
export const stakeDeal = onCall<{ gameId: string; dealId: string; stake: unknown }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, dealId } = req.data
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
  const { gameId, dealId, ready } = req.data
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
  const { gameId, dealId } = req.data
  const snap = await dealsOf(gameId).doc(dealId).get()
  if (!snap.exists) return { ok: true }
  const deal = snap.data() as DealDoc
  if (!sideOf(deal, uid)) throw new HttpsError('permission-denied', '이 거래의 사람이 아니다.')
  if (!LIVE.includes(deal.status)) return { ok: true }
  await endDeal(gameId, dealId, '한 사람이 나갔다.')
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
  const { gameId, dealId } = req.data
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
  if (
    game.phaseNow?.open ||
    a.tileId !== seen.tileId ||
    b.tileId !== seen.tileId ||
    !cellsTouch(a.at, b.at)
  ) {
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

  await db.runTransaction(async (tx) => {
    const dealRef = dealsOf(gameId).doc(dealId)
    const fresh = await tx.get(dealRef)
    const d = fresh.data() as DealDoc
    // **여기서 한 번만 먹는다.** 둘이 같이 불러도 나중 쪽은 그냥 끝난다
    if (d.status !== 'settling') throw new HttpsError('failed-precondition', '이미 지나갔다.')

    const [aTeamSnap, bTeamSnap] = await Promise.all([
      tx.get(ref.collection('teams').doc(d.a.team)),
      tx.get(ref.collection('teams').doc(d.b.team)),
    ])
    const aTeam = aTeamSnap.data() as TeamDoc
    const bTeam = bTeamSnap.data() as TeamDoc

    // 팀 금고 — 돈과 지식은 팀 것이라 팀원 전체가 함께 잃고 얻는다
    const move = (from: TeamDoc, give: Stake, get: Stake) => ({
      money: (from.resources?.money ?? 0) - give.money + get.money,
      knowledge: (from.resources?.knowledge ?? 0) - give.knowledge + get.knowledge,
    })
    tx.update(aTeamSnap.ref, { resources: { ...aTeam.resources, ...move(aTeam, d.a.stake, d.b.stake) } })
    tx.update(bTeamSnap.ref, { resources: { ...bTeam.resources, ...move(bTeam, d.b.stake, d.a.stake) } })

    // 개인 것 — 거래 토큰과 주머니. 값은 청한 쪽이 낸다
    const bag = (base: Satchel, give: Satchel, get: Satchel): Satchel => {
      const out: Satchel = { ...base }
      for (const k of ITEM_KINDS) {
        const v = (out[k] ?? 0) - (give[k] ?? 0) + (get[k] ?? 0)
        if (v > 0) out[k] = v
        else delete out[k]
      }
      return out
    }
    const fee = (id: string) => (id === d.askedBy ? TRADE_COST : 0)
    tx.update(aPawn.ref, {
      dealTokens: (a.dealTokens ?? 0) - d.a.stake.tokens + d.b.stake.tokens - fee(d.aId),
      items: bag(a.items ?? {}, d.a.stake.items, d.b.stake.items),
    })
    tx.update(bPawn.ref, {
      dealTokens: (b.dealTokens ?? 0) - d.b.stake.tokens + d.a.stake.tokens - fee(d.bId),
      items: bag(b.items ?? {}, d.b.stake.items, d.a.stake.items),
    })

    // 쪽지 — 접힌 채로 손이 바뀐다. 받는 쪽은 이제부터 읽을 수 있다
    for (const id of (slipPlan?.a ?? []).slice(0, d.a.stake.slips)) {
      tx.update(slipsOf(gameId).doc(id), { heldBy: d.bId })
    }
    for (const id of (slipPlan?.b ?? []).slice(0, d.b.stake.slips)) {
      tx.update(slipsOf(gameId).doc(id), { heldBy: d.aId })
    }

    // 짝 — 데리고 있는 것만 넘어간다. 넘겨받으면 우리 머릿수다
    for (const r of aBots.slice(0, d.a.stake.robots)) {
      tx.update(r.ref, { carriedBy: d.bId, team: d.b.team })
    }
    for (const r of bBots.slice(0, d.b.stake.robots)) {
      tx.update(r.ref, { carriedBy: d.aId, team: d.a.team })
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
