// 역할 데이터가 기준 문서와 맞는지 본다.
//
// 판정 엔진은 4단계에서 붙는다. 여기서는 데이터 자체가 어긋나 있지
// 않은지만 확인한다 — 역할 수, 갈래 배분, 힌트 일정, 진행도 공개 정책,
// 엔딩 자리, 인연 고리 규칙.
import { describe, expect, it } from 'vitest'
import {
  BOND_RING_SIZE,
  DAY4_CHOICES,
  ENDING_BANDS,
  ENDING_PLACEHOLDER,
  ENDING_TEXT,
  HINT_SCHEDULE,
  MAX_PERSONAL_SCORE,
  NEVER_HINTED,
  ROLES,
  ROLES_BY_PATH,
  ROLE_BY_ID,
  ROLE_IDS,
  endingBandOf,
  validateBondRing,
  type BondAssignment,
} from './roles'
import { TEAM_SIZES, type TeamId } from '../rules/v2'

describe('역할 14종', () => {
  it('열네 개다', () => {
    expect(ROLES).toHaveLength(14)
    expect(new Set(ROLE_IDS).size).toBe(14)
  })

  it('갈래가 4·6·4다', () => {
    expect(ROLES_BY_PATH.team).toHaveLength(4)
    expect(ROLES_BY_PATH.people).toHaveLength(6)
    expect(ROLES_BY_PATH.outside).toHaveLength(4)
  })

  it('팀마다 팀의 길 하나와 밖의 길 하나를 줄 수 있다', () => {
    // 네 팀에 하나씩 돌아가야 하므로 각 갈래가 정확히 4개여야 한다
    expect(ROLES_BY_PATH.team).toHaveLength(4)
    expect(ROLES_BY_PATH.outside).toHaveLength(4)
    // 남은 자리를 사람의 길로 채운다
    const total = Object.values(TEAM_SIZES).reduce((a, b) => a + b, 0)
    expect(total).toBe(14)
    expect(total - 4 - 4).toBe(ROLES_BY_PATH.people.length)
  })

  it('모두 서사·숨긴 사실·주 미션·인연 미션을 갖는다', () => {
    for (const r of ROLES) {
      expect(r.flavor.length).toBeGreaterThan(0)
      expect(r.secret.length).toBeGreaterThan(0)
      expect(r.main.clauses.length).toBeGreaterThan(0)
      expect(r.bond.clauses.length).toBeGreaterThan(0)
      expect(r.main.text.length).toBeGreaterThan(0)
      expect(r.bond.text.length).toBeGreaterThan(0)
    }
  })

  it('모든 조항에 기준이 있다', () => {
    for (const r of ROLES) {
      for (const c of [...r.main.clauses, ...r.bond.clauses]) {
        const hasBar =
          c.need !== undefined ||
          c.limit !== undefined ||
          c.hours !== undefined ||
          c.day !== undefined ||
          c.days !== undefined ||
          // 기준치가 없는 것은 「했다/안 했다」로 갈리는 조항이다
          ['teamNeverLostTile', 'neverRevealed', 'neverSpentLeverage', 'noSuspicionCast',
           'holdLeverageOnBondAtEnd', 'teamRankNotFirst', 'bondTeamRankHigher',
           'alliedWithBondAtEnd', 'bondPrivateRevealToMe', 'privateRevealToBond'].includes(c.kind)
        expect(hasBar, `${r.id} · ${c.kind}`).toBe(true)
      }
    }
  })
})

describe('A의 기록이 가리키는 역할', () => {
  it('닷새 동안 두 명씩, 열 명을 가리킨다', () => {
    const hinted = Object.values(HINT_SCHEDULE).flat()
    expect(hinted).toHaveLength(10)
    expect(new Set(hinted).size).toBe(10)
    for (const day of [1, 2, 3, 4, 5]) expect(HINT_SCHEDULE[day]).toHaveLength(2)
  })

  it('가리켜지지 않는 넷은 지킴이·수첩·중재자·전학생이다', () => {
    expect([...NEVER_HINTED].sort()).toEqual(['guard', 'mediator', 'notebook', 'transfer'])
  })

  it('역할의 hintDay와 일정표가 서로 맞는다', () => {
    for (const r of ROLES) {
      if (r.hintDay === null) {
        expect(NEVER_HINTED).toContain(r.id)
      } else {
        expect(HINT_SCHEDULE[r.hintDay]).toContain(r.id)
      }
    }
  })
})

describe('진행도 공개 정책', () => {
  it('받은 표에 걸린 조항은 실시간으로 보여 주지 않는다', () => {
    const received = ['trustReceived', 'suspicionReceivedAtMost', 'suspicionAfterRevealAtMost']
    for (const r of ROLES) {
      for (const c of [...r.main.clauses, ...r.bond.clauses]) {
        if (received.includes(c.kind)) {
          expect(c.disclosure, `${r.id} · ${c.kind}`).toBe('settlement')
        }
      }
    }
  })

  it('보낸 사람이 특정되는 조항은 끝에만 판정한다', () => {
    // 인연 대상에게서 받았는지를 실시간으로 보여 주면 익명 표가 무너진다
    const traceable = ['voteReceivedFromBond', 'trustReceivedFromBond', 'bondSuspicionReceivedAtMost']
    for (const r of ROLES) {
      for (const c of [...r.main.clauses, ...r.bond.clauses]) {
        if (traceable.includes(c.kind)) {
          expect(c.disclosure, `${r.id} · ${c.kind}`).toBe('endOnly')
        }
      }
    }
  })

  it('고발자의 적중·헛짚음은 끝까지 숨긴다', () => {
    for (const c of ROLE_BY_ID.accuser.main.clauses) {
      expect(c.disclosure).toBe('hidden')
    }
  })

  it('순위·종료 소유·동맹은 끝날 때 판정이다', () => {
    const atEnd = ['teamRankNotFirst', 'bondTeamRankHigher', 'alliedWithBondAtEnd',
                   'ownFragmentTilesAtEnd', 'holdLeverageOnBondAtEnd']
    for (const r of ROLES) {
      for (const c of [...r.main.clauses, ...r.bond.clauses]) {
        if (atEnd.includes(c.kind)) {
          expect(c.disclosure, `${r.id} · ${c.kind}`).toBe('endOnly')
        }
      }
    }
  })

  it('뒤집힐 수 있는 조항에는 실패 확정을 붙이지 않는다', () => {
    // 목격자의 「털어놓은 뒤 의심표 1장 이하」는 마지막까지 모른다
    const clause = ROLE_BY_ID.witness.main.clauses.find((c) => c.kind === 'suspicionAfterRevealAtMost')
    expect(clause?.failsOnBreak).toBeUndefined()
  })

  it('되돌릴 수 없는 조항에만 실패 확정을 붙였다', () => {
    const definite = ROLES.flatMap((r) =>
      [...r.main.clauses, ...r.bond.clauses].filter((c) => c.failsOnBreak).map((c) => c.kind),
    )
    expect([...new Set(definite)].sort()).toEqual(
      ['neverRevealed', 'neverSpentLeverage', 'noRevealUntilDay', 'noSuspicionCast'].sort(),
    )
  })
})

describe('점수와 엔딩', () => {
  it('최대 9점이다', () => {
    expect(MAX_PERSONAL_SCORE).toBe(9)
  })

  it('DAY 4 선택은 셋이다', () => {
    expect(DAY4_CHOICES).toHaveLength(3)
  })

  it('구간이 0~9를 빈틈없이 덮는다', () => {
    for (let s = 0; s <= MAX_PERSONAL_SCORE; s++) {
      const band = endingBandOf(s)
      expect(s >= band.min && s <= band.max, `${s}점`).toBe(true)
    }
    expect(endingBandOf(9).id).toBe('stayed')
    expect(endingBandOf(7).id).toBe('stayed')
    expect(endingBandOf(6).id).toBe('passed')
    expect(endingBandOf(4).id).toBe('passed')
    expect(endingBandOf(3).id).toBe('left')
    expect(endingBandOf(0).id).toBe('left')
  })

  it('엔딩 자리가 42개다', () => {
    let slots = 0
    for (const id of ROLE_IDS) {
      for (const b of ENDING_BANDS) {
        expect(ENDING_TEXT[id][b.id]).toBe(ENDING_PLACEHOLDER)
        slots++
      }
    }
    expect(slots).toBe(42)
  })
})

describe('인연 고리', () => {
  const teams: TeamId[] = ['A', 'A', 'A', 'A', 'B', 'B', 'B', 'B', 'C', 'C', 'C', 'D', 'D', 'D']
  const ids = teams.map((_, i) => `p${i}`)
  const teamOf = (id: string) => teams[ids.indexOf(id)]

  /** 이웃이 서로 다른 팀이 되도록 섞은 고리 하나. */
  function ringFrom(order: string[]): BondAssignment[] {
    return order.map((p, i) => ({ playerId: p, bondId: order[(i + 1) % order.length] }))
  }

  // A A A A B B B B C C C D D D 를 팀이 겹치지 않게 늘어놓는다
  const order = ['p0', 'p4', 'p1', 'p5', 'p2', 'p6', 'p3', 'p7', 'p8', 'p11', 'p9', 'p12', 'p10', 'p13']

  it('제대로 된 고리는 통과한다', () => {
    const ring = ringFrom(order)
    expect(ring).toHaveLength(BOND_RING_SIZE)
    expect(validateBondRing(ring, teamOf)).toEqual({ ok: true })
  })

  it('같은 팀끼리 이어지면 막는다', () => {
    // p0(A) 다음에 p1(A)이 오게 뒤집는다
    const bad = ringFrom(['p0', 'p1', 'p4', 'p5', 'p2', 'p6', 'p3', 'p7', 'p8', 'p11', 'p9', 'p12', 'p10', 'p13'])
    const out = validateBondRing(bad, teamOf)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toContain('같은 팀')
  })

  it('자기 자신을 받으면 막는다', () => {
    const bad = ringFrom(order)
    bad[0] = { playerId: 'p0', bondId: 'p0' }
    const out = validateBondRing(bad, teamOf)
    expect(out.ok).toBe(false)
  })

  it('작은 고리 두 개로 갈라지면 막는다', () => {
    // 팀 규칙은 지키면서 일곱씩 두 고리로만 갈라 둔다.
    // 그래야 「같은 팀」이 아니라 「갈라짐」에서 걸리는 걸 확인할 수 있다.
    const half1 = ['p0', 'p4', 'p1', 'p5', 'p2', 'p8', 'p6']
    const half2 = ['p9', 'p11', 'p10', 'p12', 'p3', 'p13', 'p7']
    const bad = [...ringFrom(half1), ...ringFrom(half2)]
    // 이웃은 전부 다른 팀이다 — 오직 갈라진 것만 문제다
    for (const b of bad) expect(teamOf(b.playerId)).not.toBe(teamOf(b.bondId))
    const out = validateBondRing(bad, teamOf)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toContain('고리')
  })

  it('누군가 두 번 지목되면 막는다', () => {
    const bad = ringFrom(order)
    bad[1] = { playerId: bad[1].playerId, bondId: bad[0].bondId }
    const out = validateBondRing(bad, teamOf)
    expect(out.ok).toBe(false)
  })

  it('열네 명이 아니면 막는다', () => {
    const out = validateBondRing(ringFrom(order).slice(0, 13), teamOf)
    expect(out.ok).toBe(false)
  })
})
