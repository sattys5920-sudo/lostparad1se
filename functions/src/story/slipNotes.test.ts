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
  it('세 규칙을 다 지킨다', () => {
    expect(checkSlipNotes(SLIP_NOTES, ROLE_NAMES)).toEqual([])
  })
  it('문서(docs/roles_full.md)와 한 글자도 다르지 않다', () => {
    const md = parseNotesMd()
    expect(md).toHaveLength(SLIP_NOTES.length)
    for (const m of md) {
      const id = `r${String(m.no).padStart(2, '0')}-p${m.pair}-${m.kind}`
      expect(SLIP_NOTES.find((n) => n.id === id)?.text, id).toBe(m.text)
    }
  })
})

describe('검사가 잡는다', () => {
  const base = SLIP_NOTES.map((n) => ({ ...n }))
  it('역할형에 {이름}이 있으면', () => {
    const bad = base.map((n) => (n.id === 'r01-p1-role' ? { ...n, text: `${NAME_MARK}은 반장이다.` } : n))
    expect(checkSlipNotes(bad, ROLE_NAMES).some((e) => e.startsWith('r01-p1-role'))).toBe(true)
  })
  it('이름형에 역할 이름이 있으면 — 한 장으로 풀린다', () => {
    const bad = base.map((n) => (n.id === 'r02-p1-name' ? { ...n, text: `${NAME_MARK}은 반장이다.` } : n))
    expect(checkSlipNotes(bad, ROLE_NAMES).some((e) => e.includes('반장'))).toBe(true)
  })
  it('역할마다 넉 장이 아니면', () => {
    const bad = base.filter((n) => n.id !== 'r03-p2-name')
    const errs = checkSlipNotes(bad, ROLE_NAMES)
    expect(errs.some((e) => e.includes('3장이다'))).toBe(true)
    expect(errs.some((e) => e.includes('2짝 이름형이 0장'))).toBe(true)
  })
})
