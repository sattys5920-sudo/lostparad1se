// 순위 — 운영자 화면 「이력」 탭 맨 위. 심부름 · 걸음 · 문제 · 쪽지 발견 · 작물 · 덫 · 돈 · 말.
//
// 셈만 한다. 기록을 읽어 사람마다 몇 번인지 세는 것은 서버(hostRanks)다.
//
// **걸음 수는 추정이다.** 걷는 칸을 하나하나 적는 기록은 없다 — 화면은
// 멈춘 자리만 보낸다(standAt). 그래서 멈춘 자리와 다음 멈춘 자리를
// **걸을 수 있는 가장 짧은 길**로 잇고 그 칸 수를 더한다. 돌아서 걸었으면
// 실제보다 적게 나온다. 층을 바꾸면 계단통까지 · 계단통에서 걸은 만큼 센다.
import { PLAN_H, PLAN_W, STAIRWELLS, canStandAt, floorOfCell, type Cell, type Floor } from './board'
import { DOOR_CELLS, isBlockedCell } from './blocked'
import { rankRows } from './reportCard'

/** 몇 위까지 보이나. 같은 수면 같은 등수라서 줄은 더 많을 수 있다 */
export const RANK_LIMIT = 5

export interface RankRow {
  name: string
  score: number
  rank: number
}

/** 사람마다 센 수 → 위에서 limit 등까지. 0 번은 안 싣는다 */
export function topRanks(
  counts: ReadonlyMap<string, number>,
  nameOf: (playerId: string) => string | null,
  limit = RANK_LIMIT,
): RankRow[] {
  const rows: { name: string; score: number }[] = []
  for (const [id, n] of counts) {
    const name = nameOf(id)
    if (name !== null && n > 0) rows.push({ name, score: n })
  }
  return rankRows(rows)
    .filter((r) => r.rank <= limit)
    .map(({ name, score, rank }) => ({ name, score, rank }))
}

const DOORS = new Set(DOOR_CELLS.map((d) => d.y * PLAN_W + d.x))

/** 걸어서 지나갈 수 있는 칸인가 — 방 · 복도 · 문. 가구가 선 칸은 못 지난다 */
export function walkable(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= PLAN_W || y >= PLAN_H) return false
  if (DOORS.has(y * PLAN_W + x)) return true
  return canStandAt(x, y) && !isBlockedCell(x, y)
}

const STAIR_CELLS: Record<string, number[]> = {}
for (const s of STAIRWELLS) {
  const list = (STAIR_CELLS[s.floor] ??= [])
  for (let y = s.plan.y; y < s.plan.y + s.plan.h; y++)
    for (let x = s.plan.x; x < s.plan.x + s.plan.w; x++) list.push(y * PLAN_W + x)
}

/**
 * 두 칸 사이 걸음 수. 출발 칸마다 한 번만 길을 넓혀 퍼뜨리고 기억한다.
 * 길이 없으면(벽에 갇힌 칸 같은 옛 기록) 가로세로 거리로 친다.
 */
export function walkDistance(): (a: Cell, b: Cell) => number {
  const cache = new Map<number, Int32Array>()
  const from = (c: Cell): Int32Array => {
    const key = c.y * PLAN_W + c.x
    const hit = cache.get(key)
    if (hit) return hit
    const dist = new Int32Array(PLAN_W * PLAN_H).fill(-1)
    const queue = new Int32Array(PLAN_W * PLAN_H)
    let head = 0
    let tail = 0
    dist[key] = 0
    queue[tail++] = key
    while (head < tail) {
      const k = queue[head++]
      const x = k % PLAN_W
      const y = (k - x) / PLAN_W
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ]) {
        if (!walkable(nx, ny)) continue
        const nk = ny * PLAN_W + nx
        if (dist[nk] !== -1) continue
        dist[nk] = dist[k] + 1
        queue[tail++] = nk
      }
    }
    cache.set(key, dist)
    return dist
  }
  const manhattan = (a: Cell, b: Cell) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
  /** 그 층 계단통까지 가장 가까운 걸음 */
  const toStairs = (c: Cell, floor: Floor): number | null => {
    const d = from(c)
    let best: number | null = null
    for (const k of STAIR_CELLS[floor] ?? []) if (d[k] >= 0 && (best === null || d[k] < best)) best = d[k]
    return best
  }
  return (a, b) => {
    if (a.x === b.x && a.y === b.y) return 0
    const fa = floorOfCell(a.x, a.y)
    const fb = floorOfCell(b.x, b.y)
    if (fa !== null && fb !== null && fa !== fb) {
      const up = toStairs(a, fa)
      const down = toStairs(b, fb)
      if (up !== null && down !== null) return up + down
      return 0
    }
    const d = from(a)[b.y * PLAN_W + b.x]
    return d >= 0 ? d : manhattan(a, b)
  }
}

/** 멈춘 자리들(시간순)을 이어 걸은 칸 수 */
export function walkedCells(stops: readonly Cell[], dist: (a: Cell, b: Cell) => number): number {
  let sum = 0
  for (let i = 1; i < stops.length; i++) sum += dist(stops[i - 1], stops[i])
  return sum
}
