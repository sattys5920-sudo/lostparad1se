import { describe, expect, it } from 'vitest'
import { buildRows, type DashboardInput } from './dashboard'
import type { RoleId } from '../missions/roleNames'

const base: DashboardInput = {
  roster: [
    { playerId: 'p1', name: '가온', role: 'bookclub' as RoleId },
    { playerId: 'p2', name: '나린', role: 'duty' as RoleId },
  ],
  invisibleDaysOf: () => [],
  mainMetOf: () => null,
  slipsMetOf: () => null,
}

describe('운영자 대시보드', () => {
  it('명단 그대로 한 줄씩 낸다', () => {
    const rows = buildRows(base)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ playerId: 'p1', name: '가온', role: 'bookclub' })
  })

  it('투명인간이었던 날을 적는다', () => {
    const rows = buildRows({ ...base, invisibleDaysOf: (id) => (id === 'p2' ? [2, 4] : []) })
    expect(rows[0].invisibleDays).toEqual([])
    expect(rows[1].invisibleDays).toEqual([2, 4])
  })

  it('끝나기 전에는 달성 여부가 null이다 — 화면이 가리는 게 아니라 안 온다', () => {
    const rows = buildRows(base)
    for (const r of rows) {
      expect(r.mainMet).toBe(null)
      expect(r.slipsMet).toBe(null)
    }
  })

  it('끝나면 달성 여부가 온다', () => {
    const rows = buildRows({
      ...base,
      mainMetOf: (id) => id === 'p1',
      slipsMetOf: (id) => (id === 'p1' ? 2 : 0),
    })
    expect(rows[0]).toMatchObject({ mainMet: true, slipsMet: 2 })
    expect(rows[1]).toMatchObject({ mainMet: false, slipsMet: 0 })
  })

  it('표를 보낸 사람은 어디에도 없다', () => {
    const text = JSON.stringify(buildRows(base))
    expect(text).not.toContain('voter')
    expect(text).not.toContain('vote')
  })
})
