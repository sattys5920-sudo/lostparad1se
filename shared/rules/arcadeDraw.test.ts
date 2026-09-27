import { describe, expect, it } from 'vitest'

import {
  DRAW_MAX_ROUNDS,
  DRAW_MIN_REACT_MS,
  DRAW_TIMEOUT_MS,
  DRAW_WAIT_MAX_MS,
  DRAW_WAIT_MIN_MS,
  drawClose,
  drawJudge,
  drawNew,
  drawWait,
  normShot,
} from './arcadeDraw'

describe('먼저 쏴', () => {
  it('기다림은 씨앗과 판 번호로 정해지고 범위 안이다', () => {
    for (let r = 0; r < 10; r++) {
      const w = drawWait(5, r)
      expect(w).toBe(drawWait(5, r))
      expect(w).toBeGreaterThanOrEqual(DRAW_WAIT_MIN_MS)
      expect(w).toBeLessThanOrEqual(DRAW_WAIT_MAX_MS)
    }
  })

  it('신호 전에 닿으면 무조건 부정출발 — 화면이 뭐라 적었든', () => {
    expect(normShot(250, 999, 1000)).toBe('early')
    expect(normShot(DRAW_MIN_REACT_MS - 1, 2000, 1000)).toBe('early')
    expect(normShot(DRAW_MIN_REACT_MS, 2000, 1000)).toBe(DRAW_MIN_REACT_MS)
    expect(normShot(DRAW_TIMEOUT_MS + 1, 5000, 1000)).toBe('none')
    expect(normShot('abc', 2000, 1000)).toBe('none')
    expect(normShot(null, 2000, 1000)).toBe('none')
  })

  it('가르기 — 빠른 쪽, 부정출발은 지고, 못 쏜 것은 쏜 것에 진다', () => {
    expect(drawJudge('a', 'b', { a: 200, b: 300 })).toBe('a')
    expect(drawJudge('a', 'b', { a: 'early', b: 900 })).toBe('b')
    expect(drawJudge('a', 'b', { a: 'none', b: 900 })).toBe('b')
    expect(drawJudge('a', 'b', { a: 250, b: 250 })).toBe(null)
    expect(drawJudge('a', 'b', { a: 'early', b: 'early' })).toBe(null)
    expect(drawJudge('a', 'b', {})).toBe(null)
  })

  it('두 판 먼저 따면 끝 — 다음 판 신호는 판 사이 뒤로 밀린다', () => {
    let s = drawNew(5, ['a', 'b'], 0)
    let r = drawClose(s, 5, ['a', 'b'], { a: 200, b: 300 }, 10_000)
    expect(r.over).toBe(null)
    expect(r.s.signalAtMs).toBeGreaterThan(10_000 + DRAW_WAIT_MIN_MS)
    s = r.s
    r = drawClose(s, 5, ['a', 'b'], { a: 200, b: 300 }, 20_000)
    expect(r.over).toEqual({ winner: 'a' })
  })

  it('비기기만 이어지면 다섯 판에서 끊고 비긴다', () => {
    let s = drawNew(5, ['a', 'b'], 0)
    let over = null
    for (let i = 0; i < DRAW_MAX_ROUNDS; i++) {
      const r = drawClose(s, 5, ['a', 'b'], { a: 'early', b: 'early' }, i * 10_000)
      s = r.s
      over = r.over
    }
    expect(over).toEqual({ winner: null })
  })
})
