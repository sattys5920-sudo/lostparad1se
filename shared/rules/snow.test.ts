// 눈이 그친 아침 — 수치가 새지 않는지.
import { describe, expect, it } from 'vitest'
import { commonEndingOf, snowLevel, snowStopped, snowView } from './snow'
import { SNOW_AWAKENED_NEEDED, SNOW_LEVEL_MAX, SNOW_REVEALED_NEEDED } from './v2'

describe('그치는 조건', () => {
  it('깨달음 아홉과 털어놓기 일곱을 모두 채워야 한다', () => {
    expect(SNOW_AWAKENED_NEEDED).toBe(9)
    expect(SNOW_REVEALED_NEEDED).toBe(7)
    expect(snowStopped({ awakened: 9, revealed: 7 })).toBe(true)
  })

  it('한쪽만 채우면 그치지 않는다', () => {
    expect(snowStopped({ awakened: 14, revealed: 6 })).toBe(false)
    expect(snowStopped({ awakened: 8, revealed: 14 })).toBe(false)
  })

  it('넘겨도 그친다', () => {
    expect(snowStopped({ awakened: 14, revealed: 14 })).toBe(true)
  })
})

describe('눈발', () => {
  it('아무것도 없으면 가장 굵다', () => {
    expect(snowLevel({ awakened: 0, revealed: 0 })).toBe(SNOW_LEVEL_MAX)
  })

  it('그치면 0이다', () => {
    expect(snowLevel({ awakened: 9, revealed: 7 })).toBe(0)
  })

  it('덜 찬 쪽을 따른다 — 한쪽만 채워도 거의 그대로다', () => {
    const lopsided = snowLevel({ awakened: 14, revealed: 0 })
    expect(lopsided).toBe(SNOW_LEVEL_MAX)
  })

  it('둘 다 차오르면 약해진다', () => {
    const early = snowLevel({ awakened: 2, revealed: 2 })
    const late = snowLevel({ awakened: 7, revealed: 6 })
    expect(late).toBeLessThan(early)
    expect(late).toBeGreaterThan(0)
  })

  it('다 차기 전에는 절대 0이 아니다', () => {
    expect(snowLevel({ awakened: 8, revealed: 7 })).toBeGreaterThan(0)
    expect(snowLevel({ awakened: 9, revealed: 6 })).toBeGreaterThan(0)
  })

  it('음수를 넣어도 범위를 벗어나지 않는다', () => {
    const lvl = snowLevel({ awakened: -5, revealed: -5 })
    expect(lvl).toBeLessThanOrEqual(SNOW_LEVEL_MAX)
    expect(lvl).toBeGreaterThanOrEqual(0)
  })
})

describe('화면에 내려보내는 것', () => {
  it('사람 수는 들어 있지 않다', () => {
    const view = snowView({ awakened: 8, revealed: 6 })
    expect(Object.keys(view).sort()).toEqual(['level', 'stopped'])
    const text = JSON.stringify(view)
    expect(text).not.toContain('awakened')
    expect(text).not.toContain('8')
    expect(text).not.toContain('6')
  })
})

describe('공동 엔딩', () => {
  it('조건을 채우면 눈이 그친 아침이다', () => {
    expect(commonEndingOf({ awakened: 9, revealed: 7 })).toBe('snowStopped')
    expect(commonEndingOf({ awakened: 9, revealed: 6 })).toBe('snowKept')
  })
})
