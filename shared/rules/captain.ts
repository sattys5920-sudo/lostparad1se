// 팀장 — 날마다 팀이 투표로 뽑는다.
//
// 전에는 세 명짜리 팀의 주장이 자리 순서대로 하루씩 돌았다. 돌리는
// 것은 공평하지만 아무 뜻도 없다 — 누가 맡을지를 팀이 정하지 않으면
// 팀장은 직책이 아니라 순번이다.
//
// **네 팀이 다 뽑는다.** 다만 점령 판정에서 둘로 세는 것은 **세 명인
// 팀의 팀장뿐**이다. 그것은 직책의 힘이 아니라 네 명인 팀과 머릿수를
// 맞추는 보정이라, 네 명인 팀에까지 붙이면 맞추려던 것이 도로 벌어진다.
//
// **동점이면 다시 뽑는다.** 풀릴 때까지 되풀이한다 — 팀이 못 정한
// 것을 규칙이 대신 정해 주지 않는다. 정할 때까지 그 팀에는 팀장이
// 없고, 세 명인 팀은 그동안 머릿수 보정도 없다.
import type { TeamId } from './v2'

/** 한 차례 — 무전으로 상의하는 시간. 투표 창은 이만큼 뒤에 열린다. */
export const CAPTAIN_TALK_MINUTES = 10

/** 투표 창이 열려 있는 시간. 지나면 그때까지 모인 표로 센다. */
export const CAPTAIN_VOTE_MINUTES = 5

/** teams/{teamId}.captainVote — 지금 몇 차례째를 하고 있는가. */
export interface CaptainVote {
  day: number
  /** 1부터. 동점이면 하나씩 오른다. */
  round: number
  /** 투표 창이 열리는 게임 시각. 그전까지는 상의만 한다. */
  opensAtMs: number
  /** 닫히는 게임 시각. 지나면 그때까지 모인 표로 센다. */
  closesAtMs: number
}

export interface CaptainBallot {
  voterId: string
  targetId: string
}

/** 한 차례의 창을 짠다. 상의가 먼저고 투표가 뒤다. */
export function roundAt(day: number, round: number, fromMs: number): CaptainVote {
  const opensAtMs = fromMs + CAPTAIN_TALK_MINUTES * 60_000
  return {
    day,
    round,
    opensAtMs,
    closesAtMs: opensAtMs + CAPTAIN_VOTE_MINUTES * 60_000,
  }
}

export type VotePhase = 'talking' | 'open' | 'closed'

export function phaseOf(vote: CaptainVote, nowMs: number): VotePhase {
  if (nowMs < vote.opensAtMs) return 'talking'
  if (nowMs < vote.closesAtMs) return 'open'
  return 'closed'
}

/**
 * 표를 세어 팀장을 고른다.
 *
 * **팀 사람에게 준 표만 센다.** 자기를 적는 것은 된다 — 맡겠다고
 * 나서는 것도 뜻이고, 그것까지 막으면 셋이 서로를 가리키다 끝난다.
 *
 * 최다가 하나면 그 사람이다. 둘 이상이거나 한 장도 없으면 못 정한
 * 것이라, 다시 뽑는다.
 */
export function tallyCaptain(
  ballots: readonly CaptainBallot[],
  members: readonly string[],
): { winner: string | null; tied: boolean } {
  const ok = new Set(members)
  const count = new Map<string, number>()
  for (const b of ballots) {
    if (!ok.has(b.targetId) || !ok.has(b.voterId)) continue
    count.set(b.targetId, (count.get(b.targetId) ?? 0) + 1)
  }
  if (count.size === 0) return { winner: null, tied: true }
  const top = Math.max(...count.values())
  const best = [...count].filter(([, n]) => n === top).map(([id]) => id)
  return best.length === 1 ? { winner: best[0], tied: false } : { winner: null, tied: true }
}

/** 점령 판정에서 둘로 세는가. **세 명인 팀의 팀장만이다.** */
export function countsDouble(teamSize: number, isCaptain: boolean): boolean {
  return isCaptain && teamSize < 4
}

/** 화면에 적는 한 줄. 서버가 거절할 때와 같은 말이다. */
export const CAPTAIN_NO = {
  notOpen: '아직 투표 창이 안 열렸다',
  over: '투표가 닫혔다',
  otherTeam: '우리 팀 사람만 적을 수 있다',
  settled: '오늘 팀장은 이미 정해졌다',
} as const

export type CaptainNo = keyof typeof CAPTAIN_NO

export function whyNotVote(input: {
  vote: CaptainVote | null
  settled: boolean
  nowMs: number
  sameTeam: boolean
}): CaptainNo | null {
  if (input.settled) return 'settled'
  if (!input.vote) return 'notOpen'
  if (!input.sameTeam) return 'otherTeam'
  const at = phaseOf(input.vote, input.nowMs)
  if (at === 'talking') return 'notOpen'
  if (at === 'closed') return 'over'
  return null
}

/** 팀 이름을 그대로 쓰는 자리가 많아 한 군데 모은다. */
export type CaptainByTeam = Partial<Record<TeamId, string | null>>
