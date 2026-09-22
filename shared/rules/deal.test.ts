// 마주 보고 하는 거래. **탁자지 주문서가 아니다.**
//
// 여기서 보는 것은 흥정이 성립하는 조건과, 성립하지 말아야 할 때
// 성립하지 않는 것이다. 특히 「준비해 놓고 몰래 빼기」를 막는 자리가
// 이 파일의 절반이다.
import { describe, expect, it } from 'vitest'

import {
  DEAL_ASK_MS,
  DEAL_COUNTDOWN_MS,
  afterReady,
  afterStake,
  askExpired,
  canReady,
  dealHasAnything,
  gainOf,
  newDeal,
  readyToSettle,
  shortOf,
  stakeIsEmpty,
  stakeOf,
  EMPTY_STAKE,
  type DealState,
  type Holdings,
  type Stake,
} from './deal'

const T0 = 1_000_000

const fresh = (): DealState =>
  newDeal({
    askedBy: 'a',
    a: { playerId: 'a', team: 'A' },
    b: { playerId: 'b', team: 'B' },
    tileId: 'centralPlaza',
    nowMs: T0,
  })

const open = (): DealState => ({ ...fresh(), status: 'open' })
const put = (over: Partial<Stake>): Stake => ({ ...EMPTY_STAKE, ...over })
const have = (over: Partial<Holdings>): Holdings => ({
  money: 0,
  knowledge: 0,
  items: {},
  slips: 0,
  robots: 0,
  ...over,
})

describe('요청', () => {
  it('열다섯 초가 지나면 그냥 사라진다', () => {
    const d = fresh()
    expect(askExpired(d, T0 + DEAL_ASK_MS - 1)).toBe(false)
    expect(askExpired(d, T0 + DEAL_ASK_MS)).toBe(true)
  })

  it('수락한 뒤에는 시들지 않는다', () => {
    expect(askExpired(open(), T0 + DEAL_ASK_MS * 10)).toBe(false)
  })
})

describe('빈 탁자로는 준비를 못 누른다', () => {
  it('둘 다 빈손이면 못 누른다', () => {
    expect(dealHasAnything(open())).toBe(false)
    expect(canReady(open(), 'a')).toBe(false)
  })

  it('**한쪽만 올려도 된다** — 일방적으로 주는 것도 거래다', () => {
    const d = afterStake(open(), 'a', put({ money: 2 }))
    expect(dealHasAnything(d)).toBe(true)
    expect(canReady(d, 'a')).toBe(true)
    expect(canReady(d, 'b')).toBe(true)
  })

  it('거래에 없는 사람은 못 누른다', () => {
    const d = afterStake(open(), 'a', put({ money: 1 }))
    expect(canReady(d, 'c')).toBe(false)
  })
})

describe('준비해 놓고 몰래 빼기를 막는다', () => {
  it('한쪽이 준비한 뒤 탁자가 바뀌면 **둘 다** 준비가 풀린다', () => {
    let d = afterStake(open(), 'a', put({ money: 3 }))
    d = afterStake(d, 'b', put({ knowledge: 1 }))
    d = afterReady(d, 'b', true, T0)
    expect(d.b.ready).toBe(true)

    // a 가 제 몫을 줄인다. b 는 아무것도 안 했는데 준비가 풀려야 한다
    d = afterStake(d, 'a', put({ money: 1 }))
    expect(d.a.ready).toBe(false)
    expect(d.b.ready).toBe(false)
    expect(d.settleAtMs).toBeNull()
  })

  it('세는 중에 바꿔도 카운트다운이 없어진다', () => {
    let d = afterStake(open(), 'a', put({ money: 1 }))
    d = afterReady(d, 'a', true, T0)
    d = afterReady(d, 'b', true, T0)
    expect(d.status).toBe('settling')
    d = afterStake(d, 'b', put({ money: 1 }))
    expect(d.status).toBe('open')
    expect(readyToSettle(d, T0 + DEAL_COUNTDOWN_MS * 10)).toBe(false)
  })
})

describe('성립은 세고 나서', () => {
  const both = (): DealState => {
    let d = afterStake(open(), 'a', put({ money: 2 }))
    d = afterStake(d, 'b', put({ knowledge: 1 }))
    d = afterReady(d, 'a', true, T0)
    return afterReady(d, 'b', true, T0)
  }

  it('둘 다 누르면 세기 시작한다', () => {
    const d = both()
    expect(d.status).toBe('settling')
    expect(d.settleAtMs).toBe(T0 + DEAL_COUNTDOWN_MS)
  })

  it('세는 동안에는 성립하지 않는다 — 그사이 무를 수 있다', () => {
    const d = both()
    expect(readyToSettle(d, T0)).toBe(false)
    expect(readyToSettle(d, T0 + DEAL_COUNTDOWN_MS - 1)).toBe(false)
    expect(readyToSettle(d, T0 + DEAL_COUNTDOWN_MS)).toBe(true)
  })

  it('한쪽이 무르면 세던 것이 사라진다', () => {
    const d = afterReady(both(), 'a', false, T0 + 1000)
    expect(d.status).toBe('open')
    expect(readyToSettle(d, T0 + DEAL_COUNTDOWN_MS)).toBe(false)
  })

  it('**동시에 눌러도 한 번만 센다**', () => {
    // 둘이 같은 순간에 눌렀다고 두 번 성립하지 않는다. 세는 시각은
    // 나중에 누른 쪽 기준으로 하나뿐이다
    let d = afterStake(open(), 'a', put({ money: 1 }))
    d = afterReady(d, 'a', true, T0)
    const first = afterReady(d, 'b', true, T0 + 5)
    const again = afterReady(first, 'b', true, T0 + 9)
    expect(first.settleAtMs).toBe(T0 + 5 + DEAL_COUNTDOWN_MS)
    expect(again.settleAtMs).toBe(T0 + 9 + DEAL_COUNTDOWN_MS)
    // 이미 끝난 판은 다시 안 센다
    expect(readyToSettle({ ...first, status: 'done' }, T0 + 99_999)).toBe(false)
  })
})

describe('성립 직전에 다시 센다', () => {
  it('그사이 다 썼으면 막힌다', () => {
    const stake = put({ money: 5 })
    expect(shortOf(stake, have({ money: 5 }))).toBeNull()
    expect(shortOf(stake, have({ money: 4 }))).toBe('shortMoney')
  })

  it('무엇이 모자란지 갈라서 말한다', () => {
    expect(shortOf(put({ knowledge: 1 }), have({}))).toBe('shortKnowledge')
    expect(shortOf(put({ slips: 1 }), have({}))).toBe('shortSlips')
    expect(shortOf(put({ robots: 1 }), have({}))).toBe('shortRobots')
    expect(shortOf(put({ items: { whistle: 2 } }), have({ items: { whistle: 1 } }))).toBe('shortItems')
  })

  it('가진 만큼이면 통과한다', () => {
    const all = put({ money: 1, knowledge: 1, slips: 1, robots: 1, items: { whistle: 1 } })
    expect(shortOf(all, have({ money: 1, knowledge: 1, slips: 1, robots: 1, items: { whistle: 1 } }))).toBeNull()
  })
})

describe('누가 무엇을 주고받는가', () => {
  it('내가 올린 것이 내가 주는 것이고, 상대가 올린 것이 내가 받는 것이다', () => {
    let d = afterStake(open(), 'a', put({ money: 2 }))
    d = afterStake(d, 'b', put({ slips: 1 }))
    expect(stakeOf(d, 'a').money).toBe(2)
    expect(gainOf(d, 'a').slips).toBe(1)
    expect(stakeOf(d, 'b').slips).toBe(1)
    expect(gainOf(d, 'b').money).toBe(2)
  })

  it('빈 더미는 비었다고 센다', () => {
    expect(stakeIsEmpty(EMPTY_STAKE)).toBe(true)
    expect(stakeIsEmpty(put({ items: { whistle: 0 } }))).toBe(true)
    expect(stakeIsEmpty(put({ items: { whistle: 1 } }))).toBe(false)
  })
})
