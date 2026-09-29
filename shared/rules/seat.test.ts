import { describe, expect, it } from 'vitest'

import { START_TILE, TILE_IDS, isHallCell, roomOfCell, type Cell, type TileId } from './board'
import { isBlockedCell } from './blocked'
import { isFixture } from './fixtures'
import { canSeatAt, entryCellOf, inLane, nearestOpenHall, seatIn } from './seat'

/** 설 수 있는 복도 칸 하나 — 지도를 훑어 처음 나오는 것 */
function someHallCell(): Cell {
  for (let y = 0; y < 400; y++) for (let x = 0; x < 120; x++) if (isHallCell(x, y) && canSeatAt(x, y)) return { x, y }
  throw new Error('복도 칸이 없다')
}

describe('seat — 방에 들어선 사람이 설 칸', () => {
  it('같은 문으로 열넷이 차례로 들어와도 모두 다른 칸이다', () => {
    for (const room of TILE_IDS) {
      const taken = new Set<string>()
      for (let i = 0; i < 14; i++) {
        const c = seatIn(room as TileId, taken)
        expect(c, `${room} ${i}번째`).not.toBeNull()
        const k = `${c!.x},${c!.y}`
        expect(taken.has(k)).toBe(false)
        expect(roomOfCell(c!.x, c!.y)).toBe(room)
        expect(isBlockedCell(c!.x, c!.y) || isFixture(c!.x, c!.y)).toBe(false)
        taken.add(k)
      }
    }
  })

  it('서버가 세우는 사람은 문 앞 길에 안 선다 — 문이 막히지 않게', () => {
    const taken = new Set<string>()
    for (let i = 0; i < 9; i++) {
      const c = seatIn(START_TILE as TileId, taken)!
      expect(inLane(c.x, c.y)).toBe(false)
      taken.add(`${c.x},${c.y}`)
    }
  })

  it('걸어 들어온 칸이 비었으면 그 칸 그대로, 찼으면 가까운 빈 칸', () => {
    const door = entryCellOf(START_TILE as TileId)
    expect(seatIn(START_TILE as TileId, new Set(), door)).toEqual(door)
    const next = seatIn(START_TILE as TileId, new Set([`${door.x},${door.y}`]), door)!
    expect(next).not.toEqual(door)
    expect(Math.max(Math.abs(next.x - door.x), Math.abs(next.y - door.y))).toBeLessThanOrEqual(3)
  })

  it('다른 방 칸을 걸어 들어온 칸이라고 우기면 안 믿는다', () => {
    const other = TILE_IDS.find((t) => t !== START_TILE) as TileId
    const c = seatIn(START_TILE as TileId, new Set(), entryCellOf(other))!
    expect(roomOfCell(c.x, c.y)).toBe(START_TILE)
  })
})

describe('nearestOpenHall — 복도에서 비켜 설 칸', () => {
  it('비었으면 그 칸 그대로', () => {
    const h = someHallCell()
    expect(nearestOpenHall(h, new Set())).toEqual(h)
  })

  it('찼으면 가까운 빈 복도 칸 — 방 안이나 막힌 칸으로는 안 간다', () => {
    const h = someHallCell()
    const c = nearestOpenHall(h, new Set([`${h.x},${h.y}`]))!
    expect(c).not.toEqual(h)
    expect(isHallCell(c.x, c.y)).toBe(true)
    expect(canSeatAt(c.x, c.y)).toBe(true)
    expect(Math.max(Math.abs(c.x - h.x), Math.abs(c.y - h.y))).toBeLessThanOrEqual(6)
  })

  it('닿는 거리 안에 빈 복도 칸이 없으면 null', () => {
    const h = someHallCell()
    const all = new Set<string>()
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) all.add(`${h.x + dx},${h.y + dy}`)
    expect(nearestOpenHall(h, all, 2)).toBeNull()
  })
})
