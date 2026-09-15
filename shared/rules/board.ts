// 학교. 지하 · 1층 · 2층 · 옥상.
//
// **층마다 복도가 하나고, 방은 그 복도에 붙는다.** 복도 양끝에 계단이
// 있고 계단으로 위아래 층에 간다. 전에는 스물다섯 방이 5×5 격자로
// 서로 직통이었다 — 교무실 옆문을 열면 급식실이 나오는 식이라,
// 학교라기보다 바둑판이었다.
//
// 이웃은 손으로 적지 않는다. 층·줄·자리에서 계산한다 — 서른 칸의
// 이웃 관계를 손으로 적으면 반드시 어딘가 틀리고, 틀려도 한참 뒤에나
// 드러난다.
//
//   같은 줄에서 옆자리        102호 ↔ 103호
//   복도 건너 마주 본 방      102호 ↔ 105호
//   줄 끝 방 ↔ 그쪽 계단
//   계단 ↔ 바로 위아래 층의 같은 쪽 계단
//
// **복도 자체는 칸이 아니다.** 걸어서 지나는 자리일 뿐이라 점령도
// 깃발도 없다. 규칙이 보는 것은 방과 계단뿐이다.
import { type TeamId, type Tier } from './v2'

export type TileId = string

/** 층. 위에서부터 옥상 · 2층 · 1층 · 지하. */
export type Floor = 'roof' | 'f2' | 'f1' | 'b1'

/** 아래에서 위로. 지오메트리와 계단 잇기가 이 순서를 본다. */
export const FLOORS: readonly Floor[] = ['b1', 'f1', 'f2', 'roof']

export const FLOOR_NAME: Record<Floor, string> = {
  b1: '지하',
  f1: '1층',
  f2: '2층',
  roof: '옥상',
}

/** 복도를 기준으로 어느 줄인가. 계단은 복도 끝에 선다. */
export type Side = 'up' | 'down' | 'stair'

export interface TileSpec {
  id: TileId
  name: string
  floor: Floor
  side: Side
  /** 그 줄에서 왼쪽부터 몇 번째인가. 계단은 서쪽 0, 동쪽 1. */
  slot: number
  value: number
  tier: Tier
  /** 기지라면 어느 팀 것인가. */
  homeOf: TeamId | null
  /**
   * 전개도에서의 자리.
   *
   * 한 층이 세 줄을 쓴다 — 위 줄 · 복도(계단) · 아래 줄. 위에서부터
   * 옥상·2층·1층·지하 순이라, 그림만 봐도 어느 층인지 안다.
   */
  planRow: number
  planCol: number
}

/** 한 층이 전개도에서 차지하는 줄 수 — 위 줄 · 복도 · 아래 줄. */
export const PLAN_ROWS_PER_FLOOR = 3
/** 전개도의 칸 수. 서쪽 계단 + 방 다섯 + 동쪽 계단. */
export const PLAN_COLS = 7

/**
 * 층별 배치.
 *
 * up 은 복도 위쪽 줄, down 은 아래쪽 줄이다. 같은 자리끼리는 복도를
 * 사이에 두고 마주 본다.
 *
 *   지하   창고 · 기술실 / 경비실
 *   1층    교무실 · 급식실 · 양호실 · 화장실 · 상점
 *          가사실 · 체육관 · 강당 · 운동장 · 정원
 *   2층    2-3 교실 · 과학실 · 음악실 · 미술실 · 도서관
 *          무용실 · 시청각실 · 방송실 · 학생회실 · 동아리실
 *   옥상   옥상 한 칸
 *
 * 값과 등급은 예전 판에서 그대로 가져왔다 — 자리가 바뀌었을 뿐
 * 어느 방이 얼마나 값진지는 그대로다.
 */
type Row = readonly (readonly [TileId, string, number, Tier, TeamId | null])[]

const PLAN: readonly { floor: Floor; up: Row; down: Row }[] = [
  {
    floor: 'b1',
    up: [
      ['storage', '창고', 1, 'zone1', null],
      ['baseC', '기술실', 0, 'base', 'C'],
    ],
    down: [['oldBuilding', '경비실', 5, 'cross', null]],
  },
  {
    floor: 'f1',
    up: [
      ['baseA', '교무실', 0, 'base', 'A'],
      ['cafeteria', '급식실', 4, 'gate', null],
      ['annex', '양호실', 5, 'cross', null],
      ['baseB', '화장실', 0, 'base', 'B'],
      ['classroom', '상점', 3, 'zone1', null],
    ],
    down: [
      ['hallway', '가사실', 1, 'zone1', null],
      ['gym', '체육관', 4, 'gate', null],
      ['auditorium', '강당', 6, 'core', null],
      ['playground', '운동장', 6, 'core', null],
      ['garden', '정원', 3, 'zone1', null],
    ],
  },
  {
    floor: 'f2',
    up: [
      ['centralPlaza', '2-3 교실', 8, 'plaza', null],
      ['scienceRoom', '과학실', 3, 'zone1', null],
      ['musicRoom', '음악실', 3, 'zone1', null],
      ['artRoom', '미술실', 1, 'zone1', null],
      ['library', '도서관', 4, 'gate', null],
    ],
    down: [
      ['newBuilding', '무용실', 5, 'cross', null],
      ['baseD', '시청각실', 0, 'base', 'D'],
      ['broadcastRoom', '방송실', 6, 'core', null],
      ['studentCouncil', '학생회실', 6, 'core', null],
      ['clubRoom', '동아리실', 1, 'zone1', null],
    ],
  },
  { floor: 'roof', up: [['rooftop', '옥상', 4, 'gate', null]], down: [] },
]

/**
 * 계단. 층마다 서쪽·동쪽 하나씩이다.
 *
 * **옥상에는 계단 칸이 없다.** 2층 계단을 올라가면 바로 옥상이다 —
 * 옥상은 한 칸짜리 열린 자리라 복도도 끝도 없다.
 */
const STAIR_FLOORS: readonly Floor[] = ['b1', 'f1', 'f2']
export type StairEnd = 'w' | 'e'
export const STAIR_ENDS: readonly StairEnd[] = ['w', 'e']
export const stairIdOf = (floor: Floor, end: StairEnd): TileId => `stair_${floor}_${end}`

const bandOf = (floor: Floor) => FLOORS.length - 1 - FLOORS.indexOf(floor)

const STAIR_TILES: TileSpec[] = STAIR_FLOORS.flatMap((floor) =>
  STAIR_ENDS.map((end, i) => ({
    id: stairIdOf(floor, end),
    name: `${FLOOR_NAME[floor]} ${end === 'w' ? '서쪽' : '동쪽'} 계단`,
    floor,
    side: 'stair' as Side,
    slot: i,
    value: 0,
    tier: 'stair' as Tier,
    homeOf: null,
    planRow: bandOf(floor) * PLAN_ROWS_PER_FLOOR + 1,
    planCol: i === 0 ? 0 : PLAN_COLS - 1,
  })),
)

const ROOM_TILES_SPEC: TileSpec[] = PLAN.flatMap((f) =>
  (['up', 'down'] as const).flatMap((side) =>
    f[side].map(([id, name, value, tier, homeOf], slot) => ({
      id,
      name,
      floor: f.floor,
      side: side as Side,
      slot,
      value,
      tier,
      homeOf,
      // **옥상은 제 층의 아래 줄에 앉힌다.** 위 줄에 두면 2층과의
      // 사이에 빈 줄이 둘 생겨서, 전개도에 옥상만 멀찍이 떠 보인다
      planRow:
        bandOf(f.floor) * PLAN_ROWS_PER_FLOOR + (f.floor === 'roof' || side === 'down' ? 2 : 0),
      planCol: f.floor === 'roof' ? Math.floor(PLAN_COLS / 2) : slot + 1,
    })),
  ),
)

export const TILES: readonly TileSpec[] = [...ROOM_TILES_SPEC, ...STAIR_TILES]

export const TILE_BY_ID: Record<TileId, TileSpec> = Object.fromEntries(
  TILES.map((t) => [t.id, t]),
)

export const TILE_IDS: readonly TileId[] = TILES.map((t) => t.id)

/** 그 층의 방들. 복도를 그릴 때와 이웃을 셀 때 둘 다 쓴다. */
export const rowOf = (floor: Floor, side: 'up' | 'down'): readonly TileSpec[] =>
  ROOM_TILES_SPEC.filter((t) => t.floor === floor && t.side === side).sort((a, b) => a.slot - b.slot)

/** 기지는 팀마다 하나다. */
export const BASE_OF: Record<TeamId, TileId> = Object.fromEntries(
  TILES.filter((t) => t.homeOf).map((t) => [t.homeOf as TeamId, t.id]),
) as Record<TeamId, TileId>

/**
 * 모두가 여기서 시작한다. 2-3 교실 — 2층 복도 서쪽 끝 방이다.
 *
 * 기지는 그대로 남는다 — 점수는 여전히 네 방을 센다. 다만 아침은
 * 다 같이 한 교실에서 연다.
 */
export const START_TILE: TileId = 'centralPlaza'

// ── 이웃 ────────────────────────────────────────────────────────

function buildAdjacency(): Record<TileId, TileId[]> {
  const out: Record<TileId, TileId[]> = Object.fromEntries(TILE_IDS.map((id) => [id, [] as TileId[]]))
  const link = (a: TileId, b: TileId) => {
    if (a === b) return
    if (!out[a].includes(b)) out[a].push(b)
    if (!out[b].includes(a)) out[b].push(a)
  }

  for (const floor of FLOORS) {
    const up = rowOf(floor, 'up')
    const down = rowOf(floor, 'down')
    for (const row of [up, down]) {
      // 같은 줄에서 옆자리
      for (let i = 1; i < row.length; i++) link(row[i - 1].id, row[i].id)
    }
    // 복도를 사이에 두고 마주 본 방
    for (let i = 0; i < Math.min(up.length, down.length); i++) link(up[i].id, down[i].id)

    // 줄 끝 방과 그쪽 계단. 옥상에는 계단 칸이 없어 2층 계단이 대신 닿는다
    const west = STAIR_FLOORS.includes(floor) ? stairIdOf(floor, 'w') : stairIdOf('f2', 'w')
    const east = STAIR_FLOORS.includes(floor) ? stairIdOf(floor, 'e') : stairIdOf('f2', 'e')
    for (const row of [up, down]) {
      if (row.length === 0) continue
      link(west, row[0].id)
      link(east, row[row.length - 1].id)
    }
  }

  // 계단은 바로 위아래 층의 같은 쪽 계단과 이어진다
  for (let i = 1; i < STAIR_FLOORS.length; i++) {
    for (const end of STAIR_ENDS) {
      link(stairIdOf(STAIR_FLOORS[i - 1], end), stairIdOf(STAIR_FLOORS[i], end))
    }
  }
  return out
}

/** 방에서 곧바로 갈 수 있는 곳. 복도를 지나는 것은 한 걸음으로 친다. */
export const ADJACENCY: Record<TileId, readonly TileId[]> = buildAdjacency()

export function isAdjacent(a: TileId, b: TileId): boolean {
  return ADJACENCY[a]?.includes(b) ?? false
}

/**
 * 걸어서 몇 걸음인가.
 *
 * **격자 거리가 아니라 실제로 세어 본 걸음이다.** 층이 생긴 뒤로는
 * 좌표를 빼서 구할 수가 없다 — 지하 창고와 옥상은 좌표로는 가까워도
 * 계단을 세 번 올라야 한다.
 */
const DIST = (() => {
  const out: Record<TileId, Record<TileId, number>> = {}
  for (const from of TILE_IDS) {
    const seen: Record<TileId, number> = { [from]: 0 }
    const queue: TileId[] = [from]
    while (queue.length > 0) {
      const cur = queue.shift() as TileId
      for (const next of ADJACENCY[cur]) {
        if (seen[next] !== undefined) continue
        seen[next] = seen[cur] + 1
        queue.push(next)
      }
    }
    out[from] = seen
  }
  return out
})()

export function tileDistance(a: TileId, b: TileId): number {
  return DIST[a]?.[b] ?? Number.POSITIVE_INFINITY
}

export function stepsBetween(a: TileId, b: TileId): number {
  return tileDistance(a, b)
}

/** 시작할 때 각 팀이 쥐고 있는 칸 — 기지와 붙어 있는 방들. */
export function startingTiles(team: TeamId): readonly TileId[] {
  const base = BASE_OF[team]
  // **계단은 빼놓는다.** 계단은 아무도 못 가지는 자리고, 넣어 두면
  // 층이 다른 두 팀이 시작부터 같은 계단을 쥔 것이 된다
  return [base, ...ADJACENCY[base].filter((n) => TILE_BY_ID[n].tier !== 'stair')]
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
 * 두 팀이 이웃인가. **같은 층을 쓰면 이웃이다.**
 *
 * 전에는 관문 하나를 나눠 쓰는 것이 기준이었다 — 5×5 격자에서만
 * 말이 되던 셈이다. 층이 생긴 지금은 같은 복도를 오가느냐가 훨씬
 * 알기 쉽다. 「먼 친구」 목표가 이걸로 판정된다.
 */
export function areNeighborTeams(a: TeamId, b: TeamId): boolean {
  if (a === b) return false
  return TILE_BY_ID[BASE_OF[a]].floor === TILE_BY_ID[BASE_OF[b]].floor
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
        while (prev.has(step)) {
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
