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
import type { TeamId, TileId } from '../types'

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

// ── 가구 ────────────────────────────────────────────────────────
// 책상 사이를 비집고 다니는 것이 공간을 공간처럼 만든다. 문 앞은 반드시 비운다.

export type PropKind = 'desk' | 'shelf' | 'table' | 'plant' | 'box'

const PROP_OF: Partial<Record<TileId, PropKind>> = {
  classroom: 'desk', hallway: 'plant', scienceRoom: 'table', artRoom: 'table',
  musicRoom: 'shelf', clubRoom: 'box', garden: 'plant', storage: 'box',
  library: 'shelf', gym: 'box', cafeteria: 'table', rooftop: 'plant',
  oldBuilding: 'plant', playground: 'box', auditorium: 'table',
  broadcastRoom: 'box', studentCouncil: 'table', centralPlaza: 'plant',
}

const props = new Map<string, PropKind>()

for (const room of ROOMS) {
  const kind = PROP_OF[room.id]
  if (!kind) continue
  for (const r of room.rects) {
    if (r.w < 7 || r.h < 5) continue
    for (let y = r.y + 2; y < r.y + r.h - 2; y += 3) {
      for (let x = r.x + 2; x < r.x + r.w - 2; x += 3) {
        // 문 앞 두 칸은 비운다 — 막으면 방이 잠긴다.
        if (DOORS.some((d) => Math.abs(d.x - x) <= 2 && Math.abs(d.y - y) <= 2)) continue
        props.set(`${x},${y}`, kind)
      }
    }
  }
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
