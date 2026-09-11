// 추리 노트 — 이력이 「처음 맞힌 날」을 제대로 짚는가.
import { describe, expect, it } from 'vitest'
import {
  boardResult,
  emptyNote,
  NOTE_MAX,
  scoreBoard,
  setEntryNote,
  setGuess,
  setPersonNote,
  tagOf,
  UNKNOWN,
} from './notes'
import type { RoleId } from '../missions/roles'

const seoul = (iso: string) => new Date(`${iso}+09:00`).getTime()
const START = seoul('2026-03-02T08:00:00')
const on = (day: number, hhmm: string) => seoul(`2026-03-0${1 + day}T${hhmm}:00`)

describe('태그 달기', () => {
  it('처음에는 모름이다', () => {
    expect(tagOf(emptyNote('me'), 'p1').guess).toBe(UNKNOWN)
  })

  it('달면 보드에 들어간다', () => {
    const out = setGuess(emptyNote('me'), 'p1', 'librarian', 100)
    expect(out.ok).toBe(true)
    expect(tagOf(out.note, 'p1').guess).toBe('librarian')
  })

  it('자기 자신에게는 못 단다', () => {
    const out = setGuess(emptyNote('me'), 'me', 'librarian', 100)
    expect(out.ok).toBe(false)
    expect(out.reason).toBe('self')
  })

  it('바꿀 때마다 이력이 쌓인다', () => {
    let n = emptyNote('me')
    n = setGuess(n, 'p1', 'librarian', 100).note
    n = setGuess(n, 'p1', 'witness', 200).note
    expect(n.history).toHaveLength(2)
    expect(n.history[1]).toMatchObject({ from: 'librarian', to: 'witness' })
  })

  it('같은 값을 다시 골라도 이력에 남지 않는다', () => {
    let n = emptyNote('me')
    n = setGuess(n, 'p1', 'librarian', 100).note
    n = setGuess(n, 'p1', 'librarian', 200).note
    expect(n.history).toHaveLength(1)
  })
})

describe('한 줄 메모', () => {
  it('태그와 따로 간다', () => {
    let n = setGuess(emptyNote('me'), 'p1', 'liar', 100).note
    n = setPersonNote(n, 'p1', 'DAY 4에 너무 조용했다', 200).note
    expect(tagOf(n, 'p1')).toMatchObject({ guess: 'liar', note: 'DAY 4에 너무 조용했다' })
    // 메모는 이력에 남기지 않는다
    expect(n.history).toHaveLength(1)
  })

  it('너무 길면 막는다', () => {
    const out = setPersonNote(emptyNote('me'), 'p1', 'ㄱ'.repeat(NOTE_MAX + 1), 0)
    expect(out.ok).toBe(false)
    expect(out.reason).toBe('tooLong')
  })

  it('보관함 항목에도 붙는다', () => {
    const n = setEntryNote(emptyNote('me'), 'record:3', '음악실이 아니라 창고 앞').note
    expect(n.entryNotes['record:3']).toBe('음악실이 아니라 창고 앞')
  })

  it('비우면 지운다', () => {
    let n = setEntryNote(emptyNote('me'), 'record:3', '메모').note
    n = setEntryNote(n, 'record:3', '   ').note
    expect(n.entryNotes['record:3']).toBeUndefined()
  })
})

describe('끝난 뒤 채점', () => {
  const actual: Record<string, RoleId> = { p1: 'librarian', p2: 'liar', p3: 'guard' }
  const actualOf = (id: string) => actual[id]

  it('맞힌 것과 틀린 것을 가른다', () => {
    let n = emptyNote('me')
    n = setGuess(n, 'p1', 'librarian', on(1, '10:00')).note
    n = setGuess(n, 'p2', 'witness', on(2, '10:00')).note
    const rows = scoreBoard(n, actualOf, START)
    expect(rows.find((r) => r.targetId === 'p1')?.correct).toBe(true)
    expect(rows.find((r) => r.targetId === 'p2')?.correct).toBe(false)
  })

  it('처음 맞힌 날을 짚는다', () => {
    let n = emptyNote('me')
    n = setGuess(n, 'p1', 'librarian', on(2, '10:00')).note
    const row = scoreBoard(n, actualOf, START)[0]
    expect(row.firstCorrectDay).toBe(2)
  })

  it('맞혔다 바꿨다 다시 맞히면 가장 이른 날이다', () => {
    let n = emptyNote('me')
    n = setGuess(n, 'p1', 'librarian', on(1, '10:00')).note
    n = setGuess(n, 'p1', 'witness', on(3, '10:00')).note
    n = setGuess(n, 'p1', 'librarian', on(5, '10:00')).note
    const row = scoreBoard(n, actualOf, START)[0]
    expect(row.correct).toBe(true)
    expect(row.firstCorrectDay).toBe(1)
  })

  it('한 번 스쳤다가 끝내 틀렸으면 맞힌 게 아니다', () => {
    let n = emptyNote('me')
    n = setGuess(n, 'p1', 'librarian', on(1, '10:00')).note
    n = setGuess(n, 'p1', 'witness', on(4, '10:00')).note
    const row = scoreBoard(n, actualOf, START)[0]
    expect(row.correct).toBe(false)
    // 닿은 적은 있으니 그날은 남는다
    expect(row.firstCorrectDay).toBe(1)
  })

  it('맞힌 수와 전체를 센다 — 안 단 사람도 세어야 13이 된다', () => {
    const everyone = ['me', 'p1', 'p2', 'p3']
    let n = emptyNote('me')
    n = setGuess(n, 'p1', 'librarian', on(1, '10:00')).note
    const out = boardResult(n, actualOf, START, everyone)
    expect(out.total).toBe(3)
    expect(out.correct).toBe(1)
    expect(out.rows.find((r) => r.targetId === 'p3')?.guess).toBe(UNKNOWN)
  })
})

describe('새면 안 되는 것', () => {
  it('노트에는 주인 말고 다른 주인이 없다', () => {
    // 서버는 notes/{playerId} 를 본인에게만 내려보낸다. 이 구조가
    // 한 문서에 한 사람 것만 담게 강제한다
    const n = setGuess(emptyNote('me'), 'p1', 'liar', 0).note
    expect(n.ownerId).toBe('me')
    expect(Object.keys(n)).toEqual(['ownerId', 'entryNotes', 'board', 'history'])
  })
})
