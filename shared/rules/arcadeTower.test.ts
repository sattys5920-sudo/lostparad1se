import { describe, expect, it } from 'vitest'

import {
  TOWER_BASE_W,
  TOWER_GOAL,
  TOWER_SWING,
  swingX,
  towerDrop,
  towerHeight,
  towerLeave,
  towerNew,
  towerCross,
  towerHitT,
  towerOutcome,
  whoseTurn,
} from './arcadeTower'

describe('탑 쌓기', () => {
  it('일정한 빠르기로 오간다 — 끝에서 출발, 건너는 시간 뒤 반대 끝, 층마다 반대쪽에서', () => {
    expect(swingX(0, 0)).toBeCloseTo(-TOWER_SWING)
    expect(swingX(0, towerCross(0))).toBeCloseTo(TOWER_SWING)
    expect(swingX(0, towerCross(0) / 2)).toBeCloseTo(0)
    expect(swingX(1, 0)).toBeCloseTo(TOWER_SWING)
    expect(towerCross(10)).toBeLessThan(towerCross(0))
    // 가운데를 지날 때도 끝을 지날 때와 같은 빠르기다
    const v = (h: number, t: number) => Math.abs(swingX(h, t + 10) - swingX(h, t)) / 10
    expect(v(0, towerCross(0) / 2 - 5)).toBeCloseTo(v(0, 50))
  })

  it('딱 맞으면 안 잘린다 — 사람 손의 50ms 어긋남도 첫 층에서는 딱이다', () => {
    const at = towerHitT(0, 0)
    const s = towerDrop(towerNew(['a', 'b'], 0), 'a', at + 50, 1000)
    expect(s.blocks[1]).toEqual({ x: 0, w: TOWER_BASE_W })
    expect(s.last?.perfect).toBe(true)
  })

  it('어긋나면 겹친 만큼만 남는다', () => {
    const t = towerHitT(0, 0) + 200
    const s = towerDrop(towerNew(['a'], 0), 'a', t, 1000)
    const x = swingX(0, t)
    expect(s.fell).toBe(false)
    expect(s.blocks[1].w).toBeCloseTo(TOWER_BASE_W - Math.abs(x), 1)
  })

  it('하나도 안 겹치면 무너진다(끝에서 떨어뜨리면)', () => {
    const s = towerDrop(towerNew(['a'], 0), 'a', 0, 1000)
    expect(s.fell).toBe(true)
    expect(whoseTurn(s)).toBe(null)
  })

  it('돌아가며 둔다. 목표 층을 넘으면 다 같이 깬다', () => {
    let s = towerNew(['a', 'b', 'c'], 0)
    const seen: string[] = []
    for (let i = 0; i < TOWER_GOAL; i++) {
      seen.push(whoseTurn(s)!)
      const h = s.blocks.length - 1
      s = towerDrop(s, whoseTurn(s)!, towerHitT(h, s.blocks[h].x), i * 1000)
    }
    expect(seen.slice(0, 4)).toEqual(['a', 'b', 'c', 'a'])
    expect(towerHeight(s)).toBe(TOWER_GOAL)
    expect(towerOutcome(s)).toBe('win')
  })

  it('차례인 사람이 나가면 다음 사람에게 새로 열린다', () => {
    let s = towerNew(['a', 'b', 'c'], 0)
    s = towerDrop(s, 'a', towerHitT(0, 0), 1000) // 이제 b 차례
    s = towerLeave(s, 'b', 5000)
    expect(whoseTurn(s)).toBe('c')
    expect(s.turnAtMs).toBe(5000)
    const t = towerLeave(towerNew(['a', 'b', 'c'], 0), 'c', 9000) // a 차례 그대로
    expect(whoseTurn(t)).toBe('a')
  })
})
