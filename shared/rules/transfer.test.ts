import { describe, expect, it } from 'vitest'

import { TRANSFER_ASK_MS, askExpired, whyNotTransfer, type TransferAsk } from './transfer'

/** 되는 자리 하나. 시험마다 한 군데씩만 망가뜨린다. */
const ok = (over: Partial<TransferAsk> = {}): TransferAsk => ({
  day: 2,
  phaseOpen: false,
  byId: 'me',
  byTeam: 'A',
  toId: 'you',
  toTeam: 'B',
  bothStanding: true,
  nextTo: true,
  asking: false,
  movingTo: null,
  fromTeamSize: 4,
  ...over,
})

describe('whyNotTransfer', () => {
  it('자유 시간에 마주 서 있으면 꺼낼 수 있다', () => {
    expect(whyNotTransfer(ok())).toBeNull()
  })

  it('점령전 중에는 못 꺼낸다', () => {
    expect(whyNotTransfer(ok({ phaseOpen: true }))).toBe('phase')
  })

  it('첫날에는 못 꺼낸다', () => {
    expect(whyNotTransfer(ok({ day: 1 }))).toBe('early')
    expect(whyNotTransfer(ok({ day: 5 }))).toBeNull()
  })

  it('같은 팀에게는 못 꺼낸다', () => {
    expect(whyNotTransfer(ok({ toTeam: 'A' }))).toBe('sameTeam')
  })

  it('걷는 중이거나 멀리 있으면 못 꺼낸다', () => {
    expect(whyNotTransfer(ok({ bothStanding: false }))).toBe('walking')
    expect(whyNotTransfer(ok({ nextTo: false }))).toBe('far')
  })

  it('이미 걸린 제안이나 이적이 있으면 못 꺼낸다', () => {
    expect(whyNotTransfer(ok({ asking: true }))).toBe('asking')
    expect(whyNotTransfer(ok({ movingTo: 'C' }))).toBe('pending')
  })

  it('마지막 한 사람은 못 데려온다 — 팀이 비면 안 된다', () => {
    expect(whyNotTransfer(ok({ fromTeamSize: 1 }))).toBe('lastOne')
    expect(whyNotTransfer(ok({ fromTeamSize: 2 }))).toBeNull()
  })

  /**
   * 순위 조건은 **없다**. 앞선 팀이 뒤진 팀 사람을 데려가는 것도 된다 —
   * 막을지 말지는 사람이 정할 일이지 규칙이 정할 일이 아니다.
   */
  it('어느 팀이 앞서 있든 상관하지 않는다', () => {
    expect(whyNotTransfer(ok({ byTeam: 'A', toTeam: 'D' }))).toBeNull()
    expect(whyNotTransfer(ok({ byTeam: 'D', toTeam: 'A' }))).toBeNull()
  })
})

describe('askExpired', () => {
  it('열다섯 초가 지나면 사라진다', () => {
    const t = { status: 'asking' as const, askedAtMs: 1000 }
    expect(askExpired(t, 1000 + TRANSFER_ASK_MS - 1)).toBe(false)
    expect(askExpired(t, 1000 + TRANSFER_ASK_MS)).toBe(true)
  })

  it('이미 답한 것은 시간이 지나도 그대로다', () => {
    expect(askExpired({ status: 'taken', askedAtMs: 0 }, 1e9)).toBe(false)
  })
})
