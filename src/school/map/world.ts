// 걸어 다니는 학교. **판은 여기서 정하지 않는다 — shared/rules/board.ts 가 정한다.**
//
// 방 네모도 복도 조각도 전부 규칙 쪽에 적혀 있다. 여기서 하는 일은
// 그걸 칸판에 찍고, 벽을 세우고, 방과 복도가 맞닿은 데에 문을 뚫고,
// 가구를 놓는 것뿐이다. 자리를 두 벌로 두면 반드시 어긋난다 —
// 화면에서는 들어가지는데 서버는 이웃이 아니라고 하는 식이다.
//
// 층마다 복도 모양이 다르다.
//
//   옥상    한 칸짜리 열린 자리
//   2층     복도가 ㅁ 자로 돈다. 가운데 세 방은 사방이 복도다
//   1층     긴 복도가 가운데서 아래로 갈라져 다시 좌우로 뻗는다
//   지하    짧은 복도가 동쪽 끝에서 위로 꺾인다
//
// **복도는 방이 아니다.** 걸어서 지나는 자리일 뿐이라 점령도 깃발도
// 없고, 거기 선 동안에는 어느 방에도 있지 않다(문턱과 같다).
//
// **계단은 뚫린 문이 아니라 건너뛰는 자리다.** 층이 서로 멀리 떨어져
// 그려져 있어서 벽에 구멍을 낼 수가 없다 — 계단 칸을 밟으면 위아래
// 층의 짝 계단으로 옮겨 놓는다.
import {
  ADJACENCY,
  FLOORS,
  HALLS,
  PLAN_H,
  PLAN_W,
  START_TILE,
  STAIR_ENDS,
  STAIR_FLOORS,
  TILE_BY_ID,
  TILES as BOARD,
  stairIdOf,
  type Rect,
} from '../../../shared/rules/board'
import type { Tier } from '../../../shared/rules/v2'
import type { MarkKind, PropKind } from './sprites'
import type { TeamId, TileId } from '../types'

export type { PropKind, MarkKind } from './sprites'

export const TILE = 16

/**
 * 제일 작은 방의 한 변(칸).
 *
 * **화면에 들어오는 크기여야 한다.** 캔버스는 한 변이 380px 쯤이고 2배로
 * 그리니 열한 칸이 보인다. 제일 작은 방이 일곱 칸이면 방과 양옆 벽이
 * 넉넉히 들어와서, 선 자리에서 제 방의 문이 보인다.
 */
export const ROOM_TILES = Math.min(...BOARD.map((t) => Math.min(t.plan.w, t.plan.h)))

/** 복도 너비. 셋이면 두 사람이 비켜 지나갈 수 있다. */
export const AISLE_WIDE = 3

export const MAP_W = PLAN_W
export const MAP_H = PLAN_H

const ROOM_RECTS = Object.fromEntries(BOARD.map((t) => [t.id, [t.plan]])) as Record<TileId, Rect[]>

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

/** 복도. 규칙이 적어 둔 조각을 그대로 판다. */
for (const h of HALLS) {
  for (let y = h.rect.y; y < h.rect.y + h.rect.h; y++) {
    for (let x = h.rect.x; x < h.rect.x + h.rect.w; x++) {
      if (kinds[idx(x, y)] === 1) throw new Error(`복도가 방을 먹는다: @ ${x},${y}`)
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
  /** 가로로 뻗은 벽에 났는가. 위아래로 지나가는 문이다. */
  horizontal: boolean
}

/** 문 너비. 한 칸이다. 다가가는 복도는 세 칸이라 좁아도 막히지 않는다. */
export const DOOR_WIDE = 1

/** 벽이 이만큼은 맞닿아야 문을 낸다. 모서리만 스친 데에는 안 낸다. */
const DOOR_MIN_TOUCH = 3

/**
 * 방과 복도 사이 벽에 문을 뚫는다.
 *
 * **방 하나에 문이 여럿일 수 있다.** 2층 가운데 방들은 사방이 복도라
 * 문이 서넛이다 — 실제로 그렇게 생긴 학교고, 그래야 막다른 길이 안
 * 생긴다.
 *
 * **문은 방과 복도를 잇는다. 방과 방을 잇지 않는다.** 그래서 문을
 * 밟는 것만으로는 어느 방으로 가는지 알 수 없다 — 나가는 문에서는
 * 아무 일도 없고, 들어가는 문에서 그 방으로 들어간 것이 된다.
 */
const DOORS_BUILD: Door[] = []
{
  const overlap = (a0: number, a1: number, b0: number, b1: number) =>
    [Math.max(a0, b0), Math.min(a1, b1)] as const

  for (const t of BOARD) {
    if (t.tier === 'stair') continue // 계단참은 복도에 바로 붙어 있다
    const r = t.plan
    for (const h of HALLS) {
      if (h.floor !== t.floor) continue
      const g = h.rect
      // 가로 벽 — 방 위나 아래에 복도가 있다
      if (g.y + g.h === r.y - 1 || r.y + r.h === g.y - 1) {
        const [x0, x1] = overlap(r.x, r.x + r.w - 1, g.x, g.x + g.w - 1)
        if (x1 - x0 + 1 < DOOR_MIN_TOUCH) continue
        const x = Math.floor((x0 + x1) / 2)
        const y = g.y + g.h === r.y - 1 ? r.y - 1 : r.y + r.h
        DOORS_BUILD.push({ x, y, a: t.id as TileId, b: null, tiles: [{ x, y }], horizontal: true })
        continue
      }
      // 세로 벽 — 방 옆에 복도가 있다
      if (g.x + g.w === r.x - 1 || r.x + r.w === g.x - 1) {
        const [y0, y1] = overlap(r.y, r.y + r.h - 1, g.y, g.y + g.h - 1)
        if (y1 - y0 + 1 < DOOR_MIN_TOUCH) continue
        const y = Math.floor((y0 + y1) / 2)
        const x = g.x + g.w === r.x - 1 ? r.x - 1 : r.x + r.w
        DOORS_BUILD.push({ x, y, a: t.id as TileId, b: null, tiles: [{ x, y }], horizontal: false })
      }
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
 * **한 칸이 아니라 세 칸짜리 층계다.** 한 칸짜리로 두었더니 계단처럼
 * 안 보였다 — 발판이 하나뿐이니 그냥 무늬 있는 바닥이다. 세 칸을
 * 세로로 이어 놓으면 발판이 열둘이라 눈으로 바로 계단인 줄 안다.
 * 어느 칸을 밟든 같은 계단이다.
 *
 * 계단참 하나에 층계가 둘까지 놓인다 — 위로 가는 것과 아래로 가는 것.
 * 계단참은 세로로 길어서 오르는 층계는 위쪽, 내려가는 층계는 아래쪽에
 * 둔다. 밟으면 짝 계단참의 **계단이 아닌 칸**에 내려놓는다. 같은 칸에
 * 놓으면 그 칸이 다시 계단이라 무한히 오르내린다.
 */
export const STAIR_STEPS = 3

const STAIRS_BUILD: Stair[] = []
{
  const landing = (id: TileId) => ROOM_RECTS[id][0]
  /** 층계 한 벌. 계단참 안쪽 줄을 따라 세 칸이다. */
  const flight = (r: Rect, top: number) =>
    Array.from({ length: STAIR_STEPS }, (_, i) => ({ x: r.x + 1, y: top + i }))
  const upCells = (id: TileId) => flight(landing(id), landing(id).y + 1)
  const downCells = (id: TileId) => {
    const r = landing(id)
    return flight(r, r.y + r.h - 1 - STAIR_STEPS)
  }
  /**
   * 내려놓는 자리.
   *
   * **계단 칸 위에 내려놓으면 안 된다.** 거기 놓으면 그 즉시 도로
   * 반대편 층으로 간다 — 무한히 오르내린다. 오르내리는 칸이 왼쪽
   * 줄에 있으니 오른쪽 줄에 내려놓는다.
   */
  const restFor = (id: TileId, arrivingUp: boolean) => {
    const r = landing(id)
    return { x: r.x + r.w - 2, y: arrivingUp ? r.y + 2 : r.y + r.h - 3 }
  }

  const roof = ROOM_RECTS.rooftop[0]
  /** 옥상에서 내려가는 층계. 올라온 자리 바로 그 자리다. */
  const roofCells = (end: (typeof STAIR_ENDS)[number]) =>
    Array.from({ length: STAIR_STEPS }, (_, i) => ({
      x: end === 'w' ? roof.x + 1 : roof.x + roof.w - 2,
      y: roof.y + roof.h - 1 - STAIR_STEPS + i,
    }))

  const add = (
    cells: { x: number; y: number }[],
    from: TileId,
    to: TileId,
    rest: { x: number; y: number },
    up: boolean,
  ) => {
    for (const c of cells) {
      STAIRS_BUILD.push({ ...c, from, to, toX: rest.x, toY: rest.y, up })
    }
  }

  for (let i = 0; i < STAIR_FLOORS.length; i++) {
    for (const end of STAIR_ENDS) {
      const here = stairIdOf(STAIR_FLOORS[i], end) as TileId
      const above = (
        i + 1 < STAIR_FLOORS.length ? stairIdOf(STAIR_FLOORS[i + 1], end) : null
      ) as TileId | null
      const below = (i > 0 ? stairIdOf(STAIR_FLOORS[i - 1], end) : null) as TileId | null
      if (above) {
        add(upCells(here), here, above, restFor(above, true), true)
      } else {
        // 맨 위 층의 계단은 옥상으로 나간다. 올라온 층계 옆에 내려놓는다
        const c = roofCells(end)[STAIR_STEPS - 1]
        const toX = end === 'w' ? c.x + 2 : c.x - 2
        add(upCells(here), here, 'rooftop', { x: toX, y: c.y }, true)
      }
      if (below) {
        add(downCells(here), here, below, restFor(below, false), false)
      }
    }
  }
  // 옥상에서 내려가는 자리. 양끝에 하나씩
  {
    const top = STAIR_FLOORS[STAIR_FLOORS.length - 1]
    for (const end of STAIR_ENDS) {
      const back = stairIdOf(top, end) as TileId
      add(roofCells(end), 'rooftop', back, restFor(back, false), false)
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
 * 벽이 누운 방향에 따라 문 널빤지도 눕거나 선다.
 */
export function doorIsHorizontal(x: number, y: number): boolean {
  return doorAt.get(`${x},${y}`)?.horizontal ?? true
}

// ── 가구와 흔적 ─────────────────────────────────────────────────
// 방마다 다른 것을 놓는다. 이름표를 읽지 않아도 어느 실인지 알아야 한다.

const props = new Map<string, PropKind>()
const marks = new Map<string, MarkKind>()
const key = (x: number, y: number) => `${x},${y}`

/**
 * 문에서 방 한가운데까지 이어지는 길.
 *
 * **문 앞 한두 칸만 비워서는 모자란다.** 방이 커지고 문이 여럿이
 * 되면서, 문 앞은 비었는데 그 안쪽 벽을 따라 놓은 사물함 줄이 길을
 * 막는 일이 생겼다. 문마다 한가운데까지 ㄱ 자로 길을 그어 두고, 그
 * 위에는 아무것도 놓지 않는다.
 */
const LANES = new Set<string>()
{
  for (const d of DOORS) {
    const r = ROOM_RECTS[d.a][0]
    const cx = r.x + Math.floor(r.w / 2)
    const cy = r.y + Math.floor(r.h / 2)
    // 문에서 방 안으로 한 칸 들어온 자리
    let x = Math.min(Math.max(d.x, r.x), r.x + r.w - 1)
    let y = Math.min(Math.max(d.y, r.y), r.y + r.h - 1)
    const mark = (px: number, py: number) => {
      for (let ox = -1; ox <= 1; ox++) LANES.add(`${px + ox},${py}`)
      for (let oy = -1; oy <= 1; oy++) LANES.add(`${px},${py + oy}`)
    }
    mark(d.x, d.y)
    while (y !== cy) {
      y += y < cy ? 1 : -1
      mark(x, y)
    }
    while (x !== cx) {
      x += x < cx ? 1 : -1
      mark(x, y)
    }
  }
}

const inDoorLane = (x: number, y: number) => LANES.has(`${x},${y}`)

/**
 * 가구 자리. 방 왼쪽 위에서 센 칸수인데, **음수면 반대쪽 끝에서 센다** —
 * 방마다 크기가 달라서(작게는 7×7, 크게는 18×9) 절대 좌표로는 한 벌을
 * 돌려 쓸 수가 없다. -1 은 마지막 줄, -2 는 그 앞줄이다.
 */
type Slot = [number, number, number]

/**
 * 한 방을 채운다.
 *
 * **더 이상 돌려 쓰지 않는다.** 5×5 격자이던 동안에는 판이 90도 대칭이라
 * 한 방만 그리고 세 번 돌려 썼다. 층과 복도가 생기면서 그 대칭이 없어졌다 —
 * 이제는 등급마다 자리 한 벌을 방 크기에 맞춰 편다.
 */
function furnish(id: TileId, slots: Slot[], pick: (id: TileId, group: number) => PropKind): void {
  const target = ROOM_RECTS[id][0]
  for (const [sx, sy, g] of slots) {
    const lx = sx < 0 ? target.w + sx : sx
    const ly = sy < 0 ? target.h + sy : sy
    if (lx < 0 || ly < 0 || lx >= target.w || ly >= target.h) continue
    const x = target.x + lx
    const y = target.y + ly
    if (inDoorLane(x, y)) continue
    props.set(key(x, y), pick(id, g))
  }
}

/**
 * 가구 자리는 방 크기에서 만든다.
 *
 * 자리 목록을 손으로 적어 두었더니 방마다 크기가 달라진 뒤로 큰 방이
 * 텅 비어 보였다 — 열여덟 칸짜리 경비실에 사물함 넷이 놓이는 식이다.
 * 벽을 따라 몇 칸마다 하나씩 놓게 바꿨다.
 */
type Gen = (w: number, h: number) => Slot[]

const along = (y: number, w: number, step: number, g: number, pad = 0): Slot[] => {
  const out: Slot[] = []
  for (let x = pad; x < w - pad; x += step) out.push([x, y, g])
  return out
}
const down = (x: number, h: number, step: number, g: number, pad = 2): Slot[] => {
  const out: Slot[] = []
  for (let y = pad; y < h - pad; y += step) out.push([x, y, g])
  return out
}

const SLOTS_BY_TIER: Partial<Record<Tier, Gen>> = {
  /** 기지 — 사물함이 위 벽을 메우고, 앉을 자리가 아래에 흩어진다. */
  base: (w, h) => [...along(0, w, 2, 0), ...along(h - 1, w, 4, 1, 1)],
  /** 1구역 — 벽에서 한 칸 띄운 두 줄과 옆벽 한 줄. */
  zone1: (w, h) => [
    ...along(1, w, 3, 0, 1),
    ...along(h - 2, w, 3, 1, 1),
    ...down(0, h, 4, 2),
    ...down(w - 1, h, 4, 2),
  ],
  /** 관문 — 정원이 둘뿐인 좁은 방이다. 위아래를 꽉 채워 실제로 좁게 만든다. */
  gate: (w, h) => [
    ...along(0, w, 2, 0),
    ...along(1, w, 3, 1, 1),
    ...along(h - 2, w, 3, 1, 1),
    ...along(h - 1, w, 2, 2),
  ],
  /** 교차로 — 지나가는 곳이라 네 귀퉁이만 쓴다. */
  cross: (w, h) => [
    [0, 0, 0],
    [w - 1, 0, 0],
    [0, h - 1, 1],
    [w - 1, h - 1, 1],
    [2, 2, 2],
  ],
  /** 핵심 지역 — 몇 개만. 여기서 무슨 일이 있었는지가 중요하지 가구가 아니다. */
  core: (w, h) => [
    [2, 2, 0],
    [w - 3, 2, 0],
    [2, h - 3, 1],
    [w - 3, h - 3, 1],
  ],
  plaza: (w, h) => [
    [2, 2, 0],
    [w - 3, 2, 0],
    [2, h - 3, 1],
    [w - 3, h - 3, 1],
  ],
}

/** 옥상은 넓다. 위쪽 벽을 따라서만 놓는다 — 아래쪽 줄은 계단 자리다. */
const ROOF_SLOTS_AT: Slot[] = [[6, 1, 0], [20, 1, 1], [34, 1, 2], [-6, 1, 0]]


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
  const gen = SLOTS_BY_TIER[t.tier]
  if (gen) furnish(t.id as TileId, gen(t.plan.w, t.plan.h), pickProp)
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
  // 방마다 문이 적어도 하나. 옥상과 계단참은 복도에 바로 붙어 있어 문이 없다
  for (const t of BOARD) {
    if (t.tier === 'stair' || t.floor === 'roof') continue
    if (!DOORS.some((d) => d.a === (t.id as TileId))) throw new Error(`${t.id} 에 문이 없다.`)
  }

  // 방과 복도 사이에는 벽이 한 줄 있어야 한다. 붙여 놓으면 문 없이
  // 벽을 통과하는 방이 된다 — 규칙은 못 들어간다고 하는데 화면은 통과시킨다
  for (const t of BOARD) {
    if (t.tier === 'stair') continue
    const r = t.plan
    for (const h of HALLS) {
      const g = h.rect
      const touchX = g.x + g.w === r.x || r.x + r.w === g.x
      const touchY = g.y + g.h === r.y || r.y + r.h === g.y
      const overX = Math.min(r.x + r.w, g.x + g.w) > Math.max(r.x, g.x)
      const overY = Math.min(r.y + r.h, g.y + g.h) > Math.max(r.y, g.y)
      if ((touchX && overY) || (touchY && overX)) {
        throw new Error(`${t.id} 가 복도에 그대로 붙었다 — 벽 한 줄이 없다.`)
      }
    }
  }

  // 방 한가운데는 언제나 비어 있어야 한다. 거기 서서 시작하고, 거기로 놓인다
  for (const room of ROOMS) {
    const c = centerOf(room.id)
    if (!isWalkable(c.x, c.y)) throw new Error(`${room.id} 한가운데에 설 수 없다.`)
  }

  // 계단 칸 자체를 밟을 수 있어야 한다. 가구가 올라앉으면 층을 못 넘는다
  for (const s of STAIRS) {
    if (!isWalkable(s.x, s.y)) throw new Error(`계단을 밟을 수 없다: ${s.from}→${s.to} @ ${s.x},${s.y}`)
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
