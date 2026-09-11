// 표와 털어놓기.
//
// 표는 익명이다. **보낸 사람은 secret/votes에만 있고 어디로도 나가지
// 않는다** — 화면에도, 운영자 대시보드에도. 정산에서 팀 합계만 나간다.
//
// 털어놓기는 반대다. 스스로 입을 여는 일이라 공인된 고백으로 남고,
// 들은 사람은 그 사람의 약점을 쥔다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

import { canCast } from '../../shared/rules/votes'
import { revealInfluenceGain } from '../../shared/rules/reveal'
import { applyInfluence } from '../../shared/rules/votes'
import { REVEAL_INFLUENCE_CAP, type RevealScope, type VoteKind } from '../../shared/rules/v2'
import { ROLE_BY_ID } from '../../shared/missions/roles'
import { FRAGMENT_BY_DAY } from './story/fragments'
import type { LeverageDoc, PawnDoc, RosterDoc, TeamDoc, VoteDoc } from '../../shared/model'
import { refreshViews } from './views'
import { freshNow, myPawn } from './turn'
import { gameRef, requireUid } from './index'

const db = getFirestore()

const VOTE_KINDS: VoteKind[] = ['trust', 'liking', 'suspicion']

/**
 * 그날 A의 기록이 가리킨 역할을 정확히 짚었는가.
 *
 * **서버에서만 본다.** 가리켜진 역할 목록을 내려보내면 「정확히
 * 짚으면 두 배」가 추리가 아니라 조회가 된다.
 */
function isExactHit(day: number, targetRole: string | undefined): boolean {
  if (!targetRole) return false
  const implicated = FRAGMENT_BY_DAY[day]?.implicated ?? []
  return implicated.includes(targetRole as (typeof implicated)[number])
}

/** 하루 한 장. 같은 팀에는 못 준다. 08:00~21:00. */
export const castVote = onCall<{ gameId: string; targetId: string; kind: VoteKind }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, targetId, kind } = req.data
  if (!VOTE_KINDS.includes(kind)) throw new HttpsError('invalid-argument', '그런 표는 없다.')
  const { game, nowMs } = await freshNow(gameId)
  const ref = gameRef(gameId)

  const [me, target] = await Promise.all([myPawn(gameId, uid), ref.collection('pawns').doc(targetId).get()])
  if (!target.exists) throw new HttpsError('not-found', '그런 사람이 없다.')
  const you = target.data() as PawnDoc

  // 지워진 사람은 표를 받지 않는다. 없는 사람이다
  if (game.invisibleId === targetId) throw new HttpsError('failed-precondition', '지금은 그 사람에게 줄 수 없다.')

  const out = canCast({
    voterId: uid,
    voterTeam: me.team,
    targetId,
    targetTeam: you.team,
    atMs: nowMs,
    votedToday: me.votedToday,
  })
  if (!out.ok) {
    const why: Record<string, string> = {
      closed: '지금은 표를 던질 수 없다.',
      self: '자기에게는 못 준다.',
      ownTeam: '같은 팀에는 못 준다.',
      alreadyToday: '오늘은 이미 던졌다.',
    }
    throw new HttpsError('failed-precondition', why[out.reason as string] ?? '던질 수 없다.')
  }

  // 역할은 명단에서만 본다. 이 값은 응답에 담지 않는다
  const roleSnap = await ref.collection('secret').doc('roster').collection('items').doc(targetId).get()
  const targetRole = (roleSnap.data() as RosterDoc | undefined)?.roleId
  const exactHit = kind === 'suspicion' && isExactHit(game.day, targetRole)

  const vote: VoteDoc = {
    day: game.day,
    voterId: uid,
    voterTeam: me.team,
    targetId,
    targetTeam: you.team,
    kind,
    exactHit,
    castAtMs: nowMs,
    settled: false,
  }
  const batch = db.batch()
  batch.set(ref.collection('secret').doc('votes').collection('items').doc(), vote)
  batch.update(ref.collection('pawns').doc(uid), { votedToday: true })
  batch.set(ref.collection('events').doc(), {
    atMs: nowMs,
    day: game.day,
    kind: 'vote',
    // 보낸 사람도 받은 사람도 기록에 남기지 않는다. 정산에서 팀 합계만 쓴다
    detail: {},
  })
  await batch.commit()
  await refreshViews(gameId)
  // 짚었는지도 알려 주지 않는다. 알려 주면 역할을 하나씩 찍어 볼 수 있다
  return { cast: kind }
})

// ── 털어놓기 ────────────────────────────────────────────────────

/**
 * 숨긴 사실을 털어놓는다.
 *
 *   첫 1:1        영향력 +3, 들은 사람이 약점을 쥔다
 *   그다음 1:1    영향력 0   — 약점만 늘어난다
 *   전체          남은 만큼을 6까지 채운다. 아무도 약점을 쥐지 않는다
 *
 * 「나 털어놓을게」라고 채팅에 쓰는 것과 실제로 털어놓는 것은 완전히
 * 다른 일이다. 게임은 후자만 센다.
 */
export const revealSecret = onCall<{ gameId: string; scope: RevealScope; listenerIds?: string[] }>(
  async (req) => {
    const uid = requireUid(req.auth)
    const { gameId, scope } = req.data
    if (scope !== 'class' && scope !== 'private') throw new HttpsError('invalid-argument', '그런 방식은 없다.')
    const { game, nowMs } = await freshNow(gameId)
    const ref = gameRef(gameId)

    const me = await myPawn(gameId, uid)
    const roleSnap = await ref.collection('secret').doc('roster').collection('items').doc(uid).get()
    if (!roleSnap.exists) throw new HttpsError('permission-denied', '이 판에 없는 사람이다.')
    const row = roleSnap.data() as RosterDoc
    const secretText = ROLE_BY_ID[row.roleId as keyof typeof ROLE_BY_ID]?.secret
    if (!secretText) throw new HttpsError('internal', '숨긴 사실을 찾지 못했다.')

    // 전체면 자기를 뺀 열셋, 1:1이면 고른 사람들
    let listenerIds: string[]
    if (scope === 'class') {
      const all = await ref.collection('pawns').get()
      listenerIds = all.docs.map((d) => d.id).filter((id) => id !== uid)
    } else {
      listenerIds = [...new Set((req.data.listenerIds ?? []).filter((id) => id !== uid))]
      if (listenerIds.length === 0) throw new HttpsError('invalid-argument', '들을 사람을 골라야 한다.')
      const pawns = await ref.collection('pawns').get()
      const known = new Set(pawns.docs.map((d) => d.id))
      if (listenerIds.some((id) => !known.has(id))) throw new HttpsError('not-found', '그런 사람이 없다.')
    }

    const gained = (await ref.collection('secret').doc('reveals').collection('items').doc(uid).get()).data() as
      | { gained: number }
      | undefined
    const already = gained?.gained ?? 0
    const gain = revealInfluenceGain(already, scope)

    const teamSnap = await ref.collection('teams').doc(me.team).get()
    const teamDoc = teamSnap.data() as TeamDoc

    const batch = db.batch()
    batch.set(ref.collection('secret').doc('confessions').collection('items').doc(), {
      speakerId: uid,
      scope,
      listenerIds,
      // 원문 그대로 남는다. 공인된 고백이다
      text: secretText,
      atMs: nowMs,
    })
    batch.set(ref.collection('secret').doc('reveals').collection('items').doc(uid), {
      gained: Math.min(REVEAL_INFLUENCE_CAP, already + gain),
    })
    batch.update(ref.collection('teams').doc(me.team), {
      resources: { ...teamDoc.resources, influence: applyInfluence(teamDoc.resources.influence, gain) },
    })
    batch.update(ref.collection('secret').doc('roster').collection('items').doc(uid), {
      reveal: { scope, atMs: nowMs, listenerIds },
    })

    // 1:1로 들은 사람은 그 사람의 약점을 쥔다. 전체 고백은 아무도 안 쥔다
    if (scope === 'private') {
      for (const listener of listenerIds) {
        const lev: LeverageDoc = {
          holderId: listener,
          aboutId: uid,
          gainedAtMs: nowMs,
          spentAs: null,
        }
        batch.set(ref.collection('secret').doc('leverage').collection('items').doc(), lev)
      }
    }

    batch.set(ref.collection('events').doc(), {
      atMs: nowMs,
      day: game.day,
      kind: 'reveal',
      team: me.team,
      playerId: uid,
      detail: { scope, listeners: listenerIds.length, gain },
    })
    await batch.commit()
    await refreshViews(gameId)
    return { scope, listeners: listenerIds.length, gain }
  },
)
