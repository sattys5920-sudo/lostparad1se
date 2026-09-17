// 교역과 동맹.
//
// 동맹은 깃발 판정에서 우리 편으로 센다 — 이게 동맹의 실질적인 힘이고,
// 그래서 판정 직전에 깨질 수도 있다. 깨는 값은 12시간이다 — 그 12시간은
// 실제 시계다. 밤새 잠긴 채로 아침을 맞아야 아프다.
import {
  RESOURCES,
  type Resource,
  type TeamId,
} from './v2'
import { canPay, type Bag } from './resources'


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
 * **여기서 값을 물지 않는다.** 거는 값은 제안한 사람의 개인 토큰에서
 * 나간다(TRADE_COST) — 팀 상자에서 빼면 한 사람이 말을 걸고 다니는
 * 것만으로 팀이 페이즈에 쓸 것이 준다. 이 함수는 오가는 것만 센다.
 */
export function movePurse(
  from: Purse,
  to: Purse,
  give: Partial<Purse>,
  want: Partial<Purse>,
): { ok: true; from: Purse; to: Purse } | { ok: false; reason: PurseRefusal } {
  const giveT = give.tokens ?? 0
  const giveR = give.robots ?? 0
  const wantT = want.tokens ?? 0
  const wantR = want.robots ?? 0
  if (from.tokens < giveT) return { ok: false, reason: 'senderNoTokens' }
  if (from.robots < giveR) return { ok: false, reason: 'senderNoRobots' }
  if (to.tokens < wantT) return { ok: false, reason: 'receiverNoTokens' }
  if (to.robots < wantR) return { ok: false, reason: 'receiverNoRobots' }
  return {
    ok: true,
    from: { tokens: from.tokens - giveT + wantT, robots: from.robots - giveR + wantR },
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
