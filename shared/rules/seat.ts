// 방에 들어선 사람이 설 칸 — **한 칸에 한 사람.**
//
// 방에 들어오면 서버가 칸을 정해 준다(roamTo · 도착 · 종이 칠 때 제자리).
// 전에는 칸을 비워(at: null) 두고 화면이 알아서 고르게 했는데, 같은 문으로
// 여럿이 들어오면 저마다 「문 앞 빈 칸」을 골라 한 칸에 겹쳐 섰다 — 칸이 없는
// 사람은 서버의 「누가 서 있다」 검사에도 안 걸렸다.
//
// 고르는 법은 화면과 서버가 같다. 가고 싶은 칸(없으면 문 바로 안쪽 —
// ENTRY_CELLS)에서 **가까운 테두리부터 한 겹씩** 넓혀 가며 첫 빈 칸.
import { DOOR_CELLS, ENTRY_CELLS, isBlockedCell } from './blocked'
import { TILE_BY_ID, roomOfCell, type Cell, type TileId } from './board'
import { isFixture } from './fixtures'
import { laneCells } from './lane'

/** 문 앞 길 칸 전부(rules/lane). 서버가 세우는 사람은 여기 먼저 안 세운다 */
const LANE: ReadonlySet<string> = new Set(
  DOOR_CELLS.flatMap((d) => (TILE_BY_ID[d.room as TileId] ? laneCells(d, TILE_BY_ID[d.room as TileId].plan) : [])),
)
export const inLane = (x: number, y: number): boolean => LANE.has(`${x},${y}`)

/**
 * 복도에서 겹쳐 그려질 사람을 비켜 그릴 때 찾아보는 거리(칸). 복도는 방처럼
 * 끝이 없어서 한도를 둔다 — 세 칸 안에 빈 칸이 없으면 그 자리에 그린다
 */
export const HALL_SPREAD_REACH = 3

/** 방에 들어서는 자리. 문 바로 안쪽 한 칸, 문이 없으면 한가운데 */
export function entryCellOf(room: TileId): Cell {
  const hit = ENTRY_CELLS[room]
  if (hit) return hit
  const r = TILE_BY_ID[room].plan
  return { x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) }
}

/**
 * from 에서 가장 가까운, 그 방 안의 열린 칸. 가까운 테두리(체비셰프 거리)부터
 * 한 겹씩 본다 — 같은 겹 안에서는 왼쪽 위부터. **순서가 정해져 있어야** 화면과
 * 서버가 같은 칸을 고른다. 방이 꽉 찼으면 null.
 */
export function nearestOpenCell(room: TileId, from: Cell, open: (x: number, y: number) => boolean): Cell | null {
  const ok = (x: number, y: number) => roomOfCell(x, y) === room && open(x, y)
  if (ok(from.x, from.y)) return { x: from.x, y: from.y }
  const r = TILE_BY_ID[room].plan
  // 방 끝까지 닿는 겹 수. 방 밖에서 시작해도 방 전체를 덮는다
  const reach = Math.max(Math.abs(from.x - r.x), Math.abs(from.x - (r.x + r.w - 1)), Math.abs(from.y - r.y), Math.abs(from.y - (r.y + r.h - 1)))
  for (let d = 1; d <= reach; d++) {
    for (let dx = -d; dx <= d; dx++) {
      for (let dy = -d; dy <= d; dy++) {
        if (Math.abs(dx) !== d && Math.abs(dy) !== d) continue
        if (ok(from.x + dx, from.y + dy)) return { x: from.x + dx, y: from.y + dy }
      }
    }
  }
  return null
}

/** 서버 기준으로 방 안에서 설 수 있는 칸인가 — 기물 · 가구 · 팻말이 아니다 */
export const canSeatAt = (x: number, y: number): boolean => !isFixture(x, y) && !isBlockedCell(x, y)

/**
 * from 에서 가까운 설 칸 — **문 앞 길은 비워 둔다.** 들어온 사람들을 문 앞에
 * 뭉쳐 세우면 문(한 칸)이 막혀 방 안 사람이 못 나간다. 길 밖에 빈 칸이 없을
 * 때만 길 위에 세운다. 화면(Walk 의 자리 고르기)과 서버가 같이 쓴다.
 */
export function seatNear(room: TileId, from: Cell, open: (x: number, y: number) => boolean): Cell | null {
  return nearestOpenCell(room, from, (x, y) => open(x, y) && !inLane(x, y)) ?? nearestOpenCell(room, from, open)
}

/**
 * 방에 들어선 사람이 설 칸. taken 은 이미 누가 선 칸과 종이가 놓인 칸("x,y").
 *
 * near 는 **걸어 들어온 칸**이다. 그 방 안이고 비었으면 그 칸 그대로 — 제 발로
 * 서 있는 자리를 옮기지 않는다(곧 걸어 나간다). 찼으면 거기서 가까운 길 밖 칸.
 * near 가 없으면(도착 · 종이 칠 때 · 계단) 문 바로 안쪽에서 가까운 길 밖 칸.
 */
export function seatIn(room: TileId, taken: ReadonlySet<string>, near: Cell | null = null): Cell | null {
  const open = (x: number, y: number) => canSeatAt(x, y) && !taken.has(`${x},${y}`)
  const walkedIn = near && roomOfCell(near.x, near.y) === room ? near : null
  if (walkedIn && open(walkedIn.x, walkedIn.y)) return { x: walkedIn.x, y: walkedIn.y }
  return seatNear(room, walkedIn ?? entryCellOf(room), open)
}
