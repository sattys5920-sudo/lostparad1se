// 21:00 정산 — 투명인간이 표 반영 뒤에 정해지는가, 표 수가 새지 않는가.
import { describe, expect, it } from 'vitest'
import { settleDay, settlementView, suspicionCounts } from './settlement'
import type { ScoreBreakdown } from './score'
import type { Vote } from './votes'
import type { TeamId, VoteKind } from './v2'

const row = (team: TeamId, total: number): ScoreBreakdown => ({
  team, territory: total, connection: 0, core: 0, resource: 0, development: 0, goals: 0, total,
})

const SCORES = [row('A', 30), row('B', 20), row('C', 10), row('D', 5)]

const vote = (voterId: string, targetId: string, kind: VoteKind): Vote => ({
  voterId,
  voterTeam: 'A',
  targetId,
  targetTeam: 'B',
  kind,
  atMs: 0,
})

describe('의심표 세기', () => {
  it('받은 사람별로 센다', () => {
    const out = suspicionCounts([
      vote('a1', 'b1', 'suspicion'),
      vote('a2', 'b1', 'suspicion'),
      vote('a3', 'c1', 'suspicion'),
      vote('a4', 'b1', 'trust'),
    ])
    expect(out.sort((x, y) => x.playerId.localeCompare(y.playerId))).toEqual([
      { playerId: 'b1', count: 2 },
      { playerId: 'c1', count: 1 },
    ])
  })

  it('의심이 아닌 표는 세지 않는다', () => {
    expect(suspicionCounts([vote('a1', 'b1', 'trust'), vote('a2', 'b1', 'liking')])).toEqual([])
  })
})

describe('하루 정산', () => {
  const base = { scores: SCORES, influenceOf: () => 0 }

  it('순위·주목·만회는 그대로 나온다', () => {
    const out = settleDay({ ...base, votes: [] })
    expect(out.spotlighted).toBe('A')
    expect(out.comeback).toBe('D')
    expect(out.ranked).toHaveLength(4)
  })

  it('두 장 이상 받은 사람이 하나면 그 사람이다', () => {
    const out = settleDay({
      ...base,
      votes: [vote('a1', 'b1', 'suspicion'), vote('a2', 'b1', 'suspicion')],
    })
    expect(out.invisible.playerId).toBe('b1')
  })

  it('갈리면 아무도 지워지지 않는다', () => {
    const out = settleDay({
      ...base,
      votes: [
        vote('a1', 'b1', 'suspicion'), vote('a2', 'b1', 'suspicion'),
        vote('a3', 'c1', 'suspicion'), vote('a4', 'c1', 'suspicion'),
      ],
    })
    expect(out.invisible.playerId).toBe(null)
    expect(out.invisible.reason).toBe('tie')
  })

  it('어제 그 사람이면 넘어간다', () => {
    const out = settleDay({
      ...base,
      votes: [vote('a1', 'b1', 'suspicion'), vote('a2', 'b1', 'suspicion')],
      yesterdayInvisibleId: 'b1',
    })
    expect(out.invisible.playerId).toBe(null)
    expect(out.invisible.reason).toBe('repeat')
  })
})

describe('화면에 내려보내는 것', () => {
  it('표에 관해 나가는 것은 투명인간 하나뿐이다', () => {
    const out = settleDay({
      scores: SCORES,
      influenceOf: () => 0,
      votes: [vote('a1', 'b1', 'suspicion'), vote('a2', 'b1', 'suspicion'), vote('a3', 'c1', 'suspicion')],
    })
    const view = settlementView(out)
    expect(view.invisibleId).toBe('b1')

    const text = JSON.stringify(view)
    // 보낸 사람도, 받은 표 수도 들어 있지 않다
    expect(text).not.toContain('a1')
    expect(text).not.toContain('voterId')
    expect(text).not.toContain('count')
    expect(text).not.toContain('c1')
  })

  it('아무도 지워지지 않은 날도 그대로 알린다', () => {
    const view = settlementView(settleDay({ scores: SCORES, influenceOf: () => 0, votes: [] }))
    expect(view.invisibleId).toBe(null)
  })
})
