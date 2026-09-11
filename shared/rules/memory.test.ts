// A의 기억 — 열세 칸, 먼저 마주한 팀만.
import { describe, expect, it } from 'vitest'
import { footprintTiles, hasMemory, MEMORY_TILES, memoriesFor, openMemory, type MemoryOpened } from './memory'
import { TILE_BY_ID } from './board'

describe('묻힌 칸', () => {
  it('열세 곳이다', () => {
    expect(MEMORY_TILES).toHaveLength(13)
  })

  it('관문 4 · 교차로 4 · 핵심 4 · 중앙광장 1이다', () => {
    const byTier = MEMORY_TILES.reduce<Record<string, number>>((acc, id) => {
      const t = TILE_BY_ID[id].tier
      acc[t] = (acc[t] ?? 0) + 1
      return acc
    }, {})
    expect(byTier).toEqual({ gate: 4, cross: 4, core: 4, plaza: 1 })
  })

  it('기지와 1구역에는 없다', () => {
    expect(hasMemory('baseA')).toBe(false)
    expect(hasMemory('classroom')).toBe(false)
    expect(hasMemory('storage')).toBe(false)
  })

  it('다툼이 벌어지는 칸에는 있다', () => {
    expect(hasMemory('library')).toBe(true)
    expect(hasMemory('centralPlaza')).toBe(true)
    expect(hasMemory('oldBuilding')).toBe(true)
  })
})

describe('여는 순간', () => {
  it('처음 가져간 팀에게 열린다', () => {
    const out = openMemory({ tileId: 'library', team: 'A', atMs: 100, opened: [] })
    expect(out).toEqual({ tileId: 'library', team: 'A', atMs: 100 })
  })

  it('나중에 뺏은 팀에게는 열리지 않는다', () => {
    const opened: MemoryOpened[] = [{ tileId: 'library', team: 'A', atMs: 100 }]
    expect(openMemory({ tileId: 'library', team: 'B', atMs: 200, opened })).toBe(null)
  })

  it('기억이 없는 칸은 아무 일도 없다', () => {
    expect(openMemory({ tileId: 'classroom', team: 'A', atMs: 100, opened: [] })).toBe(null)
  })
})

describe('읽을 수 있는 것', () => {
  const opened: MemoryOpened[] = [
    { tileId: 'library', team: 'A', atMs: 1 },
    { tileId: 'gym', team: 'B', atMs: 2 },
  ]

  it('우리 팀이 연 것만 보인다', () => {
    expect(memoriesFor(opened, 'A')).toEqual(['library'])
    expect(memoriesFor(opened, 'B')).toEqual(['gym'])
    expect(memoriesFor(opened, 'C')).toEqual([])
  })

  it('끝나면 열세 장면 모두 열린다', () => {
    expect(memoriesFor(opened, 'C', true)).toHaveLength(13)
  })

  it('발자국은 열린 칸마다 하나씩이다', () => {
    expect(footprintTiles(opened).sort()).toEqual(['gym', 'library'])
  })
})
