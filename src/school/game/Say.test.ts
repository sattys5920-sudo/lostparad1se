// 로그 한 덩이의 규칙 — 옅어지는 기울기와 풍선 자르기.
import { describe, expect, it } from 'vitest'

import { SAY_BUBBLE_CHARS } from './timing'
import { bubbleText } from './useChat'
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
