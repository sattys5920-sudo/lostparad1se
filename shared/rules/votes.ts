// 표와 영향력.
//
// 영향력은 지도 위 어디에서도 생기지 않는다. 다른 팀 사람이 준 표,
// 털어놓은 비밀, 쥔 약점 — 이 세 군데서만 들어온다. 이 파일은 그중
// 첫째를 센다.
//
// 표는 익명이다. 보낸 사람은 secret/에만 있고, 정산 때 팀 합계만 나간다.
// 여기서 「누가 줬는지」를 돌려주는 함수는 정보부장 열람 하나뿐이고,
// 그것도 서버에서만 부른다.
import {
  BROADCAST_VOTE_BONUS,
  HIDEOUT_SUSPICION_RELIEF,
  FRAGMENT_HIT_MULTIPLIER,
  RUMOR_DECAY,
  RUMOR_DECAY_DAY,
  RUMOR_DECAY_MULTIPLIER,
  SPOTLIGHT_SUSPICION_EXTRA,
  SUSPICION_SELF_COST,
  TEAM_IDS,
  VOTE_CLOSE_HOUR,
  VOTE_INFLUENCE,
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
  exactHit?: boolean
  atMs: number
}

export type VoteRefusal = 'ownTeam' | 'self' | 'alreadyToday' | 'closed'

export interface CastInput {
  voterId: string
  voterTeam: TeamId
  targetId: string
  targetTeam: TeamId
  atMs: number
  /** 오늘 이미 던졌는가. */
  votedToday: boolean
}

/** 던질 수 있는가. 하루 한 장, 같은 팀에는 못 준다, 08:00~21:00. */
export function canCast(input: CastInput): { ok: boolean; reason: VoteRefusal | null } {
  const s = secondsIntoSeoulDay(input.atMs)
  if (s < VOTE_OPEN_HOUR * 3600 || s >= VOTE_CLOSE_HOUR * 3600) return { ok: false, reason: 'closed' }
  if (input.voterId === input.targetId) return { ok: false, reason: 'self' }
  if (input.voterTeam === input.targetTeam) return { ok: false, reason: 'ownTeam' }
  if (input.votedToday) return { ok: false, reason: 'alreadyToday' }
  return { ok: true, reason: null }
}

export interface TallyInput {
  votes: readonly Vote[]
  /** 그 팀에 방송국이 있는가. 받는 신뢰·호감이 커진다. */
  hasBroadcast?: (team: TeamId) => boolean
  /** 그 팀에 비밀기지가 있는가. 받는 의심 타격이 줄어든다. */
  hasHideout?: (team: TeamId) => boolean
  /** 지금 주목받는 팀. 받는 의심 타격이 1 커진다. */
  spotlighted?: TeamId | null
}

/**
 * 표 한 장이 대상 팀 영향력을 얼마나 움직이는가.
 *
 *   신뢰 +2 (방송국 +3) · 호감 +1 (방송국 +2)
 *   의심 −2 → 정확히 짚으면 두 배 → 주목이면 1 더 → 비밀기지면 1 덜
 *
 * 배수는 기본값에만 건다. 주목과 비밀기지는 그 뒤에 더하고 뺀다 —
 * 규칙 원문이 "−4가 된다", "1 더 커진다", "−1로 완화"라고 따로 말한다.
 */
export function voteInfluence(vote: Vote, input: Omit<TallyInput, 'votes'> = {}): number {
  const base = VOTE_INFLUENCE[vote.kind]
  if (vote.kind !== 'suspicion') {
    return base + (input.hasBroadcast?.(vote.targetTeam) ? BROADCAST_VOTE_BONUS : 0)
  }
  let hit = Math.abs(base) * (vote.exactHit ? FRAGMENT_HIT_MULTIPLIER : 1)
  if (input.spotlighted === vote.targetTeam) hit += SPOTLIGHT_SUSPICION_EXTRA
  if (input.hasHideout?.(vote.targetTeam)) hit -= HIDEOUT_SUSPICION_RELIEF
  return -Math.max(0, hit)
}

export interface TallyRow {
  team: TeamId
  /** 이 팀 영향력이 움직인 값. 던진 의심표의 대가까지 합쳐져 있다. */
  delta: number
  /** 이 팀이 받은 표 수. 누가 줬는지는 들어 있지 않다. */
  received: Record<VoteKind, number>
}

/**
 * 정산에 반영할 팀별 합계. 이 결과만 공개된다.
 *
 * 보낸 사람은 어디에도 들어 있지 않다 — 받은 표 수와 영향력 변화뿐이다.
 * 네 명짜리 팀의 합계에서 누가 누구에게 줬는지는 되짚을 수 없다.
 */
export function tallyVotes(input: TallyInput): Record<TeamId, TallyRow> {
  const out = {} as Record<TeamId, TallyRow>
  for (const team of TEAM_IDS) {
    out[team] = { team, delta: 0, received: { trust: 0, liking: 0, suspicion: 0 } }
  }
  for (const v of input.votes) {
    out[v.targetTeam].received[v.kind] += 1
    out[v.targetTeam].delta += voteInfluence(v, input)
    // 의심은 우리도 값을 치른다
    if (v.kind === 'suspicion') out[v.voterTeam].delta -= SUSPICION_SELF_COST
  }
  return out
}

/** 영향력은 0 아래로 내려가지 않는다. 합계를 적용할 때 쓴다. */
export function applyInfluence(current: number, delta: number): number {
  return Math.max(0, current + delta)
}

// ── 소문 ────────────────────────────────────────────────────────

/**
 * 소문이 옮겨질 때마다 그 사람 팀이 잃는 영향력.
 * 처음 꺼낸 사람은 값을 치르지 않는다 — 옮겨진 횟수만 센다.
 */
export function rumorDecay(retellCount: number, day: number): number {
  const per = day === RUMOR_DECAY_DAY ? RUMOR_DECAY * RUMOR_DECAY_MULTIPLIER : RUMOR_DECAY
  return Math.max(0, retellCount) * per
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
