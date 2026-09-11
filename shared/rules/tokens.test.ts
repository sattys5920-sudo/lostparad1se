// 행동 토큰 — 따라잡기가 제대로 되는지 본다.
//
// 가장 위험한 건 두 번 주는 것이다. 서버가 꺼졌다 켜지거나 이어받기가
// 도중에 끊기면 같은 구간을 두 번 훑게 되는데, 그때 토큰이 두 배로
// 들어가면 판이 무너진다.
import { describe, expect, it } from 'vitest'
import {
  accrueTokens,
  grantInstantsBetween,
  initialTokenState,
  markComeback,
  msUntilNextGrant,
  personalLeft,
  spendToken,
  type TokenState,
} from './tokens'
import { TOKEN_CAP, TOKEN_PER_PLAYER_DAILY } from './v2'

const seoul = (iso: string) => new Date(`${iso}+09:00`).getTime()

const state = (over: Partial<TokenState> = {}): TokenState => ({
  tokens: 0,
  lastGrantMs: seoul('2026-03-02T08:00:00'),
  usedToday: {},
  pendingComeback: 0,
  ...over,
})

describe('충전 시각', () => {
  it('하루에 일곱 번이다 — 08시와 짝수 시각 여섯', () => {
    const out = grantInstantsBetween(seoul('2026-03-02T00:00:00'), seoul('2026-03-02T23:59:59'))
    expect(out).toHaveLength(7)
    expect(out[0].kind).toBe('dawn')
    expect(out.filter((i) => i.kind === 'hourly')).toHaveLength(6)
  })

  it('20시가 마지막이다 — 22시에는 차지 않는다', () => {
    const out = grantInstantsBetween(seoul('2026-03-02T20:00:00'), seoul('2026-03-03T07:00:00'))
    expect(out).toHaveLength(0)
  })

  it('시작 시각은 빼고 끝 시각은 넣는다', () => {
    const at10 = seoul('2026-03-02T10:00:00')
    expect(grantInstantsBetween(at10, at10 + 1)).toHaveLength(0)
    expect(grantInstantsBetween(at10 - 1, at10)).toHaveLength(1)
  })

  it('며칠이 비어 있어도 전부 훑는다', () => {
    const out = grantInstantsBetween(seoul('2026-03-02T07:00:00'), seoul('2026-03-05T07:00:00'))
    expect(out).toHaveLength(21)
  })

  it('이른 것부터 나온다', () => {
    const out = grantInstantsBetween(seoul('2026-03-02T07:00:00'), seoul('2026-03-04T21:00:00'))
    for (let i = 1; i < out.length; i++) expect(out[i].atMs).toBeGreaterThan(out[i - 1].atMs)
  })
})

describe('충전', () => {
  it('08:00에 두 개를 받는다', () => {
    const out = accrueTokens(state({ lastGrantMs: seoul('2026-03-02T07:00:00') }), seoul('2026-03-02T08:30:00'))
    expect(out.state.tokens).toBe(2)
    expect(out.grants).toHaveLength(1)
    expect(out.grants[0].kind).toBe('dawn')
  })

  it('짝수 시각마다 하나씩 찬다', () => {
    const out = accrueTokens(state({ tokens: 0 }), seoul('2026-03-02T12:30:00'))
    // 10시·12시 두 번
    expect(out.state.tokens).toBe(2)
  })

  it('네 개에서 멈춘다 — 넘치는 건 사라진다', () => {
    const out = accrueTokens(state({ tokens: 0 }), seoul('2026-03-02T20:30:00'))
    expect(out.state.tokens).toBe(TOKEN_CAP)
    expect(out.grants.reduce((a, g) => a + g.wasted, 0)).toBe(2)
  })

  it('하루를 통째로 따라잡는다', () => {
    const out = accrueTokens(state({ lastGrantMs: seoul('2026-03-02T07:00:00') }), seoul('2026-03-02T23:00:00'))
    expect(out.grants).toHaveLength(7)
    expect(out.state.tokens).toBe(TOKEN_CAP)
  })

  it('같은 계산을 두 번 돌려도 결과가 같다', () => {
    const now = seoul('2026-03-02T15:00:00')
    const once = accrueTokens(state(), now)
    const twice = accrueTokens(once.state, now)
    expect(twice.state.tokens).toBe(once.state.tokens)
    expect(twice.grants).toHaveLength(0)
  })

  it('토막내서 돌려도 한 번에 돌린 것과 같다', () => {
    const start = state({ lastGrantMs: seoul('2026-03-02T07:00:00') })
    const end = seoul('2026-03-04T21:00:00')
    const whole = accrueTokens(start, end)
    let piece = start
    for (const at of ['2026-03-02T13:00:00', '2026-03-03T09:00:00', '2026-03-03T19:00:00', '2026-03-04T21:00:00']) {
      piece = accrueTokens(piece, seoul(at)).state
    }
    expect(piece.tokens).toBe(whole.state.tokens)
    expect(piece.lastGrantMs).toBe(whole.state.lastGrantMs)
  })

  it('소등 동안은 아무것도 차지 않는다', () => {
    const out = accrueTokens(state({ lastGrantMs: seoul('2026-03-02T20:00:00') }), seoul('2026-03-03T07:59:59'))
    expect(out.grants).toHaveLength(0)
    expect(out.state.tokens).toBe(0)
  })
})

describe('만회 보너스', () => {
  it('다음 08:00에 두 개를 더 받는다', () => {
    const s = markComeback(state({ tokens: 0, lastGrantMs: seoul('2026-03-02T21:00:00') }))
    const out = accrueTokens(s, seoul('2026-03-03T08:30:00'))
    expect(out.state.tokens).toBe(4)
    expect(out.grants[0].comeback).toBe(2)
  })

  it('이때만 보관 한도를 넘는다', () => {
    const s = markComeback(state({ tokens: TOKEN_CAP, lastGrantMs: seoul('2026-03-02T21:00:00') }))
    const out = accrueTokens(s, seoul('2026-03-03T08:30:00'))
    expect(out.state.tokens).toBe(TOKEN_CAP + 2)
  })

  it('한 번 받으면 사라진다', () => {
    const s = markComeback(state({ tokens: 0, lastGrantMs: seoul('2026-03-02T21:00:00') }))
    const out = accrueTokens(s, seoul('2026-03-04T08:30:00'))
    expect(out.state.pendingComeback).toBe(0)
    // 첫 08:00만 보너스를 받는다
    expect(out.grants.filter((g) => g.comeback > 0)).toHaveLength(1)
  })

  it('한도를 넘겨 쥔 상태에서 짝수 시각이 와도 줄지 않는다', () => {
    const s = markComeback(state({ tokens: TOKEN_CAP, lastGrantMs: seoul('2026-03-02T21:00:00') }))
    const out = accrueTokens(s, seoul('2026-03-03T12:30:00'))
    expect(out.state.tokens).toBe(TOKEN_CAP + 2)
  })
})

describe('쓰기', () => {
  it('팀 상자에서 빠진다', () => {
    const out = spendToken(state({ tokens: 3 }), 'a')
    expect(out.ok).toBe(true)
    expect(out.state.tokens).toBe(2)
  })

  it('모자라면 아무것도 빠지지 않는다', () => {
    const out = spendToken(state({ tokens: 0 }), 'a')
    expect(out.ok).toBe(false)
    expect(out.reason).toBe('notEnoughTokens')
    expect(out.state.tokens).toBe(0)
  })

  it('한 사람은 하루 세 개까지다', () => {
    let s = state({ tokens: 4, usedToday: { a: TOKEN_PER_PLAYER_DAILY } })
    const out = spendToken(s, 'a')
    expect(out.ok).toBe(false)
    expect(out.reason).toBe('playerDailyLimit')
    expect(out.state.tokens).toBe(4)
    // 다른 사람은 쓸 수 있다
    s = spendToken(s, 'b').state
    expect(s.tokens).toBe(3)
  })

  it('여덟 개를 다 쓰려면 적어도 세 명이 움직여야 한다', () => {
    let s = state({ tokens: 8 })
    for (const who of ['a', 'a', 'a', 'b', 'b', 'b']) s = spendToken(s, who).state
    expect(s.tokens).toBe(2)
    expect(spendToken(s, 'a').ok).toBe(false)
    expect(spendToken(s, 'b').ok).toBe(false)
    expect(spendToken(s, 'c').ok).toBe(true)
  })

  it('08:00이 지나면 사람 몫이 초기화된다', () => {
    const s = state({ tokens: 4, usedToday: { a: 3 }, lastGrantMs: seoul('2026-03-02T20:00:00') })
    const out = accrueTokens(s, seoul('2026-03-03T08:30:00'))
    expect(personalLeft(out.state, 'a')).toBe(TOKEN_PER_PLAYER_DAILY)
    expect(spendToken(out.state, 'a').ok).toBe(true)
  })

  it('남은 몫을 알려 준다', () => {
    expect(personalLeft(state({ usedToday: { a: 1 } }), 'a')).toBe(2)
    expect(personalLeft(state(), 'z')).toBe(TOKEN_PER_PLAYER_DAILY)
  })
})

describe('다음 충전까지', () => {
  it('남은 시간을 알려 준다', () => {
    expect(msUntilNextGrant(seoul('2026-03-02T09:30:00'))).toBe(30 * 60_000)
  })

  it('20시를 넘기면 다음 날 08:00을 가리킨다', () => {
    expect(msUntilNextGrant(seoul('2026-03-02T22:00:00'))).toBe(10 * 3600_000)
  })
})

describe('판 시작', () => {
  it('두 개로 시작하고 그 전 충전은 없던 것으로 한다', () => {
    const s = initialTokenState(seoul('2026-03-02T13:00:00'))
    expect(s.tokens).toBe(2)
    const out = accrueTokens(s, seoul('2026-03-02T13:30:00'))
    expect(out.grants).toHaveLength(0)
  })
})
