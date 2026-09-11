// 교역과 동맹.
import { describe, expect, it } from 'vitest'
import {
  acceptTrade,
  alliesOf,
  breakAlliance,
  canAlly,
  canOffer,
  clearAlliances,
  type AllianceState,
  type TradeOffer,
} from './diplomacy'
import {
  ALLIANCE_BREAK_INFLUENCE_PENALTY,
  ALLIANCE_BREAK_LOCK_REAL_HOURS,
  TRADE_PENDING_LIMIT,
  type Resource,
  type TeamId,
} from './v2'

const res = (over: Partial<Record<Resource, number>> = {}): Record<Resource, number> => ({
  money: 10,
  knowledge: 5,
  influence: 3,
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
  const base = { fromTeam: 'A' as TeamId, toTeam: 'B' as TeamId, give: { money: 1 }, want: {}, pending: 0 }

  it('우리 팀에는 못 보낸다', () => {
    expect(canOffer({ ...base, toTeam: 'A' }).reason).toBe('ownTeam')
  })

  it('답 없는 제안이 셋을 넘으면 못 보낸다', () => {
    expect(canOffer({ ...base, pending: TRADE_PENDING_LIMIT - 1 }).ok).toBe(true)
    expect(canOffer({ ...base, pending: TRADE_PENDING_LIMIT }).reason).toBe('tooManyPending')
  })

  it('교역 차단을 맞으면 못 보낸다', () => {
    expect(canOffer({ ...base, tradeBlocked: true }).reason).toBe('blocked')
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
    expect(out.influencePenalty).toBe(ALLIANCE_BREAK_INFLUENCE_PENALTY)
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
