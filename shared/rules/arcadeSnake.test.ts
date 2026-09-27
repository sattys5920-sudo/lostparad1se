import { describe, expect, it } from 'vitest'

import {
  SNAKE_H,
  SNAKE_PASS,
  SNAKE_W,
  canTurn,
  cleanTurns,
  snakeReplay,
  snakeStart,
  snakeStep,
  type SnakeDir,
  type SnakeGame,
  type SnakeInput,
} from './arcadeSnake'

const STEP: Record<SnakeDir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }

/** 사과까지 가는 첫걸음(몸을 벽으로 보고 넓게 찾기). 없으면 안 죽는 아무 쪽 */
function plan(g: SnakeGame): SnakeDir | null {
  const key = (x: number, y: number) => `${x},${y}`
  const body = new Set(g.body.slice(0, -1).map((c) => key(c.x, c.y)))
  const head = g.body[0]
  const seen = new Map<string, SnakeDir>()
  const q: { x: number; y: number; first: SnakeDir }[] = []
  for (const d of Object.keys(STEP) as SnakeDir[]) {
    if (d !== g.dir && !canTurn(g, d)) continue
    const x = head.x + STEP[d][0]
    const y = head.y + STEP[d][1]
    if (x < 0 || y < 0 || x >= SNAKE_W || y >= SNAKE_H || body.has(key(x, y))) continue
    seen.set(key(x, y), d)
    q.push({ x, y, first: d })
  }
  const any = q[0]?.first ?? null
  while (q.length) {
    const c = q.shift()!
    if (c.x === g.food.x && c.y === g.food.y) return c.first
    for (const d of Object.keys(STEP) as SnakeDir[]) {
      const x = c.x + STEP[d][0]
      const y = c.y + STEP[d][1]
      if (x < 0 || y < 0 || x >= SNAKE_W || y >= SNAKE_H || body.has(key(x, y)) || seen.has(key(x, y))) continue
      seen.set(key(x, y), c.first)
      q.push({ x, y, first: c.first })
    }
  }
  return any
}

describe('뱀', () => {
  it('씨앗이 같으면 같은 판(사과 자리까지)', () => {
    expect(snakeStart(3).food).toEqual(snakeStart(3).food)
    expect(snakeStart(3).body).toHaveLength(3)
  })

  it('그대로 두면 벽에 박는다', () => {
    const g = snakeStart(1)
    let n = 0
    while (g.alive && n < 100) {
      snakeStep(g, null)
      n++
    }
    expect(g.alive).toBe(false)
    expect(n).toBeLessThan(SNAKE_W)
  })

  it('정반대로는 못 꺾는다', () => {
    const g = snakeStart(1)
    expect(canTurn(g, 'left')).toBe(false)
    snakeStep(g, 'left')
    expect(g.dir).toBe('right')
  })

  it('화면이 꺾은 기록으로 서버가 다시 굴리면 같은 사과 수가 나온다 — 그리고 사과를 쫓으면 깬다', () => {
    for (const seed of [1, 7, 42]) {
      const g = snakeStart(seed)
      const turns: SnakeInput[] = []
      while (g.alive && g.eaten < SNAKE_PASS + 5) {
        const d = plan(g)
        if (d && d !== g.dir) turns.push({ tick: g.tick, dir: d })
        snakeStep(g, d)
      }
      const r = snakeReplay(seed, turns)
      if (g.alive) {
        // 화면은 여기서 멈췄고 서버는 끝까지 굴린다 — 사과는 적어도 이만큼
        expect(r.eaten).toBeGreaterThanOrEqual(g.eaten)
      } else {
        expect(r.eaten).toBe(g.eaten)
      }
      expect(r.eaten, `씨앗 ${seed}`).toBeGreaterThanOrEqual(SNAKE_PASS)
      expect(r.outcome).toBe('win')
    }
  })

  it('기록 없이는 사과를 거의 못 먹고 진다', () => {
    expect(snakeReplay(9, []).outcome).toBe('lose')
  })

  it('꺾기 기록 받기 — 틀린 것은 버리고, 한 틱에 하나, 틱 순서로', () => {
    expect(cleanTurns([{ tick: 5, dir: 'up' }, { tick: 2, dir: 'down' }, { tick: 5, dir: 'left' }, { tick: -1, dir: 'up' }, { tick: 3, dir: 'x' }, 7])).toEqual([
      { tick: 2, dir: 'down' },
      { tick: 5, dir: 'left' },
    ])
    expect(cleanTurns(null)).toEqual([])
  })
})
