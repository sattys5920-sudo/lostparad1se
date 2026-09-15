// 걸어 다니는 학교. **판은 여기서 정하지 않는다 — shared/rules/board.ts 가 정한다.**
//
// 층마다 복도가 하나고, 방은 그 복도 위아래로 늘어선다. 복도 양끝에
// 계단이 있고 계단으로 위아래 층에 간다.
//
//   옥상    한 칸짜리 열린 자리
//   2층     2-3 교실 · 과학실 · 음악실 · 미술실 · 도서관
//           ─────────────── 복도 ───────────────
//           무용실 · 시청각실 · 방송실 · 학생회실 · 동아리실
//   1층     교무실 · 급식실 · 양호실 · 화장실 · 상점
//           ─────────────── 복도 ───────────────
//           가사실 · 체육관 · 강당 · 운동장 · 정원
//   지하    창고 · 기술실 / 경비실
//
// **복도는 방이 아니다.** 걸어서 지나는 자리일 뿐이라 점령도 깃발도
// 없고, 거기 선 동안에는 어느 방에도 있지 않다(문턱과 같다).
//
// **계단은 뚫린 문이 아니라 건너뛰는 자리다.** 층이 서로 멀리 떨어져
// 그려져 있어서 벽에 구멍을 낼 수가 없다 — 계단 칸을 밟으면 위아래
// 층의 짝 계단으로 옮겨 놓는다.
//
// 전에는 스물다섯 방이 5×5 격자로 서로 직통이었다. 교무실 옆문을 열면
// 급식실이 나오는 식이라 학교라기보다 바둑판이었다.
import {
  ADJACENCY,
  FLOORS,
  START_TILE,
  TILE_BY_ID,
  TILES as BOARD,
  rowOf,
  stairIdOf,
  type Floor,
  type StairEnd,
} from '../../../shared/rules/board'
import type { Tier } from '../../../shared/rules/v2'
import type { MarkKind, PropKind } from './sprites'
import type { TeamId, TileId } from '../types'

export type { PropKind, MarkKind } from './sprites'

export const TILE = 16

/**
 * 방 한 변과 방 사이 벽 한 줄.
 *
 * **화면에 들어오는 크기여야 한다.** 캔버스는 한 변이 380px 쯤이고 2배로
 * 그리니 열한 칸이 보인다. 방이 아홉 칸이면 방과 양옆 벽이 딱 들어와서,
 * 선 자리에서 제 방의 문이 보인다.
 */
const ROOM = 9
const CELL = ROOM + 1
const MARGIN = 2

/** 방 한 변(칸). 화면에 몇 칸이 들어오는지와 맞물린다 — world.test.ts 가 지킨다. */
export const ROOM_TILES = ROOM

/** 복도와 계단참의 높이. 셋이면 두 사람이 비켜 지나갈 수 있다. */
export const AISLE_WIDE = 3
/** 계단참 너비. */
const STAIR_W = 5
/** 한 층의 높이 — 위 줄 + 벽 + 복도 + 벽 + 아래 줄. */
const BAND_H = ROOM + 1 + AISLE_WIDE + 1 + ROOM
/** 층과 층 사이. 벽으로 둔다 — 위층이 아래층에 붙어 보이면 안 된다. */
const BAND_GAP = 3

/** 방 줄이 시작하는 x. 왼쪽에 계단참과 벽 한 줄이 있다. */
const ROOM_X0 = MARGIN + STAIR_W + 1

const slotsOn = (floor: Floor) => Math.max(rowOf(floor, 'up').length, rowOf(floor, 'down').length)

/** 위에서부터 몇 번째 층인가. 옥상이 0이다. */
const bandIndex = (floor: Floor) => FLOORS.length - 1 - FLOORS.indexOf(floor)
const bandTop = (floor: Floor) => MARGIN + bandIndex(floor) * (BAND_H + BAND_GAP)

/** 그 층 복도의 y 범위(첫 줄). */
const aisleTop = (floor: Floor) => bandTop(floor) + ROOM + 1
/** 그 층 동쪽 계단참이 시작하는 x. 방이 적은 층은 복도도 짧다. */
const eastStairX = (floor: Floor) => ROOM_X0 + slotsOn(floor) * CELL

/** 옥상은 한 칸짜리 열린 자리라 복도도 계단참도 없다. 넓게 편다. */
const ROOF_SLOTS = 5

export const MAP_W = ROOM_X0 + ROOF_SLOTS * CELL + STAIR_W + MARGIN
export const MAP_H = MARGIN + FLOORS.length * (BAND_H + BAND_GAP) - BAND_GAP + MARGIN

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

function rectOf(id: TileId): Rect {
  const t = TILE_BY_ID[id]
  const top = bandTop(t.floor)
  if (t.side === 'stair') {
    const x = t.slot === 0 ? MARGIN : eastStairX(t.floor)
    return { x, y: aisleTop(t.floor), w: STAIR_W, h: AISLE_WIDE }
  }
  // 옥상은 한 방이 복도 자리까지 통째로 쓴다
  if (t.floor === 'roof') {
    return { x: ROOM_X0, y: top, w: ROOF_SLOTS * CELL - 1, h: ROOM }
  }
  const y = t.side === 'up' ? top : top + ROOM + 1 + AISLE_WIDE + 1
  return { x: ROOM_X0 + t.slot * CELL, y, w: ROOM, h: ROOM }
}

const ROOM_RECTS = Object.fromEntries(BOARD.map((t) => [t.id, [rectOf(t.id as TileId)]])) as Record<TileId, Rect[]>

export interface RoomSpec {
  id: TileId
  name: string
  rects: Rect[]
}

export const ROOMS: RoomSpec[] = BOARD.map((t) => ({
  id: t.id as TileId,
  name: t.name,
  rects: ROOM_RECTS[t.id as TileId],
}))
export const roomById = Object.fromEntries(ROOMS.map((r) => [r.id, r])) as Record<TileId, RoomSpec>

// ── 타일판 만들기 ───────────────────────────────────────────────

/** hall 은 복도다. 걸을 수 있지만 어느 방도 아니다. */
export type TileKind = 'wall' | 'floor' | 'door' | 'hall'

const N_W = MAP_W
const N_H = MAP_H
const kinds = new Uint8Array(N_W * N_H) // 0 벽 · 1 바닥 · 2 문 · 3 복도
/** 각 칸이 어느 방인지. 255는 어느 방도 아님(벽·문턱·복도). */
const roomIndex = new Uint8Array(N_W * N_H).fill(255)
const idx = (x: number, y: number) => y * N_W + x

ROOMS.forEach((room, i) => {
  for (const r of room.rects) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        if (kinds[idx(x, y)] === 1) throw new Error(`방이 겹친다: ${room.id} @ ${x},${y}`)
        kinds[idx(x, y)] = 1
        roomIndex[idx(x, y)] = i
      }
    }
  }
})

/** 복도. 서쪽 계단참 오른쪽 끝부터 동쪽 계단참 왼쪽 끝까지 이어진다. */
for (const floor of FLOORS) {
  if (floor === 'roof') continue
  const y0 = aisleTop(floor)
  for (let y = y0; y < y0 + AISLE_WIDE; y++) {
    for (let x = MARGIN + STAIR_W; x < eastStairX(floor); x++) {
      if (kinds[idx(x, y)] !== 0) continue
      kinds[idx(x, y)] = 3
    }
  }
}

export interface Door {
  /** 문 자리. */
  x: number
  y: number
  /** 문이 붙은 방. */
  a: TileId
  /** 문 너머. **복도면 null 이다** — 복도는 방이 아니다. */
  b: TileId | null
  /** 문을 이루는 칸 전부. 어느 칸으로 지나든 같은 문이다. */
  tiles: readonly { x: number; y: number }[]
}

/** 문 너비. 한 칸이다. 다가가는 복도는 세 칸이라 좁아도 막히지 않는다. */
export const DOOR_WIDE = 1

/**
 * 방과 복도 사이 벽 한가운데에 문을 뚫는다.
 *
 * **문은 방과 복도를 잇는다. 방과 방을 잇지 않는다.** 그래서 문을
 * 밟는 것만으로는 어느 방으로 가는지 알 수 없다 — 나가는 문에서는
 * 아무 일도 없고, 들어가는 문에서 그 방으로 들어간 것이 된다.
 */
const DOORS_BUILD: Door[] = []
for (const floor of FLOORS) {
  if (floor === 'roof') continue
  const top = bandTop(floor)
  for (const side of ['up', 'down'] as const) {
    const wallY = side === 'up' ? top + ROOM : top + ROOM + 1 + AISLE_WIDE
    for (const t of rowOf(floor, side)) {
      const r = ROOM_RECTS[t.id as TileId][0]
      const x = r.x + Math.floor(ROOM / 2)
      DOORS_BUILD.push({ x, y: wallY, a: t.id as TileId, b: null, tiles: [{ x, y: wallY }] })
    }
  }
}

export const DOORS: Door[] = DOORS_BUILD
for (const d of DOORS) for (const t of d.tiles) kinds[idx(t.x, t.y)] = 2

const doorAt = new Map<string, Door>()
for (const d of DOORS) for (const t of d.tiles) doorAt.set(`${t.x},${t.y}`, d)

// ── 계단 ────────────────────────────────────────────────────────

export interface Stair {
  /** 밟는 자리. */
  x: number
  y: number
  /** 이 칸이 속한 계단참. */
  from: TileId
  /** 옮겨 갈 방과 자리. */
  to: TileId
  toX: number
  toY: number
  /** 올라가는가 내려가는가. 그림을 고를 때 쓴다. */
  up: boolean
}

/**
 * 계단 칸.
 *
 * 계단참 하나에 두 칸까지 놓인다 — 위로 가는 칸과 아래로 가는 칸.
 * 밟으면 짝 계단참의 **반대쪽 칸 옆**에 내려놓는다. 같은 칸에 놓으면
 * 그 칸이 다시 계단이라 무한히 오르내린다.
 */
const STAIRS_BUILD: Stair[] = []
{
  const landing = (id: TileId) => ROOM_RECTS[id][0]
  /** 계단참 안에서 위로 가는 칸과 아래로 가는 칸. 가운데 줄에 나란히 둔다. */
  const upCell = (id: TileId) => {
    const r = landing(id)
    return { x: r.x + 1, y: r.y + 1 }
  }
  const downCell = (id: TileId) => {
    const r = landing(id)
    return { x: r.x + r.w - 2, y: r.y + 1 }
  }
  /**
   * 내려놓는 자리.
   *
   * **계단 칸 위에 내려놓으면 안 된다.** 오르내리는 칸이 가운데 줄
   * 양쪽에 있어서, 거기 놓으면 그 즉시 도로 반대편 층으로 간다 —
   * 무한히 오르내린다. 가운데 칸의 위·아래 줄에 내려놓는다.
   */
  const restFor = (id: TileId, arrivingUp: boolean) => {
    const r = landing(id)
    return { x: r.x + Math.floor(r.w / 2), y: arrivingUp ? r.y : r.y + r.h - 1 }
  }

  const ends: StairEnd[] = ['w', 'e']
  const withStairs: Floor[] = FLOORS.filter((f) => f !== 'roof')
  for (let i = 0; i < withStairs.length; i++) {
    for (const end of ends) {
      const here = stairIdOf(withStairs[i], end) as TileId
      const above = (i + 1 < withStairs.length ? stairIdOf(withStairs[i + 1], end) : null) as TileId | null
      const below = (i > 0 ? stairIdOf(withStairs[i - 1], end) : null) as TileId | null
      if (above) {
        const c = upCell(here)
        const r = restFor(above, true)
        STAIRS_BUILD.push({ ...c, from: here, to: above, toX: r.x, toY: r.y, up: true })
      } else {
        // 맨 위 층의 계단은 옥상으로 나간다
        const c = upCell(here)
        const roof = ROOM_RECTS.rooftop[0]
        const x = end === 'w' ? roof.x + 2 : roof.x + roof.w - 3
        STAIRS_BUILD.push({ ...c, from: here, to: 'rooftop', toX: x, toY: roof.y + roof.h - 2, up: true })
      }
      if (below) {
        const c = downCell(here)
        const r = restFor(below, false)
        STAIRS_BUILD.push({ ...c, from: here, to: below, toX: r.x, toY: r.y, up: false })
      }
    }
  }
  // 옥상에서 내려가는 자리. 양끝에 하나씩 — 올라온 자리 그대로다
  {
    const roof = ROOM_RECTS.rooftop[0]
    for (const end of ends) {
      const back = stairIdOf('f2', end) as TileId
      const rest = restFor(back, false)
      const x = end === 'w' ? roof.x : roof.x + roof.w - 1
      STAIRS_BUILD.push({
        x,
        y: roof.y + roof.h - 2,
        from: 'rooftop',
        to: back,
        toX: rest.x,
        toY: rest.y,
        up: false,
      })
    }
  }
}

export const STAIRS: readonly Stair[] = STAIRS_BUILD
const stairAt = new Map<string, Stair>(STAIRS.map((s) => [`${s.x},${s.y}`, s]))

/** 그 칸이 계단인가. 밟으면 다른 층으로 간다. */
export function stairHere(x: number, y: number): Stair | null {
  return stairAt.get(`${x},${y}`) ?? null
}

export function tileAt(x: number, y: number): TileKind {
  if (x < 0 || y < 0 || x >= N_W || y >= N_H) return 'wall'
  const k = kinds[idx(x, y)]
  return k === 0 ? 'wall' : k === 1 ? 'floor' : k === 2 ? 'door' : 'hall'
}

/** 문턱과 복도에 서 있으면 아직 어느 방도 아니다. */
export function roomAt(x: number, y: number): RoomSpec | null {
  if (x < 0 || y < 0 || x >= N_W || y >= N_H) return null
  const i = roomIndex[idx(x, y)]
  return i === 255 ? null : ROOMS[i]
}

export function doorHere(x: number, y: number): Door | null {
  return doorAt.get(`${x},${y}`) ?? null
}

/**
 * 그 문이 가로로 뻗은 벽에 났는가. 위아래로 지나가는 문이다.
 * 방과 복도 사이 벽은 전부 가로다 — 그림을 고르는 쪽이 이걸 본다.
 */
export function doorIsHorizontal(x: number, y: number): boolean {
  const d = doorAt.get(`${x},${y}`)
  if (!d) return true
  if (d.tiles.length < 2) return true
  return d.tiles[0].x !== d.tiles[1].x
}

// ── 가구와 흔적 ─────────────────────────────────────────────────
// 방마다 다른 것을 놓는다. 이름표를 읽지 않아도 어느 실인지 알아야 한다.

const props = new Map<string, PropKind>()
const marks = new Map<string, MarkKind>()
const key = (x: number, y: number) => `${x},${y}`

/** 문 앞 한 칸은 비워 둔다. 막으면 방이 잠긴다. */
function nearDoor(x: number, y: number): boolean {
  return DOORS.some((d) => d.tiles.some((t) => Math.abs(t.x - x) <= 1 && Math.abs(t.y - y) <= 1))
}

/** 방 한가운데 줄. 문에서 방 안쪽으로 가는 길이라 가구를 놓지 않는다. */
const CENTER = Math.floor(ROOM / 2)
const KEEP_CLEAR = new Set<number>()
for (let i = -Math.floor(AISLE_WIDE / 2); i <= Math.floor(AISLE_WIDE / 2); i++) KEEP_CLEAR.add(CENTER + i)

type Slot = [number, number, number]

/**
 * 한 방을 채운다.
 *
 * **더 이상 돌려 쓰지 않는다.** 5×5 격자이던 동안에는 판이 90도 대칭이라
 * 한 방만 그리고 세 번 돌려 썼다. 층과 복도가 생기면서 그 대칭이 없어졌다 —
 * 이제는 등급마다 자리 한 벌을 그대로 쓴다.
 */
function furnish(id: TileId, slots: Slot[], pick: (id: TileId, group: number) => PropKind): void {
  const target = ROOM_RECTS[id][0]
  for (const [lx, ly, g] of slots) {
    if (lx < 0 || ly < 0 || lx >= target.w || ly >= target.h) continue
    // 한가운데 세로 길은 비운다. 문이 거기 뚫려 있다
    if (KEEP_CLEAR.has(lx)) continue
    const x = target.x + lx
    const y = target.y + ly
    if (nearDoor(x, y)) continue
    props.set(key(x, y), pick(id, g))
  }
}

/** 기지 — 사물함 벽과 앉을 자리. */
const BASE_SLOTS: Slot[] = [
  [0, 0, 0], [1, 0, 0], [2, 0, 0], [6, 0, 0], [7, 0, 0], [8, 0, 0],
  [0, 8, 1], [1, 8, 1], [7, 8, 1], [8, 8, 1],
]
/** 1구역 — 벽을 따라 두 줄. */
const ZONE1_SLOTS: Slot[] = [
  [1, 1, 0], [2, 1, 0], [6, 1, 0], [7, 1, 0],
  [1, 7, 1], [2, 7, 1], [6, 7, 1], [7, 7, 1],
  [0, 2, 2], [8, 6, 2],
]
/** 관문 — 정원이 둘뿐인 좁은 방이다. 귀퉁이를 꽉 채워 실제로 좁게 만든다. */
const GATE_SLOTS: Slot[] = [
  [0, 0, 0], [1, 0, 0], [2, 0, 0], [6, 0, 0], [7, 0, 0], [8, 0, 0],
  [0, 1, 1], [1, 1, 1], [7, 1, 1], [8, 1, 1],
  [0, 7, 1], [1, 7, 1], [7, 7, 1], [8, 7, 1],
  [0, 8, 2], [2, 8, 2], [6, 8, 2], [8, 8, 2],
]
/** 교차로 — 지나가는 곳이라 네 귀퉁이만 쓴다. */
const CROSS_SLOTS: Slot[] = [[0, 0, 0], [8, 0, 0], [0, 8, 1], [8, 8, 1], [2, 2, 2]]
/** 핵심 지역 — 몇 개만. 여기서 무슨 일이 있었는지가 중요하지 가구가 아니다. */
const CORE_SLOTS: Slot[] = [[2, 2, 0], [6, 2, 0], [2, 6, 1]]
/**
 * 옥상은 넓다. 위쪽 벽을 따라서만 놓는다 — 아래쪽 줄은 계단이 사람을
 * 내려놓는 자리라 비워 둔다.
 */
const ROOF_SLOTS_AT: Slot[] = [[6, 1, 0], [20, 1, 1], [34, 1, 2], [42, 1, 0]]

const SLOTS_BY_TIER: Partial<Record<Tier, Slot[]>> = {
  base: BASE_SLOTS,
  zone1: ZONE1_SLOTS,
  gate: GATE_SLOTS,
  cross: CROSS_SLOTS,
  core: CORE_SLOTS,
  plaza: CORE_SLOTS,
}

const PROPS: Partial<Record<TileId, PropKind[]>> = {
  baseA: ['cabinet', 'meetingTable'],
  baseB: ['box', 'box'],
  baseC: ['labBench', 'cabinet'],
  baseD: ['seats', 'console'],

  classroom: ['shelf', 'table', 'plant'],
  hallway: ['canteen', 'table', 'shelf'],
  scienceRoom: ['labBench', 'labBench', 'shelf'],
  artRoom: ['easel', 'table', 'shelf'],
  musicRoom: ['seats', 'seats', 'piano'],
  clubRoom: ['box', 'table', 'shelf'],
  garden: ['tree', 'bench', 'plant'],
  storage: ['box', 'box', 'cabinet'],

  library: ['shelf', 'shelf', 'table'],
  gym: ['bench', 'vault', 'box'],
  cafeteria: ['canteen', 'table', 'table'],
  rooftop: ['tank', 'plant', 'box'],

  oldBuilding: ['cabinet', 'cabinet', 'shelf'],
  newBuilding: ['bench', 'piano', 'plant'],
  annex: ['bench', 'cabinet', 'shelf'],

  playground: ['bench', 'tree'],
  auditorium: ['seats', 'seats'],
  broadcastRoom: ['console', 'cabinet'],
  studentCouncil: ['meetingTable', 'shelf'],
  centralPlaza: ['desk', 'desk', 'plant'],
}

const pickProp = (id: TileId, g: number): PropKind => PROPS[id]?.[g] ?? 'box'

for (const t of BOARD) {
  if (t.id === 'rooftop') continue
  const slots = SLOTS_BY_TIER[t.tier]
  if (slots) furnish(t.id as TileId, slots, pickProp)
}
furnish('rooftop', ROOF_SLOTS_AT, pickProp)

/**
 * 흔적. 길을 막지 않고 바닥에 깔린다. 대부분은 낡은 학교의 얼룩이지만
 * 옥상의 실내화와 국화, 2-3 교실의 초는 A가 남긴 자리다.
 */
const MARKS: [TileId, number, number, MarkKind][] = [
  ['classroom', 6, 8, 'flowers'],
  ['hallway', 6, 4, 'poster'],
  ['scienceRoom', 6, 4, 'stain'],
  ['artRoom', 6, 6, 'stain'],
  ['musicRoom', 6, 4, 'poster'],
  ['clubRoom', 6, 4, 'crack'],
  ['garden', 6, 6, 'flowers'],
  ['storage', 6, 6, 'crack'],
  ['library', 6, 3, 'poster'],
  ['gym', 6, 7, 'crack'],
  ['cafeteria', 6, 3, 'stain'],
  ['rooftop', 20, 3, 'shoes'],
  ['rooftop', 22, 3, 'flowers'],
  ['rooftop', 24, 6, 'tape'],
  ['oldBuilding', 6, 5, 'tape'],
  ['newBuilding', 6, 5, 'stain'],
  ['annex', 6, 5, 'crack'],
  ['playground', 6, 5, 'crack'],
  ['auditorium', 6, 5, 'stain'],
  ['broadcastRoom', 6, 5, 'stain'],
  ['studentCouncil', 6, 5, 'crack'],
  ['centralPlaza', 6, 4, 'candle'],
  ['centralPlaza', 6, 6, 'flowers'],
]

for (const [id, lx, ly, kind] of MARKS) {
  const r = ROOM_RECTS[id][0]
  if (lx < 0 || ly < 0 || lx >= r.w || ly >= r.h) throw new Error(`${id} 흔적이 방 밖으로 나갔다: ${lx},${ly}`)
  const k = key(r.x + lx, r.y + ly)
  if (!props.has(k)) marks.set(k, kind)
}

/** 방마다 바닥이 다르다. 실외는 흙, 체육관·강당은 마루, 계단·복도는 통로. */
export type FloorKind = 'room' | 'hall' | 'outdoor' | 'wood'

const FLOOR_OF: Partial<Record<TileId, FloorKind>> = {
  garden: 'outdoor',
  playground: 'outdoor',
  rooftop: 'outdoor',
  gym: 'wood',
  auditorium: 'wood',
}

export function floorOf(id: TileId): FloorKind {
  if (TILE_BY_ID[id]?.tier === 'stair') return 'hall'
  return FLOOR_OF[id] ?? 'room'
}

export function markAt(x: number, y: number): MarkKind | null {
  return marks.get(key(x, y)) ?? null
}

export function propAt(x: number, y: number): PropKind | null {
  return props.get(`${x},${y}`) ?? null
}

/**
 * 걸을 수 있는가. lockedDoors에 든 문은 아직 A의 기록이 열지 않은 문이라 지나갈 수 없다.
 * 키는 "x,y".
 */
export function isWalkable(x: number, y: number, lockedDoors?: Set<string>): boolean {
  if (tileAt(x, y) === 'wall') return false
  if (props.has(`${x},${y}`)) return false
  if (lockedDoors?.has(`${x},${y}`)) return false
  return true
}

/** A의 기록이 열어 주기 전에는 못 들어가는 칸. 규칙 쪽 등급이 정한다. */
const CORE_TILES = new Set<TileId>(
  BOARD.filter((t) => t.tier === 'core' || t.tier === 'plaza').map((t) => t.id as TileId),
)

/** 잠긴 문 목록. 아직 열리지 않은 핵심 지역으로 들어가는 문만 잠근다. */
export function lockedDoorKeys(unlocked: TileId[]): Set<string> {
  const open = new Set(unlocked)
  const out = new Set<string>()
  for (const d of DOORS) {
    if (!CORE_TILES.has(d.a) || open.has(d.a)) continue
    for (const t of d.tiles) out.add(`${t.x},${t.y}`)
  }
  return out
}

/** 그 방 한가운데 칸. */
export function centerOf(id: TileId): { x: number; y: number } {
  const r = roomById[id].rects[0]
  return { x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) }
}

/**
 * 처음 서는 자리. **팀을 안 본다** — 넷 다 2-3 교실에서 시작한다.
 * 서버(functions/src/lobby.ts)가 두는 자리와 같은 곳이어야 한다.
 */
export function spawnFor(_team: TeamId | null): { x: number; y: number } {
  return centerOf(START_TILE as TileId)
}

/** 팀이 정해지기 전 기본 자리. */
export const SPAWN = spawnFor(null)

/** 조각이 떨어질 수 있는 곳 — 기지·핵심 지역·계단은 뺀다. */
export const SPAWNABLE_TILES: TileId[] = BOARD.filter(
  (t) => !CORE_TILES.has(t.id as TileId) && t.tier !== 'base' && t.tier !== 'stair',
).map((t) => t.id as TileId)

// ── 만들고 나서 확인 ────────────────────────────────────────────
// 생성된 맵이라 한 군데만 어긋나도 방이 통째로 잠긴다. 켤 때 바로 터뜨린다.
{
  // 방마다 문이 하나씩. 옥상과 계단참은 복도에 바로 붙어 있어 문이 없다
  for (const t of BOARD) {
    if (t.tier === 'stair' || t.floor === 'roof') continue
    const mine = DOORS.filter((d) => d.a === (t.id as TileId))
    if (mine.length !== 1) throw new Error(`${t.id} 의 문이 ${mine.length}개다.`)
  }

  // 방 한가운데는 언제나 비어 있어야 한다. 거기 서서 시작하고, 거기로 놓인다
  for (const room of ROOMS) {
    const c = centerOf(room.id)
    if (!isWalkable(c.x, c.y)) throw new Error(`${room.id} 한가운데에 설 수 없다.`)
  }

  // 계단이 내려놓는 자리도 설 수 있어야 한다
  for (const s of STAIRS) {
    if (!isWalkable(s.toX, s.toY)) throw new Error(`계단이 못 서는 자리에 내려놓는다: ${s.from}→${s.to}`)
    if (stairHere(s.toX, s.toY)) throw new Error(`계단이 또 계단 위에 내려놓는다: ${s.from}→${s.to}`)
  }

  // 층마다 따로 본다 — 계단은 걸어서 잇지 않고 건너뛰므로 물 흐르듯
  // 퍼지지 않는다. 한 층 안에서 모든 방에 닿는지만 확인한다
  for (const floor of FLOORS) {
    const mine = BOARD.filter((t) => t.floor === floor)
    const start = centerOf(mine[0].id as TileId)
    const seen = new Uint8Array(N_W * N_H)
    const queue = [idx(start.x, start.y)]
    seen[queue[0]] = 1
    while (queue.length > 0) {
      const cur = queue.pop() as number
      const x = cur % N_W
      const y = (cur - x) / N_W
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nx = x + dx
        const ny = y + dy
        if (!isWalkable(nx, ny)) continue
        if (seen[idx(nx, ny)]) continue
        seen[idx(nx, ny)] = 1
        queue.push(idx(nx, ny))
      }
    }
    for (const t of mine) {
      const r = ROOM_RECTS[t.id as TileId][0]
      let ok = false
      for (let y = r.y; y < r.y + r.h && !ok; y++) {
        for (let x = r.x; x < r.x + r.w && !ok; x++) if (seen[idx(x, y)]) ok = true
      }
      if (!ok) throw new Error(`${t.id}에 걸어서 갈 수 없다.`)
    }
  }

  // 계단이 닿는 곳이 규칙의 이웃과 같아야 한다
  for (const s of STAIRS) {
    if (!ADJACENCY[s.from]?.includes(s.to)) throw new Error(`규칙이 이웃으로 안 치는 계단: ${s.from} → ${s.to}`)
  }
}
