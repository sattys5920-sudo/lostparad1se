// 눈발. A의 기록이 열린 날 수로 돈다 — snow.ts 머리말을 보라.
import { describe, expect, it } from 'vitest'
import { commonEndingOf, snowLevel, snowStopped, snowView } from './snow'
import { SNOW_LEVEL_MAX, TOTAL_DAYS } from './v2'

describe('눈이 그치는 때', () => {
  it('다섯 장이 다 열려야 그친다', () => {
    expect(snowStopped({ released: TOTAL_DAYS - 1 })).toBe(false)
    expect(snowStopped({ released: TOTAL_DAYS })).toBe(true)
  })

  it('더 열려도 그친 것은 그대로다', () => {
    expect(snowStopped({ released: TOTAL_DAYS + 3 })).toBe(true)
  })
})

describe('눈발의 세기', () => {
  it('아무것도 안 열렸으면 가장 굵다', () => {
    expect(snowLevel({ released: 0 })).toBe(SNOW_LEVEL_MAX)
  })

  it('다 열리면 0이다 — 0은 오직 그쳤을 때다', () => {
    expect(snowLevel({ released: TOTAL_DAYS })).toBe(0)
  })

  it('하나 남았을 때는 1이다 — 그치기 직전', () => {
    expect(snowLevel({ released: TOTAL_DAYS - 1 })).toBe(1)
  })

  it('열릴수록 가늘어진다', () => {
    let last = SNOW_LEVEL_MAX + 1
    for (let d = 0; d <= TOTAL_DAYS; d++) {
      const level = snowLevel({ released: d })
      expect(level, `${d}장`).toBeLessThanOrEqual(last)
      last = level
    }
  })

  it('음수가 들어와도 버틴다', () => {
    expect(snowLevel({ released: -3 })).toBe(SNOW_LEVEL_MAX)
  })
})

describe('화면에 내려보내는 것', () => {
  it('사람 수는 들어 있지 않다 — 단계와 그쳤는지뿐', () => {
    expect(Object.keys(snowView({ released: 2 })).sort()).toEqual(['level', 'stopped'])
  })
})

describe('공동 엔딩', () => {
  it('그치면 snowStopped, 아니면 snowKept', () => {
    expect(commonEndingOf({ released: TOTAL_DAYS })).toBe('snowStopped')
    expect(commonEndingOf({ released: 1 })).toBe('snowKept')
  })
})
