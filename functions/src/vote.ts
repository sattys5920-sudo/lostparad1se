// 표.
//
// 표는 익명이다. **보낸 사람은 secret/votes에만 있고 어디로도 나가지
// 않는다** — 화면에도, 운영자 대시보드에도. 정산에서 팀 합계만 나간다.
//
// 털어놓기가 여기 같이 있었다. 숨긴 사실을 걷어내면서 없앴다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

import { canCast } from '../../shared/rules/votes'
import type { VoteKind } from '../../shared/rules/v2'
import type { PawnDoc, VoteDoc } from '../../shared/model'
import { refreshViews } from './views'
import { freshNow, myPawn } from './turn'
import { gameRef, requireUid } from './index'

const db = getFirestore()

// 표는 호의뿐이다. 배제는 투명인간 투표가 따로 맡는다(ballot.ts)
const VOTE_KINDS: VoteKind[] = ['trust', 'liking']

/** 하루 한 장. 같은 팀에는 못 준다. 자정~21:00. */
export const castVote = onCall<{ gameId: string; targetId: string; kind: VoteKind }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, targetId, kind } = req.data
  if (!VOTE_KINDS.includes(kind)) throw new HttpsError('invalid-argument', '그런 표는 없다.')
  const { game, nowMs } = await freshNow(gameId)
  const ref = gameRef(gameId)

  // **지워진 사람도 표는 준다.** 믿는다고 말하는 일까지 빼앗지는
  // 않는다 — 받는 쪽은 아래에서 따로 막는다
  const [me, target] = await Promise.all([myPawn(gameId, uid), ref.collection('pawns').doc(targetId).get()])
  if (!target.exists) throw new HttpsError('not-found', '그런 사람이 없다.')
  const you = target.data() as PawnDoc

  // 그 사람 앞에 서야 준다. 믿는다고 말하려면 걸어가야 한다
  if (me.tileId === null) throw new HttpsError('failed-precondition', '걷는 중에는 표를 줄 수 없다.')
  if (you.tileId !== me.tileId) throw new HttpsError('failed-precondition', '같은 자리에 있는 사람에게만 줄 수 있다.')

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

  const vote: VoteDoc = {
    day: game.day,
    voterId: uid,
    voterTeam: me.team,
    targetId,
    targetTeam: you.team,
    kind,
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
