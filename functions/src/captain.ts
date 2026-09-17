// 팀장 투표 — 서버 쪽.
//
// 하루가 열리면 네 팀에 각각 한 차례가 걸린다. **상의가 먼저고 투표가
// 뒤다** — 무전으로 이야기할 시간을 두고 나서 창이 열린다. 창이 닫히면
// 그때까지 모인 표로 센다.
//
// **동점이면 다시 건다.** 풀릴 때까지 되풀이한다. 정할 때까지 그 팀에는
// 팀장이 없고, 세 명인 팀은 그동안 머릿수 보정도 없다 — 못 정한 값을
// 규칙이 대신 메워 주지 않는다.
//
// **누가 누구를 적었는지는 서버 밖으로 안 나간다.** 결과 한 줄만 나간다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'

import {
  CAPTAIN_NO,
  countsDouble,
  roundAt,
  tallyCaptain,
  whyNotVote,
  type CaptainBallot,
  type CaptainVote,
} from '../../shared/rules/captain'
import { TEAMS } from '../../shared/rules/lobby'
import type { TeamId } from '../../shared/rules/v2'
import type { GameDoc, PawnDoc, TeamDoc } from '../../shared/model'
import { freshNow, myPawn } from './turn'
import { gameRef, nowOf, requireUid } from './index'

/** games/{gameId}/secret/captainBallots/items/{day}-{round}-{team}-{voterId} */
const ballotsOf = (gameId: string) =>
  gameRef(gameId).collection('secret').doc('captainBallots').collection('items')

const keyOf = (day: number, round: number, team: TeamId, voterId: string) =>
  `${day}-${round}-${team}-${voterId}`

/** 그 팀 사람들. 자리표를 본다 — 이적은 자리표까지 같이 옮긴다. */
const membersOf = (game: GameDoc, team: TeamId): string[] =>
  game.seats.filter((s) => s.team === team).map((s) => s.playerId)

/**
 * 하루가 열릴 때 네 팀에 한 차례씩 건다.
 *
 * 어제 팀장은 여기서 내려온다. 새로 뽑을 때까지 그 팀에는 팀장이 없다 —
 * 어제 사람이 자리에 앉은 채로 새 투표를 하면, 못 정했을 때 어제
 * 사람이 계속 남아 「투표로 뽑는다」가 「투표로 바꿀 수도 있다」가 된다.
 */
export function openCaptainVotes(
  tx: FirebaseFirestore.Transaction,
  gameId: string,
  day: number,
  nowMs: number,
  pawns: FirebaseFirestore.QuerySnapshot,
): void {
  const ref = gameRef(gameId)
  for (const team of TEAMS) {
    tx.update(ref.collection('teams').doc(team), {
      captainId: null,
      captainVote: roundAt(day, 1, nowMs),
    })
  }
  for (const d of pawns.docs) {
    if ((d.data() as PawnDoc).captain === true) tx.update(d.ref, { captain: false })
  }
}

/**
 * 창이 닫힌 팀의 표를 센다. **아무 때나 불러도 된다** — 닫히지 않은
 * 팀은 건너뛰고, 이미 정한 팀도 건너뛴다.
 *
 * 시계가 아니라 사람이 부를 때 처리한다. 이 판의 다른 것들과 같은
 * 방식이다 — 예약해 둔 일이 조용히 안 돌아 있는 것보다, 누가 화면을
 * 열 때 밀린 것이 따라잡히는 편이 덜 틀린다.
 */
export async function settleCaptainVotes(gameId: string): Promise<void> {
  const ref = gameRef(gameId)
  // **freshNow 를 부르면 안 된다.** 그것은 따라잡기를 돌리는데, 이
  // 함수가 따라잡기 안에서도 불린다 — 서로를 부르며 영영 안 끝난다.
  // 판 문서를 그대로 읽고 이 판의 시계로 잰다
  const snap = await ref.get()
  if (!snap.exists) return
  const game = snap.data() as GameDoc
  if (game.phase !== 'running') return
  const nowMs = nowOf(game)
  const teams = await ref.collection('teams').get()

  for (const d of teams.docs) {
    const team = d.id as TeamId
    const t = d.data() as TeamDoc
    const vote = t.captainVote as CaptainVote | null | undefined
    if (!vote || t.captainId) continue
    if (nowMs < vote.closesAtMs) continue

    const members = membersOf(game, team)
    const rows = await ballotsOf(gameId)
      .where('day', '==', vote.day)
      .where('round', '==', vote.round)
      .where('team', '==', team)
      .get()
    const ballots = rows.docs.map((r) => r.data() as CaptainBallot)
    const out = tallyCaptain(ballots, members)

    if (out.tied) {
      // **다시 건다.** 지금부터 상의 시간을 새로 준다
      await d.ref.update({ captainVote: roundAt(vote.day, vote.round + 1, nowMs) })
      continue
    }
    await d.ref.update({ captainId: out.winner, captainVote: null })
    // 머릿수 두 배는 세 명인 팀의 팀장에게만 붙는다
    if (out.winner && countsDouble(members.length, true)) {
      await ref.collection('pawns').doc(out.winner).update({ captain: true })
    }
  }
}

/** 우리 팀 팀장으로 한 사람을 적는다. 한 차례에 한 장, 바꿔 적을 수 있다. */
export const voteCaptain = onCall<{ gameId: string; targetId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, targetId } = req.data
  // 밀린 차례가 있으면 먼저 정리한다. 안 그러면 닫힌 창에 표가 쌓인다
  await settleCaptainVotes(gameId)
  const { game, nowMs } = await freshNow(gameId)
  const mine = await myPawn(gameId, uid)

  const snap = await gameRef(gameId).collection('teams').doc(mine.team).get()
  const t = snap.data() as TeamDoc
  const vote = (t.captainVote ?? null) as CaptainVote | null
  const members = membersOf(game, mine.team)

  const no = whyNotVote({
    vote,
    settled: t.captainId != null,
    nowMs,
    sameTeam: members.includes(targetId),
  })
  if (no) throw new HttpsError('failed-precondition', `${CAPTAIN_NO[no]}.`)

  const v = vote as CaptainVote
  await ballotsOf(gameId)
    .doc(keyOf(v.day, v.round, mine.team, uid))
    .set({ day: v.day, round: v.round, team: mine.team, voterId: uid, targetId, atMs: nowMs })
  return { voted: true, round: v.round }
})

/**
 * 이적으로 팀장이 팀을 떠났을 때.
 *
 * 남은 사람들이 다시 뽑는다. **자리 순서로 대신 앉히지 않는다** —
 * 투표로 뽑기로 한 자리를 규칙이 말없이 채우면 그게 곧 예전 교대다.
 */
export function captainLeft(
  tx: FirebaseFirestore.Transaction,
  gameId: string,
  team: TeamId,
  day: number,
  nowMs: number,
): void {
  tx.update(gameRef(gameId).collection('teams').doc(team), {
    captainId: null,
    captainVote: roundAt(day, 1, nowMs),
  })
}
