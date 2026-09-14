// 교역과 동맹.
//
// 동맹은 깃발 판정에서 우리 편으로 센다 — 이게 동맹의 실질적인 힘이고,
// 그래서 판정 직전에 깨질 수도 있다. 깨는 값은 영향력 2와 12시간이다.
// 그 12시간은 실제 시계다. 밤새 잠긴 채로 아침을 맞아야 아프다.
import {
  ALLIANCE_BREAK_INFLUENCE_PENALTY,
  ALLIANCE_BREAK_LOCK_REAL_HOURS,
  ALLIANCE_CLEAR_DAY,
  RESOURCES,
  TRADE_PENDING_LIMIT,
  type Resource,
  type TeamId,
} from './v2'
import { canPay, type Bag } from './buildings'

const HOUR_MS = 3_600_000

// ── 교역 ────────────────────────────────────────────────────────

export interface TradeOffer {
  id: string
  fromTeam: TeamId
  toTeam: TeamId
  /** 내가 내놓는 것. */
  give: Bag
  /** 내가 받고 싶은 것. */
  want: Bag
  /** 덧붙인 말. 판정에는 쓰이지 않는다 — 손으로 친 말은 세지 않는다. */
  note?: string
  createdAtMs: number
  /** 협정서가 붙어 있는가. 성립하면 양쪽이 돈 2를 더 받는다. */
  accord?: boolean
}

/**
 * 사람이 들고 있어서 사람끼리 오가는 것. 재화는 팀 것이고 이 둘은 개인 것이다.
 *
 * 토큰은 페이즈마다 받는 행동 횟수고, 로봇은 데리고 다니는 것이다.
 * 둘 다 **마주 선 두 사람 사이에서만** 움직인다 — 팀 금고를 거치지 않는다.
 */
export interface Purse {
  tokens: number
  robots: number
}

export type OfferRefusal = 'ownTeam' | 'tooManyPending' | 'blocked' | 'empty'

export interface OfferInput {
  fromTeam: TeamId
  toTeam: TeamId
  give: Bag
  want: Bag
  /** 답을 못 받은 내 제안 수. */
  pending: number
  /** 교역 차단 견제를 맞고 있는가. */
  tradeBlocked?: boolean
  /** 사람끼리 오가는 것 — 토큰과 데리고 있는 로봇. */
  givePurse?: Partial<Purse>
  wantPurse?: Partial<Purse>
}

/** 제안할 수 있는가. 답 없는 제안이 셋을 넘으면 더 못 보낸다. */
export function canOffer(input: OfferInput): { ok: boolean; reason: OfferRefusal | null } {
  if (input.fromTeam === input.toTeam) return { ok: false, reason: 'ownTeam' }
  if (input.tradeBlocked) return { ok: false, reason: 'blocked' }
  if (input.pending >= TRADE_PENDING_LIMIT) return { ok: false, reason: 'tooManyPending' }
  const any =
    RESOURCES.some((r) => (input.give[r] ?? 0) > 0 || (input.want[r] ?? 0) > 0) ||
    (input.givePurse?.tokens ?? 0) > 0 ||
    (input.givePurse?.robots ?? 0) > 0 ||
    (input.wantPurse?.tokens ?? 0) > 0 ||
    (input.wantPurse?.robots ?? 0) > 0
  if (!any) return { ok: false, reason: 'empty' }
  return { ok: true, reason: null }
}

export type PurseRefusal = 'senderNoTokens' | 'senderNoRobots' | 'receiverNoTokens' | 'receiverNoRobots'

/**
 * 토큰과 로봇이 실제로 오갈 수 있는가. **받아들이는 순간** 센다.
 *
 * 값(TRADE_COST)은 제안한 쪽이 낸다. 제안만 뿌리고 다니는 것을 막으려면
 * 값이 제안하는 쪽에 붙어야 한다 — 다만 성립할 때만이다.
 */
export function movePurse(
  from: Purse,
  to: Purse,
  give: Partial<Purse>,
  want: Partial<Purse>,
  cost: number,
): { ok: true; from: Purse; to: Purse } | { ok: false; reason: PurseRefusal } {
  const giveT = give.tokens ?? 0
  const giveR = give.robots ?? 0
  const wantT = want.tokens ?? 0
  const wantR = want.robots ?? 0
  if (from.tokens < giveT + cost) return { ok: false, reason: 'senderNoTokens' }
  if (from.robots < giveR) return { ok: false, reason: 'senderNoRobots' }
  if (to.tokens < wantT) return { ok: false, reason: 'receiverNoTokens' }
  if (to.robots < wantR) return { ok: false, reason: 'receiverNoRobots' }
  return {
    ok: true,
    from: { tokens: from.tokens - giveT - cost + wantT, robots: from.robots - giveR + wantR },
    to: { tokens: to.tokens - wantT + giveT, robots: to.robots - wantR + giveR },
  }
}

export type AcceptRefusal = 'senderShort' | 'receiverShort'

export interface AcceptResult {
  ok: boolean
  fromResources: Record<Resource, number>
  toResources: Record<Resource, number>
  reason: AcceptRefusal | null
}

/**
 * 받아들이는 순간 양쪽 자원을 본다. 그 사이에 한쪽이 다 써 버렸으면
 * 성립하지 않는다 — 제안할 때가 아니라 **받아들일 때** 센다.
 */
export function acceptTrade(
  offer: TradeOffer,
  fromResources: Record<Resource, number>,
  toResources: Record<Resource, number>,
): AcceptResult {
  const no = (reason: AcceptRefusal): AcceptResult => ({
    ok: false,
    fromResources,
    toResources,
    reason,
  })
  if (!canPay(fromResources, offer.give)) return no('senderShort')
  if (!canPay(toResources, offer.want)) return no('receiverShort')

  const bonus = offer.accord ? 2 : 0
  const out = { fromResources: { ...fromResources }, toResources: { ...toResources } }
  for (const r of RESOURCES) {
    out.fromResources[r] += (offer.want[r] ?? 0) - (offer.give[r] ?? 0)
    out.toResources[r] += (offer.give[r] ?? 0) - (offer.want[r] ?? 0)
  }
  out.fromResources.money += bonus
  out.toResources.money += bonus
  return { ok: true, ...out, reason: null }
}

// ── 동맹 ────────────────────────────────────────────────────────

export interface AllianceState {
  /** 지금 손잡은 팀. 한 번에 하나다. */
  allyTeam: TeamId | null
  /** 먼저 깨서 새 동맹을 못 맺는 시각(실제 시계). */
  lockUntilRealMs: number | null
}

export type AllyRefusal = 'ownTeam' | 'alreadyAllied' | 'theyAreAllied' | 'locked' | 'lastHours'

export interface AllyInput {
  us: AllianceState
  them: AllianceState
  ourTeam: TeamId
  theirTeam: TeamId
  realNowMs: number
  /** 마지막 여섯 시간에는 새 동맹을 맺을 수 없다. */
  lastHours?: boolean
}

export function canAlly(input: AllyInput): { ok: boolean; reason: AllyRefusal | null } {
  if (input.ourTeam === input.theirTeam) return { ok: false, reason: 'ownTeam' }
  if (input.lastHours) return { ok: false, reason: 'lastHours' }
  if (input.us.allyTeam !== null) return { ok: false, reason: 'alreadyAllied' }
  if (input.them.allyTeam !== null) return { ok: false, reason: 'theyAreAllied' }
  if (input.us.lockUntilRealMs !== null && input.realNowMs < input.us.lockUntilRealMs) {
    return { ok: false, reason: 'locked' }
  }
  if (input.them.lockUntilRealMs !== null && input.realNowMs < input.them.lockUntilRealMs) {
    return { ok: false, reason: 'locked' }
  }
  return { ok: true, reason: null }
}

export interface BreakResult {
  /** 먼저 깬 쪽. 값을 치른다. */
  breaker: AllianceState
  /** 당한 쪽. 아무것도 잃지 않는다. */
  other: AllianceState
  /** 먼저 깬 팀이 잃는 영향력. */
  influencePenalty: number
}

/** 먼저 깬 팀은 영향력 2를 잃고 12시간 동안 새 동맹을 못 맺는다. */
export function breakAlliance(realNowMs: number): BreakResult {
  return {
    breaker: {
      allyTeam: null,
      lockUntilRealMs: realNowMs + ALLIANCE_BREAK_LOCK_REAL_HOURS * HOUR_MS,
    },
    other: { allyTeam: null, lockUntilRealMs: null },
    influencePenalty: ALLIANCE_BREAK_INFLUENCE_PENALTY,
  }
}

/** DAY 4 08:00. 모든 동맹이 풀린다. 먼저 깬 것이 아니므로 아무도 값을 치르지 않는다. */
export function clearAlliances(states: Record<TeamId, AllianceState>): Record<TeamId, AllianceState> {
  const out = {} as Record<TeamId, AllianceState>
  for (const [team, s] of Object.entries(states) as [TeamId, AllianceState][]) {
    out[team] = { ...s, allyTeam: null }
  }
  return out
}

export const ALLIANCE_CLEARED_ON_DAY = ALLIANCE_CLEAR_DAY

/** 깃발 판정에 넘길 동맹 목록. 판정 직전 값이다. */
export function alliesOf(state: AllianceState): TeamId[] {
  return state.allyTeam ? [state.allyTeam] : []
}
