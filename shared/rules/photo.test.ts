import { describe, expect, it } from 'vitest'
import { PHOTO_ROOM, PHOTO_SPOTS, photoSpots } from './photo'
import { roomOfCell } from './board'
import { isBlockedCell } from './blocked'

describe('기념사진 자리', () => {
  it('열넷 자리는 모두 2-3 교실 안, 서로 다르다', () => {
    expect(PHOTO_SPOTS).toHaveLength(14)
    expect(new Set(PHOTO_SPOTS.map((c) => `${c.x},${c.y}`)).size).toBe(14)
    for (const c of PHOTO_SPOTS) expect(roomOfCell(c.x, c.y)).toBe(PHOTO_ROOM)
  })
  it('기물이 있는 칸을 안 쓴다 — 기념사진을 끄면 기물이 돌아오므로', () => {
    for (const c of PHOTO_SPOTS) expect(isBlockedCell(c.x, c.y)).toBe(false)
  })
  it('분단끼리 모아 왼쪽부터 — 1 분단(B)이 맨 왼쪽', () => {
    const seats = [
      { playerId: 'a', name: '가', team: 'A' as const },
      { playerId: 'b', name: '나', team: 'B' as const },
      { playerId: 'c', name: '다', team: 'C' as const },
    ]
    const m = photoSpots(seats)
    expect(m.get('b')).toEqual(PHOTO_SPOTS[0])
    expect(m.get('a')).toEqual(PHOTO_SPOTS[1])
    expect(m.get('c')).toEqual(PHOTO_SPOTS[2])
  })
})
