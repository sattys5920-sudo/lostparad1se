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
  canRoamTo,
  FLOORS,
  HALLS,
  PLAN_H,
  PLAN_W,
  START_TILE,
  STAIR_ENDS,
  STAIR_FLOORS,
  TILES as BOARD,
  stairwellOf,
  type Floor,
  type Rect,
  type StairEnd,
} from '../../../shared/rules/board'
import { isFixture } from '../../../shared/rules/fixtures'
import { FURNITURE } from './furniture'
import { propTiles, WALL_PROPS, type PropKind } from './props'
import { signTiles } from './signs'
import type { MarkKind } from './sprites'
import type { TeamId, TileId } from '../types'

export type { MarkKind } from './sprites'
export type { PropKind } from './props'

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
  /** 옮겨 갈 자리. */
  toX: number
  toY: number
  /** 올라가는가 내려가는가. 그림을 고를 때 쓴다. */
  up: boolean
  /** 어디서 어디로. **칸 이름이 아니다** — 터뜨릴 때 읽을 이름이다. */
  from: string
  to: string
}

/**
 * 계단 칸.
 *
 * **한 칸이 아니라 세 칸짜리 층계다.** 한 칸짜리로 두었더니 계단처럼
 * 안 보였다 — 발판이 하나뿐이니 그냥 무늬 있는 바닥이다. 세 칸을
 * 세로로 이어 놓으면 발판이 열둘이라 눈으로 바로 계단인 줄 안다.
 * 어느 칸을 밟든 같은 계단이다.
 *
 * 계단통 하나에 층계가 둘까지 놓인다 — 위로 가는 것과 아래로 가는 것.
 * 계단통은 세로로 길어서 오르는 층계는 위쪽, 내려가는 층계는 아래쪽에
 * 둔다. 밟으면 짝 계단통의 **계단이 아닌 칸**에 내려놓는다. 같은 칸에
 * 놓으면 그 칸이 다시 계단이라 무한히 오르내린다.
 *
 * **계단통은 방이 아니라 복도다.** 그래서 내려놓은 자리는 어느 방도
 * 아니고, 규칙에 「계단으로 갔다」고 말할 일도 없다 — 문 앞에 선
 * 것과 같다. 거기서 다시 문을 넘어야 방에 들어간다.
 */
export const STAIR_STEPS = 3

const STAIRS_BUILD: Stair[] = []
{
  const wellOf = (floor: Floor, end: StairEnd) => {
    const w = stairwellOf(floor, end)
    if (!w) throw new Error(`계단통이 없다: ${floor} ${end}`)
    return w.plan
  }
  const label = (floor: Floor, end: StairEnd) => `${floor}_${end}`
  /** 층계 한 벌. 계단통 안쪽 줄을 따라 세 칸이다. */
  const flight = (r: Rect, top: number) =>
    Array.from({ length: STAIR_STEPS }, (_, i) => ({ x: r.x + 1, y: top + i }))
  const upCells = (r: Rect) => flight(r, r.y + 1)
  const downCells = (r: Rect) => flight(r, r.y + r.h - 1 - STAIR_STEPS)
  /**
   * 내려놓는 자리.
   *
   * **계단 칸 위에 내려놓으면 안 된다.** 거기 놓으면 그 즉시 도로
   * 반대편 층으로 간다 — 무한히 오르내린다. 오르내리는 칸이 왼쪽
   * 줄에 있으니 오른쪽 줄에 내려놓는다.
   */
  const restIn = (r: Rect, arrivingUp: boolean) => ({
    x: r.x + r.w - 2,
    y: arrivingUp ? r.y + 2 : r.y + r.h - 3,
  })

  const roof = ROOM_RECTS.rooftop[0]
  /** 옥상에서 내려가는 층계. 올라온 자리 바로 그 자리다. */
  const roofCells = (end: StairEnd) =>
    Array.from({ length: STAIR_STEPS }, (_, i) => ({
      x: end === 'w' ? roof.x + 1 : roof.x + roof.w - 2,
      y: roof.y + roof.h - 1 - STAIR_STEPS + i,
    }))

  const add = (
    cells: { x: number; y: number }[],
    from: string,
    to: string,
    rest: { x: number; y: number },
    up: boolean,
  ) => {
    for (const c of cells) {
      STAIRS_BUILD.push({ ...c, from, to, toX: rest.x, toY: rest.y, up })
    }
  }

  for (let i = 0; i < STAIR_FLOORS.length; i++) {
    for (const end of STAIR_ENDS) {
      const here = wellOf(STAIR_FLOORS[i], end)
      const name = label(STAIR_FLOORS[i], end)
      const upFloor = i + 1 < STAIR_FLOORS.length ? STAIR_FLOORS[i + 1] : null
      const downFloor = i > 0 ? STAIR_FLOORS[i - 1] : null
      if (upFloor) {
        add(upCells(here), name, label(upFloor, end), restIn(wellOf(upFloor, end), true), true)
      } else {
        // 맨 위 층의 계단은 옥상으로 나간다. 올라온 층계 옆에 내려놓는다
        const c = roofCells(end)[STAIR_STEPS - 1]
        const toX = end === 'w' ? c.x + 2 : c.x - 2
        add(upCells(here), name, 'rooftop', { x: toX, y: c.y }, true)
      }
      if (downFloor) {
        add(downCells(here), name, label(downFloor, end), restIn(wellOf(downFloor, end), false), false)
      }
    }
  }
  // 옥상에서 내려가는 자리. 양끝에 하나씩
  {
    const top = STAIR_FLOORS[STAIR_FLOORS.length - 1]
    for (const end of STAIR_ENDS) {
      add(roofCells(end), 'rooftop', label(top, end), restIn(wellOf(top, end), false), false)
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

/** 소품이 깔린 칸. 두 칸짜리 소품이면 칸마다 그림의 어느 조각인지 적는다. */
export interface PropCell {
  kind: PropKind
  /** 그림에서 몇 번째 칸인가. drawImage 로 그 조각만 떠 온다. */
  ox: number
  oy: number
}

/** 팻말이 깔린 칸. 방마다 판이 하나라 방 이름과 조각 번호면 된다. */
export interface SignCell {
  id: TileId
  ox: number
}

const props = new Map<string, PropCell>()
const signs = new Map<string, SignCell>()
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

/** 문에서 방 한가운데로 이어지는 길 위인가. 여기에는 아무것도 못 놓는다. */
export const inDoorLane = (x: number, y: number): boolean => LANES.has(`${x},${y}`)

/**
 * 가구를 깐다.
 *
 * **자리는 여기서 정하지 않는다.** furniture.ts 에 좌표로 적혀 있고,
 * 그 파일은 scripts/gen-furniture.ts 가 한 번 굴려서 만든 것이다 —
 * 판마다 가구가 옮겨 다니면 「아까 그 방」을 알아볼 수가 없다.
 *
 * 여기서 하는 일은 적힌 대로 깔면서 어긋난 데가 없는지 보는 것뿐이다.
 */
for (const room of ROOMS) {
  const r = ROOM_RECTS[room.id][0]
  const plan = FURNITURE[room.id]
  if (!plan) throw new Error(`${room.id} 의 가구 배치가 없다.`)

  for (const it of plan.props) {
    const size = propTiles(it.kind)
    for (let oy = 0; oy < size.h; oy++) {
      for (let ox = 0; ox < size.w; ox++) {
        const lx = it.x + ox
        const ly = it.y + oy
        if (lx < 0 || ly < 0 || lx >= r.w || ly >= r.h) {
          throw new Error(`${room.id} 의 ${it.kind} 가 방 밖으로 나갔다: ${lx},${ly}`)
        }
        const x = r.x + lx
        const y = r.y + ly
        if (inDoorLane(x, y)) throw new Error(`${room.id} 의 ${it.kind} 가 문 앞 길을 막는다: ${lx},${ly}`)
        if (props.has(key(x, y))) throw new Error(`${room.id} 에서 소품이 겹친다: ${lx},${ly}`)
        props.set(key(x, y), { kind: it.kind, ox, oy })
      }
    }
    if (WALL_PROPS.has(it.kind) && it.y !== 0) {
      throw new Error(`${room.id} 의 ${it.kind} 는 벽에 붙는 것인데 안쪽에 놓였다: ${it.y}`)
    }
  }

  // 팻말. 판 너비는 이름에서 나오므로 좌표만 적어 둔다
  const wide = signTiles(room.name)
  for (let ox = 0; ox < wide; ox++) {
    const lx = plan.sign.x + ox
    const ly = plan.sign.y
    if (lx < 0 || ly < 0 || lx >= r.w || ly >= r.h) {
      throw new Error(`${room.id} 팻말이 방 밖으로 나갔다: ${lx},${ly}`)
    }
    const x = r.x + lx
    const y = r.y + ly
    if (inDoorLane(x, y)) throw new Error(`${room.id} 팻말이 문 앞 길을 막는다: ${lx},${ly}`)
    if (props.has(key(x, y))) throw new Error(`${room.id} 팻말이 소품과 겹친다: ${lx},${ly}`)
    signs.set(key(x, y), { id: room.id, ox })
  }
}

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
  ['labRoom', 6, 4, 'stain'],
  ['centralPlaza', 6, 4, 'candle'],
  ['centralPlaza', 6, 6, 'flowers'],
]

for (const [id, lx, ly, kind] of MARKS) {
  const r = ROOM_RECTS[id][0]
  if (lx < 0 || ly < 0 || lx >= r.w || ly >= r.h) throw new Error(`${id} 흔적이 방 밖으로 나갔다: ${lx},${ly}`)
  const k = key(r.x + lx, r.y + ly)
  if (!props.has(k)) marks.set(k, kind)
}

// **방 바닥은 모두 같은 흰색이다.**
//
// 한때 정원과 운동장은 흙, 체육관과 강당은 마루로 따로 깔았다. 그런데
// 바닥에는 이미 할 일이 있다 — 누구 땅인가. 점령한 팀 색이 바닥에
// 물드는데 그 밑이 방마다 다르면 같은 팀 색이 방마다 달라 보인다.
//
// 어느 실인지는 소품과 팻말이 말한다. 바닥은 점령만 말한다.

export function markAt(x: number, y: number): MarkKind | null {
  return marks.get(key(x, y)) ?? null
}

export function propAt(x: number, y: number): PropCell | null {
  return props.get(key(x, y)) ?? null
}

/** 그 칸에 팻말이 깔렸는가. 방 이름판의 어느 조각인지까지 알려 준다. */
export function signAt(x: number, y: number): SignCell | null {
  return signs.get(key(x, y)) ?? null
}

/**
 * 소품이나 팻말 한 조각을 찍는다. 두 칸짜리도 칸마다 제 조각만 떠 온다.
 * 그림은 화면 쪽이 들고 오고, 여기서는 어느 조각인지만 안다.
 */
export function drawPiece(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  ox: number,
  oy: number,
  dx: number,
  dy: number,
): void {
  ctx.drawImage(img, ox * TILE, oy * TILE, TILE, TILE, dx, dy, TILE, TILE)
}

/**
 * 지금 판 위에 놓인 것들 — 문제 종이. **기물과 같이 못 지나간다.**
 *
 * 게시판·자판기·화분은 자리가 정해져 있어 규칙 파일에 박혀 있지만,
 * 종이는 페이즈마다 다른 방에 떨어진다. 그래서 화면이 서버에서 받을
 * 때마다 여기에 적어 두고, isWalkable 이 기물과 같은 자리에서 본다.
 * 서버(standAt)도 같은 것을 본다 — 이건 걸음을 막는 쪽이다.
 */
const blockedNow = new Set<string>()
export function setBlockedCells(cells: readonly { x: number; y: number }[]): void {
  blockedNow.clear()
  for (const c of cells) blockedNow.add(`${c.x},${c.y}`)
}

/** 걸을 수 있는가. 키는 "x,y". */
export function isWalkable(x: number, y: number): boolean {
  if (tileAt(x, y) === 'wall') return false
  if (props.has(key(x, y))) return false
  if (signs.has(key(x, y))) return false
  // 복도의 게시판과 자판기. **소품과 같은 갈래다** — 그림만 얹혀
  // 있으면 사람이 기계를 뚫고 지나간다(rules/fixtures)
  if (isFixture(x, y)) return false
  if (blockedNow.has(`${x},${y}`)) return false
  return true
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

/**
 * 조각이 떨어질 수 있는 곳 — **2-3 교실만 뺀다.**
 *
 * 핵심도 같이 뺐던 것은 A의 기록이 열어 주기 전에는 못 들어갔기
 * 때문이다. 이제 방이 처음부터 다 열려 있으니 핵심에도 떨어진다.
 * 2-3 교실은 아무도 못 가지는 중립 자리라 그대로 뺀다.
 */
export const SPAWNABLE_TILES: TileId[] = BOARD.filter((t) => t.tier !== 'plaza').map(
  (t) => t.id as TileId,
)

/**
 * 복도만 밟고 닿을 수 있는 방들. **다른 방을 지나가지는 않는다.**
 *
 * **계단은 밟고 지나간다.** 계단통이 복도가 된 뒤로 층을 넘는 것도
 * 걸음이라, 여기서 따라가지 않으면 이 확인이 한 층 안에서만 돈다.
 *
 * 규칙이 들여보내 주는 범위(canRoamTo)와 이것이 어긋나면, 화면에서는
 * 문이 열려 있는데 서버가 거절한다. 켤 때 맞춰 본다.
 */
function roamReach(from: TileId): Set<TileId> {
  const out = new Set<TileId>()
  const seen = new Uint8Array(N_W * N_H)
  const queue: number[] = []
  /**
   * 그 칸을 밟는다. 남의 방이면 들어가지 않고 이름만 적는다 —
   * 방을 가로질러 가는 길은 없다. 계단이면 짝 계단통까지 따라간다.
   */
  const enter = (x: number, y: number): void => {
    if (seen[idx(x, y)]) return
    const room = roomAt(x, y)?.id ?? null
    if (room && room !== from) {
      out.add(room)
      return
    }
    seen[idx(x, y)] = 1
    queue.push(idx(x, y))
    const step = stairHere(x, y)
    if (step) enter(step.toX, step.toY)
  }

  for (const d of DOORS) {
    if (d.a !== from) continue
    seen[idx(d.x, d.y)] = 1
    queue.push(idx(d.x, d.y))
  }
  // 옥상에는 문이 없다. 계단이 곧장 올라오므로 제 안의 계단 칸에서 나선다
  for (const st of STAIRS) {
    if (roomAt(st.x, st.y)?.id !== from) continue
    seen[idx(st.x, st.y)] = 1
    queue.push(idx(st.x, st.y))
    enter(st.toX, st.toY)
  }
  while (queue.length > 0) {
    const cur = queue.pop() as number
    const x = cur % N_W
    const y = (cur - x) / N_W
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= N_W || ny >= N_H) continue
      if (tileAt(nx, ny) === 'wall') continue
      enter(nx, ny)
    }
  }
  return out
}

// ── 만들고 나서 확인 ────────────────────────────────────────────
// 생성된 맵이라 한 군데만 어긋나도 방이 통째로 잠긴다. 켤 때 바로 터뜨린다.
{
  // 방마다 문이 적어도 하나. 옥상은 계단이 곧장 올라오므로 문이 없다
  for (const t of BOARD) {
    if (t.floor === 'roof') continue
    if (!DOORS.some((d) => d.a === (t.id as TileId))) throw new Error(`${t.id} 에 문이 없다.`)
  }

  // 방과 복도 사이에는 벽이 한 줄 있어야 한다. 붙여 놓으면 문 없이
  // 벽을 통과하는 방이 된다 — 규칙은 못 들어간다고 하는데 화면은 통과시킨다
  for (const t of BOARD) {
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

  // **방 안 한 칸도 갇히면 안 된다.**
  //
  // 가구를 놓다 보면 구석 한 칸이 소품에 둘러싸여 영영 못 가는
  // 자리가 된다 — 걸어서는 안 닿는데 규칙은 그 방에 있다고 하니
  // 서 있을 수는 있는, 말이 안 되는 칸이다. 문(옥상은 계단)에서
  // 물을 부어 방 안이 다 젖는지 본다
  for (const room of ROOMS) {
    const r = ROOM_RECTS[room.id][0]
    const seen = new Uint8Array(N_W * N_H)
    const queue: number[] = []
    const push = (x: number, y: number): void => {
      if (x < r.x || y < r.y || x >= r.x + r.w || y >= r.y + r.h) return
      if (seen[idx(x, y)] || !isWalkable(x, y)) return
      seen[idx(x, y)] = 1
      queue.push(idx(x, y))
    }
    // 문 자리는 벽 줄이라 방 밖이다. 문으로 들어선 첫 칸에서 나선다
    for (const d of DOORS) {
      if (d.a !== room.id) continue
      push(Math.min(Math.max(d.x, r.x), r.x + r.w - 1), Math.min(Math.max(d.y, r.y), r.y + r.h - 1))
    }
    for (const st of STAIRS) if (roomAt(st.x, st.y)?.id === room.id) push(st.x, st.y)
    if (queue.length === 0) throw new Error(`${room.id} 에 들어설 자리가 없다.`)
    while (queue.length > 0) {
      const cur = queue.pop() as number
      const x = cur % N_W
      const y = (cur - x) / N_W
      push(x, y - 1)
      push(x, y + 1)
      push(x - 1, y)
      push(x + 1, y)
    }
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        if (isWalkable(x, y) && !seen[idx(x, y)]) {
          throw new Error(`${room.id} 안에 갇힌 칸이 있다: ${x - r.x},${y - r.y}`)
        }
      }
    }
  }

  // **계단은 방이 아닌 자리에 내려놓는다.** 옥상만 빼고.
  //
  // 계단통이 복도가 된 뒤로 여기가 규칙과 화면을 잇는 자리다. 방
  // 한복판에 내려놓으면 문을 안 지나고 방에 들어선 것이 되고, 서버는
  // 그 방을 모르는데 화면만 안에 서 있게 된다
  for (const s of STAIRS) {
    const landed = roomAt(s.toX, s.toY)
    if (landed && landed.id !== 'rooftop') {
      throw new Error(`계단이 방 한복판에 내려놓는다: ${s.from} → ${s.to} (${landed.id})`)
    }
  }

  // **걸어서 닿는 방은 규칙도 들여보내야 한다.**
  //
  // 이쪽이 진짜 함정이었다. 「이웃한 방끼리 걸어서 닿는가」만 보고
  // 그 반대를 안 봤더니, 복도가 층을 통째로 잇는 바람에 걸어서 닿는
  // 방 짝 254개 중 181개를 서버가 거절했다 — 눈앞의 문 앞에 서서
  // 못 들어간다.
  //
  // **양쪽을 다 본다.** 규칙이 들여보내는데 화면에 길이 없으면 누른
  // 곳에 영영 못 가고, 화면에 길이 있는데 규칙이 막으면 문 앞에서
  // 거절당한다. 계단이 복도가 된 뒤로는 이 두 확인이 「학교가 통째로
  // 한 덩어리인가」를 재는 자리이기도 하다
  for (const t of BOARD) {
    const walk = roamReach(t.id as TileId)
    for (const other of walk) {
      if (!canRoamTo(t.id as TileId, other)) {
        throw new Error(`걸어서 닿는데 규칙이 막는다: ${t.id} → ${other}`)
      }
    }
    for (const other of BOARD) {
      const to = other.id as TileId
      if (to === t.id) continue
      if (canRoamTo(t.id as TileId, to) && !walk.has(to)) {
        throw new Error(`규칙은 들여보내는데 걸어갈 길이 없다: ${t.id} → ${to}`)
      }
    }
  }
}
