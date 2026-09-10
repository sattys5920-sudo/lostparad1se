import type { TileId, TileSpec } from '../types'

/**
 * 지도는 90도 회전에 대해 완전히 대칭이다. 네 팀 모두
 *   기지 → 1구역 2칸(합 가치 4) → 관문 2곳 중 하나 → 핵심 지역 → 중앙광장
 * 이라는 똑같은 거리와 똑같은 가치를 마주한다. 판의 유불리는 자리가 아니라
 * 사람에게서 나와야 하기 때문이다.
 *
 *                       중앙광장
 *              운동장   강당   방송실   학생회실   ← 핵심(A의 기록이 열어 준다)
 *                        구관(교차로)
 *          도서관    체육관    급식실    옥상        ← 관문(두 팀이 맞닿는다)
 *        교실 복도  과학실 미술실  음악실 동아리실  정원 창고  ← 1구역
 *          A기지      B기지      C기지      D기지
 */
function slotsFor(value: number): number {
  return value >= 5 ? 2 : 1
}

function tile(id: TileId, name: string, baseValue: number, isCore = false): TileSpec {
  return { id, name, baseValue, homeOf: null, isCore, buildingSlots: slotsFor(baseValue) }
}

export const TILES: TileSpec[] = [
  { id: 'baseA', name: 'A팀 기지', baseValue: 0, homeOf: 'A', isCore: false, buildingSlots: 0 },
  { id: 'baseB', name: 'B팀 기지', baseValue: 0, homeOf: 'B', isCore: false, buildingSlots: 0 },
  { id: 'baseC', name: 'C팀 기지', baseValue: 0, homeOf: 'C', isCore: false, buildingSlots: 0 },
  { id: 'baseD', name: 'D팀 기지', baseValue: 0, homeOf: 'D', isCore: false, buildingSlots: 0 },

  // 1구역 — 팀마다 두 칸, 합쳐서 가치 4로 똑같다
  tile('classroom', '교실', 3),
  tile('hallway', '복도', 1),
  tile('scienceRoom', '과학실', 2),
  tile('artRoom', '미술실', 2),
  tile('musicRoom', '음악실', 2),
  tile('clubRoom', '동아리실', 2),
  tile('garden', '정원', 3),
  tile('storage', '창고', 1),

  // 관문 — 이웃한 두 팀이 반드시 부딪히는 자리
  tile('library', '도서관', 4),
  tile('gym', '체육관', 4),
  tile('cafeteria', '급식실', 4),
  tile('rooftop', '옥상', 4),

  // 교차로 — 네 관문이 모두 만나는 한 칸
  tile('oldBuilding', '구관', 5),

  // 핵심 지역 — A의 기록이 열어 주기 전에는 아무도 들어갈 수 없다
  tile('playground', '운동장', 6, true),
  tile('auditorium', '강당', 6, true),
  tile('broadcastRoom', '방송실', 6, true),
  tile('studentCouncil', '학생회실', 6, true),
  tile('centralPlaza', '중앙광장', 8, true),
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

  // 1구역끼리 — 이웃 팀과 맞닿는 경계 (A-B-C-D-A 고리)
  ['hallway', 'scienceRoom'],
  ['artRoom', 'musicRoom'],
  ['clubRoom', 'garden'],
  ['storage', 'classroom'],

  // 1구역 — 관문 (관문마다 두 팀이 한 칸씩)
  ['hallway', 'library'],
  ['scienceRoom', 'library'],
  ['artRoom', 'gym'],
  ['musicRoom', 'gym'],
  ['clubRoom', 'cafeteria'],
  ['garden', 'cafeteria'],
  ['storage', 'rooftop'],
  ['classroom', 'rooftop'],

  // 관문 — 교차로
  ['library', 'oldBuilding'],
  ['gym', 'oldBuilding'],
  ['cafeteria', 'oldBuilding'],
  ['rooftop', 'oldBuilding'],

  // 관문 — 핵심 지역
  ['library', 'playground'],
  ['gym', 'auditorium'],
  ['cafeteria', 'broadcastRoom'],
  ['rooftop', 'studentCouncil'],

  // 핵심 지역 — 중앙광장
  ['playground', 'centralPlaza'],
  ['auditorium', 'centralPlaza'],
  ['broadcastRoom', 'centralPlaza'],
  ['studentCouncil', 'centralPlaza'],
  ['oldBuilding', 'centralPlaza'],
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

/** 핵심 지역을 점령할 때 드는 영향력. 영향력은 오직 투표로만 들어온다. */
export const CORE_INFLUENCE_COST = 4
