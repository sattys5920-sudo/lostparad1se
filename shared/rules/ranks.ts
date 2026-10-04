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

/**
 * 걸을 수 있는 칸만 번호를 매긴 길 그물. 칸이 4천 개 남짓이라 한 번만
 * 만들어 두고 같이 쓴다.
 */
interface Grid {
  /** 전개도 칸 → 그물 번호. 못 걷는 칸은 -1 */
  node: Int32Array
  /** 이웃 목록(CSR) — node i 의 이웃은 next[start[i] .. start[i + 1]) */
  start: Int32Array
  next: Int32Array
  size: number
  /** 층마다 계단통 칸의 그물 번호 */
  stairs: Record<string, number[]>
}

let GRID: Grid | null = null
function grid(): Grid {
  if (GRID) return GRID
  const node = new Int32Array(PLAN_W * PLAN_H).fill(-1)
  let size = 0
  for (let y = 0; y < PLAN_H; y++) for (let x = 0; x < PLAN_W; x++) if (walkable(x, y)) node[y * PLAN_W + x] = size++
  const start = new Int32Array(size + 1)
  const list: number[] = []
  for (let y = 0; y < PLAN_H; y++)
    for (let x = 0; x < PLAN_W; x++) {
      const i = node[y * PLAN_W + x]
      if (i < 0) continue
      start[i] = list.length
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ]) {
        if (nx < 0 || ny < 0 || nx >= PLAN_W || ny >= PLAN_H) continue
        const j = node[ny * PLAN_W + nx]
        if (j >= 0) list.push(j)
      }
    }
  start[size] = list.length
  const stairs: Record<string, number[]> = {}
  for (const st of STAIRWELLS)
    for (let y = st.plan.y; y < st.plan.y + st.plan.h; y++)
      for (let x = st.plan.x; x < st.plan.x + st.plan.w; x++) {
        const i = node[y * PLAN_W + x]
        if (i >= 0) (stairs[st.floor] ??= []).push(i)
      }
  GRID = { node, start, next: Int32Array.from(list), size, stairs }
  return GRID
}

const FAR = 0xffff

/**
 * 두 칸 사이 걸음 수.
 *
 * **출발 칸마다 길을 한 번만 퍼뜨리고 그 줄을 기억한다.** 줄 하나가 칸 수
 * × 2 바이트라 다 채워도 30 MB 남짓이다 — 전개도 전체를 줄마다 담던
 * 때는 실제 판에서 서버 메모리를 넘었다.
 * 길이 없으면(벽에 갇힌 칸 같은 옛 기록) 가로세로 거리로 친다.
 */
export function walkDistance(): (a: Cell, b: Cell) => number {
  const g = grid()
  let rows: Uint16Array | null = null
  const done = new Uint8Array(g.size)
  const queue = new Int32Array(g.size)
  const row = (i: number): Uint16Array => {
    rows ??= new Uint16Array(g.size * g.size)
    const out = rows.subarray(i * g.size, (i + 1) * g.size)
    if (done[i]) return out
    out.fill(FAR)
    out[i] = 0
    let head = 0
    let tail = 0
    queue[tail++] = i
    while (head < tail) {
      const k = queue[head++]
      for (let e = g.start[k]; e < g.start[k + 1]; e++) {
        const j = g.next[e]
        if (out[j] !== FAR) continue
        out[j] = out[k] + 1
        queue[tail++] = j
      }
    }
    done[i] = 1
    return out
  }
  const nodeOf = (c: Cell) => (c.x < 0 || c.y < 0 || c.x >= PLAN_W || c.y >= PLAN_H ? -1 : g.node[c.y * PLAN_W + c.x])
  const manhattan = (a: Cell, b: Cell) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
  /** 그 층 계단통까지 가장 가까운 걸음 */
  const toStairs = (c: Cell, floor: Floor): number | null => {
    const i = nodeOf(c)
    if (i < 0) return null
    const d = row(i)
    let best: number | null = null
    for (const k of g.stairs[floor] ?? []) if (d[k] !== FAR && (best === null || d[k] < best)) best = d[k]
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
    const i = nodeOf(a)
    const j = nodeOf(b)
    if (i < 0 || j < 0) return manhattan(a, b)
    const d = row(i)[j]
    return d !== FAR ? d : manhattan(a, b)
  }
}

/** 멈춘 자리들(시간순)을 이어 걸은 칸 수 */
export function walkedCells(stops: readonly Cell[], dist: (a: Cell, b: Cell) => number): number {
  let sum = 0
  for (let i = 1; i < stops.length; i++) sum += dist(stops[i - 1], stops[i])
  return sum
}
