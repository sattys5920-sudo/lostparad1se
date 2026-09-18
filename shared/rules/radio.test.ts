import { describe, expect, it } from 'vitest'

import { TEAM_FREQ, WAVE_AMP, WAVE_BARS, WAVE_MAX, stampOf, sys, waveAt } from './radio'

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

describe('시스템 줄', () => {
  it('교시', () => {
    expect(sys.phaseOpen(3)).toBe('3교시가 열렸다.')
    expect(sys.phaseClose(3)).toBe('3교시가 닫혔다.')
  })

  it('방은 받침을 보고 조사를 고른다', () => {
    expect(sys.roomTaken('도서관')).toBe('도서관을 차지했다.')
    expect(sys.roomTaken('과학실')).toBe('과학실을 차지했다.')
    expect(sys.roomTaken('양호실')).toBe('양호실을 차지했다.')
    expect(sys.roomLost('도서관', 'B')).toBe('도서관을 B팀에게 빼앗겼다.')
    expect(sys.roomLost('도서관', null)).toBe('도서관을 놓쳤다.')
  })

  it('이름도 받침을 본다', () => {
    expect(sys.invisible('수아')).toBe('수아는 오늘 보이지 않는다.')
    expect(sys.invisible('가온')).toBe('가온은 오늘 보이지 않는다.')
    expect(sys.movedOut('마루', 'C')).toBe('마루가 C팀으로 갔다.')
    expect(sys.movedOut('다솜', 'C')).toBe('다솜이 C팀으로 갔다.')
    expect(sys.movedIn('바다')).toBe('바다가 우리 팀으로 왔다.')
  })

  it('금고는 움직인 것만 적는다. 숫자 뒤에 조사를 안 붙인다', () => {
    expect(sys.vaultOut(3, 2)).toBe('금고가 줄었다 — 돈 3 · 지식 2')
    expect(sys.vaultOut(3, 0)).toBe('금고가 줄었다 — 돈 3')
    expect(sys.vaultOut(0, 2)).toBe('금고가 줄었다 — 지식 2')
  })
})
