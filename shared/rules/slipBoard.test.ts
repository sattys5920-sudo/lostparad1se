// 쪽지 배포판 — 무작위 뿌리기와 경고.
import { describe, expect, it } from 'vitest'
import { LATE_FROM_DAY, SCATTER_ROOMS, needsEarlyConfirm, planScatter, roleWarn, type BoardNote } from './slipBoard'
import { START_TILE } from './board'
import type { RoleId } from '../missions/roleNames'

const ROLES: RoleId[] = ['classlead', 'model', 'treasurer']
const note = (role: RoleId, slot: 1 | 2 | 3 | 4, kind: 'role' | 'name', over: Partial<BoardNote> = {}): BoardNote => ({
  id: `${role}-${slot}-${kind}`,
  no: ROLES.indexOf(role) + 1,
  roleKey: role,
  slot,
  kind,
  state: 'waiting',
  slipId: null,
  room: null,
  holder: null,
  placedDay: null,
  everHeld: false,
  text: '',
  ...over,
})
const all = ROLES.flatMap((r) => [note(r, 1, 'role'), note(r, 2, 'role'), note(r, 3, 'role'), note(r, 4, 'name')])
let seed = 1
const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)

describe('무작위로 뿌리기', () => {
  it('3~4번(그날)은 DAY 3 전에는 후보가 아니다', () => {
    const out = planScatter({ notes: all, day: 1, n: 12, rng })
    const picked = all.filter((n) => out.some((o) => o.id === n.id))
    expect(picked.every((n) => n.slot <= 2)).toBe(true)
  })
  it(`DAY ${LATE_FROM_DAY}부터는 3~4번(그날)도 후보다`, () => {
    let sawLate = false
    for (let i = 0; i < 30 && !sawLate; i++) {
      const out = planScatter({ notes: all, day: LATE_FROM_DAY, n: 3, rng })
      sawLate = all.some((n) => n.slot >= 3 && out.some((o) => o.id === n.id))
    }
    expect(sawLate).toBe(true)
  })
  it('한 역할이 같은 날 두 장이 되지 않는다 — 이미 오늘 뿌린 것까지 센다', () => {
    const out = planScatter({ notes: all, day: 1, n: 12, rng })
    const roles = out.map((o) => all.find((n) => n.id === o.id)?.roleKey)
    expect(new Set(roles).size).toBe(roles.length)
    expect(out.length).toBe(ROLES.length)
    const today = all.map((n) => (n.id === 'classlead-1-role' ? { ...n, state: 'placed' as const, placedDay: 1, room: 'library' as const } : n))
    const next = planScatter({ notes: today, day: 1, n: 12, rng })
    expect(next.some((o) => o.id.startsWith('classlead'))).toBe(false)
  })
  it('대기 중인 것만 — 뿌림 · 주움 · 찢김은 안 고른다', () => {
    const busy = all.map((n) => (n.kind === 'role' ? { ...n, state: 'torn' as const } : n))
    const out = planScatter({ notes: busy, day: 1, n: 12, rng })
    expect(out.every((o) => o.id.endsWith('name'))).toBe(true)
  })
  it('방은 서로 다르고, 2-3 교실은 없다', () => {
    const out = planScatter({ notes: all, day: 3, n: 3, rng })
    expect(new Set(out.map((o) => o.room)).size).toBe(out.length)
    expect(SCATTER_ROOMS).not.toContain(START_TILE)
  })
})

describe('경고', () => {
  it('이름형과 역할형이 하나라도 같이 나갔으면 완성 가능', () => {
    const r = ROLES.slice(0, 1).flatMap((x) => [note(x, 3, 'role', { state: 'placed', placedDay: 3 }), note(x, 4, 'name', { state: 'held', placedDay: 4 })])
    expect(roleWarn(r).solvable).toBe(true)
    expect(roleWarn([r[0], note('classlead', 4, 'name')]).solvable).toBe(false)
  })
  it('같은 날 두 장이면 몰림', () => {
    const r = [note('model', 1, 'role', { state: 'placed', placedDay: 2 }), note('model', 2, 'role', { state: 'placed', placedDay: 2 })]
    expect(roleWarn(r).crowdedDays).toEqual([2])
  })
  it('3~4번(그날)을 DAY 3 전에 뿌리면 한 번 더 묻는다', () => {
    expect(needsEarlyConfirm(3, 2)).toBe(true)
    expect(needsEarlyConfirm(3, 3)).toBe(false)
    expect(needsEarlyConfirm(1, 1)).toBe(false)
  })
})
