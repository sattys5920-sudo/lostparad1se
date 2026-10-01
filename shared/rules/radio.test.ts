import { describe, expect, it } from 'vitest'

import { TEAM_FREQ, WAVE_AMP, WAVE_BARS, WAVE_MAX, stampOf, waveAt } from './radio'

describe('주파수', () => {
  it('네 팀이 서로 다르다', () => {
    const all = Object.values(TEAM_FREQ)
    expect(new Set(all).size).toBe(4)
  })
})

describe('시각', () => {
  it('페이즈 중에는 열린 뒤로 얼마나 지났는지', () => {
    const open = 1_000_000
    expect(stampOf(open, open, 0)).toBe('00:00')
    expect(stampOf(open + 12_000, open, 0)).toBe('00:12')
    expect(stampOf(open + 9 * 60_000 + 5_000, open, 0)).toBe('09:05')
  })

  it('한 교시를 넘겨도 칸이 안 밀린다', () => {
    expect(stampOf(0, -100 * 60_000, 0)).toBe('99:00')
  })

  it('자유 시간에는 그냥 시계다', () => {
    // 14시 32분 07초
    expect(stampOf(0, null, 14 * 3600 + 32 * 60 + 7)).toBe('14:32')
    expect(stampOf(0, null, 0)).toBe('00:00')
  })
})

describe('파형', () => {
  it('아무도 없으면 가라앉지만 사라지지는 않는다', () => {
    for (let i = 0; i < WAVE_BARS; i++) {
      for (let f = 0; f < 40; f++) expect(waveAt(i, f, 0, false)).toBe(1)
    }
  })

  it('사람이 많을수록 크게 흔들린다', () => {
    const swing = (n: number): number => {
      let lo = WAVE_MAX
      let hi = 1
      for (let i = 0; i < WAVE_BARS; i++) {
        for (let f = 0; f < 200; f++) {
          const v = waveAt(i, f, n, false)
          lo = Math.min(lo, v)
          hi = Math.max(hi, v)
        }
      }
      return hi - lo
    }
    expect(swing(1)).toBeLessThan(swing(2))
    expect(swing(2)).toBeLessThan(swing(4))
  })

  it('정수만 돌려주고 칸을 안 넘는다', () => {
    for (let i = 0; i < WAVE_BARS; i++) {
      for (let f = 0; f < 60; f++) {
        for (const n of [0, 1, 2, 3, 4, 9]) {
          const v = waveAt(i, f, n, false)
          expect(Number.isInteger(v)).toBe(true)
          expect(v).toBeGreaterThanOrEqual(1)
          expect(v).toBeLessThanOrEqual(WAVE_MAX)
        }
      }
    }
  })

  it('새 줄이 오면 더 크게 튄다', () => {
    const top = (spiking: boolean): number => {
      let hi = 0
      for (let i = 0; i < WAVE_BARS; i++) for (let f = 0; f < 200; f++) hi = Math.max(hi, waveAt(i, f, 1, spiking))
      return hi
    }
    expect(top(true)).toBeGreaterThan(top(false))
  })

  it('사람 수가 표를 넘어도 터지지 않는다', () => {
    expect(waveAt(0, 0, 99, false)).toBeLessThanOrEqual(WAVE_AMP[WAVE_AMP.length - 1])
  })
})

