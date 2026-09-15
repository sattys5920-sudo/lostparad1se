// 표 — 익명과 합계.
import { describe, expect, it } from 'vitest'
import { canCast, peekVoter, tallyVotes, type Vote } from './votes'
import type { TeamId, VoteKind } from './v2'

const seoul = (iso: string) => new Date(`${iso}+09:00`).getTime()

const vote = (kind: VoteKind, targetTeam: TeamId, over: Partial<Vote> = {}): Vote => ({
  voterId: 'a1',
  voterTeam: 'A',
  targetId: 'b1',
  targetTeam,
  kind,
  atMs: seoul('2026-03-02T10:00:00'),
  ...over,
})

describe('던질 수 있는가', () => {
  const base = {
    voterId: 'a1',
    voterTeam: 'A' as TeamId,
    targetId: 'b1',
    targetTeam: 'B' as TeamId,
    atMs: seoul('2026-03-02T10:00:00'),
    votedToday: false,
  }

  // 하루가 자정에 열리니 표도 자정부터 받는다
  it('자정부터 21:00까지다', () => {
    expect(canCast({ ...base, atMs: seoul('2026-03-02T00:00:00') }).ok).toBe(true)
    expect(canCast({ ...base, atMs: seoul('2026-03-02T07:59:59') }).ok).toBe(true)
    expect(canCast({ ...base, atMs: seoul('2026-03-02T20:59:59') }).ok).toBe(true)
    expect(canCast({ ...base, atMs: seoul('2026-03-02T21:00:00') }).reason).toBe('closed')
  })

  it('같은 팀에는 못 준다', () => {
    expect(canCast({ ...base, targetTeam: 'A' }).reason).toBe('ownTeam')
  })

  it('자기에게는 못 준다', () => {
    expect(canCast({ ...base, targetId: 'a1', targetTeam: 'A' }).reason).toBe('self')
  })

  it('하루 한 장이다', () => {
    expect(canCast({ ...base, votedToday: true }).reason).toBe('alreadyToday')
  })
})

describe('합계', () => {
  it('받은 표 수를 팀별로 낸다', () => {
    const out = tallyVotes({
      votes: [vote('trust', 'B'), vote('trust', 'B', { voterId: 'c1', voterTeam: 'C' }), vote('liking', 'C')],
    })
    expect(out.B.received.trust).toBe(2)
    expect(out.C.received.liking).toBe(1)
    expect(out.A.received.trust).toBe(0)
  })

  it('표는 받은 쪽에만 센다 — 금고는 아무도 안 움직인다', () => {
    const out = tallyVotes({ votes: [vote('liking', 'B')] })
    expect(out.B.received.liking).toBe(1)
    expect(out.A.received.liking).toBe(0)
  })

  it('합계에는 보낸 사람이 들어 있지 않다', () => {
    const out = tallyVotes({ votes: [vote('trust', 'B'), vote('liking', 'C')] })
    const text = JSON.stringify(out)
    expect(text).not.toContain('a1')
    expect(text).not.toContain('voterId')
    expect(text).not.toContain('b1')
  })

  it('네 팀이 모두 나온다 — 표를 안 받은 팀도', () => {
    const out = tallyVotes({ votes: [] })
    expect(Object.keys(out).sort()).toEqual(['A', 'B', 'C', 'D'])
  })

})

describe('정보부장 열람', () => {
  const votes = [vote('trust', 'B'), vote('liking', 'C', { voterId: 'd1', voterTeam: 'D' })]

  it('우리 팀이 받은 표에서만 고른다', () => {
    expect(peekVoter(votes, 'B', 0)).toBe('a1')
    expect(peekVoter(votes, 'C', 0)).toBe('d1')
  })

  it('받은 표가 없으면 null이다', () => {
    expect(peekVoter(votes, 'A', 0)).toBe(null)
  })
})
