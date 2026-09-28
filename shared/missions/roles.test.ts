// 역할 데이터가 문서와 어긋나지 않는지 본다.
//
// 조건 수치는 데이터에만 있다. 여기서 수치를 확인하는 것은 **문서와
// 맞는지**를 보려는 것이지 판정을 보려는 것이 아니다 — 판정은
// judge.test.ts 가 본다. 그래서 수치를 시험에 적지 않고 문서를 직접 읽어
// 맞대어 본다.
import { describe, expect, it } from 'vitest'
import {
  ASSIGN_RULES,
  BRANCHES,
  BRANCH_COUNT,
  DAY4_CHOICES,
  ROLES,
  ROLE_BRANCH,
  ROLE_BY_ID,
  ROLE_IDS,
  ROLE_NAMES,
  ROSTER_SIZE,
  STATUS_LABEL,
} from './roles'
import { REVEAL, barOf, parseRolesMd } from '../../scripts/lib/rolesMd'

describe('역할 열넷', () => {
  it('열네 종류다', () => {
    expect(ROLES).toHaveLength(ROSTER_SIZE)
    expect(ROLE_IDS).toHaveLength(ROSTER_SIZE)
  })

  it('아이디가 겹치지 않는다', () => {
    expect(new Set(ROLES.map((r) => r.id)).size).toBe(ROSTER_SIZE)
  })

  it('이름이 겹치지 않는다', () => {
    expect(new Set(Object.values(ROLE_NAMES)).size).toBe(ROSTER_SIZE)
  })

  it('모두 한 줄 소개와 미션 문장을 갖는다', () => {
    for (const r of ROLES) {
      expect(r.flavor.length, r.id).toBeGreaterThan(0)
      expect(r.main.text.length, r.id).toBeGreaterThan(0)
      expect(r.main.clauses.length, r.id).toBeGreaterThan(0)
    }
  })

  it('ROLE_BY_ID 가 전부 채워져 있다', () => {
    for (const id of ROLE_IDS) expect(ROLE_BY_ID[id].id).toBe(id)
  })
})

describe('네 갈래', () => {
  it('문서의 배정 표와 인원이 같다 — 3·3·5·3', () => {
    for (const b of BRANCHES) {
      const got = ROLE_IDS.filter((id) => ROLE_BRANCH[id] === b).length
      expect(got, b).toBe(BRANCH_COUNT[b])
    }
  })

  it('갈래 인원을 합치면 열넷이다', () => {
    expect(BRANCHES.reduce((n, b) => n + BRANCH_COUNT[b], 0)).toBe(ROSTER_SIZE)
  })

  it('★ 는 셋이다', () => {
    expect(ROLE_IDS.filter((id) => ROLE_BRANCH[id] === 'astray')).toHaveLength(3)
  })
})

describe('조건 수치', () => {
  // 판정 로직에 숫자를 쓰지 않으려면 조항마다 기준치가 있어야 한다.
  // 하나라도 비면 엔진이 1로 떨어져 조용히 쉬워진다
  it('모든 조항이 기준치를 갖는다 — 깃발 조항만 뺀다', () => {
    const flagKinds = new Set(['teamNotFirstAtEnd'])
    for (const r of ROLES) {
      for (const c of r.main.clauses) {
        if (flagKinds.has(c.kind)) continue
        const bar = c.need ?? c.limit ?? c.minutes
        expect(bar, `${r.id} · ${c.kind}`).toBeDefined()
        expect(bar, `${r.id} · ${c.kind}`).toBeGreaterThan(0)
      }
    }
  })

  // 「우리 팀이 1위가 아님」의 1위는 조절할 수치가 아니라 조건 자체다.
  // 기준치가 붙은 조항만 본다 — 그쪽이 난이도를 고칠 때 어긋난다
  it('기준치가 있는 조항은 문구에 숫자를 박아 두지 않는다', () => {
    for (const r of ROLES) {
      for (const c of r.main.clauses) {
        if (c.need === undefined && c.limit === undefined && c.minutes === undefined) continue
        expect(/[0-9]/.test(c.text), `${r.id} · ${c.text}`).toBe(false)
      }
    }
  })

  // 기준 문서(docs/roles_full.md)를 직접 읽어 맞대어 본다. 수치를 시험에
  // 박아 두면 문서와 데이터를 같이 고쳤을 때 시험만 옛 값에 남는다
  const { roles: mdRoles } = parseRolesMd()

  /** 문서 한 줄의 기준. 「같은 방에 1분 이상 …」처럼 말 안에 박힌 분도 minutes 로 읽는다 */
  const wantOf = (counts: string, bar: string) => {
    const want = barOf(bar)
    const inner = counts.match(/(\d+)분 이상/)
    return inner && want.minutes === undefined ? { ...want, minutes: Number(inner[1]) } : want
  }

  it('문서의 열네 역할이 다 있다', () => {
    expect(mdRoles).toHaveLength(ROSTER_SIZE)
    for (const m of mdRoles) expect(ROLES.find((r) => r.name === m.name), m.name).toBeDefined()
  })

  it('문서가 정한 수치 그대로다', () => {
    for (const m of mdRoles) {
      const r = ROLES.find((x) => x.name === m.name)
      if (!r) continue
      expect(r.main.clauses.length, `${m.name} 조항 수`).toBe(m.clauses.length)
      m.clauses.forEach((mc, i) => {
        const c = r.main.clauses[i]
        const want = wantOf(mc.counts, mc.bar)
        expect(c.need, `${m.name} · ${mc.counts} 이상`).toBe(want.need)
        expect(c.limit, `${m.name} · ${mc.counts} 이하`).toBe(want.limit)
      })
    }
  })

  it('시간 조건도 문서 그대로다 — 분 단위', () => {
    for (const m of mdRoles) {
      const r = ROLES.find((x) => x.name === m.name)
      if (!r) continue
      m.clauses.forEach((mc, i) => {
        expect(r.main.clauses[i].minutes, `${m.name} · ${mc.counts}`).toBe(wantOf(mc.counts, mc.bar).minutes)
      })
    }
  })

  it('공개 시점도 문서 그대로다', () => {
    for (const m of mdRoles) {
      const r = ROLES.find((x) => x.name === m.name)
      if (!r) continue
      m.clauses.forEach((mc, i) => {
        expect(r.main.clauses[i].disclosure, `${m.name} · ${mc.counts}`).toBe(REVEAL[mc.reveal])
      })
    }
  })

})

describe('마지막 선택', () => {
  it('셋이다', () => {
    expect(DAY4_CHOICES).toHaveLength(3)
  })

  it('세 번째 줄은 중요한 사람의 팀이 1위다', () => {
    expect(DAY4_CHOICES[2].id).toBe('chosen')
    expect(DAY4_CHOICES[2].text).toBe('중요한 사람의 팀이 1위')
  })
})

describe('진행도 상태', () => {
  it('네 가지다 — 진행 중 · 달성 · 실패 · 끝날 때 판정', () => {
    expect(Object.values(STATUS_LABEL)).toEqual(['진행 중', '달성', '실패', '끝날 때 판정'])
  })
})

describe('배정 규칙 수치', () => {
  it('팀마다 손 갈래 하나 이상, 같은 갈래는 둘까지', () => {
    expect(ASSIGN_RULES.handPerTeamAtLeast).toBe(1)
    expect(ASSIGN_RULES.sameBranchPerTeamAtMost).toBe(2)
  })

  it('★ 셋은 서로 다른 팀에, 그중 둘은 4인 팀에', () => {
    expect(ASSIGN_RULES.astrayOnePerTeam).toBe(true)
    expect(ASSIGN_RULES.astrayInBigTeams).toBe(2)
  })
})
