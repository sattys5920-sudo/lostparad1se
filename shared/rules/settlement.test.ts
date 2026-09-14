// 하루 정산 — 투명인간이 제대로 정해지는가, 표 수가 새지 않는가.
import { describe, expect, it } from 'vitest'
import { settleDay, settlementView } from './settlement'
import type { ScoreBreakdown } from './score'
import type { Ballot } from './invisible'
import type { TeamId } from './v2'

const row = (team: TeamId, total: number): ScoreBreakdown => ({
  team, territory: total, connection: 0, core: 0, resource: 0, development: 0, goals: 0, total,
})

const SCORES = [row('A', 30), row('B', 20), row('C', 10), row('D', 5)]

/** 투명인간 투표 한 장. 신뢰·호감 표와는 다른 것이다. */
const at = (voterId: string, targetId: string): Ballot => ({ voterId, targetId, atMs: 0 })

describe('하루 정산', () => {
  const base = { scores: SCORES, knowledgeOf: () => 0 }

  it('순위·주목·만회는 그대로 나온다', () => {
    const out = settleDay({ ...base, ballots: [] })
    expect(out.spotlighted).toBe('A')
    expect(out.comeback).toBe('D')
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
    expect(out.invisible.reason).toBe('tooFew')
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

describe('화면에 내려보내는 것', () => {
  it('투표에 관해 나가는 것은 투명인간 하나뿐이다', () => {
    const out = settleDay({
      scores: SCORES,
      knowledgeOf: () => 0,
      ballots: [at('a1', 'b1'), at('a2', 'b1'), at('a3', 'c1')],
    })
    const view = settlementView(out)
    expect(view.invisibleId).toBe('b1')

    const text = JSON.stringify(view)
    // 적은 사람도, 몇 장 받았는지도 들어 있지 않다
    expect(text).not.toContain('a1')
    expect(text).not.toContain('voterId')
    expect(text).not.toContain('count')
    expect(text).not.toContain('c1')
  })

  it('아무도 지워지지 않은 날도 그대로 알린다', () => {
    const view = settlementView(settleDay({ scores: SCORES, knowledgeOf: () => 0, ballots: [] }))
    expect(view.invisibleId).toBe(null)
  })
})
