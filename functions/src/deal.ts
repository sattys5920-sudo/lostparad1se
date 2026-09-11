// 교역과 동맹.
//
// 토큰이 들지 않는다. 대신 **받아들이는 순간** 양쪽 자원을 다시 센다 —
// 제안할 때가 아니라. 그 사이에 한쪽이 다 써 버렸으면 성립하지 않는다.
//
// 동맹은 한 번에 하나다. 먼저 깬 팀은 영향력을 잃고 열두 시간 동안 새
// 동맹을 못 맺는다. DAY 4 08:00에는 모든 동맹이 그냥 풀린다 — 먼저 깬
// 것이 아니므로 아무도 값을 치르지 않는다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

import { acceptTrade, breakAlliance, canAlly, canOffer, type TradeOffer } from '../../shared/rules/diplomacy'
import { ALLIANCE_BREAK_INFLUENCE_PENALTY, type Resource, type TeamId } from '../../shared/rules/v2'
import { TEAMS } from '../../shared/rules/lobby'
import type { SabotageDoc, TeamDoc } from '../../shared/model'
import { refreshViews } from './views'
import { freshNow, myPawn } from './turn'
import { gameRef, requireUid } from './index'

const db = getFirestore()

/**
 * 교역 제안과 동맹 제안은 **서버만 읽는다.**
 *
 * 네 팀이 서로의 제안을 다 볼 수 있으면 협상이 협상이 아니다. 관련된
 * 두 팀에게만 views로 깎여 간다.
 */
const tradesOf = (gameId: string) => gameRef(gameId).collection('secret').doc('trades').collection('items')
const proposalsOf = (gameId: string) => gameRef(gameId).collection('secret').doc('alliances').collection('items')

type Bag = Partial<Record<Resource, number>>

/** 숫자가 아니거나 음수면 거절한다. 화면을 믿지 않는다. */
function cleanBag(bag: unknown): Bag {
  const out: Bag = {}
  if (!bag || typeof bag !== 'object') return out
  for (const [k, v] of Object.entries(bag as Record<string, unknown>)) {
    if (k !== 'money' && k !== 'knowledge' && k !== 'influence') continue
    const n = Number(v)
    if (!Number.isInteger(n) || n < 0) throw new HttpsError('invalid-argument', '자원 수가 이상하다.')
    if (n > 0) out[k] = n
  }
  return out
}

/** 지금 이 팀이 맞고 있는 견제. */
async function sabotagesOn(gameId: string, team: TeamId, kind: SabotageDoc['kind']): Promise<boolean> {
  const snap = await gameRef(gameId).collection('sabotages').where('targetTeam', '==', team).get()
  const now = Date.now()
  return snap.docs.some((d) => {
    const s = d.data() as SabotageDoc
    return s.kind === kind && !s.consumed && (s.expiresRealMs === null || s.expiresRealMs > now)
  })
}

// ── 교역 ────────────────────────────────────────────────────────

export const offerTrade = onCall<{ gameId: string; toTeam: TeamId; give: Bag; want: Bag; note?: string }>(
  async (req) => {
    const uid = requireUid(req.auth)
    const { gameId, toTeam } = req.data
    const { nowMs } = await freshNow(gameId)
    const pawn = await myPawn(gameId, uid)
    if (!TEAMS.includes(toTeam)) throw new HttpsError('invalid-argument', '그런 팀은 없다.')

    const give = cleanBag(req.data.give)
    const want = cleanBag(req.data.want)
    const ref = gameRef(gameId)
    const pending = (await tradesOf(gameId).where('fromTeam', '==', pawn.team).where('status', '==', 'open').get())
      .size

    const out = canOffer({
      fromTeam: pawn.team,
      toTeam,
      give,
      want,
      pending,
      tradeBlocked: await sabotagesOn(gameId, pawn.team, 'tradeBlocked'),
    })
    if (!out.ok) {
      const why: Record<string, string> = {
        ownTeam: '우리 팀이다.',
        tooManyPending: '답 없는 제안이 너무 많다.',
        blocked: '교역이 막혀 있다.',
        empty: '주고받을 것이 없다.',
      }
      throw new HttpsError('failed-precondition', why[out.reason as string] ?? '보낼 수 없다.')
    }

    const doc = await tradesOf(gameId).add({
      fromTeam: pawn.team,
      toTeam,
      give,
      want,
      // 덧붙인 말은 판정에 쓰이지 않는다. 손으로 친 말은 세지 않는다
      note: typeof req.data.note === 'string' ? req.data.note.slice(0, 200) : '',
      byId: uid,
      createdAtMs: nowMs,
      status: 'open',
      accord: false,
    })
    await ref.collection('events').doc().set({
      atMs: nowMs,
      day: (await ref.get()).get('day'),
      kind: 'tradeProposed',
      team: pawn.team,
      playerId: uid,
      detail: { toTeam },
    })
    // 제안도 각자 몫으로 깎아 보내야 보인다. 이걸 빼먹으면 보낸
    // 사람조차 자기 제안을 못 본다
    await refreshViews(gameId)
    return { id: doc.id }
  },
)

export const respondTrade = onCall<{ gameId: string; tradeId: string; accept: boolean }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, tradeId } = req.data
  const { game, nowMs } = await freshNow(gameId)
  const pawn = await myPawn(gameId, uid)
  const ref = gameRef(gameId)

  return db.runTransaction(async (tx) => {
    const tradeRef = tradesOf(gameId).doc(tradeId)
    const snap = await tx.get(tradeRef)
    if (!snap.exists) throw new HttpsError('not-found', '그런 제안이 없다.')
    const t = snap.data() as TradeOffer & { toTeam: TeamId; fromTeam: TeamId; status: string }
    if (t.status !== 'open') throw new HttpsError('failed-precondition', '이미 끝난 제안이다.')
    if (t.toTeam !== pawn.team) throw new HttpsError('permission-denied', '우리에게 온 제안이 아니다.')

    if (!req.data.accept) {
      tx.update(tradeRef, { status: 'declined', closedAtMs: nowMs })
      tx.set(ref.collection('events').doc(), {
        atMs: nowMs,
        day: game.day,
        kind: 'tradeDeclined',
        team: pawn.team,
        detail: { fromTeam: t.fromTeam },
      })
      return { accepted: false }
    }

    const [fromSnap, toSnap] = await Promise.all([
      tx.get(ref.collection('teams').doc(t.fromTeam)),
      tx.get(ref.collection('teams').doc(t.toTeam)),
    ])
    const from = fromSnap.data() as TeamDoc
    const to = toSnap.data() as TeamDoc

    // 받아들이는 순간 다시 센다
    const out = acceptTrade(t, from.resources, to.resources)
    if (!out.ok) {
      throw new HttpsError(
        'failed-precondition',
        out.reason === 'senderShort' ? '보낸 쪽 자원이 모자라다.' : '우리 자원이 모자라다.',
      )
    }

    tx.update(ref.collection('teams').doc(t.fromTeam), { resources: out.fromResources })
    tx.update(ref.collection('teams').doc(t.toTeam), { resources: out.toResources })
    tx.update(tradeRef, { status: 'accepted', closedAtMs: nowMs })
    tx.set(ref.collection('events').doc(), {
      atMs: nowMs,
      day: game.day,
      kind: 'tradeAccepted',
      team: pawn.team,
      detail: { fromTeam: t.fromTeam, give: t.give, want: t.want },
    })
    return { accepted: true }
  }).then(async (r) => {
    await refreshViews(gameId)
    return r
  })
})

// ── 동맹 ────────────────────────────────────────────────────────

export const proposeAlliance = onCall<{ gameId: string; withTeam: TeamId }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, withTeam } = req.data
  const { game, nowMs } = await freshNow(gameId)
  const pawn = await myPawn(gameId, uid)
  if (!TEAMS.includes(withTeam)) throw new HttpsError('invalid-argument', '그런 팀은 없다.')
  const ref = gameRef(gameId)

  const [usSnap, themSnap] = await Promise.all([
    ref.collection('teams').doc(pawn.team).get(),
    ref.collection('teams').doc(withTeam).get(),
  ])
  const us = usSnap.data() as TeamDoc
  const them = themSnap.data() as TeamDoc

  const out = canAlly({
    us: { allyTeam: us.allyTeam, lockUntilRealMs: us.allianceLockUntilRealMs ?? null },
    them: { allyTeam: them.allyTeam, lockUntilRealMs: them.allianceLockUntilRealMs ?? null },
    ourTeam: pawn.team,
    theirTeam: withTeam,
    realNowMs: Date.now(),
    lastHours: game.lastHours,
  })
  if (!out.ok) {
    const why: Record<string, string> = {
      ownTeam: '우리 팀이다.',
      alreadyAllied: '이미 동맹이 있다.',
      theyAreAllied: '그 팀은 이미 동맹이 있다.',
      locked: '아직 새 동맹을 맺을 수 없다.',
      lastHours: '마지막 여섯 시간에는 못 맺는다.',
    }
    throw new HttpsError('failed-precondition', why[out.reason as string] ?? '맺을 수 없다.')
  }

  // 상대가 받아들여야 성립한다. 한쪽이 누른다고 되지 않는다
  const doc = await proposalsOf(gameId).add({
    fromTeam: pawn.team,
    toTeam: withTeam,
    byId: uid,
    createdAtMs: nowMs,
    status: 'open',
  })
  await refreshViews(gameId)
  return { id: doc.id }
})

export const respondAlliance = onCall<{ gameId: string; proposalId: string; accept: boolean }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, proposalId } = req.data
  const { game, nowMs } = await freshNow(gameId)
  const pawn = await myPawn(gameId, uid)
  const ref = gameRef(gameId)

  const result = await db.runTransaction(async (tx) => {
    const propRef = proposalsOf(gameId).doc(proposalId)
    const snap = await tx.get(propRef)
    if (!snap.exists) throw new HttpsError('not-found', '그런 제안이 없다.')
    const p = snap.data() as { fromTeam: TeamId; toTeam: TeamId; status: string }
    if (p.status !== 'open') throw new HttpsError('failed-precondition', '이미 끝난 제안이다.')
    if (p.toTeam !== pawn.team) throw new HttpsError('permission-denied', '우리에게 온 제안이 아니다.')

    if (!req.data.accept) {
      tx.update(propRef, { status: 'declined', closedAtMs: nowMs })
      return { allied: false }
    }

    const [usSnap, themSnap] = await Promise.all([
      tx.get(ref.collection('teams').doc(p.toTeam)),
      tx.get(ref.collection('teams').doc(p.fromTeam)),
    ])
    const us = usSnap.data() as TeamDoc
    const them = themSnap.data() as TeamDoc

    // 제안한 뒤에 상황이 바뀌었을 수 있다. 여기서 다시 본다
    const ok = canAlly({
      us: { allyTeam: us.allyTeam, lockUntilRealMs: us.allianceLockUntilRealMs ?? null },
      them: { allyTeam: them.allyTeam, lockUntilRealMs: them.allianceLockUntilRealMs ?? null },
      ourTeam: p.toTeam,
      theirTeam: p.fromTeam,
      realNowMs: Date.now(),
      lastHours: game.lastHours,
    })
    if (!ok.ok) throw new HttpsError('failed-precondition', '지금은 맺을 수 없다.')

    tx.update(ref.collection('teams').doc(p.toTeam), { allyTeam: p.fromTeam })
    tx.update(ref.collection('teams').doc(p.fromTeam), { allyTeam: p.toTeam })
    tx.update(propRef, { status: 'accepted', closedAtMs: nowMs })
    tx.set(ref.collection('events').doc(), {
      atMs: nowMs,
      day: game.day,
      kind: 'allianceFormed',
      team: p.toTeam,
      detail: { with: p.fromTeam },
    })
    return { allied: true, with: p.fromTeam }
  })
  await refreshViews(gameId)
  return result
})

/** 먼저 깬다. 영향력 2를 잃고 열두 시간 동안 새 동맹을 못 맺는다. */
export const breakAllianceNow = onCall<{ gameId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const { game, nowMs } = await freshNow(gameId)
  const pawn = await myPawn(gameId, uid)
  const ref = gameRef(gameId)

  const result = await db.runTransaction(async (tx) => {
    const usRef = ref.collection('teams').doc(pawn.team)
    const usSnap = await tx.get(usRef)
    const us = usSnap.data() as TeamDoc
    if (!us.allyTeam) throw new HttpsError('failed-precondition', '동맹이 없다.')
    const themRef = ref.collection('teams').doc(us.allyTeam)
    const themSnap = await tx.get(themRef)
    const them = themSnap.data() as TeamDoc

    const out = breakAlliance(Date.now())
    tx.update(usRef, {
      allyTeam: null,
      allianceLockUntilRealMs: out.breaker.lockUntilRealMs,
      resources: {
        ...us.resources,
        // 영향력은 0 아래로 내려가지 않는다
        influence: Math.max(0, us.resources.influence - ALLIANCE_BREAK_INFLUENCE_PENALTY),
      },
    })
    // 당한 쪽은 아무것도 잃지 않고 잠기지도 않는다
    tx.update(themRef, { allyTeam: null })
    tx.set(ref.collection('events').doc(), {
      atMs: nowMs,
      day: game.day,
      kind: 'allianceBroken',
      team: pawn.team,
      detail: { with: us.allyTeam, penalty: out.influencePenalty },
    })
    return { broke: us.allyTeam, penalty: out.influencePenalty, theirResources: them.resources }
  })
  await refreshViews(gameId)
  return { broke: result.broke, penalty: result.penalty }
})
