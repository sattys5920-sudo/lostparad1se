// A의 기억.
//
// 다툼이 벌어지는 칸 열세 곳에 A의 기억이 한 장면씩 묻혀 있다. 어떤 팀이
// 그 칸을 **처음으로** 가져가면 그 팀 전원에게 열린다. 나중에 뺏은 팀에게는
// 열리지 않는다 — 먼저 마주한 사람만 안다.
//
// 문장은 여기 없다. 서버 전용 데이터(functions/src/story)에 있고, 이
// 파일은 「어느 칸에 있고, 언제 누구에게 열리는가」만 안다.
import { TILES, type TileId } from './board'
import { MEMORY_TIERS } from './v2'
import type { TeamId } from './v2'

/** 기억이 묻힌 칸. 관문 4 · 교차로 4 · 핵심 4 · 중앙광장 1 = 열세 곳. */
export const MEMORY_TILES: readonly TileId[] = TILES.filter((t) =>
  MEMORY_TIERS.includes(t.tier),
).map((t) => t.id)

export const MEMORY_TILE_SET: ReadonlySet<TileId> = new Set(MEMORY_TILES)

export function hasMemory(tileId: TileId): boolean {
  return MEMORY_TILE_SET.has(tileId)
}

/** 어느 팀이 그 칸의 기억을 열었는가. 한 칸에 한 팀뿐이다. */
export interface MemoryOpened {
  tileId: TileId
  team: TeamId
  atMs: number
}

export interface OpenInput {
  tileId: TileId
  /** 깃발로 그 칸을 가져간 팀. */
  team: TeamId
  atMs: number
  /** 지금까지 열린 것들. */
  opened: readonly MemoryOpened[]
}

/**
 * 깃발이 성공한 순간 부른다. 열 것이 없으면 null.
 *
 * 기억이 없는 칸이거나, 이미 누가 열었으면 아무 일도 일어나지 않는다.
 */
export function openMemory(input: OpenInput): MemoryOpened | null {
  if (!hasMemory(input.tileId)) return null
  if (input.opened.some((o) => o.tileId === input.tileId)) return null
  return { tileId: input.tileId, team: input.team, atMs: input.atMs }
}

/** 그 팀이 지금 읽을 수 있는 기억. 게임이 끝나면 전원이 열세 장면을 다 본다. */
export function memoriesFor(
  opened: readonly MemoryOpened[],
  team: TeamId,
  over = false,
): TileId[] {
  if (over) return [...MEMORY_TILES]
  return opened.filter((o) => o.team === team).map((o) => o.tileId)
}

/** 미니맵에 발자국을 찍을 칸. 열린 칸에는 눈 위에 발자국이 하나씩 생긴다. */
export function footprintTiles(opened: readonly MemoryOpened[]): TileId[] {
  return opened.map((o) => o.tileId)
}
