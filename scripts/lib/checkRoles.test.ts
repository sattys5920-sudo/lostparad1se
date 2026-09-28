// 역할 검사가 제 할 일을 하는가 — 통과하고, 어긋나면 잡는다.
import { describe, expect, it } from 'vitest'

import { checkRoles } from './checkRoles'
import { ROLE_DATA } from '../../shared/missions/roleData'
import type { RoleData } from '../../shared/missions/roleTypes'

const edit = (no: number, f: (r: RoleData) => RoleData) => ROLE_DATA.map((r) => (r.no === no ? f(r) : r))

describe('역할 검사', () => {
  it('지금 데이터는 문서와 같다', () => {
    const out = checkRoles()
    expect(out.errors).toEqual([])
    expect(out.notices).toEqual([])
  })
  it('문장이 한 글자라도 다르면 오류다', () => {
    const out = checkRoles(edit(1, (r) => ({ ...r, line: r.line.replace('.', '!') })))
    expect(out.errors.some((e) => e.includes('01 반장 미션 한 줄'))).toBe(true)
  })
  it('상황 문단이 다르면 오류다', () => {
    const out = checkRoles(edit(6, (r) => ({ ...r, situation: r.situation.slice(1) })))
    expect(out.errors.some((e) => e.includes('06 미화부'))).toBe(true)
  })
  it('공개 시점이 다르면 오류다 — 모범생의 표가 바로 오르면 역추적된다', () => {
    const out = checkRoles(edit(2, (r) => ({ ...r, clauses: r.clauses.map((c) => ({ ...c, disclosure: 'realtime' as const })) })))
    expect(out.errors.some((e) => e.includes('02 모범생 조건 1: 공개'))).toBe(true)
  })
  it('수치만 바꾸면 알림뿐이다 — 빌드는 안 막는다', () => {
    const out = checkRoles(edit(1, (r) => ({ ...r, clauses: r.clauses.map((c) => ({ ...c, need: 7, minutes: 2 })) })))
    expect(out.errors).toEqual([])
    expect(out.notices.some((n) => n.includes('need'))).toBe(true)
    expect(out.notices.some((n) => n.includes('minutes'))).toBe(true)
  })
})
