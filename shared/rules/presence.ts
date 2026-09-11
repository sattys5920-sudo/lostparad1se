// 어디에 얼마나 서 있었나.
//
// 체류·동석·방문을 여기 한 곳에서만 계산한다. 영역전의 깃발 판정과 개인
// 미션의 단짝·목격자·편지가 전부 이 함수를 쓴다 — 두 군데서 따로 세면
// 반드시 다른 답이 나오고, 그때는 이미 판이 끝나 있다.
//
// 활동 시간(08:00~24:00)만 센다. 소등은 빠진다. 걷는 중인 말은 어느 칸에도
// 있지 않은 것으로 본다 — 출발하는 순간 원래 칸을 떠난 것이다. 잠든 말은
// 그 자리에 그대로 있다.
import { activeSecondsBetween } from './clock'
import type { TileId } from './board'

/** 말이 어디에 있었는지 한 토막. endMs가 null이면 아직 거기 있다. */
export interface Interval {
  playerId: string
  /** 걷는 중이면 null — 어느 칸에도 세지 않는다. */
  tileId: TileId | null
  startMs: number
  endMs: number | null
  state: 'standing' | 'asleep' | 'walking'
}

/** 판정에 세는 상태. 잠든 말은 서 있는 것과 똑같이 센다. */
const COUNTS = new Set(['standing', 'asleep'])

function clip(iv: Interval, fromMs: number, toMs: number): [number, number] | null {
  const start = Math.max(iv.startMs, fromMs)
  const end = Math.min(iv.endMs ?? toMs, toMs)
  return end > start ? [start, end] : null
}

const usable = (iv: Interval) => iv.tileId !== null && COUNTS.has(iv.state)

/**
 * 그 사람이 그 칸에 머문 시간(활동 초).
 *
 * 구간이 밤을 걸쳐 있어도 소등은 빠진다 — 23:30에 서서 다음 날 09:00까지
 * 있었다면 1시간 반이 아니라 1시간 반 중 활동분만 센다.
 */
export function stayedSeconds(
  intervals: readonly Interval[],
  playerId: string,
  tileId: TileId,
  fromMs: number,
  toMs: number,
): number {
  let total = 0
  for (const iv of intervals) {
    if (iv.playerId !== playerId || iv.tileId !== tileId || !usable(iv)) continue
    const span = clip(iv, fromMs, toMs)
    if (span) total += activeSecondsBetween(span[0], span[1])
  }
  return total
}

/** 두 사람이 같은 칸에 동시에 있던 시간(활동 초). 칸이 어디든 상관없다. */
export function coStaySeconds(
  intervals: readonly Interval[],
  a: string,
  b: string,
  fromMs: number,
  toMs: number,
): number {
  const mine = intervals.filter((iv) => iv.playerId === a && usable(iv))
  const yours = intervals.filter((iv) => iv.playerId === b && usable(iv))
  let total = 0
  for (const x of mine) {
    const xs = clip(x, fromMs, toMs)
    if (!xs) continue
    for (const y of yours) {
      if (y.tileId !== x.tileId) continue
      const ys = clip(y, fromMs, toMs)
      if (!ys) continue
      const start = Math.max(xs[0], ys[0])
      const end = Math.min(xs[1], ys[1])
      if (end > start) total += activeSecondsBetween(start, end)
    }
  }
  return total
}

/**
 * 발을 디딘 적 있는 칸. 걸어가며 거친 칸도 들어간다 — 머문 시간은 따지지
 * 않는다. 전학생의 「서로 다른 칸 15곳」이 이걸 쓴다.
 */
export function visitedTiles(intervals: readonly Interval[], playerId: string): Set<TileId> {
  const out = new Set<TileId>()
  for (const iv of intervals) {
    if (iv.playerId === playerId && iv.tileId !== null) out.add(iv.tileId)
  }
  return out
}

/** 그 순간 그 칸에 서 있던 사람들. 깃발 판정과 종례가 이걸 쓴다. */
export function presentAt(
  intervals: readonly Interval[],
  tileId: TileId,
  atMs: number,
): string[] {
  const out = new Set<string>()
  for (const iv of intervals) {
    if (iv.tileId !== tileId || !usable(iv)) continue
    if (iv.startMs <= atMs && (iv.endMs === null || iv.endMs > atMs)) out.add(iv.playerId)
  }
  return [...out]
}

/** 그 순간 그 사람이 선 칸. 걷는 중이면 null. */
export function tileAt(
  intervals: readonly Interval[],
  playerId: string,
  atMs: number,
): TileId | null {
  for (const iv of intervals) {
    if (iv.playerId !== playerId || !usable(iv)) continue
    if (iv.startMs <= atMs && (iv.endMs === null || iv.endMs > atMs)) return iv.tileId
  }
  return null
}

/**
 * 그 사람이 머문 적 있는, 조건에 맞는 칸의 수.
 * 떠날 아이의 「서로 다른 세 팀의 칸에 각각 1시간 이상」이 이걸 쓴다.
 */
export function tilesStayedOver(
  intervals: readonly Interval[],
  playerId: string,
  seconds: number,
  fromMs: number,
  toMs: number,
  where: (tileId: TileId) => boolean = () => true,
): Set<TileId> {
  const out = new Set<TileId>()
  for (const tileId of visitedTiles(intervals, playerId)) {
    if (!where(tileId)) continue
    if (stayedSeconds(intervals, playerId, tileId, fromMs, toMs) >= seconds) out.add(tileId)
  }
  return out
}
