// 표.
//
// 표는 익명이다. **보낸 사람은 secret/votes에만 있고 어디로도 나가지
// 않는다** — 화면에도, 운영자 대시보드에도. 정산에서는 팀 합계, 운영자
// 화면에서는 사람별 종류별 합계까지만 나간다(hostVotes). 「누가 줬는지」
// 만 끝까지 감춘다.
//
// 털어놓기가 여기 같이 있었다. 숨긴 사실을 걷어내면서 없앴다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

import { canCast } from '../../shared/rules/votes'
import { cellsTouch } from '../../shared/rules/board'
import type { VoteKind } from '../../shared/rules/v2'
import type { GameDoc, PawnDoc, VoteDoc } from '../../shared/model'
import { refreshViews } from './views'
import { freshNow, myPawn } from './turn'
import { gameRef, requireUid } from './index'
import { requireHost } from './host'
import { docId } from './ids'

const db = getFirestore()

// 표는 호의뿐이다. 배제는 투명인간 투표가 따로 맡는다(ballot.ts)
const VOTE_KINDS: VoteKind[] = ['trust', 'liking']

/** 하루 한 장. 같은 팀에는 못 준다. 자정~21:00. */
export const castVote = onCall<{ gameId: string; targetId: string; kind: VoteKind }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, kind } = req.data
  if (!VOTE_KINDS.includes(kind)) throw new HttpsError('invalid-argument', '그런 표는 없다.')
  const targetId = docId(req.data.targetId, '그런 사람이 없다.')
  const { game, nowMs } = await freshNow(gameId)
  const ref = gameRef(gameId)

  // **지워진 사람도 표는 준다.** 믿는다고 말하는 일까지 빼앗지는
  // 않는다 — 받는 쪽은 아래에서 따로 막는다
  const [me, target] = await Promise.all([myPawn(gameId, uid), ref.collection('pawns').doc(targetId).get()])
  if (!target.exists) throw new HttpsError('not-found', '그런 사람이 없다.')
  const you = target.data() as PawnDoc

  // 그 사람 옆에 서야 준다. **정확히 같은 칸일 수는 없다** — 한 칸에
  // 둘이 서지 못하도록 캐릭터끼리 겹치지 않게 자리를 잡기 때문이다.
  // 거래(deal.ts)와 같은 기준으로 옆 칸이면 된다
  if (me.tileId === null) throw new HttpsError('failed-precondition', '걷는 중에는 표를 줄 수 없다.')
  if (!cellsTouch(me.at, you.at)) throw new HttpsError('failed-precondition', '옆 칸에 있는 사람에게만 줄 수 있다.')

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

/**
 * 운영자 — 사람마다 받은 표. **종류별 합계까지만** 나간다. 누가 줬는지는
 * 여기서도 안 나간다(secret/votes 는 이 함수 밖으로 통째로 안 나간다).
 * 오늘 것도 센다 — 판정과 달리 운영자는 지금 상황을 보는 것이다.
 */
export const hostVotes = onCall<{ gameId: string }>(async (req) => {
  requireHost(req.auth)
  const { gameId } = req.data
  const gameSnap = await gameRef(gameId).get()
  if (!gameSnap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  const game = gameSnap.data() as GameDoc

  const voteS = await gameRef(gameId).collection('secret').doc('votes').collection('items').get()
  const totals = new Map<string, { trust: number; liking: number }>()
  for (const d of voteS.docs) {
    const v = d.data() as VoteDoc
    const row = totals.get(v.targetId) ?? { trust: 0, liking: 0 }
    row[v.kind] += 1
    totals.set(v.targetId, row)
  }

  return {
    rows: game.seats.map((s) => {
      const row = totals.get(s.playerId) ?? { trust: 0, liking: 0 }
      return { playerId: s.playerId, name: s.name, team: s.team, trust: row.trust, liking: row.liking }
    }),
  }
})

// ── 털어놓기 ────────────────────────────────────────────────────
