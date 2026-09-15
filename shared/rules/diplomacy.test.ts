// 교역과 동맹.
import { DEAL_TOKENS_PER_DAY, TRADE_COST } from './occupy'
import { tradeEpoch } from './diplomacy'
import { describe, expect, it } from 'vitest'
import {
  acceptTrade,
  alliesOf,
  breakAlliance,
  canAlly,
  canOffer,
  clearAlliances,
  movePurse,
  type AllianceState,
  type TradeOffer,
} from './diplomacy'
import {
  ALLIANCE_BREAK_LOCK_REAL_HOURS,
  type Resource,
  type TeamId,
} from './v2'

const res = (over: Partial<Record<Resource, number>> = {}): Record<Resource, number> => ({
  money: 10,
  knowledge: 5,
  ...over,
})

const offer = (over: Partial<TradeOffer> = {}): TradeOffer => ({
  id: 't1',
  fromTeam: 'A',
  toTeam: 'B',
  give: { money: 3 },
  want: { knowledge: 2 },
  createdAtMs: 0,
  ...over,
})

describe('교역 제안', () => {
  const base = { fromTeam: 'A' as TeamId, toTeam: 'B' as TeamId, give: { money: 1 }, want: {} }

  it('우리 팀에는 못 보낸다', () => {
    expect(canOffer({ ...base, toTeam: 'A' }).reason).toBe('ownTeam')
  })

  it('제안 수에 한도가 없다 — 남는 제안이 아예 없으므로', () => {
    // 마주 선 자리에서 꺼내고 그 자리에서 끝난다. 쌓이지 않으니
    // 「몇 개까지」를 셀 일이 없다
    expect(canOffer({ ...base }).ok).toBe(true)
    expect(canOffer({ ...base }).ok).toBe(true)
  })


  it('빈 제안은 막는다', () => {
    expect(canOffer({ ...base, give: {}, want: {} }).reason).toBe('empty')
  })
})

describe('교역 성립', () => {
  it('양쪽 자원이 맞바뀐다', () => {
    const out = acceptTrade(offer(), res(), res())
    expect(out.ok).toBe(true)
    expect(out.fromResources).toMatchObject({ money: 7, knowledge: 7 })
    expect(out.toResources).toMatchObject({ money: 13, knowledge: 3 })
  })

  it('받아들일 때 센다 — 보낸 쪽이 다 썼으면 성립하지 않는다', () => {
    const out = acceptTrade(offer(), res({ money: 1 }), res())
    expect(out.reason).toBe('senderShort')
    expect(out.fromResources.money).toBe(1)
  })

  it('받는 쪽이 모자라도 성립하지 않는다', () => {
    expect(acceptTrade(offer(), res(), res({ knowledge: 0 })).reason).toBe('receiverShort')
  })

  it('협정서가 붙으면 양쪽이 돈 2를 더 받는다', () => {
    const out = acceptTrade(offer({ accord: true }), res(), res())
    expect(out.fromResources.money).toBe(9)
    expect(out.toResources.money).toBe(15)
  })

  it('덧붙인 말은 계산에 들어가지 않는다', () => {
    const withNote = acceptTrade(offer({ note: '이번엔 진짜야' }), res(), res())
    const without = acceptTrade(offer(), res(), res())
    expect(withNote.fromResources).toEqual(without.fromResources)
  })
})

describe('동맹', () => {
  const free: AllianceState = { allyTeam: null, lockUntilRealMs: null }
  const base = { us: free, them: free, ourTeam: 'A' as TeamId, theirTeam: 'B' as TeamId, realNowMs: 1000 }

  it('둘 다 비어 있으면 맺는다', () => {
    expect(canAlly(base).ok).toBe(true)
  })

  it('한 팀은 한 번에 한 팀과만 맺는다', () => {
    expect(canAlly({ ...base, us: { allyTeam: 'C', lockUntilRealMs: null } }).reason).toBe('alreadyAllied')
    expect(canAlly({ ...base, them: { allyTeam: 'C', lockUntilRealMs: null } }).reason).toBe('theyAreAllied')
  })

  it('먼저 깬 팀은 12시간 잠긴다', () => {
    const out = breakAlliance(0)
    expect(out.breaker.lockUntilRealMs).toBe(ALLIANCE_BREAK_LOCK_REAL_HOURS * 3_600_000)
    expect(out.other.lockUntilRealMs).toBe(null)
  })

  it('잠긴 동안에는 못 맺는다', () => {
    const locked = { allyTeam: null, lockUntilRealMs: 5000 }
    expect(canAlly({ ...base, us: locked }).reason).toBe('locked')
    // 상대가 잠겨 있어도 못 맺는다
    expect(canAlly({ ...base, them: locked }).reason).toBe('locked')
    // 풀리면 맺는다
    expect(canAlly({ ...base, us: locked, realNowMs: 5000 }).ok).toBe(true)
  })

  it('마지막 여섯 시간에는 새 동맹이 없다', () => {
    expect(canAlly({ ...base, lastHours: true }).reason).toBe('lastHours')
  })

  it('DAY 4에는 모두 풀리되 아무도 값을 치르지 않는다', () => {
    const before: Record<TeamId, AllianceState> = {
      A: { allyTeam: 'B', lockUntilRealMs: null },
      B: { allyTeam: 'A', lockUntilRealMs: null },
      C: { allyTeam: 'D', lockUntilRealMs: 777 },
      D: { allyTeam: 'C', lockUntilRealMs: null },
    }
    const after = clearAlliances(before)
    for (const s of Object.values(after)) expect(s.allyTeam).toBe(null)
    // 잠금은 건드리지 않는다
    expect(after.C.lockUntilRealMs).toBe(777)
  })

  it('깃발 판정에 넘길 목록을 만든다', () => {
    expect(alliesOf({ allyTeam: 'B', lockUntilRealMs: null })).toEqual(['B'])
    expect(alliesOf(free)).toEqual([])
  })
})

describe('거래를 거는 값은 개인 토큰이다', () => {
  it('하루에 열둘', () => {
    expect(DEAL_TOKENS_PER_DAY).toBe(12)
  })

  it('한 번 거는 데 하나', () => {
    expect(TRADE_COST).toBe(1)
  })

  it('하루치로 열두 번까지 건다', () => {
    // 자유 시간이 하루 다섯 번이니 한 번에 두어 차례꼴이다
    expect(Math.floor(DEAL_TOKENS_PER_DAY / TRADE_COST)).toBe(12)
  })
})

describe('토큰과 로봇은 사람끼리 오간다', () => {
  it('주고받은 만큼 옮겨 간다', () => {
    const out = movePurse({ tokens: 5, robots: 2 }, { tokens: 1, robots: 0 }, { tokens: 2 }, { robots: 0 })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.from.tokens).toBe(3)
    expect(out.to.tokens).toBe(3)
  })

  it('**거는 값은 여기서 안 문다** — 제안한 사람의 개인 토큰에서 나간다', () => {
    // 팀 상자에서 빼면 한 사람이 말을 걸고 다니는 것만으로 팀이
    // 페이즈에 쓸 것이 준다. 이 함수는 오가는 것만 센다
    const out = movePurse({ tokens: 2, robots: 0 }, { tokens: 9, robots: 0 }, { tokens: 2 }, {})
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.from.tokens).toBe(0)
  })

  it('로봇도 손에서 손으로 간다', () => {
    const out = movePurse({ tokens: 3, robots: 2 }, { tokens: 0, robots: 1 }, { robots: 2 }, { robots: 1 })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.from.robots).toBe(1)
    expect(out.to.robots).toBe(2)
  })

  it('없는 토큰은 못 준다', () => {
    const out = movePurse({ tokens: 1, robots: 0 }, { tokens: 9, robots: 0 }, { tokens: 2 }, {})
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toBe('senderNoTokens')
  })

  it('없는 것은 못 받는다', () => {
    const out = movePurse({ tokens: 9, robots: 0 }, { tokens: 0, robots: 0 }, {}, { robots: 1 })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toBe('receiverNoRobots')
  })

  it('토큰이나 로봇만 걸어도 빈 제안이 아니다', () => {
    const out = canOffer({ fromTeam: 'A', toTeam: 'B', give: {}, want: {}, givePurse: { tokens: 1 } })
    expect(out.ok).toBe(true)
  })
})

describe('말이 살아 있는 범위', () => {
  it('페이즈가 열리고 닫힐 때마다 바뀐다', () => {
    const openP3 = tradeEpoch({ phaseNow: { no: 3, open: true }, phaseDone: 2 })
    const shutP3 = tradeEpoch({ phaseNow: { no: 3, open: false }, phaseDone: 3 })
    const openP4 = tradeEpoch({ phaseNow: { no: 4, open: true }, phaseDone: 3 })
    expect(openP3).not.toBe(shutP3)
    expect(shutP3).not.toBe(openP4)
  })

  it('같은 페이즈 안에서는 안 바뀐다 — 한 자리에서 여러 번 주고받는다', () => {
    expect(tradeEpoch({ phaseNow: { no: 3, open: true }, phaseDone: 2 })).toBe(
      tradeEpoch({ phaseNow: { no: 3, open: true }, phaseDone: 2 }),
    )
  })

  it('판이 막 시작해 아직 아무 페이즈도 없을 때도 값이 있다', () => {
    expect(tradeEpoch({})).toBe('f0')
  })
})
