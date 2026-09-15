// 동맹.
//
// 동맹은 한 번에 하나다. 먼저 깬 팀은 열두 시간 동안 새
// 동맹을 못 맺는다. DAY 4 가 열릴 때는 모든 동맹이 그냥 풀린다 — 먼저 깬
// 것이 아니므로 아무도 값을 치르지 않는다.
//
// 거래는 여기 없다. 마주 앉아 양쪽이 각자 물건을 올리는 방식이라
// deals.ts 가 따로 맡는다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

import { breakAlliance, canAlly } from '../../shared/rules/diplomacy'
import type { TeamId } from '../../shared/rules/v2'
import { TEAMS } from '../../shared/rules/lobby'
import type { TeamDoc } from '../../shared/model'
import { refreshViews } from './views'
import { freshNow, myPawn, standingWith } from './turn'
import { gameRef, requireUid } from './index'

const db = getFirestore()

/**
 * 동맹 제안은 **서버만 읽는다.**
 *
 * 네 팀이 서로의 제안을 다 볼 수 있으면 협상이 협상이 아니다. 관련된
 * 두 팀에게만 views로 깎여 간다.
 */
const proposalsOf = (gameId: string) => gameRef(gameId).collection('secret').doc('alliances').collection('items')

/**
 * 그 팀 사람과 **마주 서야** 동맹을 꺼낼 수 있다.
 *
 * 동맹은 팀 대 팀이지만, 말을 꺼내는 것은 사람이다. 학교 반대편에서
 * 제안이 날아오면 「뺏으려면 걸어가야 한다」가 자원에만 적용되고 말에는
 * 적용되지 않는 셈이 된다.
 */
async function requireFacing(gameId: string, uid: string, team: TeamId, what: string): Promise<void> {
  const { here } = await standingWith(gameId, uid)
  for (const [, p] of here) if (p.team === team) return
  throw new HttpsError('failed-precondition', `${team}팀 사람과 같은 자리에 서야 ${what}을 꺼낼 수 있다.`)
}

// ── 동맹 ────────────────────────────────────────────────────────

export const proposeAlliance = onCall<{ gameId: string; withTeam: TeamId }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, withTeam } = req.data
  const { game, nowMs } = await freshNow(gameId)
  const pawn = await myPawn(gameId, uid)
  if (!TEAMS.includes(withTeam)) throw new HttpsError('invalid-argument', '그런 팀은 없다.')
  await requireFacing(gameId, uid, withTeam, '동맹')
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

/** 먼저 깬다. 열두 시간 동안 새 동맹을 못 맺는다. */
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
    })
    // 당한 쪽은 아무것도 잃지 않고 잠기지도 않는다
    tx.update(themRef, { allyTeam: null })
    tx.set(ref.collection('events').doc(), {
      atMs: nowMs,
      day: game.day,
      kind: 'allianceBroken',
      team: pawn.team,
      detail: { with: us.allyTeam },
    })
    return { broke: us.allyTeam, theirResources: them.resources }
  })
  await refreshViews(gameId)
  return { broke: result.broke }
})
