// 배정 — 천 번 돌려도 규칙이 깨지지 않는지 본다.
//
// 한 번 배정하면 판이 끝날 때까지 바뀌지 않는다. 그래서 여기서 나온
// 잘못은 고칠 기회가 없다 — 고리가 갈라지거나, 한 팀이 팀의 길을 두 개
// 받거나, 누군가 아무에게도 지목되지 않는 일이 한 번이라도 있으면 안 된다.
import { describe, expect, it } from 'vitest'
import { assignRoles, ownAssignment, rngFrom, type Player } from './assign'
import { FILLER_PATH, REQUIRED_PATHS, ROLE_BY_ID, validateBondRing } from './roles'
import { TEAM_SIZES, type TeamId } from '../rules/v2'

/** 열네 명. 팀 크기는 4·4·3·3이다. */
const ROSTER: Player[] = (Object.entries(TEAM_SIZES) as [TeamId, number][]).flatMap(([team, n]) =>
  Array.from({ length: n }, (_, i) => ({ id: `${team.toLowerCase()}${i + 1}`, team })),
)

const teamOf = (id: string) => ROSTER.find((p) => p.id === id)!.team

describe('명단 확인', () => {
  it('열네 명이 아니면 막는다', () => {
    expect(() => assignRoles(ROSTER.slice(0, 13), 's')).toThrow()
  })

  it('팀 인원이 맞지 않으면 막는다', () => {
    const bad = ROSTER.map((p, i) => (i === 0 ? { ...p, team: 'B' as TeamId } : p))
    expect(() => assignRoles(bad, 's')).toThrow()
  })

  it('아이디가 겹치면 막는다', () => {
    const bad = [...ROSTER.slice(0, 13), { ...ROSTER[13], id: ROSTER[0].id }]
    expect(() => assignRoles(bad, 's')).toThrow()
  })
})

describe('재현', () => {
  it('같은 씨앗이면 같은 결과다', () => {
    expect(assignRoles(ROSTER, 'seed-1')).toEqual(assignRoles(ROSTER, 'seed-1'))
  })

  it('씨앗이 다르면 대체로 다른 결과다', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 20; i++) seen.add(JSON.stringify(assignRoles(ROSTER, `seed-${i}`)))
    expect(seen.size).toBeGreaterThan(10)
  })

  it('들어온 순서는 결과를 바꾸지 않는다', () => {
    const backwards = [...ROSTER].reverse()
    expect(assignRoles(backwards, 'seed-1')).toEqual(assignRoles(ROSTER, 'seed-1'))
  })

  it('난수는 0 이상 1 미만이다', () => {
    const rnd = rngFrom('x')
    for (let i = 0; i < 1000; i++) {
      const v = rnd()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('천 번 돌려 보기', () => {
  const runs = Array.from({ length: 1000 }, (_, i) => assignRoles(ROSTER, `run-${i}`))

  it('언제나 열네 줄이고 역할이 겹치지 않는다', () => {
    for (const out of runs) {
      expect(out).toHaveLength(14)
      expect(new Set(out.map((a) => a.roleId)).size).toBe(14)
      expect(new Set(out.map((a) => a.playerId)).size).toBe(14)
    }
  })

  it('팀마다 팀의 길 하나와 밖의 길 하나를 받는다', () => {
    for (const out of runs) {
      for (const team of Object.keys(TEAM_SIZES) as TeamId[]) {
        const paths = out.filter((a) => a.team === team).map((a) => ROLE_BY_ID[a.roleId].path)
        for (const required of REQUIRED_PATHS) {
          expect(paths.filter((p) => p === required)).toHaveLength(1)
        }
        expect(paths.filter((p) => p === FILLER_PATH)).toHaveLength(TEAM_SIZES[team] - 2)
      }
    }
  })

  it('인연 고리가 언제나 규칙을 지킨다', () => {
    for (const out of runs) {
      const ring = out.map((a) => ({ playerId: a.playerId, bondId: a.bondId }))
      expect(validateBondRing(ring, teamOf)).toEqual({ ok: true })
    }
  })

  it('자기 팀 사람을 인연으로 받지 않는다', () => {
    for (const out of runs) {
      for (const a of out) expect(teamOf(a.bondId)).not.toBe(a.team)
    }
  })

  it('열네 역할이 모두 어느 팀에든 갈 수 있다', () => {
    // 갈래 배분 때문에 특정 역할이 특정 팀에 묶여 버리면 안 된다
    const seen = new Map<string, Set<TeamId>>()
    for (const out of runs) {
      for (const a of out) {
        if (!seen.has(a.roleId)) seen.set(a.roleId, new Set())
        seen.get(a.roleId)!.add(a.team)
      }
    }
    expect(seen.size).toBe(14)
    for (const [roleId, teams] of seen) expect(teams.size, roleId).toBe(4)
  })

  it('누구든 누구의 인연도 될 수 있다', () => {
    // 같은 사람이 늘 같은 사람을 받으면 씨앗이 제대로 안 돌고 있는 것이다
    const targets = new Set<string>()
    for (const out of runs) targets.add(out.find((a) => a.playerId === 'a1')!.bondId)
    // a1은 A팀이니 나머지 열 명 전부가 후보다
    expect(targets.size).toBe(10)
  })
})

describe('내 것만 꺼내기', () => {
  it('자기 줄을 돌려준다', () => {
    const all = assignRoles(ROSTER, 'seed-1')
    const mine = ownAssignment(all, 'a1')
    expect(mine?.playerId).toBe('a1')
  })

  it('없는 사람이면 null이다', () => {
    expect(ownAssignment(assignRoles(ROSTER, 'seed-1'), 'nobody')).toBe(null)
  })
})
