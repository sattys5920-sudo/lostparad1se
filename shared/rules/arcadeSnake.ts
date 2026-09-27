// 뱀 — 먹을수록 길어진다. 벽이나 제 꼬리에 닿으면 끝.
//
// **서버가 다시 돌린다.** 화면은 박자(틱)마다 뱀을 한 칸씩 옮기고, 방향을
// 바꾼 틱만 적어 둔다. 끝나면 그 기록만 서버로 간다 — 서버는 같은 씨앗,
// 같은 함수로 처음부터 다시 굴려 사과 수를 센다. 사과 자리도 씨앗에서
// 나오니 화면과 서버가 같은 판을 본다.
//
// 시각이 아니라 **틱 번호**로 적는다. 시각으로 적으면 화면이 조금만
// 늦어도 서버에서는 한 칸 먼저 꺾어 벽에 박는다.
import { rngFrom } from '../rand'
import { ARCADE_MAX_MS, type ArcadeOutcome } from './arcade'
import type { Cell } from './board'

export const SNAKE_W = 15
export const SNAKE_H = 15
export const SNAKE_START_LEN = 3
/**
 * 한 칸 가는 시간. **처음엔 느리고 사과를 먹을수록 빨라진다.** 170ms 면
 * 처음 잡은 사람도 벽을 피한다. 사과 스무 개쯤이면 바닥(65ms)에 닿아
 * 눈으로 따라가기도 벅차다.
 */
export const SNAKE_TICK_MS = 170
export const SNAKE_TICK_MIN_MS = 65
export const SNAKE_SPEEDUP_MS = 5
/** 판 끝(오락실 공통 5분). 살아 있어도 여기서 끝낸다. */
export const SNAKE_MAX_MS = ARCADE_MAX_MS
/** 기록을 받을 틱의 끝. 제일 빨라도 5분이면 이 안이다. */
export const SNAKE_MAX_TICKS = Math.ceil(SNAKE_MAX_MS / SNAKE_TICK_MIN_MS)
/** 사과를 이만큼 먹으면 깬 것이다. */
export const SNAKE_PASS = 15

export type SnakeDir = 'up' | 'down' | 'left' | 'right'
export const SNAKE_DIRS: readonly SnakeDir[] = ['up', 'down', 'left', 'right']
const STEP: Record<SnakeDir, Cell> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }
const BACK: Record<SnakeDir, SnakeDir> = { up: 'down', down: 'up', left: 'right', right: 'left' }

export interface SnakeInput {
  /** 이 틱을 옮기기 **전에** 꺾는다. */
  tick: number
  dir: SnakeDir
}

export interface SnakeGame {
  /** 머리가 [0] 이다. */
  body: Cell[]
  dir: SnakeDir
  food: Cell
  eaten: number
  alive: boolean
  tick: number
  /** 지금까지 흐른 시간. 틱마다 그때의 빠르기만큼 더한다. */
  timeMs: number
  rnd: () => number
}

export const snakeTickMs = (eaten: number): number => Math.max(SNAKE_TICK_MIN_MS, SNAKE_TICK_MS - eaten * SNAKE_SPEEDUP_MS)

function dropFood(g: Pick<SnakeGame, 'body' | 'rnd'>): Cell {
  const taken = new Set(g.body.map((c) => `${c.x},${c.y}`))
  const free: Cell[] = []
  for (let y = 0; y < SNAKE_H; y++) for (let x = 0; x < SNAKE_W; x++) if (!taken.has(`${x},${y}`)) free.push({ x, y })
  return free[Math.floor(g.rnd() * free.length)] ?? { x: -1, y: -1 }
}

export function snakeStart(seed: number | string): SnakeGame {
  const rnd = rngFrom(`snake:${seed}`)
  const y = Math.floor(SNAKE_H / 2)
  const body = Array.from({ length: SNAKE_START_LEN }, (_, i) => ({ x: Math.floor(SNAKE_W / 2) - i, y }))
  const g = { body, dir: 'right' as SnakeDir, eaten: 0, alive: true, tick: 0, timeMs: 0, rnd, food: { x: 0, y: 0 } }
  g.food = dropFood(g)
  return g
}

/** 꺾을 수 있는가. 제 몸 쪽(정반대)으로는 못 꺾는다. */
export const canTurn = (g: SnakeGame, dir: SnakeDir): boolean => dir !== g.dir && dir !== BACK[g.dir]

/** 한 틱. **g 를 고친다** — 화면이 매 박자 부르고, 서버는 기록을 넣으며 부른다. */
export function snakeStep(g: SnakeGame, turn: SnakeDir | null): void {
  if (!g.alive) return
  if (turn && canTurn(g, turn)) g.dir = turn
  g.timeMs += snakeTickMs(g.eaten)
  g.tick++
  const head = g.body[0]
  const next = { x: head.x + STEP[g.dir].x, y: head.y + STEP[g.dir].y }
  const eats = next.x === g.food.x && next.y === g.food.y
  // 꼬리는 이번 틱에 빠진다 — 먹지 않으면 꼬리 자리로는 들어가도 된다
  const body = eats ? g.body : g.body.slice(0, -1)
  const wall = next.x < 0 || next.y < 0 || next.x >= SNAKE_W || next.y >= SNAKE_H
  if (wall || body.some((c) => c.x === next.x && c.y === next.y)) {
    g.alive = false
    return
  }
  g.body = [next, ...body]
  if (eats) {
    g.eaten++
    g.food = dropFood(g)
  }
  if (g.tick >= SNAKE_MAX_TICKS || g.timeMs >= SNAKE_MAX_MS) g.alive = false
}

/** 화면이 보낸 꺾기 기록을 믿을 수 있는 모양으로. 틱 순서, 한 틱에 하나. */
export function cleanTurns(raw: unknown): SnakeInput[] {
  if (!Array.isArray(raw)) return []
  const out = new Map<number, SnakeDir>()
  for (const r of raw.slice(0, SNAKE_MAX_TICKS)) {
    const tick = Number((r as { tick?: unknown })?.tick)
    const dir = (r as { dir?: unknown })?.dir
    if (!Number.isInteger(tick) || tick < 0 || tick >= SNAKE_MAX_TICKS) continue
    if (typeof dir !== 'string' || !(SNAKE_DIRS as readonly string[]).includes(dir)) continue
    out.set(tick, dir as SnakeDir)
  }
  return [...out.entries()].sort((a, b) => a[0] - b[0]).map(([tick, dir]) => ({ tick, dir }))
}

export interface SnakeResult {
  eaten: number
  ticks: number
  timeMs: number
  score: number
  outcome: ArcadeOutcome
}

/** 기록 하나로 판 전체를 다시 굴린다. **서버가 사과를 세는 길은 이것뿐이다.** */
export function snakeReplay(seed: number | string, turns: readonly SnakeInput[]): SnakeResult {
  const g = snakeStart(seed)
  let i = 0
  while (g.alive) {
    while (i < turns.length && turns[i].tick < g.tick) i++
    const turn = i < turns.length && turns[i].tick === g.tick ? turns[i].dir : null
    snakeStep(g, turn)
  }
  return { eaten: g.eaten, ticks: g.tick, timeMs: g.timeMs, score: g.eaten, outcome: g.eaten >= SNAKE_PASS ? 'win' : 'lose' }
}
