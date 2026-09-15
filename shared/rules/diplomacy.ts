// 교역과 동맹.
//
// 동맹은 깃발 판정에서 우리 편으로 센다 — 이게 동맹의 실질적인 힘이고,
// 그래서 판정 직전에 깨질 수도 있다. 깨는 값은 12시간이다 — 그 12시간은
// 실제 시계다. 밤새 잠긴 채로 아침을 맞아야 아프다.
import {
  ALLIANCE_BREAK_LOCK_REAL_HOURS,
  ALLIANCE_CLEAR_DAY,
  RESOURCES,
  type Resource,
  type TeamId,
} from './v2'
import { canPay, type Bag } from './resources'

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

export type OfferRefusal = 'ownTeam' | 'empty'

export interface OfferInput {
  fromTeam: TeamId
  toTeam: TeamId
  give: Bag
  want: Bag
  /** 교역 차단 견제를 맞고 있는가. */
  /** 사람끼리 오가는 것 — 토큰과 데리고 있는 로봇. */
  givePurse?: Partial<Purse>
  wantPurse?: Partial<Purse>
}

/**
 * 제안할 수 있는가.
 *
 * **답 없는 제안이라는 것이 없다.** 거래는 마주 선 자리에서 말을 꺼내고
 * 그 자리에서 끝난다 — 상대가 수락하면 성립하고, 거절하거나 둘 중
 * 하나가 방을 떠나거나 페이즈가 닫히면 그냥 사라진다. 다음으로
 * 넘어가지 않으므로 「몇 개까지」를 셀 것도 없다.
 */
export function canOffer(input: OfferInput): { ok: boolean; reason: OfferRefusal | null } {
  if (input.fromTeam === input.toTeam) return { ok: false, reason: 'ownTeam' }
  const any =
    RESOURCES.some((r) => (input.give[r] ?? 0) > 0 || (input.want[r] ?? 0) > 0) ||
    (input.givePurse?.tokens ?? 0) > 0 ||
    (input.givePurse?.robots ?? 0) > 0 ||
    (input.wantPurse?.tokens ?? 0) > 0 ||
    (input.wantPurse?.robots ?? 0) > 0
  if (!any) return { ok: false, reason: 'empty' }
  return { ok: true, reason: null }
}

/**
 * 지금이 어느 「자리」인가. **제안이 살아 있는 범위다.**
 *
 * 페이즈가 열릴 때와 닫힐 때 값이 바뀐다. 제안에 이 값을 적어 두고
 * 수락할 때 다시 견주면, 페이즈 경계를 넘은 제안은 저절로 죽는다 —
 * 따로 쓸어 담는 일을 만들지 않아도 된다.
 */
export function tradeEpoch(game: { phaseNow?: { no: number; open: boolean }; phaseDone?: number }): string {
  return game.phaseNow?.open ? `p${game.phaseNow.no}` : `f${game.phaseDone ?? 0}`
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
}

/**
 * 먼저 깬 팀은 12시간 동안 새 동맹을 못 맺는다.
 *
 * 전에는 영향력 2도 같이 잃었다. 영향력이 없어진 지금 값은 시간
 * 하나뿐이다 — 그리고 시간이야말로 이 게임에서 제일 비싼 것이다.
 */
export function breakAlliance(realNowMs: number): BreakResult {
  return {
    breaker: {
      allyTeam: null,
      lockUntilRealMs: realNowMs + ALLIANCE_BREAK_LOCK_REAL_HOURS * HOUR_MS,
    },
    other: { allyTeam: null, lockUntilRealMs: null },
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
