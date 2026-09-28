import { describe, expect, it } from 'vitest'

import { foundByOf, sortPapers, trailOf, type PaperRow } from './paperTrail'

const names: Record<string, string> = { a: '가람', b: '나래', c: '다온' }
const nameOf = (id: string | null | undefined) => (id ? (names[id] ?? null) : null)
const roomName = (t: string | null | undefined) => (t ? `방${t}` : null)

describe('종이 이력', () => {
  const recs = [
    { kind: 'slipRead' as const, atMs: 30, actorId: 'a', subjectId: 's1' },
    { kind: 'slipTake' as const, atMs: 10, actorId: 'a', subjectId: 's1', tileId: '1' },
    { kind: 'slipGive' as const, atMs: 40, actorId: 'a', otherId: 'b', subjectId: 's1', tileId: '2' },
    { kind: 'slipTake' as const, atMs: 5, actorId: 'c', subjectId: 'other' },
    { kind: 'trade' as const, atMs: 50, actorId: 'a', subjectId: 's1' },
    { kind: 'slipTear' as const, atMs: 60, actorId: 'b', subjectId: 's1' },
  ]

  it('그 종이의 줄만, 시간순으로 모은다 — 이력과 상관없는 기록은 뺀다', () => {
    const t = trailOf('s1', recs, nameOf, roomName)
    expect(t.map((r) => r.kind)).toEqual(['slipTake', 'slipRead', 'slipGive', 'slipTear'])
    expect(t[0]).toMatchObject({ who: '가람', where: '방1', to: null })
    expect(t[2]).toMatchObject({ who: '가람', to: '나래', where: '방2' })
  })

  it('발견은 처음 주운 사람이다', () => {
    expect(foundByOf(trailOf('s1', recs, nameOf, roomName))).toBe('가람')
    expect(foundByOf([])).toBeNull()
  })

  it('이름을 모르면 「누군가」로 둔다', () => {
    const t = trailOf('x', [{ kind: 'quizWrong', atMs: 1, actorId: 'zz', subjectId: 'x' }], nameOf, roomName)
    expect(t[0].who).toBe('누군가')
  })

  it('손에 있는 것 · 바닥에 있는 것이 위, 끝난 것이 아래 — 그 안에서는 최근 것이 위', () => {
    const row = (id: string, state: PaperRow['state'], at: number): PaperRow => ({
      id,
      kind: 'note',
      title: id,
      text: '',
      state,
      placedAt: null,
      placedAtMs: at,
      where: null,
      holder: null,
      foundBy: null,
      doneBy: null,
      readers: [],
      trail: [],
    })
    const out = sortPapers([row('t', 'torn', 9), row('f1', 'floor', 1), row('h', 'held', 2), row('f2', 'floor', 5)])
    expect(out.map((p) => p.id)).toEqual(['h', 'f2', 'f1', 't'])
  })
})
