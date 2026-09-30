// 배정이 규칙을 지키는지. **천 판을 돌려 본다.**
//
// 무작위 재시도라서 한 판만 보면 아무것도 모른다. 규칙이 서로
// 부딪혀서 어떤 자리 배치에서는 답이 없을 수도 있고, 그 경우 판이
// 시작되지 않는다 — 그건 게임 당일에 알면 안 되는 일이다.
import { describe, expect, it } from 'vitest'
import { assignRoles, validateDeal, type Player } from './assign'
import { ROLE_IDS, ROSTER_SIZE } from './roles'
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

  it(`천 판 모두 열넷에게 한 역할씩이다`, () => {
    for (let i = 0; i < RUNS; i++) {
      const out = assignRoles(people, `run-${i}`)
      const check = validateDeal(out)
      expect(check.ok, `${i}판: ${check.ok ? '' : check.reason}`).toBe(true)
    }
  })
})

describe('짝사랑 대상', () => {
  const people = roster()

  it('배정 시점에는 아무도 대상을 갖지 않는다 — 매일 밤 운영자가 정한다', () => {
    for (let i = 0; i < 100; i++) {
      const out = assignRoles(people, `crush-${i}`)
      for (const a of out) expect(a.targetId, `${i}판 ${a.roleId}`).toBeNull()
    }
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
