// 걸어 다니는 학교. **판은 여기서 정하지 않는다 — shared/rules/board.ts 가 정한다.**
//
// 전에는 이 파일이 학교를 따로 그렸다. 바깥 고리 한 줄에 기지와 1구역을
// 늘어놓고, 관문을 안쪽에 박고, 구관 회랑으로 핵심 지역을 감싼 모양이었다.
// 보기에는 그럴듯했는데 규칙 쪽 판과 이웃 관계가 달랐다. 미술실에서
// 음악실로 가는 문이 있었지만 규칙은 그 둘을 이웃으로 치지 않아서, 그 문을
// 지나면 서버가 「옆방이 아니다」라고 되받았다. 마흔 쌍 중 열여덟 쌍이
// 그랬다. 두 벌로 그리면 반드시 이렇게 된다.
//
// 그래서 지금은 판이 하나다. 방 스물다섯 개를 5×5 격자에 그대로 펴고,
// 문은 ADJACENCY 가 이웃이라고 한 자리에만 뚫는다. 미니맵이 그리는 것과
// 걸어 다니는 학교가 같은 것이 된다.
//
//      D기지  창고   급식실  음악실  C기지        기지는 네 귀퉁이 — 어디서
//      정원   본관   방송실  신관   동아리실      중앙까지 가든 네 걸음이다
//      옥상  학생회  중앙광장  강당   체육관
//      복도   구관   운동장  별관   과학실
//      A기지  교실   도서관  미술실  B기지
//
// 격자는 90도 회전에 대해 대칭이다(규칙 쪽에서 그렇게 짰다). 가구도 그
// 대칭을 따라 한 방만 그리고 세 번 돌려 쓴다 — 네 팀이 똑같은 학교를
// 걷지 않으면 자리가 유불리가 된다.
import { ADJACENCY, TILE_BY_ID, TILES as BOARD } from '../../../shared/rules/board'
import type { Tier } from '../../../shared/rules/v2'
import type { MarkKind, PropKind } from './sprites'
import type { TeamId, TileId } from '../types'

export type { PropKind, MarkKind } from './sprites'

export const TILE = 16

/** 방 한 변과 방 사이 벽 한 줄. 판 크기가 전부 여기서 나온다. */
const ROOM = 11
const CELL = ROOM + 1
const MARGIN = 2
const GRID = 5
/** 격자가 90도 돌아도 같은 자리에 떨어지도록 가장자리를 맞춘 크기. */
const N = MARGIN * 2 + GRID * CELL - 1

export const MAP_W = N
export const MAP_H = N

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const rectOf = (row: number, col: number): Rect => ({
  x: MARGIN + col * CELL,
  y: MARGIN + row * CELL,
  w: ROOM,
  h: ROOM,
})

const ROOM_RECTS = Object.fromEntries(BOARD.map((t) => [t.id, [rectOf(t.row, t.col)]])) as Record<TileId, Rect[]>

/** 격자 자리로 방을 찾는다. 회전 궤도를 따라갈 때 쓴다. */
const AT = new Map<string, TileId>(BOARD.map((t) => [`${t.row},${t.col}`, t.id as TileId]))

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
 * 두 방 사이 벽 한 줄 가운데에 문을 뚫는다. 격자라 이웃은 언제나 벽 한 줄을
 * 사이에 두고 맞닿아 있다 — 손으로 좌표를 세지 않는다.
 */
function carveDoor(a: TileId, b: TileId): Door {
  const ra = TILE_BY_ID[a]
  const rb = TILE_BY_ID[b]
  const half = Math.floor(ROOM / 2)
  /** 두 칸 사이 벽 줄의 좌표. */
  const wall = (p: number, q: number) => MARGIN + Math.min(p, q) * CELL + ROOM
  if (ra.row === rb.row) return { x: wall(ra.col, rb.col), y: MARGIN + ra.row * CELL + half, a, b }
  if (ra.col === rb.col) return { x: MARGIN + ra.col * CELL + half, y: wall(ra.row, rb.row), a, b }
  throw new Error(`맞닿지 않은 두 방에 문을 놓으려 한다: ${a} ↔ ${b}`)
}

/** 이웃한 방 쌍. **규칙이 정한 것을 그대로 받는다.** 여기서 더하거나 빼지 않는다. */
const CONNECTIONS: [TileId, TileId][] = (() => {
  const out: [TileId, TileId][] = []
  for (const t of BOARD) {
    for (const n of ADJACENCY[t.id] ?? []) {
      if (t.id < n) out.push([t.id as TileId, n as TileId])
    }
  }
  return out
})()

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
// 자리는 네 팀이 똑같아야 한다. 그래서 자리 뼈대는 등급마다 한 벌만 그리고
// 회전 궤도를 따라 돌려 쓰고, 그 자리에 놓을 가구만 방마다 다르게 고른다.

const props = new Map<string, PropKind>()
const marks = new Map<string, MarkKind>()
const key = (x: number, y: number) => `${x},${y}`

/** 문 앞 한 칸은 비워 둔다. 막으면 방이 잠긴다. */
function nearDoor(x: number, y: number): boolean {
  return DOORS.some((d) => Math.abs(d.x - x) <= 1 && Math.abs(d.y - y) <= 1)
}

/** 격자가 90도 돌면 (row,col) 은 (col, GRID-1-row) 로 간다. */
const rotCell = (row: number, col: number): [number, number] => [col, GRID - 1 - row]

/** 방 한가운데 줄. 문과 문을 잇는 길이라 가구를 놓지 않는다. */
const CENTER = Math.floor(ROOM / 2)

/** 방 안의 자리도 같이 돈다. 방이 정사각이라 (lx,ly) → (ROOM-1-ly, lx) 다. */
const rotSlot = ([lx, ly]: [number, number]): [number, number] => [ROOM - 1 - ly, lx]

/**
 * 회전 궤도들. 한 궤도는 네 방(중앙광장만 저 혼자)이고, 돌리면 서로가 된다.
 * 손으로 적지 않는다 — 판이 바뀌면 궤도도 저절로 따라온다.
 */
function orbitsOf(tier: Tier): TileId[][] {
  const mine = BOARD.filter((t) => t.tier === tier)
  const left = new Set<TileId>(mine.map((t) => t.id as TileId))
  const out: TileId[][] = []
  for (const t of mine) {
    if (!left.has(t.id as TileId)) continue
    const ring: TileId[] = []
    let r = t.row
    let c = t.col
    for (let i = 0; i < 4; i++) {
      const id = AT.get(`${r},${c}`)
      if (!id || !left.has(id)) break
      left.delete(id)
      ring.push(id)
      ;[r, c] = rotCell(r, c)
    }
    if (ring.length > 0) out.push(ring)
  }
  return out
}

type Slot = [number, number, number]

/**
 * 한 궤도를 채운다. 자리는 방마다 90도씩 돌아가고, 가구는 방마다 제 것을 쓴다.
 * pick(방 id, 묶음 번호) 가 그 자리에 무엇을 놓을지 정한다.
 */
function furnish(ring: TileId[], slots: Slot[], pick: (id: TileId, group: number) => PropKind): void {
  // 문은 벽 한가운데에 뚫린다. 그래서 방 한가운데를 지나는 십자(가로 5줄,
  // 세로 5줄)는 문에서 문으로 가는 길이다. 여기를 막으면 방을 곧장 지나갈
  // 수 없고, 사람은 벽을 따라 방을 한 바퀴 돌게 된다. 실제로 그랬다 —
  // 도서관에 들어가면 서쪽 문까지 직선으로 못 갔다.
  //
  // 돌려 쓰는 자리라 (lx,ly) → (ROOM-1-ly, lx) 로 돌아간다. 네 번 다
  // 십자를 비키려면 lx 도 ly 도 한가운데가 아니면 된다
  for (const [lx, ly] of slots) {
    if (lx === CENTER || ly === CENTER) throw new Error(`가구가 방 한가운데 십자를 막는다: ${lx},${ly}`)
  }
  let cur = slots
  for (const id of ring) {
    const target = ROOM_RECTS[id][0]
    for (const [lx, ly, g] of cur) {
      if (lx < 0 || ly < 0 || lx >= ROOM || ly >= ROOM) throw new Error(`${id} 가구가 방 밖으로 나갔다: ${lx},${ly}`)
      const x = target.x + lx
      const y = target.y + ly
      if (nearDoor(x, y)) continue
      props.set(key(x, y), pick(id, g))
    }
    cur = cur.map(([lx, ly, g]): Slot => {
      const [nx, ny] = rotSlot([lx, ly])
      return [nx, ny, g]
    })
  }
}

/** 기지 — 사물함 벽과 앉을 자리. */
const BASE_SLOTS: Slot[] = [
  [1, 1, 0], [2, 1, 0], [3, 1, 0], [7, 1, 0], [8, 1, 0], [9, 1, 0],
  [1, 9, 1], [2, 9, 1], [8, 9, 1], [9, 9, 1],
]
/** 1구역 — 가운데를 비우고 벽을 따라 둔다. */
const ZONE1_SLOTS: Slot[] = [
  [1, 2, 0], [3, 2, 0], [7, 2, 0], [9, 2, 0],
  [1, 8, 1], [3, 8, 1], [7, 8, 1], [9, 8, 1],
  [4, 3, 2],
]
/**
 * 관문 — 정원이 둘뿐인 좁은 방이다. 가구로 실제로 좁게 만든다.
 * 숫자로만 좁다고 하면 걸어 보는 사람은 알 수가 없다.
 */
const GATE_SLOTS: Slot[] = [
  [1, 2, 0], [2, 2, 0], [3, 2, 0], [7, 2, 0], [8, 2, 0], [9, 2, 0],
  // 한가운데 길 양옆으로만 세운다. 길 위에 세우면 방을 못 지나간다
  [2, 4, 1], [3, 4, 1], [7, 4, 1], [8, 4, 1],
  [2, 6, 1], [3, 6, 1], [7, 6, 1], [8, 6, 1],
  [1, 8, 2], [3, 8, 2], [7, 8, 2], [9, 8, 2],
]
/** 교차로 — 지나가는 곳이라 네 귀퉁이만 쓴다. */
const CROSS_SLOTS: Slot[] = [[1, 1, 0], [9, 1, 0], [1, 9, 1], [9, 9, 1], [4, 2, 2]]
/** 핵심 지역 — 몇 개만. 여기서 무슨 일이 있었는지가 중요하지 가구가 아니다. */
const CORE_SLOTS: Slot[] = [[3, 3, 0], [7, 3, 0], [4, 8, 1]]

const PROPS: Partial<Record<TileId, PropKind[]>> = {
  baseA: ['locker', 'bench'],
  baseB: ['locker', 'bench'],
  baseC: ['locker', 'bench'],
  baseD: ['locker', 'bench'],

  classroom: ['desk', 'desk', 'plant'],
  hallway: ['locker', 'locker', 'plant'],
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
  mainBuilding: ['cabinet', 'plant', 'shelf'],
  newBuilding: ['shelf', 'cabinet', 'plant'],
  annex: ['box', 'cabinet', 'shelf'],

  playground: ['bench', 'tree'],
  auditorium: ['seats', 'seats'],
  broadcastRoom: ['console', 'cabinet'],
  studentCouncil: ['meetingTable', 'shelf'],
}

const pickProp = (id: TileId, g: number): PropKind => PROPS[id]?.[g] ?? 'box'

for (const ring of orbitsOf('base')) furnish(ring, BASE_SLOTS, pickProp)
for (const ring of orbitsOf('zone1')) furnish(ring, ZONE1_SLOTS, pickProp)
for (const ring of orbitsOf('gate')) furnish(ring, GATE_SLOTS, pickProp)
for (const ring of orbitsOf('cross')) furnish(ring, CROSS_SLOTS, pickProp)
for (const ring of orbitsOf('core')) furnish(ring, CORE_SLOTS, pickProp)

// 중앙광장 — 네 귀퉁이에 화단, 네 어귀에 기둥. 학교가 자랑스러워하던 것.
//
// 중앙광장은 회전의 **고정점**이다. 판이 돌아도 저는 제자리라, 방 안이
// 저 혼자 90도 대칭이어야 한다. 조형물을 한 자리에만 세우면 어느 팀은
// 그것을 돌아가야 하고 어느 팀은 안 돌아가도 된다 — 그래서 넷이다.
// 한가운데는 비운다. 거기는 사람이 서는 자리다
{
  const r = ROOM_RECTS.centralPlaza[0]
  const put = (lx: number, ly: number, kind: PropKind) => {
    if (!nearDoor(r.x + lx, r.y + ly)) props.set(key(r.x + lx, r.y + ly), kind)
  }
  for (const [lx, ly, kind] of [
    [3, 3, 'plant'],
    [4, 2, 'statue'],
  ] as [number, number, PropKind][]) {
    let p: [number, number] = [lx, ly]
    for (let i = 0; i < 4; i++) {
      put(p[0], p[1], kind)
      p = rotSlot(p)
    }
  }
}

/**
 * 흔적. 길을 막지 않고 바닥에 깔린다. 대부분은 그냥 낡은 학교의 얼룩이지만
 * 옥상의 실내화와 국화, 중앙광장의 초는 A가 남긴 자리다.
 */
const MARKS: [TileId, number, number, MarkKind][] = [
  ['classroom', 5, 8, 'flowers'],
  ['classroom', 5, 2, 'chalk'],
  ['hallway', 5, 4, 'poster'],
  ['scienceRoom', 5, 4, 'stain'],
  ['artRoom', 4, 6, 'stain'],
  ['musicRoom', 6, 4, 'poster'],
  ['clubRoom', 4, 4, 'crack'],
  ['garden', 6, 6, 'flowers'],
  ['storage', 4, 6, 'crack'],
  ['library', 5, 3, 'poster'],
  ['gym', 5, 7, 'crack'],
  ['cafeteria', 5, 3, 'stain'],
  ['rooftop', 4, 3, 'shoes'],
  ['rooftop', 6, 3, 'flowers'],
  ['rooftop', 5, 7, 'tape'],
  ['oldBuilding', 5, 5, 'tape'],
  ['mainBuilding', 5, 5, 'crack'],
  ['newBuilding', 5, 5, 'stain'],
  ['annex', 5, 5, 'crack'],
  ['playground', 5, 5, 'crack'],
  ['auditorium', 5, 5, 'stain'],
  ['broadcastRoom', 5, 5, 'stain'],
  ['studentCouncil', 5, 5, 'crack'],
  ['centralPlaza', 4, 4, 'candle'],
  ['centralPlaza', 6, 4, 'flowers'],
]

for (const [id, lx, ly, kind] of MARKS) {
  const r = ROOM_RECTS[id][0]
  if (lx < 0 || ly < 0 || lx >= r.w || ly >= r.h) throw new Error(`${id} 흔적이 방 밖으로 나갔다: ${lx},${ly}`)
  const k = key(r.x + lx, r.y + ly)
  // 가구가 이미 선 자리에는 겹치지 않는다
  if (!props.has(k)) marks.set(k, kind)
}

/** 방마다 바닥이 다르다. 실외는 흙, 체육관·강당은 마루, 복도·교차로는 통로. */
export type FloorKind = 'room' | 'hall' | 'outdoor' | 'wood'

const FLOOR_OF: Partial<Record<TileId, FloorKind>> = {
  hallway: 'hall',
  oldBuilding: 'hall',
  mainBuilding: 'hall',
  newBuilding: 'hall',
  annex: 'hall',
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

/** A의 기록이 열어 주기 전에는 못 들어가는 칸. 규칙 쪽 등급이 정한다. */
const CORE_TILES = new Set<TileId>(
  BOARD.filter((t) => t.tier === 'core' || t.tier === 'plaza').map((t) => t.id as TileId),
)

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
  // **문과 규칙이 어긋나면 여기서 터진다.** 이 확인이 없어서 걸어 다니는
  // 학교와 규칙이 다른 학교인 채로 한참을 굴렀다
  for (const d of DOORS) {
    if (!ADJACENCY[d.a]?.includes(d.b)) throw new Error(`규칙이 이웃으로 안 치는 문: ${d.a} ↔ ${d.b}`)
  }
  const pairs = Object.values(ADJACENCY).reduce((s, ns) => s + ns.length, 0) / 2
  if (DOORS.length !== pairs) throw new Error(`문 ${DOORS.length}개, 규칙 이웃 ${pairs}쌍 — 어긋난다.`)

  // 방 한가운데는 언제나 비어 있어야 한다. 거기 서서 시작하고, 거기로 놓인다
  for (const room of ROOMS) {
    const c = centerOf(room.id)
    if (!isWalkable(c.x, c.y)) throw new Error(`${room.id} 한가운데에 설 수 없다.`)
  }

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
