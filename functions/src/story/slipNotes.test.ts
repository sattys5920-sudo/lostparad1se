// 쪽지 56장 — 데이터가 문서와 같고, 퍼즐이 한 장으로 풀리지 않는가.
import { describe, expect, it } from 'vitest'
import { SLIP_NOTES } from './slipNotes'
import { checkSlipNotes, NAME_MARK } from './slipNotesCheck'
import { ROLE_IDS, ROLE_NAMES } from '../../../shared/missions/roleNames'
import { parseNotesMd } from '../../../scripts/lib/notesMd'

describe('쪽지 56장', () => {
  it('열넷 × 넉 장 = 쉰여섯 장이다', () => {
    expect(SLIP_NOTES).toHaveLength(ROLE_IDS.length * 4)
  })
  it('규칙을 다 지킨다', () => {
    expect(checkSlipNotes(SLIP_NOTES, ROLE_NAMES).errors).toEqual([])
  })
  it('문서(docs/roles_full.md)와 한 글자도 다르지 않다', () => {
    const md = parseNotesMd()
    expect(md).toHaveLength(SLIP_NOTES.length)
    for (const m of md) {
      const id = `r${String(m.no).padStart(2, '0')}-s${m.slot}-${m.kind}`
      expect(SLIP_NOTES.find((n) => n.id === id)?.text, id).toBe(m.text)
    }
  })
})

describe('검사가 잡는다', () => {
  const base = SLIP_NOTES.map((n) => ({ ...n }))
  it('역할형에 {이름}이 있으면', () => {
    const bad = base.map((n) => (n.id === 'r01-s1-role' ? { ...n, text: `${NAME_MARK}은 반장이다.` } : n))
    expect(checkSlipNotes(bad, ROLE_NAMES).errors.some((e) => e.startsWith('r01-s1-role'))).toBe(true)
  })
  it('이름형에 역할 이름이 있으면 — 한 장으로 풀린다', () => {
    const bad = base.map((n) => (n.id === 'r02-s4-name' ? { ...n, text: `${NAME_MARK}은 반장이다.` } : n))
    expect(checkSlipNotes(bad, ROLE_NAMES).errors.some((e) => e.includes('반장'))).toBe(true)
  })
  it('역할마다 넉 장이 아니면', () => {
    const bad = base.filter((n) => n.id !== 'r03-s4-name')
    const errs = checkSlipNotes(bad, ROLE_NAMES).errors
    expect(errs.some((e) => e.includes('3장이다'))).toBe(true)
    expect(errs.some((e) => e.includes('번호(1~4번)가 겹치거나 빠졌다'))).toBe(true)
  })
  it('지금 데이터는 역할마다 이름형이 정확히 한 장이다 — 알림이 하나도 없다', () => {
    const { errors, notices } = checkSlipNotes(base, ROLE_NAMES)
    expect(errors).toEqual([])
    expect(notices).toEqual([])
  })
  it('이름형이 목표(한 장)에서 벗어나면 — 알림만 뜨고 실패하진 않는다', () => {
    // r01-s1-role 을 이름형으로 바꾸면 반장은 이름형이 두 장이 된다
    const bad = base.map((n) => (n.id === 'r01-s1-role' ? { ...n, id: 'r01-s1-name', kind: 'name' as const, text: `${NAME_MARK}은 저녁마다 남은 사람 명단을 적어 교무실에 낸다.` } : n))
    const { errors, notices } = checkSlipNotes(bad, ROLE_NAMES)
    expect(errors).toEqual([])
    expect(notices.some((n) => n.includes('이름형이 2장이다'))).toBe(true)
  })
})
