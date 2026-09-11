// 표와 영향력 — 보정 순서와 익명.
import { describe, expect, it } from 'vitest'
import { applyInfluence, canCast, peekVoter, rumorDecay, tallyVotes, voteInfluence, type Vote } from './votes'
import { RUMOR_DECAY, RUMOR_DECAY_DAY, type TeamId, type VoteKind } from './v2'

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

const has = (team: TeamId) => (t: TeamId) => t === team

describe('던질 수 있는가', () => {
  const base = {
    voterId: 'a1',
    voterTeam: 'A' as TeamId,
    targetId: 'b1',
    targetTeam: 'B' as TeamId,
    atMs: seoul('2026-03-02T10:00:00'),
    votedToday: false,
  }

  it('08:00부터 21:00까지다', () => {
    expect(canCast({ ...base, atMs: seoul('2026-03-02T08:00:00') }).ok).toBe(true)
    expect(canCast({ ...base, atMs: seoul('2026-03-02T20:59:59') }).ok).toBe(true)
    expect(canCast({ ...base, atMs: seoul('2026-03-02T21:00:00') }).reason).toBe('closed')
    expect(canCast({ ...base, atMs: seoul('2026-03-02T07:59:59') }).reason).toBe('closed')
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

describe('표 한 장의 값', () => {
  it('신뢰 +2, 호감 +1, 의심 −2', () => {
    expect(voteInfluence(vote('trust', 'B'))).toBe(2)
    expect(voteInfluence(vote('liking', 'B'))).toBe(1)
    expect(voteInfluence(vote('suspicion', 'B'))).toBe(-2)
  })

  it('방송국이 있으면 신뢰 +3, 호감 +2', () => {
    const opt = { hasBroadcast: has('B') }
    expect(voteInfluence(vote('trust', 'B'), opt)).toBe(3)
    expect(voteInfluence(vote('liking', 'B'), opt)).toBe(2)
    // 다른 팀 것이면 그대로다
    expect(voteInfluence(vote('trust', 'C'), opt)).toBe(2)
  })

  it('방송국은 의심에 영향을 주지 않는다', () => {
    expect(voteInfluence(vote('suspicion', 'B'), { hasBroadcast: has('B') })).toBe(-2)
  })

  it('비밀기지가 있으면 −1로 완화된다', () => {
    expect(voteInfluence(vote('suspicion', 'B'), { hasHideout: has('B') })).toBe(-1)
  })

  it('정확히 짚으면 −4다', () => {
    expect(voteInfluence(vote('suspicion', 'B', { exactHit: true }))).toBe(-4)
  })

  it('주목받는 팀은 1 더 맞는다', () => {
    expect(voteInfluence(vote('suspicion', 'B'), { spotlighted: 'B' })).toBe(-3)
  })

  it('배수는 기본값에만 건다', () => {
    // −2 ×2 = −4, 주목 +1 해서 −5. 배수를 나중에 걸었다면 −6이다
    expect(voteInfluence(vote('suspicion', 'B', { exactHit: true }), { spotlighted: 'B' })).toBe(-5)
  })

  it('주목과 비밀기지는 서로 지운다', () => {
    expect(
      voteInfluence(vote('suspicion', 'B'), { spotlighted: 'B', hasHideout: has('B') }),
    ).toBe(-2)
  })

  it('타격이 0 밑으로 뒤집히지 않는다', () => {
    // 비밀기지만 있고 배수도 주목도 없으면 −1이 바닥이다
    expect(voteInfluence(vote('suspicion', 'B'), { hasHideout: has('B') })).toBeLessThan(0)
  })
})

describe('합계', () => {
  it('받은 표 수와 영향력 변화를 팀별로 낸다', () => {
    const out = tallyVotes({
      votes: [vote('trust', 'B'), vote('trust', 'B', { voterId: 'c1', voterTeam: 'C' }), vote('liking', 'C')],
    })
    expect(out.B.received.trust).toBe(2)
    expect(out.B.delta).toBe(4)
    expect(out.C.delta).toBe(1)
    expect(out.A.delta).toBe(0)
  })

  it('의심은 던진 팀도 1 잃는다', () => {
    const out = tallyVotes({ votes: [vote('suspicion', 'B')] })
    expect(out.B.delta).toBe(-2)
    expect(out.A.delta).toBe(-1)
  })

  it('합계에는 보낸 사람이 들어 있지 않다', () => {
    const out = tallyVotes({ votes: [vote('trust', 'B'), vote('suspicion', 'C')] })
    const text = JSON.stringify(out)
    expect(text).not.toContain('a1')
    expect(text).not.toContain('voterId')
    expect(text).not.toContain('b1')
  })

  it('네 팀이 모두 나온다 — 표를 안 받은 팀도', () => {
    const out = tallyVotes({ votes: [] })
    expect(Object.keys(out).sort()).toEqual(['A', 'B', 'C', 'D'])
  })

  it('영향력은 0 아래로 내려가지 않는다', () => {
    expect(applyInfluence(1, -5)).toBe(0)
    expect(applyInfluence(5, -2)).toBe(3)
  })
})

describe('소문', () => {
  it('옮겨진 횟수만큼 깎는다 — 처음 꺼낸 사람은 값을 안 치른다', () => {
    expect(rumorDecay(0, 1)).toBe(0)
    expect(rumorDecay(3, 1)).toBe(3 * RUMOR_DECAY)
  })

  it('DAY 2에는 두 배다', () => {
    expect(rumorDecay(3, RUMOR_DECAY_DAY)).toBe(6)
    expect(rumorDecay(3, RUMOR_DECAY_DAY + 1)).toBe(3)
  })
})

describe('정보부장 열람', () => {
  const votes = [vote('trust', 'B'), vote('suspicion', 'C', { voterId: 'd1', voterTeam: 'D' })]

  it('우리 팀이 받은 표에서만 고른다', () => {
    expect(peekVoter(votes, 'B', 0)).toBe('a1')
    expect(peekVoter(votes, 'C', 0)).toBe('d1')
  })

  it('받은 표가 없으면 null이다', () => {
    expect(peekVoter(votes, 'A', 0)).toBe(null)
  })
})
