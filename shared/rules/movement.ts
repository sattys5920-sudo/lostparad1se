// 말이 걷는다.
//
// 목적지를 찍으면 칸마다 15분씩 걸어간다. 앱을 꺼도 계속 걷고, 소등이
// 오면 그 자리에서 멈췄다가 08:00에 마저 걷는다 — 그래서 도착 시각은
// 실제 시계가 아니라 활동 시간으로 센다.
//
// 서버는 걸음을 초 단위로 따라가지 않는다. 출발할 때 칸마다 도착 시각을
// 미리 적어 두고, 누군가 들어왔을 때 지난 것을 한꺼번에 처리한다.
import { ADJACENCY, pathBetween, type TileId } from './board'
import { addActiveSeconds } from './clock'
import { COMMUTE_MAX_TILES, MOVE_GAME_MIN_PER_TILE } from './v2'

/** 걷는 중인 말 하나. */
export interface Walk {
  playerId: string
  /** 출발 칸. */
  from: TileId
  /** 거쳐 갈 칸들. 마지막이 목적지다. */
  path: readonly TileId[]
  startedAtMs: number
  /**
   * 칸당 시간에 곱한다. 체육관을 쥔 팀은 0.5다.
   * 출발할 때의 값으로 고정한다 — 걷는 도중에 체육관을 뺏겨도 걸음은 그대로다.
   */
  factor: number
}

/** 칸 하나를 지나는 데 걸리는 활동 초. */
export function stepSeconds(factor = 1): number {
  return Math.ceil(MOVE_GAME_MIN_PER_TILE * 60 * Math.max(0, factor))
}

/** 한 칸씩의 도착 시각. 소등을 건너뛰므로 간격이 일정하지 않다. */
export interface Arrival {
  tileId: TileId
  atMs: number
}

export function arrivals(walk: Walk): Arrival[] {
  const per = stepSeconds(walk.factor)
  const out: Arrival[] = []
  let cursor = walk.startedAtMs
  for (const tileId of walk.path) {
    cursor = addActiveSeconds(cursor, per)
    out.push({ tileId, atMs: cursor })
  }
  return out
}

/** 목적지에 닿는 시각. */
export function walkEndsAtMs(walk: Walk): number {
  const all = arrivals(walk)
  return all.length === 0 ? walk.startedAtMs : all[all.length - 1].atMs
}

/** 그 순간 말이 어디쯤 있는가. */
export interface WalkPosition {
  /** 다 걸었으면 그 칸, 걷는 중이면 null. */
  tileId: TileId | null
  /** 걷는 중일 때 방금 떠난 칸. */
  fromTile: TileId | null
  /** 걷는 중일 때 다음 칸. 목적지가 아니라 바로 다음 칸이다. */
  toTile: TileId | null
  done: boolean
}

/**
 * 걷는 도중의 위치. 판정에서는 어느 칸에도 서 있지 않은 것으로 본다 —
 * 출발하는 순간 원래 칸을 떠난 것이다.
 *
 * 다음 칸까지만 알려 준다. 목적지는 아무에게도 보이지 않으므로 여기서도
 * 내보내지 않는다.
 */
export function walkPositionAt(walk: Walk, nowMs: number): WalkPosition {
  const all = arrivals(walk)
  if (all.length === 0) return { tileId: walk.from, fromTile: null, toTile: null, done: true }
  const last = all[all.length - 1]
  if (nowMs >= last.atMs) return { tileId: last.tileId, fromTile: null, toTile: null, done: true }

  let fromTile = walk.from
  for (const step of all) {
    if (nowMs < step.atMs) return { tileId: null, fromTile, toTile: step.tileId, done: false }
    fromTile = step.tileId
  }
  // 위 반복에서 반드시 돌아간다. 방어적으로만 둔다.
  return { tileId: last.tileId, fromTile: null, toTile: null, done: true }
}

export type WalkRefusal = 'sameTile' | 'unknownTile'

export interface PlanResult {
  ok: boolean
  walk: Walk | null
  reason: WalkRefusal | null
}

/** 목적지를 찍는다. 최단 경로로 걷는다 — 길을 고르게 하지 않는다. */
export function planWalk(
  playerId: string,
  from: TileId,
  to: TileId,
  startedAtMs: number,
  factor = 1,
): PlanResult {
  if (!ADJACENCY[from] || !ADJACENCY[to]) return { ok: false, walk: null, reason: 'unknownTile' }
  if (from === to) return { ok: false, walk: null, reason: 'sameTile' }
  return {
    ok: true,
    reason: null,
    walk: { playerId, from, path: pathBetween(from, to), startedAtMs, factor },
  }
}

// ── 등교 예약 ───────────────────────────────────────────────────

/**
 * 소등 중에 찍어 두는 목적지. 08:00에 모든 팀의 예약이 동시에 출발한다.
 *
 * 예약 내용은 누구에게도 보이지 않는다 — 이 문서는 secret/ 밑에 두고,
 * 08:00에 걸음으로 바뀐 뒤에야 안개 규칙대로 드러난다.
 */
export interface CommutePlan {
  playerId: string
  to: TileId
  /** 도착하면 곧바로 깃발을 꽂는다. 토큰은 도착할 때 쓰고, 모자라면 취소된다. */
  flagOnArrival: boolean
}

export type CommuteRefusal = WalkRefusal | 'tooFar'

/** 예약은 두 칸까지다. 밤새 판을 가로지르지는 못한다. */
export function checkCommutePlan(from: TileId, to: TileId): { ok: boolean; reason: CommuteRefusal | null } {
  if (!ADJACENCY[from] || !ADJACENCY[to]) return { ok: false, reason: 'unknownTile' }
  if (from === to) return { ok: false, reason: 'sameTile' }
  if (pathBetween(from, to).length > COMMUTE_MAX_TILES) return { ok: false, reason: 'tooFar' }
  return { ok: true, reason: null }
}

/** 08:00. 예약을 걸음으로 바꾼다. 모든 팀이 같은 시각에 출발한다. */
export function releaseCommute(
  plan: CommutePlan,
  from: TileId,
  dawnMs: number,
  factor = 1,
): Walk | null {
  if (!checkCommutePlan(from, plan.to).ok) return null
  return planWalk(plan.playerId, from, plan.to, dawnMs, factor).walk
}
