// 종이 — 같은 종이는 늘 같은 모양이어야 한다.
import { describe, expect, it } from 'vitest'
import { geomOf, tornEdge, PAPER_TONES } from './paperSprite'
import { PAPER_KINDS } from '../../../shared/reveal/paper'

describe('찢긴 가장자리', () => {
  it('같은 씨앗이면 같은 모양이다', () => {
    expect(tornEdge(7, 40, 4)).toEqual(tornEdge(7, 40, 4))
  })

  it('씨앗이 다르면 모양이 다르다', () => {
    expect(tornEdge(7, 40, 4)).not.toEqual(tornEdge(8, 40, 4))
  })

  it('깊이를 벗어나지 않는다', () => {
    for (const v of tornEdge(3, 200, 4)) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(4)
    }
  })

  it('줄마다 크게 튀지 않는다 — 빗살이 아니라 찢긴 결이다', () => {
    const edge = tornEdge(5, 200, 4)
    for (let i = 1; i < edge.length; i++) {
      expect(Math.abs(edge[i] - edge[i - 1]), `${i}번째 줄`).toBeLessThanOrEqual(2)
    }
  })

  it('그래도 평평하지는 않다', () => {
    expect(new Set(tornEdge(5, 200, 4)).size).toBeGreaterThan(1)
  })
})

describe('여백', () => {
  it('일기장은 왼쪽이 넓다 — 구멍과 여백선이 있다', () => {
    const g = geomOf('diary', 80, 100)
    expect(g.pad.left).toBeGreaterThan(g.pad.right)
    expect(g.ruleStep).toBeGreaterThan(0)
  })

  it('찢긴 쪽은 오른쪽이 넓다', () => {
    const g = geomOf('torn', 80, 100)
    expect(g.pad.right).toBeGreaterThan(g.pad.left)
  })

  it('메모는 괘선이 없다', () => {
    expect(geomOf('note', 80, 100).ruleStep).toBe(0)
  })

  it('글이 들어갈 자리가 남는다', () => {
    for (const kind of PAPER_KINDS) {
      const g = geomOf(kind, 80, 100)
      expect(80 - g.pad.left - g.pad.right, kind).toBeGreaterThan(40)
      expect(100 - g.pad.top - g.pad.bottom, kind).toBeGreaterThan(60)
    }
  })
})

describe('겨울 팔레트', () => {
  it('세 종류 모두 색이 있다', () => {
    for (const kind of PAPER_KINDS) {
      expect(PAPER_TONES[kind].base).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('흰 종이가 아니라 푸른 기가 도는 회백색이다', () => {
    const hex = PAPER_TONES.diary.base
    expect(hex.toLowerCase()).not.toBe('#ffffff')
    const [r, , b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
    expect(b).toBeGreaterThan(r)
  })

  it('찢긴 한 장이 가장 바랬다', () => {
    const lum = (h: string) =>
      [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).reduce((a, b) => a + b, 0)
    expect(lum(PAPER_TONES.torn.base)).toBeLessThan(lum(PAPER_TONES.diary.base))
  })
})
