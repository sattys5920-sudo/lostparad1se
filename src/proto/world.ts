// 학교 한 층. 가운데 복도를 두고 위아래로 방이 넷씩 붙는다.
// '#' 벽 · '.' 바닥 · '+' 문(지나갈 수 있다)
const ROWS = [
  '#########################################',
  '#.........#.........#.........#.........#',
  '#.........#.........#.........#.........#',
  '#.........#.........#.........#.........#',
  '#.........#.........#.........#.........#',
  '#.........#.........#.........#.........#',
  '#.........#.........#.........#.........#',
  '#####+#########+#########+#########+#####',
  '#.......................................#',
  '#.......................................#',
  '#.......................................#',
  '#####+#########+#########+#########+#####',
  '#.........#.........#.........#.........#',
  '#.........#.........#.........#.........#',
  '#.........#.........#.........#.........#',
  '#.........#.........#.........#.........#',
  '#.........#.........#.........#.........#',
  '#.........#.........#.........#.........#',
  '#########################################',
]

// 손으로 그린 맵이라 한 줄이라도 길이가 어긋나면 충돌 판정이 조용히 어긋난다. 바로 터뜨린다.
const WIDTH = ROWS[0].length
for (const [i, row] of ROWS.entries()) {
  if (row.length !== WIDTH) {
    throw new Error(`맵 ${i}번째 줄 길이가 ${row.length}다. ${WIDTH}이어야 한다.`)
  }
}

export const TILE = 16
export const MAP_W = WIDTH
export const MAP_H = ROWS.length

export type TileKind = 'wall' | 'floor' | 'door'

export function tileAt(x: number, y: number): TileKind {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return 'wall'
  const c = ROWS[y][x]
  if (c === '#') return 'wall'
  if (c === '+') return 'door'
  return 'floor'
}

// ── 가구 ────────────────────────────────────────────────────────
// 전부 막힌 것으로 친다. 책상 사이를 비집고 다니는 게 공간을 공간처럼 만든다.
// 문 앞 칸은 반드시 비워 둘 것 — 막으면 방이 잠긴다.

export type PropKind = 'desk' | 'shelf' | 'table' | 'plant' | 'box'

const props = new Map<string, PropKind>()
const key = (x: number, y: number) => `${x},${y}`
function put(x: number, y: number, kind: PropKind) {
  props.set(key(x, y), kind)
}
function putRow(xs: number[], ys: number[], kind: PropKind) {
  for (const y of ys) for (const x of xs) put(x, y, kind)
}

// 교실 — 책상 줄. 가운데(x=5)는 문으로 이어지는 통로라 비운다.
putRow([2, 3, 6, 7], [2, 4], 'desk')
// 도서관 — 서가를 벽처럼 세운다
putRow([12, 13, 17, 18], [2, 4], 'shelf')
// 과학실 — 실험대
putRow([22, 23, 27, 28], [2, 4], 'table')
// 방송실 — 장비 상자와 탁자
putRow([32, 33, 37, 38], [2], 'box')
putRow([33, 37], [4], 'table')
// 급식실 — 식탁
putRow([2, 3, 6, 7], [14, 16], 'table')
// 체육관 — 거의 비워 두고 구석에 기구만
putRow([12, 18], [16], 'box')
// 음악실 — 뒤쪽 서가, 앞쪽 화분
putRow([22, 23, 27, 28], [16], 'shelf')
putRow([21, 29], [13], 'plant')
// 학생회실 — 회의 탁자
putRow([33, 34, 36, 37], [14], 'table')
// 복도 — 숨 돌릴 화분 몇 개
putRow([2, 20, 38], [8], 'plant')

export function propAt(x: number, y: number): PropKind | null {
  return props.get(key(x, y)) ?? null
}

export function isWalkable(x: number, y: number): boolean {
  return tileAt(x, y) !== 'wall' && !props.has(key(x, y))
}

export interface RoomSpec {
  id: string
  name: string
  /** 내부 영역(경계 포함). */
  x1: number
  y1: number
  x2: number
  y2: number
}

export const ROOMS: RoomSpec[] = [
  { id: 'classroom', name: '교실', x1: 1, y1: 1, x2: 9, y2: 6 },
  { id: 'library', name: '도서관', x1: 11, y1: 1, x2: 19, y2: 6 },
  { id: 'scienceRoom', name: '과학실', x1: 21, y1: 1, x2: 29, y2: 6 },
  { id: 'broadcastRoom', name: '방송실', x1: 31, y1: 1, x2: 39, y2: 6 },
  { id: 'hallway', name: '복도', x1: 1, y1: 8, x2: 39, y2: 10 },
  { id: 'cafeteria', name: '급식실', x1: 1, y1: 12, x2: 9, y2: 17 },
  { id: 'gym', name: '체육관', x1: 11, y1: 12, x2: 19, y2: 17 },
  { id: 'musicRoom', name: '음악실', x1: 21, y1: 12, x2: 29, y2: 17 },
  { id: 'studentCouncil', name: '학생회실', x1: 31, y1: 12, x2: 39, y2: 17 },
]

export const roomById: Record<string, RoomSpec> = Object.fromEntries(ROOMS.map((r) => [r.id, r]))

/** 지금 서 있는 칸이 어느 방인지. 문턱에 서 있으면 복도로 친다. */
export function roomAt(x: number, y: number): RoomSpec | null {
  return ROOMS.find((r) => x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2) ?? null
}

export const SPAWN = { x: 20, y: 9 }
