// 로그 한 덩이의 규칙 — 옅어지는 기울기와 풍선 자르기.
import { describe, expect, it } from 'vitest'

import { SAY_BUBBLE_CHARS, SAY_BUBBLE_MS } from './timing'
import { bubbleText, bubbleUp } from './useChat'
import { faded } from './Say'

describe('로그가 옅어진다', () => {
  it('맨 위가 0.4, 맨 아래가 1', () => {
    expect(faded(0, 5)).toBe(0.4)
    expect(faded(4, 5)).toBe(1)
  })

  it('위로 갈수록 옅어진다 — 순서가 뒤집히지 않는다', () => {
    const five = [0, 1, 2, 3, 4].map((i) => faded(i, 5))
    expect(five).toEqual([...five].sort((a, b) => a - b))
  })

  it('두 줄로 줄어도 같은 두 끝을 쓴다', () => {
    expect(faded(0, 2)).toBe(0.4)
    expect(faded(1, 2)).toBe(1)
  })

  it('한 줄뿐이면 옅게 하지 않는다 — 비교할 것이 없으면 뜻이 안 생긴다', () => {
    expect(faded(0, 1)).toBe(1)
  })
})

describe('풍선은 두 줄까지', () => {
  it('짧은 말은 그대로 둔다', () => {
    expect(bubbleText('여기 조용하다')).toBe('여기 조용하다')
  })

  it('스물넷까지는 안 자른다', () => {
    const just = '가'.repeat(SAY_BUBBLE_CHARS)
    expect(bubbleText(just)).toBe(just)
  })

  it('넘치면 뒤를 「…」로 자른다', () => {
    const long = '가'.repeat(SAY_BUBBLE_CHARS + 10)
    expect(bubbleText(long)).toBe(`${'가'.repeat(SAY_BUBBLE_CHARS)}…`)
    // 잘렸다는 표시가 남아야 짧게 끊은 말과 구별된다
    expect(bubbleText(long).endsWith('…')).toBe(true)
  })
})

describe('풍선은 시계를 빨리 돌려도 4초 떠 있는다', () => {
  // 닷새를 하룻저녁에 돌리는 판. 실제 1초가 게임 60초다
  const REAL0 = Date.UTC(2026, 2, 1, 20, 0, 0)
  const fast = { anchorRealMs: REAL0, anchorGameMs: Date.UTC(2026, 2, 1, 10, 0, 0), speed: 60 }
  /** 실제로 이만큼 지난 시점에 찍힌 게임 시각 */
  const saidAt = (realAgoMs: number) => fast.anchorGameMs + realAgoMs * fast.speed

  it('막 한 말은 떠 있다', () => {
    expect(bubbleUp(saidAt(0), fast, REAL0)).toBe(true)
  })

  it('실제로 3초 지났으면 아직 떠 있다 — 게임 시계로는 3분이 지났어도', () => {
    expect(bubbleUp(saidAt(0), fast, REAL0 + 3000)).toBe(true)
  })

  it('실제로 5초 지났으면 사라진다', () => {
    expect(bubbleUp(saidAt(0), fast, REAL0 + 5000)).toBe(false)
  })

  it('경계는 정확히 4초다', () => {
    expect(bubbleUp(saidAt(0), fast, REAL0 + SAY_BUBBLE_MS)).toBe(true)
    expect(bubbleUp(saidAt(0), fast, REAL0 + SAY_BUBBLE_MS + 1)).toBe(false)
  })

  it('배속을 올려도 떠 있는 시간은 그대로다 — 여기서 틀려서 폰에서 안 보였다', () => {
    for (const speed of [1, 12, 60, 120]) {
      const clock = { ...fast, speed }
      const at = clock.anchorGameMs + 0 * speed
      expect(bubbleUp(at, clock, REAL0 + 3000)).toBe(true)
      expect(bubbleUp(at, clock, REAL0 + 5000)).toBe(false)
    }
  })

  it('시계가 없으면 실제 시각 그대로 센다', () => {
    const now = Date.UTC(2026, 2, 1, 20, 0, 0)
    expect(bubbleUp(now - 3000, undefined, now)).toBe(true)
    expect(bubbleUp(now - 5000, undefined, now)).toBe(false)
  })
})
