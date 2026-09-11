// 운영자 대시보드 — 보낸 사람이 운영자에게도 보이지 않는지.
import { describe, expect, it } from 'vitest'
import { buildRows, linkStatus, pieceOpen, suspicionTotals, type LinkSpec } from './dashboard'
import type { RoleId } from '../missions/roleNames'

const roster = [
  { playerId: 'p1', name: '한겨울', role: 'librarian' as RoleId },
  { playerId: 'p2', name: '서리', role: 'guard' as RoleId },
]

const base = {
  roster,
  hintDayOf: (r: RoleId) => (r === 'librarian' ? 1 : null),
  exposureOf: (r: RoleId) => (r === 'guard' ? ('onlyByOwnReveal' as const) : ('byDeduction' as const)),
  reveals: [],
  exactHitsOn: () => 0,
  invisibleDaysOf: () => [],
  awakenedOf: () => false,
}

describe('역할별 행', () => {
  it('가리켜진 날과 공개 가능성이 붙는다', () => {
    const rows = buildRows(base)
    expect(rows[0]).toMatchObject({ role: 'librarian', hintDay: 1, exposure: 'byDeduction' })
    expect(rows[1]).toMatchObject({ role: 'guard', hintDay: null, exposure: 'onlyByOwnReveal' })
  })

  it('털어놓지 않았으면 null이다', () => {
    expect(buildRows(base)[0].reveal).toBe(null)
  })

  it('털어놓았으면 방식·시각·들은 인원이 붙는다', () => {
    const rows = buildRows({
      ...base,
      reveals: [{ role: 'guard', scope: 'class', atMs: 500, listeners: 13 }],
    })
    expect(rows[1].reveal).toEqual({ scope: 'class', atMs: 500, listeners: 13 })
  })

  it('여러 번 털어놓았으면 처음 것을 적는다', () => {
    const rows = buildRows({
      ...base,
      reveals: [
        { role: 'guard', scope: 'class', atMs: 900, listeners: 13 },
        { role: 'guard', scope: 'private', atMs: 300, listeners: 1 },
      ],
    })
    expect(rows[1].reveal?.atMs).toBe(300)
    expect(rows[1].reveal?.scope).toBe('private')
  })

  it('들은 사람이 누구인지는 담지 않는다 — 인원 수뿐이다', () => {
    const rows = buildRows({
      ...base,
      reveals: [{ role: 'guard', scope: 'private', atMs: 1, listeners: 2 }],
    })
    expect(Object.keys(rows[1].reveal ?? {})).toEqual(['scope', 'atMs', 'listeners'])
  })

  it('적중 의심 · 투명인간이었던 날 · 깨달음이 붙는다', () => {
    const rows = buildRows({
      ...base,
      exactHitsOn: (id) => (id === 'p1' ? 2 : 0),
      invisibleDaysOf: (id) => (id === 'p1' ? [3] : []),
      awakenedOf: (id) => id === 'p2',
    })
    expect(rows[0]).toMatchObject({ exactHits: 2, invisibleDays: [3], awakened: false })
    expect(rows[1]).toMatchObject({ exactHits: 0, invisibleDays: [], awakened: true })
  })
})

describe('연결 단서', () => {
  const links: LinkSpec[] = [
    {
      id: 'x',
      left: { kind: 'reveal', role: 'accuser', scope: 'class', label: '고발자 고백(전체)' },
      right: { kind: 'fragment', day: 5, label: 'DAY 5 기록' },
      conclusion: 'A를 부른 사람이 따로 있다.',
    },
  ]

  it('둘 다 열려야 연결 가능이다', () => {
    const none = linkStatus(links, { releasedDays: [], reveals: [] })
    expect(none[0]).toMatchObject({ leftOpen: false, rightOpen: false, connectable: false })

    const half = linkStatus(links, { releasedDays: [5], reveals: [] })
    expect(half[0]).toMatchObject({ leftOpen: false, rightOpen: true, connectable: false })

    const both = linkStatus(links, {
      releasedDays: [5],
      reveals: [{ role: 'accuser', scope: 'class' }],
    })
    expect(both[0].connectable).toBe(true)
  })

  it('전체 고백을 요구하면 1:1로는 안 열린다', () => {
    const out = linkStatus(links, {
      releasedDays: [5],
      reveals: [{ role: 'accuser', scope: 'private' }],
    })
    expect(out[0].leftOpen).toBe(false)
  })

  it('any면 방식을 가리지 않는다', () => {
    const piece = { kind: 'reveal' as const, role: 'witness' as RoleId, scope: 'any' as const, label: 'x' }
    expect(pieceOpen(piece, { releasedDays: [], reveals: [{ role: 'witness', scope: 'private' }] })).toBe(true)
  })
})

describe('의심표 집계', () => {
  it('사람별 합계만 낸다', () => {
    const out = suspicionTotals(roster, (id) => (id === 'p2' ? 4 : 1))
    expect(out).toEqual([
      { playerId: 'p2', name: '서리', received: 4 },
      { playerId: 'p1', name: '한겨울', received: 1 },
    ])
  })

  it('날짜별로도 보낸 사람별로도 쪼개지 않는다', () => {
    const text = JSON.stringify(suspicionTotals(roster, () => 2))
    expect(text).not.toContain('day')
    expect(text).not.toContain('voter')
    expect(text).not.toContain('from')
    expect(Object.keys(suspicionTotals(roster, () => 1)[0])).toEqual(['playerId', 'name', 'received'])
  })
})
