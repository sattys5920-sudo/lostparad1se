// 하루 정산 — 투명인간이 제대로 정해지는가, 표 수가 새지 않는가.
import { describe, expect, it } from 'vitest'
import { settleDay } from './settlement'
import type { ScoreBreakdown } from './score'
import type { Ballot } from './invisible'
import type { TeamId } from './v2'

const row = (team: TeamId, total: number): ScoreBreakdown => ({ team, territory: total, total })

const SCORES = [row('A', 30), row('B', 20), row('C', 10), row('D', 5)]

/** 투명인간 투표 한 장. 신뢰·호감 표와는 다른 것이다. */
const at = (voterId: string, targetId: string): Ballot => ({ voterId, targetId, atMs: 0 })

describe('하루 정산', () => {
  const base = { scores: SCORES }

  it('순위·주목·만회는 그대로 나온다', () => {
    const out = settleDay({ ...base, ballots: [] })
    expect(out.spotlighted).toEqual(['A'])
    expect(out.comeback).toEqual(['D'])
    expect(out.ranked).toHaveLength(4)
  })

  it('한 장만 받아도 최다면 그 사람이다', () => {
    const out = settleDay({ ...base, ballots: [at('a1', 'b1')] })
    expect(out.invisible.playerId).toBe('b1')
  })

  it('갈리면 아무도 지워지지 않는다', () => {
    // 누군가를 지우려면 여러 사람이 같은 이름을 적어야 한다
    const out = settleDay({ ...base, ballots: [at('a1', 'b1'), at('a2', 'c1')] })
    expect(out.invisible.playerId).toBe(null)
    expect(out.invisible.reason).toBe('tie')
  })

  it('아무도 안 적으면 아무도 아니다', () => {
    const out = settleDay({ ...base, ballots: [] })
    expect(out.invisible.playerId).toBe(null)
    expect(out.invisible.reason).toBe('none')
  })

  it('어제 그 사람이면 넘어간다', () => {
    const out = settleDay({
      ...base,
      ballots: [at('a1', 'b1'), at('a2', 'b1')],
      yesterdayInvisibleId: 'b1',
    })
    expect(out.invisible.playerId).toBe(null)
    expect(out.invisible.reason).toBe('repeat')
  })
})

