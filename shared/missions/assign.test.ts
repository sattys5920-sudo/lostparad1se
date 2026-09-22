// 배정이 규칙을 지키는지. **천 판을 돌려 본다.**
//
// 무작위 재시도라서 한 판만 보면 아무것도 모른다. 규칙이 서로
// 부딪혀서 어떤 자리 배치에서는 답이 없을 수도 있고, 그 경우 판이
// 시작되지 않는다 — 그건 게임 당일에 알면 안 되는 일이다.
import { describe, expect, it } from 'vitest'
import { assignRoles, validateDeal, type Player } from './assign'
import { ASTRAY_BRANCH, ROLE_BRANCH, ROLE_IDS, ROSTER_SIZE } from './roles'
import { STARTING_TEAM_SIZES, type TeamId } from '../rules/v2'

/** 4·4·3·3 자리에 사람을 앉힌다. */
function roster(): Player[] {
  const out: Player[] = []
  let n = 0
  for (const [team, size] of Object.entries(STARTING_TEAM_SIZES) as [TeamId, number][]) {
    for (let i = 0; i < size; i++) out.push({ id: `p${String(n++).padStart(2, '0')}`, team })
  }
  return out
}

const RUNS = 1000

describe('배정', () => {
  const people = roster()

  it('열넷에게 서로 다른 역할이 하나씩 간다', () => {
    const out = assignRoles(people, 'seed-1')
    expect(out).toHaveLength(ROSTER_SIZE)
    expect(new Set(out.map((a) => a.roleId)).size).toBe(ROSTER_SIZE)
    expect(new Set(out.map((a) => a.playerId)).size).toBe(ROSTER_SIZE)
    for (const id of ROLE_IDS) expect(out.some((a) => a.roleId === id), id).toBe(true)
  })

  it('같은 씨앗이면 같은 결과다', () => {
    const a = assignRoles(people, 'same')
    const b = assignRoles(people, 'same')
    expect(a).toEqual(b)
  })

  it('들어온 순서는 결과를 바꾸지 않는다', () => {
    const shuffledIn = [...people].reverse()
    expect(assignRoles(shuffledIn, 'order')).toEqual(assignRoles(people, 'order'))
  })

  it(`천 판 모두 규칙을 지킨다`, () => {
    for (let i = 0; i < RUNS; i++) {
      const out = assignRoles(people, `run-${i}`)
      const check = validateDeal(out)
      expect(check.ok, `${i}판: ${check.ok ? '' : check.reason}`).toBe(true)
    }
  })

  it('천 판 모두 팀마다 손 갈래를 하나 이상 받는다', () => {
    for (let i = 0; i < RUNS; i++) {
      const out = assignRoles(people, `hand-${i}`)
      for (const team of Object.keys(STARTING_TEAM_SIZES) as TeamId[]) {
        const hands = out.filter((a) => a.team === team && ROLE_BRANCH[a.roleId] === 'hand')
        expect(hands.length, `${i}판 ${team}팀`).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('천 판 모두 ★ 셋이 서로 다른 팀에 간다', () => {
    for (let i = 0; i < RUNS; i++) {
      const out = assignRoles(people, `star-${i}`)
      const teams = out.filter((a) => ROLE_BRANCH[a.roleId] === ASTRAY_BRANCH).map((a) => a.team)
      expect(teams, `${i}판`).toHaveLength(3)
      expect(new Set(teams).size, `${i}판`).toBe(3)
    }
  })

  it('천 판 모두 ★ 둘 이상이 4인 팀에 간다', () => {
    const big = new Set(
      (Object.entries(STARTING_TEAM_SIZES) as [TeamId, number][])
        .filter(([, n]) => n === Math.max(...Object.values(STARTING_TEAM_SIZES)))
        .map(([t]) => t),
    )
    for (let i = 0; i < RUNS; i++) {
      const out = assignRoles(people, `big-${i}`)
      const inBig = out
        .filter((a) => ROLE_BRANCH[a.roleId] === ASTRAY_BRANCH)
        .filter((a) => big.has(a.team)).length
      expect(inBig, `${i}판`).toBeGreaterThanOrEqual(2)
    }
  })

  it('천 판 모두 한 팀에 같은 갈래가 셋 이상 들어가지 않는다', () => {
    for (let i = 0; i < RUNS; i++) {
      const out = assignRoles(people, `branch-${i}`)
      const count = new Map<string, number>()
      for (const a of out) {
        const key = `${a.team}:${ROLE_BRANCH[a.roleId]}`
        count.set(key, (count.get(key) ?? 0) + 1)
      }
      for (const [key, n] of count) expect(n, `${i}판 ${key}`).toBeLessThanOrEqual(2)
    }
  })
})

describe('짝사랑 대상', () => {
  const people = roster()

  it('짝사랑만 대상을 갖는다', () => {
    for (let i = 0; i < 100; i++) {
      const out = assignRoles(people, `crush-${i}`)
      for (const a of out) {
        if (a.roleId === 'crush') expect(a.targetId, `${i}판`).not.toBeNull()
        else expect(a.targetId, `${i}판 ${a.roleId}`).toBeNull()
      }
    }
  })

  it('대상은 늘 다른 팀 사람이다', () => {
    for (let i = 0; i < RUNS; i++) {
      const out = assignRoles(people, `target-${i}`)
      const me = out.find((a) => a.roleId === 'crush')
      if (!me || !me.targetId) throw new Error('짝사랑이 없다')
      const target = out.find((a) => a.playerId === me.targetId)
      expect(target, `${i}판`).toBeDefined()
      expect(target?.team, `${i}판`).not.toBe(me.team)
    }
  })

  it('대상은 자기 자신이 아니다', () => {
    for (let i = 0; i < 200; i++) {
      const out = assignRoles(people, `self-${i}`)
      const me = out.find((a) => a.roleId === 'crush')
      expect(me?.targetId).not.toBe(me?.playerId)
    }
  })

  it('씨앗을 바꾸면 대상도 여러 사람으로 흩어진다', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 100; i++) {
      const out = assignRoles(people, `spread-${i}`)
      const me = out.find((a) => a.roleId === 'crush')
      if (me?.targetId) seen.add(me.targetId)
    }
    expect(seen.size).toBeGreaterThan(3)
  })
})

describe('명단 확인', () => {
  it('열넷이 아니면 거절한다', () => {
    expect(() => assignRoles(roster().slice(0, 13), 's')).toThrow()
  })

  it('같은 아이디가 두 번 들어오면 거절한다', () => {
    const bad = roster()
    bad[1] = { ...bad[1], id: bad[0].id }
    expect(() => assignRoles(bad, 's')).toThrow()
  })

  it('팀 인원이 4·4·3·3이 아니면 거절한다', () => {
    const bad = roster().map((p, i) => (i === 0 ? { ...p, team: 'D' as TeamId } : p))
    expect(() => assignRoles(bad, 's')).toThrow()
  })
})
