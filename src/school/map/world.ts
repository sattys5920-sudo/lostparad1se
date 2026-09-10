// 학교 전체. 걸어 다니는 공간과 팀이 뺏고 뺏기는 22개 구역이 같은 것이다.
// 방 하나 = 영역 한 칸(TileId). 어떤 구역을 차지하려면 거기까지 실제로 걸어가야 한다.
//
// 배치는 90도 회전에 대해 완전히 대칭이다. A팀 몫만 그리고 세 번 돌려서 B·C·D를 만든다.
// 그래서 네 팀은 문 수도, 걸음 수도, 마주치는 상대도 똑같다.
//
//      A기지 ─ 복도 ─┬─ 과학실 ─ B기지          바깥 고리: 기지 4 + 1구역 8
//        │        [도서관]        │             한 변 가운데 안쪽으로 관문이 박혀 있다
//      교실                     미술실
//        │      ┌─ 구관 ─┐        │             구관: 관문 넷을 안에서 잇는 회랑
//     [옥상]    │ 학생회 중앙광장 강당 │   [체육관]
//        │      └─ 구관 ─┘        │             그 안쪽이 핵심 지역 — A의 기록이 열어 준다
//      창고                     음악실
//        │        [급식실]        │
//      D기지 ─ 정원 ─┴─ 동아리실 ─ C기지
//
// 걷는 길과 「확장 인접」은 같지 않다. 관문에서 핵심 지역으로는 구관을 지나야 하고,
// 구관에서 중앙광장으로는 핵심 지역을 지나야 한다. 이 그래프는 평면에 그릴 수 없어서
// (K3,3을 품는다) 두 곳만 한 방을 거쳐 간다. 점령 인접은 data/tiles.ts의 ADJACENCY가 정한다.
import { tileById } from '../data/tiles'
import type { MarkKind, PropKind } from './sprites'
import type { TeamId, TileId } from '../types'

export type { PropKind, MarkKind } from './sprites'

export const TILE = 16
const N = 64
export const MAP_W = N
export const MAP_H = N

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** 90도 시계 방향. (x,y,w,h) → (N-y-h, x, h, w) */
function rot(r: Rect): Rect {
  return { x: N - r.y - r.h, y: r.x, w: r.h, h: r.w }
}

const ROOM_RECTS = {} as Record<TileId, Rect[]>

/** 씨앗 하나를 네 번 돌려서 네 구역에 나눠 준다. ids는 회전 순서대로. */
function place(ids: [TileId, TileId, TileId, TileId], seed: Rect): void {
  let r = seed
  for (const id of ids) {
    ROOM_RECTS[id] = [r]
    r = rot(r)
  }
}

// 바깥 고리 — 네 귀퉁이가 기지, 한 변에 이웃한 두 팀의 1구역이 맞닿는다.
place(['baseA', 'baseB', 'baseC', 'baseD'], { x: 1, y: 1, w: 12, h: 9 })
place(['hallway', 'artRoom', 'clubRoom', 'storage'], { x: 14, y: 1, w: 21, h: 9 })
place(['scienceRoom', 'musicRoom', 'garden', 'classroom'], { x: 36, y: 1, w: 17, h: 9 })
// 관문 — 두 1구역 사이에 안쪽으로 박혀, 양쪽 모두와 문을 나눈다.
place(['library', 'gym', 'cafeteria', 'rooftop'], { x: 24, y: 11, w: 21, h: 9 })
// 핵심 지역 — 구관 회랑 안의 작은 방 넷.
place(['playground', 'auditorium', 'broadcastRoom', 'studentCouncil'], { x: 29, y: 25, w: 6, h: 3 })

ROOM_RECTS.centralPlaza = [{ x: 29, y: 29, w: 6, h: 6 }]
// 구관은 네 조각이 이어진 하나의 회랑이다.
ROOM_RECTS.oldBuilding = (() => {
  const out: Rect[] = []
  let r: Rect = { x: 21, y: 21, w: 19, h: 3 }
  for (let i = 0; i < 4; i++) {
    out.push(r)
    r = rot(r)
  }
  return out
})()

export interface RoomSpec {
  id: TileId
  name: string
  rects: Rect[]
}

export const ROOMS: RoomSpec[] = (Object.keys(ROOM_RECTS) as TileId[]).map((id) => ({
  id,
  name: tileById[id].name,
  rects: ROOM_RECTS[id],
}))
export const roomById = Object.fromEntries(ROOMS.map((r) => [r.id, r])) as Record<TileId, RoomSpec>

// ── 타일판 만들기 ───────────────────────────────────────────────

export type TileKind = 'wall' | 'floor' | 'door'

const kinds = new Uint8Array(N * N) // 0 벽 · 1 바닥 · 2 문
/** 각 칸이 어느 방인지. 255는 어느 방도 아님(벽·문턱). */
const roomIndex = new Uint8Array(N * N).fill(255)
const idx = (x: number, y: number) => y * N + x

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

export interface Door {
  x: number
  y: number
  a: TileId
  b: TileId
}

/**
 * 두 방 사이의 벽 한 줄을 찾아 가운데에 문을 뚫는다. 좌표를 손으로 세지 않아야
 * 방 크기를 바꿔도 문이 어긋나지 않는다.
 */
function carveDoor(a: TileId, b: TileId): Door {
  for (const ra of ROOM_RECTS[a]) {
    for (const rb of ROOM_RECTS[b]) {
      const [left, right] = ra.x <= rb.x ? [ra, rb] : [rb, ra]
      if (left.x + left.w + 1 === right.x) {
        const y1 = Math.max(left.y, right.y)
        const y2 = Math.min(left.y + left.h, right.y + right.h) - 1
        if (y1 <= y2) return { x: left.x + left.w, y: Math.floor((y1 + y2) / 2), a, b }
      }
      const [top, bottom] = ra.y <= rb.y ? [ra, rb] : [rb, ra]
      if (top.y + top.h + 1 === bottom.y) {
        const x1 = Math.max(top.x, bottom.x)
        const x2 = Math.min(top.x + top.w, bottom.x + bottom.w) - 1
        if (x1 <= x2) return { x: Math.floor((x1 + x2) / 2), y: top.y + top.h, a, b }
      }
    }
  }
  throw new Error(`문을 놓을 벽이 없다: ${a} ↔ ${b}`)
}

const CONNECTIONS: [TileId, TileId][] = [
  // 바깥 고리 — 기지와 1구역이 한 줄로 이어진다
  ['baseA', 'hallway'], ['hallway', 'scienceRoom'], ['scienceRoom', 'baseB'],
  ['baseB', 'artRoom'], ['artRoom', 'musicRoom'], ['musicRoom', 'baseC'],
  ['baseC', 'clubRoom'], ['clubRoom', 'garden'], ['garden', 'baseD'],
  ['baseD', 'storage'], ['storage', 'classroom'], ['classroom', 'baseA'],
  // 관문 — 양옆 1구역에서 들어간다
  ['library', 'hallway'], ['library', 'scienceRoom'],
  ['gym', 'artRoom'], ['gym', 'musicRoom'],
  ['cafeteria', 'clubRoom'], ['cafeteria', 'garden'],
  ['rooftop', 'storage'], ['rooftop', 'classroom'],
  // 관문 → 구관 회랑
  ['library', 'oldBuilding'], ['gym', 'oldBuilding'],
  ['cafeteria', 'oldBuilding'], ['rooftop', 'oldBuilding'],
  // 구관 → 핵심 지역 → 중앙광장
  ['oldBuilding', 'playground'], ['oldBuilding', 'auditorium'],
  ['oldBuilding', 'broadcastRoom'], ['oldBuilding', 'studentCouncil'],
  ['playground', 'centralPlaza'], ['auditorium', 'centralPlaza'],
  ['broadcastRoom', 'centralPlaza'], ['studentCouncil', 'centralPlaza'],
]

export const DOORS: Door[] = CONNECTIONS.map(([a, b]) => carveDoor(a, b))
for (const d of DOORS) kinds[idx(d.x, d.y)] = 2

const doorAt = new Map<string, Door>()
for (const d of DOORS) doorAt.set(`${d.x},${d.y}`, d)

export function tileAt(x: number, y: number): TileKind {
  if (x < 0 || y < 0 || x >= N || y >= N) return 'wall'
  const k = kinds[idx(x, y)]
  return k === 0 ? 'wall' : k === 1 ? 'floor' : 'door'
}

/** 문턱에 서 있으면 아직 어느 방도 아니다. 부르는 쪽이 직전 방을 유지한다. */
export function roomAt(x: number, y: number): RoomSpec | null {
  if (x < 0 || y < 0 || x >= N || y >= N) return null
  const i = roomIndex[idx(x, y)]
  return i === 255 ? null : ROOMS[i]
}

export function doorHere(x: number, y: number): Door | null {
  return doorAt.get(`${x},${y}`) ?? null
}

// ── 가구와 흔적 ─────────────────────────────────────────────────
// 방마다 다른 것을 놓는다. 이름표를 읽지 않아도 어느 실인지 알아야 한다.
//
// 다만 자리는 네 팀이 똑같아야 한다. 그래서 배치 뼈대는 씨앗 방 하나만 그리고
// 회전시켜 쓰고, 그 자리에 놓을 가구만 방마다 다르게 고른다.
// 흔적(marks)은 길을 막지 않으니 방마다 자유롭게 놓는다 — 여기에 A가 남는다.

/** 씨앗 방 안에서의 자리와, 그 자리에 놓을 가구 묶음 번호. */
type Slot = [number, number, number]

/** 방이 90도 돌면 방 안의 자리도 같이 돈다. (lx,ly) → (h-1-ly, lx) */
function rotSlot([lx, ly, g]: Slot, w: number, h: number): { slot: Slot; w: number; h: number } {
  void w
  return { slot: [h - 1 - ly, lx, g], w: h, h: w }
}

const props = new Map<string, PropKind>()
const marks = new Map<string, MarkKind>()
const key = (x: number, y: number) => `${x},${y}`

/** 문 앞은 비워 둔다. 막으면 방이 잠긴다. */
function nearDoor(x: number, y: number): boolean {
  return DOORS.some((d) => Math.abs(d.x - x) <= 1 && Math.abs(d.y - y) <= 1)
}

/**
 * 회전 궤도 하나를 한꺼번에 채운다. ids는 회전 순서, kinds[i]는 그 방이
 * 묶음 번호별로 쓸 가구다.
 */
function furnish(ids: TileId[], seed: Rect, slots: Slot[], kinds: PropKind[][]): void {
  let rect = seed
  let cur = slots
  let w = seed.w
  let h = seed.h
  ids.forEach((id, i) => {
    const target = ROOM_RECTS[id][0]
    for (const [lx, ly, g] of cur) {
      const x = target.x + lx
      const y = target.y + ly
      if (lx < 0 || ly < 0 || lx >= target.w || ly >= target.h) {
        throw new Error(`${id} 가구가 방 밖으로 나갔다: ${lx},${ly}`)
      }
      if (nearDoor(x, y)) continue
      props.set(key(x, y), kinds[i][g])
    }
    // 다음 방을 위해 자리도 함께 돌린다
    const rotated = cur.map((sl) => rotSlot(sl, w, h))
    cur = rotated.map((r) => r.slot)
    const dims = rotSlot([0, 0, 0], w, h)
    w = dims.w
    h = dims.h
    rect = rot(rect)
  })
  void rect
}

const BASE_SLOTS: Slot[] = [
  [1, 1, 0], [2, 1, 0], [3, 1, 0], [7, 1, 0], [8, 1, 0], [9, 1, 0],
  [1, 6, 1], [2, 6, 1], [9, 6, 1], [10, 6, 1],
]
const RING_A_SLOTS: Slot[] = [
  [2, 1, 0], [5, 1, 0], [8, 1, 0], [11, 1, 0], [14, 1, 0], [17, 1, 0],
  [2, 7, 1], [5, 7, 1], [8, 7, 1], [11, 7, 1],
  [19, 2, 2],
]
const RING_B_SLOTS: Slot[] = [
  [2, 1, 0], [5, 1, 0], [8, 1, 0], [11, 1, 0], [14, 1, 0],
  [2, 6, 1], [5, 6, 1], [8, 6, 1], [11, 6, 1], [14, 6, 1],
  [14, 3, 2],
]
const GATE_SLOTS: Slot[] = [
  [2, 2, 0], [2, 4, 0], [2, 6, 0],
  [10, 2, 1], [13, 2, 1], [10, 6, 1], [13, 6, 1],
  [18, 4, 2],
]
const CORE_SLOTS: Slot[] = [[0, 1, 0], [5, 1, 0]]
const OLD_SLOTS: Slot[] = [[1, 1, 0], [5, 1, 0], [15, 1, 0]]

// 기지 — 반이 짐을 두는 곳. 네 팀 모두 같다.
furnish(
  ['baseA', 'baseB', 'baseC', 'baseD'],
  { x: 1, y: 1, w: 12, h: 9 },
  BASE_SLOTS,
  [['locker', 'bench'], ['locker', 'bench'], ['locker', 'bench'], ['locker', 'bench']],
)
// 1구역 안쪽 — 복도·미술실·동아리실·창고
furnish(
  ['hallway', 'artRoom', 'clubRoom', 'storage'],
  { x: 14, y: 1, w: 21, h: 9 },
  RING_A_SLOTS,
  [
    ['locker', 'plant', 'plant'],
    ['easel', 'table', 'shelf'],
    ['box', 'table', 'shelf'],
    ['box', 'box', 'cabinet'],
  ],
)
// 1구역 바깥쪽 — 과학실·음악실·정원·교실
furnish(
  ['scienceRoom', 'musicRoom', 'garden', 'classroom'],
  { x: 36, y: 1, w: 17, h: 9 },
  RING_B_SLOTS,
  [
    ['labBench', 'labBench', 'shelf'],
    ['seats', 'seats', 'piano'],
    ['tree', 'bench', 'plant'],
    ['desk', 'desk', 'plant'],
  ],
)
// 관문 — 도서관·체육관·급식실·옥상
furnish(
  ['library', 'gym', 'cafeteria', 'rooftop'],
  { x: 24, y: 11, w: 21, h: 9 },
  GATE_SLOTS,
  [
    ['shelf', 'shelf', 'table'],
    ['vault', 'bench', 'box'],
    ['canteen', 'table', 'table'],
    ['tank', 'plant', 'box'],
  ],
)
// 핵심 지역 — 운동장·강당·방송실·학생회실
furnish(
  ['playground', 'auditorium', 'broadcastRoom', 'studentCouncil'],
  { x: 29, y: 25, w: 6, h: 3 },
  CORE_SLOTS,
  [['bench'], ['seats'], ['console'], ['meetingTable']],
)

// 구관 회랑 — 네 조각이 한 방이라 조각마다 같은 배치를 돌려 쓴다
{
  let slots = OLD_SLOTS
  let w = 19
  let h = 3
  for (const rect of ROOM_RECTS.oldBuilding) {
    for (const [lx, ly] of slots) {
      const x = rect.x + lx
      const y = rect.y + ly
      if (lx >= rect.w || ly >= rect.h) throw new Error(`구관 가구가 방 밖으로 나갔다: ${lx},${ly}`)
      if (nearDoor(x, y)) continue
      props.set(key(x, y), 'cabinet')
    }
    const rotated = slots.map((sl) => rotSlot(sl, w, h))
    slots = rotated.map((r) => r.slot)
    const dims = rotSlot([0, 0, 0], w, h)
    w = dims.w
    h = dims.h
  }
}

// 중앙광장 — 화단 셋과 조형물 하나. 학교가 자랑스러워하던 것.
for (const [lx, ly, kind] of [
  [1, 1, 'plant'], [4, 1, 'plant'], [1, 4, 'plant'], [4, 4, 'statue'],
] as [number, number, PropKind][]) {
  const r = ROOM_RECTS.centralPlaza[0]
  if (!nearDoor(r.x + lx, r.y + ly)) props.set(key(r.x + lx, r.y + ly), kind)
}

/**
 * 흔적. 길을 막지 않고 바닥에 깔린다. 대부분은 그냥 낡은 학교의 얼룩이지만
 * 옥상의 실내화와 국화, 중앙광장의 초는 A가 남긴 자리다.
 */
const MARKS: [TileId, number, number, MarkKind][] = [
  ['classroom', 4, 8, 'flowers'],
  ['classroom', 4, 1, 'chalk'],
  ['hallway', 7, 4, 'poster'],
  ['scienceRoom', 12, 4, 'stain'],
  ['artRoom', 4, 10, 'stain'],
  ['musicRoom', 4, 9, 'poster'],
  ['clubRoom', 8, 4, 'crack'],
  ['garden', 8, 4, 'flowers'],
  ['storage', 4, 12, 'crack'],
  ['library', 16, 4, 'poster'],
  ['gym', 4, 14, 'crack'],
  ['cafeteria', 10, 4, 'stain'],
  ['rooftop', 4, 3, 'shoes'],
  ['rooftop', 4, 5, 'flowers'],
  ['rooftop', 4, 17, 'tape'],
  ['oldBuilding', 7, 1, 'tape'],
  ['oldBuilding', 12, 1, 'crack'],
  ['playground', 3, 1, 'crack'],
  ['auditorium', 1, 4, 'stain'],
  ['broadcastRoom', 2, 1, 'stain'],
  ['studentCouncil', 1, 3, 'crack'],
  ['centralPlaza', 2, 2, 'candle'],
  ['centralPlaza', 3, 2, 'flowers'],
]

for (const [id, lx, ly, kind] of MARKS) {
  const r = ROOM_RECTS[id][0]
  if (lx < 0 || ly < 0 || lx >= r.w || ly >= r.h) throw new Error(`${id} 흔적이 방 밖으로 나갔다: ${lx},${ly}`)
  const k = key(r.x + lx, r.y + ly)
  // 가구가 이미 선 자리에는 겹치지 않는다
  if (!props.has(k)) marks.set(k, kind)
}

/** 방마다 바닥이 다르다. 실외는 흙, 체육관·강당은 마루, 복도·구관은 통로. */
export type FloorKind = 'room' | 'hall' | 'outdoor' | 'wood'

const FLOOR_OF: Partial<Record<TileId, FloorKind>> = {
  hallway: 'hall',
  oldBuilding: 'hall',
  garden: 'outdoor',
  playground: 'outdoor',
  rooftop: 'outdoor',
  centralPlaza: 'outdoor',
  gym: 'wood',
  auditorium: 'wood',
}

export function floorOf(id: TileId): FloorKind {
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

const CORE_TILES = new Set<TileId>([
  'playground', 'auditorium', 'broadcastRoom', 'studentCouncil', 'centralPlaza',
])

/** 잠긴 문 목록. 아직 열리지 않은 핵심 지역으로 들어가는 문만 잠근다. */
export function lockedDoorKeys(unlocked: TileId[]): Set<string> {
  const open = new Set(unlocked)
  const out = new Set<string>()
  for (const d of DOORS) {
    const gated = [d.a, d.b].filter((id) => CORE_TILES.has(id))
    if (gated.length > 0 && gated.some((id) => !open.has(id))) out.add(`${d.x},${d.y}`)
  }
  return out
}

const BASE_OF: Record<TeamId, TileId> = { A: 'baseA', B: 'baseB', C: 'baseC', D: 'baseD' }

/** 그 방 한가운데 칸. 팀마다 자기 기지에서 시작한다. */
export function centerOf(id: TileId): { x: number; y: number } {
  const r = roomById[id].rects[0]
  return { x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) }
}

export function spawnFor(team: TeamId | null): { x: number; y: number } {
  return centerOf(team ? BASE_OF[team] : 'hallway')
}

/** 팀이 정해지기 전 기본 자리. */
export const SPAWN = spawnFor(null)

/** 조각이 떨어질 수 있는 곳 — 기지와 핵심 지역은 뺀다. */
export const SPAWNABLE_TILES: TileId[] = ROOMS.map((r) => r.id).filter(
  (id) => !CORE_TILES.has(id) && !id.startsWith('base'),
)

// ── 만들고 나서 확인 ────────────────────────────────────────────
// 생성된 맵이라 한 군데만 어긋나도 방이 통째로 잠긴다. 켤 때 바로 터뜨린다.
{
  const start = centerOf('baseA')
  const seen = new Uint8Array(N * N)
  const queue = [idx(start.x, start.y)]
  seen[queue[0]] = 1
  while (queue.length > 0) {
    const cur = queue.pop() as number
    const x = cur % N
    const y = (cur - x) / N
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = x + dx
      const ny = y + dy
      if (!isWalkable(nx, ny)) continue
      if (seen[idx(nx, ny)]) continue
      seen[idx(nx, ny)] = 1
      queue.push(idx(nx, ny))
    }
  }
  for (const room of ROOMS) {
    const reachable = room.rects.some((r) => {
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (seen[idx(x, y)]) return true
      return false
    })
    if (!reachable) throw new Error(`${room.id}에 걸어서 갈 수 없다.`)
  }
}
