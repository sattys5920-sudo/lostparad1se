// 학교. 지하 · 1층 · 2층 · 옥상.
//
// **여기가 지도의 원본이다.** 방이 어디에 얼마나 크게 앉는지, 복도가
// 어떻게 꺾이는지를 이 파일이 정하고, 그림(src/school/map/world.ts)은
// 그걸 그대로 읽어 그린다. 두 벌로 두면 반드시 어긋난다 — 화면에서는
// 걸어 들어가지는데 서버는 「이웃이 아니다」라고 하는 식이다.
//
// 전에는 층마다 방이 일렬로 늘어서고 복도가 곧은 막대 하나였다.
// 학교라기보다 복도 하나짜리 모델하우스였다. 지금은 층마다 복도가
// 다르게 꺾이고, 방도 크기가 제각각이다 — 어느 층인지 모양만 봐도
// 안다.
//
// **이웃은 손으로 적지 않는다. 네모에서 계산한다.**
//
//   두 방 사이가 복도 하나(혹은 벽 하나)만큼 떨어져 있고
//   맞닿은 변이 세 칸 넘게 겹치면 이웃이다.
//
// 그래서 방을 옮기면 이웃도 따라 바뀐다. 손으로 적은 목록이 남아
// 조용히 거짓말하는 일이 없다.
//
// **복도 자체는 칸이 아니다.** 걸어서 지나는 자리일 뿐이라 점령도
// 깃발도 없다. 규칙이 보는 것은 방과 계단참뿐이다.
import { type TeamId, type Tier } from './v2'

export type TileId = string

/** 층. 위에서부터 옥상 · 2층 · 1층 · 지하. */
export type Floor = 'roof' | 'f2' | 'f1' | 'b1'

/** 아래에서 위로. 계단 잇기가 이 순서를 본다. */
export const FLOORS: readonly Floor[] = ['b1', 'f1', 'f2', 'roof']

export const FLOOR_NAME: Record<Floor, string> = {
  b1: '지하',
  f1: '1층',
  f2: '2층',
  roof: '옥상',
}

/** 칸 네모. 층 안에서의 자리이고, 단위는 걸어 다니는 칸이다. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type StairEnd = 'w' | 'e'
export const STAIR_ENDS: readonly StairEnd[] = ['w', 'e']
export const stairIdOf = (floor: Floor, end: StairEnd): TileId => `stair_${floor}_${end}`

export interface TileSpec {
  id: TileId
  name: string
  /** 전개도처럼 좁은 데에 적는 이름. 계단참은 「계단」 두 자로 줄인다. */
  shortName: string
  floor: Floor
  value: number
  tier: Tier
  /** 기지라면 어느 팀 것인가. */
  homeOf: TeamId | null
  /** 계단참이면 어느 쪽 끝인가. */
  stairEnd: StairEnd | null
  /** 층 안에서의 자리. */
  rect: Rect
  /** 건물 전체 전개도에서의 자리 — 층을 위아래로 쌓아 놓은 좌표다. */
  plan: Rect
}

// ── 층별 배치 ───────────────────────────────────────────────────
//
// 좌표는 층 왼쪽 위가 (0,0)이다. 방과 복도 사이에는 **반드시 벽이 한
// 줄** 있어야 한다 — 붙여 놓으면 문 없이 벽을 통과하는 방이 된다.
// 그런 실수는 world.ts 가 켜질 때 바로 터뜨린다.

type RoomDef = readonly [TileId, string, number, Tier, TeamId | null, Rect]

interface FloorDef {
  floor: Floor
  /** 복도 조각들. 서로 맞닿아 한 덩어리를 이룬다. */
  halls: readonly Rect[]
  /** 계단참. 복도에 바로 붙어 있어 문이 없다. */
  stairs: readonly { end: StairEnd; rect: Rect }[]
  rooms: readonly RoomDef[]
}

/**
 * 지하 — 짧은 복도 하나가 동쪽 끝에서 위로 꺾인다.
 *
 *   ┌창고──┐ ┌기술실───┐   ┌계단┐
 *   └──────┘ └─────────┘   │   │
 *   ══════════════════════╗ └───┘
 *        ┌경비실─────┐    ║
 *        └───────────┘    ╝
 */
const B1: FloorDef = {
  floor: 'b1',
  halls: [
    { x: 8, y: 12, w: 30, h: 3 },
    { x: 38, y: 4, w: 3, h: 11 },
  ],
  stairs: [
    { end: 'w', rect: { x: 2, y: 8, w: 6, h: 11 } },
    { end: 'e', rect: { x: 41, y: 2, w: 6, h: 11 } },
  ],
  rooms: [
    ['storage', '창고', 1, 'zone1', null, { x: 9, y: 2, w: 11, h: 9 }],
    ['baseC', '기술실', 0, 'base', 'C', { x: 22, y: 1, w: 13, h: 10 }],
    ['oldBuilding', '경비실', 5, 'cross', null, { x: 10, y: 16, w: 18, h: 9 }],
  ],
}

/**
 * 1층 — 긴 복도 하나가 가운데에서 아래로 갈라지고, 그 끝에서 다시
 * 좌우로 뻗는다. 갈라진 아래쪽에 정원과 화장실이 따로 떨어져 있다.
 *
 * 동쪽 계단 밑으로 짧은 가지가 하나 더 내려가 **연구실**에 닿는다.
 * 연구실은 학교에서 하나뿐이고 이웃이 계단 하나뿐인 막다른 방이다 —
 * 어느 팀도 제 땅으로 감싸 둘 수 없고, 가려면 계단을 지나야 한다.
 */
const F1: FloorDef = {
  floor: 'f1',
  halls: [
    { x: 8, y: 16, w: 49, h: 3 },
    { x: 30, y: 19, w: 3, h: 12 },
    { x: 18, y: 31, w: 30, h: 3 },
    { x: 53, y: 19, w: 3, h: 11 },
  ],
  stairs: [
    { end: 'w', rect: { x: 2, y: 11, w: 6, h: 13 } },
    { end: 'e', rect: { x: 57, y: 11, w: 6, h: 19 } },
  ],
  rooms: [
    ['baseA', '교무실', 0, 'base', 'A', { x: 9, y: 5, w: 12, h: 10 }],
    ['cafeteria', '급식실', 4, 'gate', null, { x: 23, y: 3, w: 10, h: 12 }],
    ['annex', '양호실', 5, 'cross', null, { x: 35, y: 7, w: 8, h: 8 }],
    ['classroom', '상점', 3, 'zone1', null, { x: 45, y: 4, w: 9, h: 11 }],
    ['hallway', '가사실', 1, 'zone1', null, { x: 9, y: 20, w: 10, h: 8 }],
    ['gym', '체육관', 4, 'gate', null, { x: 20, y: 20, w: 9, h: 10 }],
    ['auditorium', '강당', 6, 'core', null, { x: 34, y: 20, w: 9, h: 10 }],
    ['playground', '운동장', 6, 'core', null, { x: 44, y: 20, w: 8, h: 10 }],
    ['labRoom', '연구실', 5, 'lab', null, { x: 51, y: 31, w: 12, h: 10 }],
    ['garden', '정원', 3, 'zone1', null, { x: 19, y: 35, w: 10, h: 8 }],
    ['baseB', '화장실', 0, 'base', 'B', { x: 33, y: 35, w: 11, h: 9 }],
  ],
}

/**
 * 2층 — 복도가 ㅁ 자로 돈다. 가운데 세 방은 사방이 복도라 문이 여럿
 * 이고, 동아리실만 서쪽 복도 바깥에 혼자 붙어 있다.
 */
const F2: FloorDef = {
  floor: 'f2',
  halls: [
    { x: 8, y: 10, w: 46, h: 3 },
    { x: 10, y: 13, w: 3, h: 16 },
    { x: 13, y: 26, w: 38, h: 3 },
    { x: 51, y: 13, w: 3, h: 16 },
  ],
  stairs: [
    { end: 'w', rect: { x: 2, y: 4, w: 6, h: 17 } },
    { end: 'e', rect: { x: 54, y: 4, w: 6, h: 17 } },
  ],
  rooms: [
    ['centralPlaza', '2-3 교실', 8, 'plaza', null, { x: 9, y: 1, w: 16, h: 8 }],
    ['scienceRoom', '과학실', 3, 'zone1', null, { x: 27, y: 2, w: 10, h: 7 }],
    ['musicRoom', '음악실', 3, 'zone1', null, { x: 39, y: 1, w: 13, h: 8 }],
    ['artRoom', '미술실', 1, 'zone1', null, { x: 14, y: 14, w: 11, h: 11 }],
    ['library', '도서관', 4, 'gate', null, { x: 27, y: 14, w: 11, h: 11 }],
    ['baseD', '시청각실', 0, 'base', 'D', { x: 40, y: 14, w: 10, h: 11 }],
    ['newBuilding', '무용실', 5, 'cross', null, { x: 14, y: 30, w: 12, h: 9 }],
    ['broadcastRoom', '방송실', 6, 'core', null, { x: 28, y: 30, w: 11, h: 9 }],
    ['studentCouncil', '학생회실', 6, 'core', null, { x: 41, y: 30, w: 10, h: 9 }],
    ['clubRoom', '동아리실', 1, 'zone1', null, { x: 2, y: 22, w: 7, h: 12 }],
  ],
}

/** 옥상 — 한 칸이다. 복도도 계단참도 없고, 2층 계단이 곧장 올라온다. */
const ROOF: FloorDef = {
  floor: 'roof',
  halls: [],
  stairs: [],
  rooms: [['rooftop', '옥상', 4, 'gate', null, { x: 8, y: 2, w: 40, h: 12 }]],
}

const PLAN_BY_FLOOR: Record<Floor, FloorDef> = { b1: B1, f1: F1, f2: F2, roof: ROOF }

/** 전개도 가장자리. */
export const PLAN_MARGIN = 2
/** 층과 층 사이. 벽으로 둔다 — 위층이 아래층에 붙어 보이면 안 된다. */
export const PLAN_BAND_GAP = 3

const allRects = (f: FloorDef): Rect[] => [
  ...f.halls,
  ...f.stairs.map((s) => s.rect),
  ...f.rooms.map((r) => r[5]),
]

/** 그 층이 차지하는 높이. 가장 아래 네모 밑에 벽 한 줄을 남긴다. */
const bandHeight = (f: FloorDef) => Math.max(...allRects(f).map((r) => r.y + r.h)) + 1

/** 위에서부터 옥상 · 2층 · 1층 · 지하 순으로 쌓는다. */
const STACK: readonly Floor[] = [...FLOORS].reverse()

const BAND_TOP: Record<Floor, number> = (() => {
  const out = {} as Record<Floor, number>
  let y = PLAN_MARGIN
  for (const floor of STACK) {
    out[floor] = y
    y += bandHeight(PLAN_BY_FLOOR[floor]) + PLAN_BAND_GAP
  }
  return out
})()

/** 전개도 전체 크기. 그림판이 이 크기로 잡힌다. */
export const PLAN_W =
  PLAN_MARGIN +
  Math.max(...FLOORS.flatMap((f) => allRects(PLAN_BY_FLOOR[f]).map((r) => r.x + r.w))) +
  1 +
  PLAN_MARGIN
export const PLAN_H =
  BAND_TOP[FLOORS[0]] + bandHeight(PLAN_BY_FLOOR[FLOORS[0]]) + PLAN_MARGIN

const toPlan = (floor: Floor, r: Rect): Rect => ({
  x: r.x + PLAN_MARGIN,
  y: r.y + BAND_TOP[floor],
  w: r.w,
  h: r.h,
})

/** 복도 조각 전부. 전개도 좌표다. 그림판이 이걸 읽어 복도를 판다. */
export const HALLS: readonly { floor: Floor; rect: Rect }[] = FLOORS.flatMap((floor) =>
  PLAN_BY_FLOOR[floor].halls.map((rect) => ({ floor, rect: toPlan(floor, rect) })),
)

const ROOM_TILES: TileSpec[] = FLOORS.flatMap((floor) =>
  PLAN_BY_FLOOR[floor].rooms.map(([id, name, value, tier, homeOf, rect]) => ({
    id,
    name,
    shortName: name,
    floor,
    value,
    tier,
    homeOf,
    stairEnd: null,
    rect,
    plan: toPlan(floor, rect),
  })),
)

const STAIR_TILES: TileSpec[] = FLOORS.flatMap((floor) =>
  PLAN_BY_FLOOR[floor].stairs.map(({ end, rect }) => ({
    id: stairIdOf(floor, end),
    name: `${FLOOR_NAME[floor]} ${end === 'w' ? '서쪽' : '동쪽'} 계단`,
    shortName: '계단',
    floor,
    value: 0,
    tier: 'stair' as Tier,
    homeOf: null,
    stairEnd: end,
    rect,
    plan: toPlan(floor, rect),
  })),
)

/** 계단참이 있는 층. 옥상에는 없다 — 2층 계단이 곧장 올라온다. */
export const STAIR_FLOORS: readonly Floor[] = FLOORS.filter(
  (f) => PLAN_BY_FLOOR[f].stairs.length > 0,
)

export const TILES: readonly TileSpec[] = [...ROOM_TILES, ...STAIR_TILES]

export const TILE_BY_ID: Record<TileId, TileSpec> = Object.fromEntries(TILES.map((t) => [t.id, t]))

export const TILE_IDS: readonly TileId[] = TILES.map((t) => t.id)

/** 그 층의 칸들. 계단참까지 센다. */
export const tilesOn = (floor: Floor): readonly TileSpec[] => TILES.filter((t) => t.floor === floor)

/** 기지는 팀마다 하나다. */
export const BASE_OF: Record<TeamId, TileId> = Object.fromEntries(
  TILES.filter((t) => t.homeOf).map((t) => [t.homeOf as TeamId, t.id]),
) as Record<TeamId, TileId>

/**
 * 모두가 여기서 시작한다. 2-3 교실 — 2층 북쪽의 제일 큰 교실이다.
 *
 * 기지는 그대로 남는다 — 점수는 여전히 네 방을 센다. 다만 아침은
 * 다 같이 한 교실에서 연다.
 */
export const START_TILE: TileId = 'centralPlaza'

// ── 이웃 ────────────────────────────────────────────────────────

/**
 * 두 네모 사이에 이만큼까지 벌어져 있으면 「바로 옆」으로 친다.
 *
 * 벽 하나면 1, 벽·복도(세 칸)·벽이면 5다. 여섯까지 봐 주는 건 복도를
 * 네 칸으로 넓힌 데가 있어도 그대로 이웃이게 하려는 것이다.
 */
const MAX_GAP = 6
/** 맞닿은 변이 이만큼은 겹쳐야 한다. 모서리만 스친 것은 이웃이 아니다. */
const MIN_OVERLAP = 3

const span = (a0: number, a1: number, b0: number, b1: number) =>
  Math.min(a1, b1) - Math.max(a0, b0) + 1

/** 두 네모가 한 뼘 거리인가. 가로로든 세로로든 한쪽이면 된다. */
export function rectsNear(a: Rect, b: Rect): boolean {
  const ox = span(a.x, a.x + a.w - 1, b.x, b.x + b.w - 1)
  const oy = span(a.y, a.y + a.h - 1, b.y, b.y + b.h - 1)
  if (ox > 0 && oy > 0) return false // 겹친 네모는 애초에 없어야 한다
  if (oy >= MIN_OVERLAP && ox <= 0 && -ox <= MAX_GAP) return true
  if (ox >= MIN_OVERLAP && oy <= 0 && -oy <= MAX_GAP) return true
  return false
}

function buildAdjacency(): Record<TileId, TileId[]> {
  const out: Record<TileId, TileId[]> = Object.fromEntries(
    TILE_IDS.map((id) => [id, [] as TileId[]]),
  )
  const link = (a: TileId, b: TileId) => {
    if (a === b) return
    if (!out[a].includes(b)) out[a].push(b)
    if (!out[b].includes(a)) out[b].push(a)
  }

  // 같은 층에서 한 뼘 거리인 칸끼리
  for (const floor of FLOORS) {
    const here = tilesOn(floor)
    for (let i = 0; i < here.length; i++) {
      for (let j = i + 1; j < here.length; j++) {
        if (rectsNear(here[i].rect, here[j].rect)) link(here[i].id, here[j].id)
      }
    }
  }

  // 계단은 바로 위아래 층의 같은 쪽 계단과 이어진다
  for (let i = 1; i < STAIR_FLOORS.length; i++) {
    for (const end of STAIR_ENDS) {
      link(stairIdOf(STAIR_FLOORS[i - 1], end), stairIdOf(STAIR_FLOORS[i], end))
    }
  }
  // 옥상에는 계단참이 없다. 맨 위 층 계단을 올라가면 곧 옥상이다
  const top = STAIR_FLOORS[STAIR_FLOORS.length - 1]
  for (const end of STAIR_ENDS) link(stairIdOf(top, end), 'rooftop')

  return out
}

// ── 복도로 닿는 곳 ──────────────────────────────────────────────
//
// **이웃과 오갈 수 있는 곳은 다른 것이다.**
//
// 이웃(ADJACENCY)은 「가까운 방」이다 — 안개가 보여 주는 범위, 시작
// 땅, 이어 붙인 땅 점수가 이것을 본다. 페이즈에 토큰 한 개로 넘는
// 것도 이것이다.
//
// 그런데 복도는 층 하나를 통째로 잇는다. 1층 서쪽 끝에서 동쪽 끝까지
// 문 하나 안 지나고 걸어갈 수 있다. 그래서 「이웃이 아니면 못 들어간다」로
// 두면, 눈앞의 문 앞에 서서 못 들어가는 일이 생긴다 — 걸어서 닿는
// 방 짝 254개 중 181개가 그랬다.
//
// **자유 시간에는 복도로 닿으면 들어간다.** 어차피 공짜고 즉시라,
// 이웃만 허용해 봐야 같은 자리에 몇 번 더 눌러 가는 것과 같다.

interface HallRect {
  floor: Floor
  rect: Rect
}

/** 서로 맞닿은 복도 조각은 한 덩어리다. */
const HALL_GROUP: number[] = (() => {
  const g = HALLS.map((_, i) => i)
  const find = (i: number): number => (g[i] === i ? i : (g[i] = find(g[i])))
  const touches = (a: HallRect, b: HallRect) => {
    if (a.floor !== b.floor) return false
    const overX = Math.min(a.rect.x + a.rect.w, b.rect.x + b.rect.w) > Math.max(a.rect.x, b.rect.x)
    const overY = Math.min(a.rect.y + a.rect.h, b.rect.y + b.rect.h) > Math.max(a.rect.y, b.rect.y)
    const sideX = a.rect.x + a.rect.w === b.rect.x || b.rect.x + b.rect.w === a.rect.x
    const sideY = a.rect.y + a.rect.h === b.rect.y || b.rect.y + b.rect.h === a.rect.y
    return (sideX && overY) || (sideY && overX)
  }
  for (let i = 0; i < HALLS.length; i++) {
    for (let j = i + 1; j < HALLS.length; j++) {
      if (touches(HALLS[i], HALLS[j])) g[find(i)] = find(j)
    }
  }
  return HALLS.map((_, i) => find(i))
})()

/**
 * 그 칸이 닿는 복도 덩어리들.
 *
 * 방은 벽 하나를 사이에 두고 닿고(=문이 난다), 계단참은 복도에 그대로
 * 열려 있다. 옥상처럼 복도가 없는 칸은 빈 집합이다.
 */
const HALLS_OF: Record<TileId, Set<number>> = (() => {
  const out: Record<TileId, Set<number>> = {}
  for (const t of TILES) {
    const set = new Set<number>()
    const r = t.plan
    // 계단참은 붙어 있고, 방은 벽 한 줄을 사이에 둔다
    const gap = t.tier === 'stair' ? 0 : 1
    HALLS.forEach((h, i) => {
      if (h.floor !== t.floor) return
      const g = h.rect
      const overX = Math.min(r.x + r.w, g.x + g.w) - Math.max(r.x, g.x)
      const overY = Math.min(r.y + r.h, g.y + g.h) - Math.max(r.y, g.y)
      const sideX = g.x + g.w + gap === r.x || r.x + r.w + gap === g.x
      const sideY = g.y + g.h + gap === r.y || r.y + r.h + gap === g.y
      if ((sideX && overY >= MIN_OVERLAP) || (sideY && overX >= MIN_OVERLAP)) set.add(HALL_GROUP[i])
    })
    out[t.id] = set
  }
  return out
})()

/**
 * 복도로 이어져 있는가. **같은 복도에 붙은 방끼리는 오갈 수 있다.**
 *
 * 계단으로 층을 넘는 것은 여기 없다 — 그것은 이웃(계단 ↔ 계단)이
 * 맡는다. 부르는 쪽이 둘을 함께 본다.
 */
export function sameHall(a: TileId, b: TileId): boolean {
  if (a === b) return false
  const x = HALLS_OF[a]
  const y = HALLS_OF[b]
  if (!x || !y) return false
  for (const g of x) if (y.has(g)) return true
  return false
}

/**
 * 자유 시간에 걸어 들어갈 수 있는가.
 *
 * 복도로 닿거나, 이웃이거나(계단으로 층을 넘는 경우). **페이즈에는
 * 이것을 쓰지 않는다** — 토큰 한 개는 옆방까지다.
 */
export function canRoamTo(from: TileId, to: TileId): boolean {
  return sameHall(from, to) || isAdjacent(from, to)
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
