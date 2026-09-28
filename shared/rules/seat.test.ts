import { describe, expect, it } from 'vitest'

import { START_TILE, TILE_IDS, roomOfCell, type TileId } from './board'
import { isBlockedCell } from './blocked'
import { isFixture } from './fixtures'
import { entryCellOf, inLane, seatIn } from './seat'

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
