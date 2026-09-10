import type { TileId, TileSpec } from '../types'

function slotsFor(value: number): number {
  return value >= 5 ? 2 : 1
}

function tile(id: TileId, name: string, baseValue: number, coreUnlocksOnDay: number | null = null): TileSpec {
  return { id, name, baseValue, homeOf: null, coreUnlocksOnDay, buildingSlots: slotsFor(baseValue) }
}

export const TILES: TileSpec[] = [
  { id: 'baseA', name: 'A팀 기지', baseValue: 0, homeOf: 'A', coreUnlocksOnDay: null, buildingSlots: 0 },
  { id: 'baseB', name: 'B팀 기지', baseValue: 0, homeOf: 'B', coreUnlocksOnDay: null, buildingSlots: 0 },
  { id: 'baseC', name: 'C팀 기지', baseValue: 0, homeOf: 'C', coreUnlocksOnDay: null, buildingSlots: 0 },
  { id: 'baseD', name: 'D팀 기지', baseValue: 0, homeOf: 'D', coreUnlocksOnDay: null, buildingSlots: 0 },

  // 1구역 — 각 팀 기지와 바로 맞닿은 구역
  tile('classroom', '교실', 2),
  tile('hallway', '복도', 1),
  tile('scienceRoom', '과학실', 3),
  tile('artRoom', '미술실', 3),
  tile('musicRoom', '음악실', 3),
  tile('clubRoom', '동아리실', 2),
  tile('garden', '정원', 2),
  tile('storage', '창고', 1),

  // 2구역 — 팀 사이를 잇는 중간 지대
  tile('library', '도서관', 4),
  tile('gym', '체육관', 5),
  tile('cafeteria', '급식실', 3),
  tile('rooftop', '옥상', 4),
  tile('oldBuilding', '구관', 3),

  // 핵심 지역 — DAY 3부터 개방된다
  tile('playground', '운동장', 6, 3),
  tile('auditorium', '강당', 7, 3),
  tile('broadcastRoom', '방송실', 5, 3),
  tile('studentCouncil', '학생회실', 5, 3),
  tile('centralPlaza', '중앙광장', 8, 3),
]

export const tileById: Record<TileId, TileSpec> = Object.fromEntries(TILES.map((t) => [t.id, t])) as Record<
  TileId,
  TileSpec
>

const EDGES: [TileId, TileId][] = [
  // 기지 — 1구역
  ['baseA', 'classroom'],
  ['baseA', 'hallway'],
  ['baseB', 'scienceRoom'],
  ['baseB', 'artRoom'],
  ['baseC', 'musicRoom'],
  ['baseC', 'clubRoom'],
  ['baseD', 'garden'],
  ['baseD', 'storage'],

  // 1구역끼리 — 옆 팀과 맞닿는 경계
  ['hallway', 'scienceRoom'],
  ['artRoom', 'musicRoom'],
  ['clubRoom', 'garden'],
  ['storage', 'classroom'],

  // 1구역 — 2구역
  ['classroom', 'library'],
  ['hallway', 'library'],
  ['scienceRoom', 'library'],
  ['artRoom', 'gym'],
  ['musicRoom', 'gym'],
  ['clubRoom', 'cafeteria'],
  ['garden', 'cafeteria'],
  ['storage', 'rooftop'],
  ['hallway', 'oldBuilding'],
  ['storage', 'oldBuilding'],

  // 2구역끼리 — 안쪽 고리
  ['library', 'gym'],
  ['gym', 'cafeteria'],
  ['cafeteria', 'rooftop'],
  ['rooftop', 'oldBuilding'],
  ['oldBuilding', 'library'],

  // 2구역 — 핵심 지역
  ['library', 'playground'],
  ['gym', 'auditorium'],
  ['cafeteria', 'broadcastRoom'],
  ['rooftop', 'studentCouncil'],
  ['oldBuilding', 'centralPlaza'],

  // 중앙광장 — 나머지 핵심 지역
  ['centralPlaza', 'playground'],
  ['centralPlaza', 'auditorium'],
  ['centralPlaza', 'broadcastRoom'],
  ['centralPlaza', 'studentCouncil'],
]

function buildAdjacency(edges: [TileId, TileId][]): Record<TileId, TileId[]> {
  const map = {} as Record<TileId, TileId[]>
  for (const t of TILES) map[t.id] = []
  for (const [a, b] of edges) {
    map[a].push(b)
    map[b].push(a)
  }
  return map
}

export const ADJACENCY: Record<TileId, TileId[]> = buildAdjacency(EDGES)

/** 핵심 지역이 실제로 열리는 날. */
export const CORE_UNLOCK_DAY = 3
