import { describe, expect, it } from 'vitest'
import { CONSTRUCTION_ROOM, isUnderConstruction } from './construction'

describe('2-3 교실 공사', () => {
  it('판이 도는 동안 열기 전까지 닫혀 있다', () => {
    expect(isUnderConstruction({ phase: 'running' }, CONSTRUCTION_ROOM)).toBe(true)
    expect(isUnderConstruction({ phase: 'running', plazaOpen: true }, CONSTRUCTION_ROOM)).toBe(false)
  })
  it('시작 전 로비는 막지 않는다 · 다른 방은 상관없다', () => {
    expect(isUnderConstruction({ phase: 'lobby' }, CONSTRUCTION_ROOM)).toBe(false)
    expect(isUnderConstruction({ phase: 'running' }, 'cafeteria')).toBe(false)
  })
})
