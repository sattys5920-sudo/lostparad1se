import { describe, expect, it } from 'vitest'
import { revealInfluenceGain } from './reveal'
import { REVEAL_INFLUENCE_CAP } from './v2'

describe('털어놓기 영향력', () => {
  it('첫 1:1은 +3', () => {
    expect(revealInfluenceGain(0, 'private')).toBe(3)
  })

  it('두 번째부터의 1:1은 오르지 않는다', () => {
    expect(revealInfluenceGain(3, 'private')).toBe(0)
    expect(revealInfluenceGain(6, 'private')).toBe(0)
  })

  it('처음부터 전체면 +6', () => {
    expect(revealInfluenceGain(0, 'class')).toBe(6)
  })

  it('1:1 뒤에 전체면 남은 +3만', () => {
    expect(revealInfluenceGain(3, 'class')).toBe(3)
  })

  it('이미 다 채웠으면 전체도 0', () => {
    expect(revealInfluenceGain(6, 'class')).toBe(0)
  })

  it('아무리 떠들어도 총량을 넘지 못한다', () => {
    // 1:1 한 번 뒤 1:1 다섯 번, 마지막에 전체
    let gained = 0
    for (const scope of ['private', 'private', 'private', 'private', 'private', 'class'] as const) {
      gained += revealInfluenceGain(gained, scope)
    }
    expect(gained).toBe(REVEAL_INFLUENCE_CAP)
  })

  it('전체를 먼저 하면 그 뒤로는 아무것도 없다', () => {
    let gained = revealInfluenceGain(0, 'class')
    gained += revealInfluenceGain(gained, 'private')
    gained += revealInfluenceGain(gained, 'class')
    expect(gained).toBe(REVEAL_INFLUENCE_CAP)
  })

  it('이상한 값이 와도 총량을 넘기지 않는다', () => {
    expect(revealInfluenceGain(-5, 'class')).toBe(6)
    expect(revealInfluenceGain(99, 'class')).toBe(0)
  })
})
