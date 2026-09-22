// 표.
//
// **표는 금고를 움직이지 않는다.** 영향력이 있을 때는 신뢰 한 장이
// +2였지만, 쓸 데 없는 숫자를 걷어내면서 그 값도 같이 없앴다. 남은 것은
// 받은 표의 수뿐이고, 그 수가 「모두의 신뢰」 같은 목표를 판정한다.
//
// 표는 익명이다. 보낸 사람은 secret/에만 있고, 정산 때 팀 합계만 나간다.
// 여기서 「누가 줬는지」를 돌려주는 함수는 정보부장 열람 하나뿐이고,
// 그것도 서버에서만 부른다.
import {
  TEAM_IDS,
  VOTE_CLOSE_HOUR,
  VOTE_OPEN_HOUR,
  type TeamId,
  type VoteKind,
} from './v2'
import { secondsIntoSeoulDay } from './clock'

/** 표 한 장. 이 모양 그대로는 클라이언트에 가지 않는다. */
export interface Vote {
  voterId: string
  voterTeam: TeamId
  targetId: string
  targetTeam: TeamId
  kind: VoteKind
  /**
   * 의심표를 던지며 그날 A의 기록이 가리킨 역할을 정확히 짚었는가.
   * 역할 판정은 개인 미션 쪽에서 하고, 여기에는 답만 들어온다 —
   * 표 계산이 역할 데이터를 알 필요는 없다.
   */
  atMs: number
}

export type VoteRefusal = 'self' | 'alreadyToday' | 'closed'

export interface CastInput {
  voterId: string
  voterTeam: TeamId
  targetId: string
  targetTeam: TeamId
  atMs: number
  /** 오늘 이미 던졌는가. */
  votedToday: boolean
}

/**
 * 던질 수 있는가. 하루 한 장, 08:00~21:00.
 *
 * **우리 팀에도 준다.** 남의 팀에만 줄 수 있던 때가 있었다. 표를
 * 팀 사이의 외교로 본 것인데, 표는 그런 것이 아니다 — 닷새를 같이
 * 지낸 사람에게 한 장을 건네는 일이고, 그 사람이 옆자리일 수도 있다.
 * 막아 두면 제 팀에게는 고맙다는 말도 못 한다.
 *
 * 나에게는 여전히 못 준다. 그건 건네는 것이 아니다.
 */
export function canCast(input: CastInput): { ok: boolean; reason: VoteRefusal | null } {
  const s = secondsIntoSeoulDay(input.atMs)
  if (s < VOTE_OPEN_HOUR * 3600 || s >= VOTE_CLOSE_HOUR * 3600) return { ok: false, reason: 'closed' }
  if (input.voterId === input.targetId) return { ok: false, reason: 'self' }
  if (input.votedToday) return { ok: false, reason: 'alreadyToday' }
  return { ok: true, reason: null }
}

export interface TallyInput {
  votes: readonly Vote[]
}

export interface TallyRow {
  team: TeamId
  /** 이 팀이 받은 표 수. 누가 줬는지는 들어 있지 않다. */
  received: Record<VoteKind, number>
}

/**
 * 정산에 반영할 팀별 합계. 이 결과만 공개된다.
 *
 * 보낸 사람은 어디에도 들어 있지 않다 — 받은 표 수뿐이다. 네 명짜리
 * 팀의 합계에서 누가 누구에게 줬는지는 되짚을 수 없다.
 */
export function tallyVotes(input: TallyInput): Record<TeamId, TallyRow> {
  const out = {} as Record<TeamId, TallyRow>
  for (const team of TEAM_IDS) {
    out[team] = { team, received: { trust: 0, liking: 0 } }
  }
  for (const v of input.votes) out[v.targetTeam].received[v.kind] += 1
  return out
}

// ── 정보부장 열람 ───────────────────────────────────────────────

/**
 * 우리 팀이 받은 표 한 장의 보낸 사람. **서버에서만 부른다.**
 *
 * 하루 한 번이라는 제한은 부르는 쪽에서 센다. 여기서는 그 팀이 받은
 * 표만 고르고, 다른 팀 표는 목록에 넣지 않는다.
 */
export function peekVoter(votes: readonly Vote[], team: TeamId, index: number): string | null {
  const mine = votes.filter((v) => v.targetTeam === team)
  const pick = mine[Math.max(0, Math.floor(index)) % Math.max(1, mine.length)]
  return pick ? pick.voterId : null
}
