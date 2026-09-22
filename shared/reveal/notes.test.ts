// 추리 노트. 메모만 남았다 — 역할 태그는 걷어냈다.
import { describe, expect, it } from 'vitest'
import { emptyNote, NOTE_MAX, setEntryNote, setPersonNote, tagOf } from './notes'

const START = 1_000_000

describe('사람 메모', () => {
  it('처음에는 비어 있다', () => {
    const note = emptyNote('me')
    expect(note.board).toEqual([])
    expect(tagOf(note, 'p1').note).toBe('')
  })

  it('한 줄을 적으면 남는다', () => {
    const out = setPersonNote(emptyNote('me'), 'p1', '2교시에 도서관에 있었다', START)
    expect(out.ok).toBe(true)
    expect(tagOf(out.note, 'p1').note).toBe('2교시에 도서관에 있었다')
    expect(tagOf(out.note, 'p1').updatedAtMs).toBe(START)
  })

  it('고쳐 쓰면 덮어쓴다 — 줄이 늘지 않는다', () => {
    let note = emptyNote('me')
    note = setPersonNote(note, 'p1', '첫 줄', START).note
    note = setPersonNote(note, 'p1', '고친 줄', START + 10).note
    expect(note.board).toHaveLength(1)
    expect(tagOf(note, 'p1').note).toBe('고친 줄')
  })

  it('나에 대해서는 못 적는다', () => {
    const out = setPersonNote(emptyNote('me'), 'me', '나', START)
    expect(out.ok).toBe(false)
    expect(out.reason).toBe('self')
  })

  it('한 줄보다 길면 거절한다', () => {
    const out = setPersonNote(emptyNote('me'), 'p1', 'ㄱ'.repeat(NOTE_MAX + 1), START)
    expect(out.ok).toBe(false)
    expect(out.reason).toBe('tooLong')
  })

  it('딱 한 줄 길이는 받는다', () => {
    const out = setPersonNote(emptyNote('me'), 'p1', 'ㄱ'.repeat(NOTE_MAX), START)
    expect(out.ok).toBe(true)
  })
})

describe('보관함 메모', () => {
  it('붙이고 지운다', () => {
    let note = emptyNote('me')
    note = setEntryNote(note, 'day1', '이 줄이 걸린다').note
    expect(note.entryNotes.day1).toBe('이 줄이 걸린다')
    note = setEntryNote(note, 'day1', '   ').note
    expect(note.entryNotes.day1).toBeUndefined()
  })

  it('한 줄보다 길면 거절한다', () => {
    const out = setEntryNote(emptyNote('me'), 'day1', 'ㄱ'.repeat(NOTE_MAX + 1))
    expect(out.ok).toBe(false)
  })
})

describe('노트는 본인 것이다', () => {
  it('주인 아이디가 바뀌지 않는다', () => {
    let note = emptyNote('me')
    note = setPersonNote(note, 'p1', '가', START).note
    note = setEntryNote(note, 'e1', '나').note
    expect(note.ownerId).toBe('me')
  })
})
