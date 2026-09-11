// 5×5 판.
//
// 인접은 손으로 적지 않는다. 좌표에서 가로·세로로 맞닿은 칸을 계산한다 —
// 스물다섯 칸의 이웃 관계를 손으로 적으면 반드시 어딘가 틀리고, 틀려도
// 한참 뒤에나 드러난다. 대신 규칙 원문이 말하는 구조(기지에서 중앙까지
// 네 걸음, 관문마다 이웃 두 팀의 1구역, 90도 회전 대칭)를 시험으로 확인한다.
import { GRID, SLOTS_BY_TIER, type TeamId, type Tier } from './v2'

export type TileId = string

export interface TileSpec {
  id: TileId
  name: string
  /** 0-based 행·열. 1행1열이 왼쪽 위다. */
  row: number
  col: number
  value: number
  tier: Tier
  /** 기지라면 어느 팀 것인가. */
  homeOf: TeamId | null
  slots: number
}

/**
 * 규칙 원문 1장의 표를 그대로 옮긴 것.
 *
 *        1          2          3            4          5
 *   1  D기지     창고 1    급식실 4관   음악실 3    C기지
 *   2  정원 3    본관 5교  방송실 6핵   신관 5교    동아리실 1
 *   3  옥상 4관  학생회 6핵 중앙광장 8  강당 6핵    체육관 4관
 *   4  복도 1    구관 5교  운동장 6핵   별관 5교    과학실 3
 *   5  A기지     교실 3    도서관 4관   미술실 1    B기지
 */
const LAYOUT: readonly (readonly [TileId, string, number, Tier, TeamId | null])[][] = [
  [
    ['baseD', 'D팀 기지', 0, 'base', 'D'],
    ['storage', '창고', 1, 'zone1', null],
    ['cafeteria', '급식실', 4, 'gate', null],
    ['musicRoom', '음악실', 3, 'zone1', null],
    ['baseC', 'C팀 기지', 0, 'base', 'C'],
  ],
  [
    ['garden', '정원', 3, 'zone1', null],
    ['mainBuilding', '본관', 5, 'cross', null],
    ['broadcastRoom', '방송실', 6, 'core', null],
    ['newBuilding', '신관', 5, 'cross', null],
    ['clubRoom', '동아리실', 1, 'zone1', null],
  ],
  [
    ['rooftop', '옥상', 4, 'gate', null],
    ['studentCouncil', '학생회실', 6, 'core', null],
    ['centralPlaza', '중앙광장', 8, 'plaza', null],
    ['auditorium', '강당', 6, 'core', null],
    ['gym', '체육관', 4, 'gate', null],
  ],
  [
    ['hallway', '복도', 1, 'zone1', null],
    ['oldBuilding', '구관', 5, 'cross', null],
    ['playground', '운동장', 6, 'core', null],
    ['annex', '별관', 5, 'cross', null],
    ['scienceRoom', '과학실', 3, 'zone1', null],
  ],
  [
    ['baseA', 'A팀 기지', 0, 'base', 'A'],
    ['classroom', '교실', 3, 'zone1', null],
    ['library', '도서관', 4, 'gate', null],
    ['artRoom', '미술실', 1, 'zone1', null],
    ['baseB', 'B팀 기지', 0, 'base', 'B'],
  ],
]

export const TILES: readonly TileSpec[] = LAYOUT.flatMap((rowCells, row) =>
  rowCells.map(([id, name, value, tier, homeOf], col) => ({
    id,
    name,
    row,
    col,
    value,
    tier,
    homeOf,
    slots: SLOTS_BY_TIER[tier],
  })),
)

export const TILE_BY_ID: Record<TileId, TileSpec> = Object.fromEntries(
  TILES.map((t) => [t.id, t]),
)

export const TILE_IDS: readonly TileId[] = TILES.map((t) => t.id)

/** 기지는 팀마다 하나다. */
export const BASE_OF: Record<TeamId, TileId> = Object.fromEntries(
  TILES.filter((t) => t.homeOf).map((t) => [t.homeOf as TeamId, t.id]),
) as Record<TeamId, TileId>

function at(row: number, col: number): TileSpec | null {
  if (row < 0 || col < 0 || row >= GRID || col >= GRID) return null
  return TILE_BY_ID[LAYOUT[row][col][0]]
}

/** 가로·세로로 맞닿은 칸만 이웃이다. 대각선은 아니다. */
export const ADJACENCY: Record<TileId, readonly TileId[]> = Object.fromEntries(
  TILES.map((t) => [
    t.id,
    [
      at(t.row - 1, t.col),
      at(t.row + 1, t.col),
      at(t.row, t.col - 1),
      at(t.row, t.col + 1),
    ]
      .filter((n): n is TileSpec => n !== null)
      .map((n) => n.id),
  ]),
)

export function isAdjacent(a: TileId, b: TileId): boolean {
  return ADJACENCY[a]?.includes(b) ?? false
}

/** 격자 위의 칸 거리. 관측소 사거리와 안개에 쓴다. */
export function tileDistance(a: TileId, b: TileId): number {
  const p = TILE_BY_ID[a]
  const q = TILE_BY_ID[b]
  return Math.abs(p.row - q.row) + Math.abs(p.col - q.col)
}

/** 걸어서 몇 칸인가. 기지도 지나갈 수 있으므로 격자 거리와 같다. */
export function stepsBetween(a: TileId, b: TileId): number {
  return tileDistance(a, b)
}

/** 시작할 때 각 팀이 쥐고 있는 칸 — 기지와 1구역 두 칸. */
export function startingTiles(team: TeamId): readonly TileId[] {
  const base = BASE_OF[team]
  return [base, ...ADJACENCY[base]]
}

/** 이 1구역 칸은 어느 팀 몫인가. 기지에 붙어 있는 쪽이 주인이다. */
export function zoneOwner(id: TileId): TeamId | null {
  if (TILE_BY_ID[id].tier !== 'zone1') return null
  for (const n of ADJACENCY[id]) {
    const home = TILE_BY_ID[n].homeOf
    if (home) return home
  }
  return null
}

/**
 * 두 팀이 이웃인가. 관문 하나를 나눠 쓰면 이웃이다.
 * 「먼 친구」 목표가 이걸로 판정된다.
 */
export function areNeighborTeams(a: TeamId, b: TeamId): boolean {
  if (a === b) return false
  return TILES.filter((t) => t.tier === 'gate').some((gate) => {
    const owners = ADJACENCY[gate.id].map(zoneOwner).filter(Boolean)
    return owners.includes(a) && owners.includes(b)
  })
}

/**
 * 기지에서 우리 칸만 밟고 갈 수 있는 칸의 수. 기지는 세지 않는다.
 * 떨어진 땅은 한 점도 되지 않는다.
 */
export function connectedSize(team: TeamId, ownerOf: (id: TileId) => TeamId | null): number {
  const base = BASE_OF[team]
  const seen = new Set<TileId>([base])
  const queue: TileId[] = [base]
  while (queue.length > 0) {
    const cur = queue.shift() as TileId
    for (const next of ADJACENCY[cur]) {
      if (seen.has(next)) continue
      if (ownerOf(next) !== team) continue
      seen.add(next)
      queue.push(next)
    }
  }
  seen.delete(base)
  return seen.size
}

/** 두 칸 사이 최단 경로. 이동은 칸마다 도착 이벤트를 만든다. */
export function pathBetween(from: TileId, to: TileId): TileId[] {
  if (from === to) return []
  const prev = new Map<TileId, TileId>()
  const seen = new Set<TileId>([from])
  const queue: TileId[] = [from]
  while (queue.length > 0) {
    const cur = queue.shift() as TileId
    for (const next of ADJACENCY[cur]) {
      if (seen.has(next)) continue
      seen.add(next)
      prev.set(next, cur)
      if (next === to) {
        const path: TileId[] = [to]
        let step = to
        while (step !== from) {
          step = prev.get(step) as TileId
          if (step !== from) path.unshift(step)
        }
        return path
      }
      queue.push(next)
    }
  }
  return []
}
