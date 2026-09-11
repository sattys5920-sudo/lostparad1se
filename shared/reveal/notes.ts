// 추리 노트. 본인 전용이고, 어떤 판정에도 쓰지 않는다.
//
// 보관함 항목마다 메모를 붙이고, 열세 명 각자에게 역할 태그를 단다.
// 태그는 언제든 바꿀 수 있고, 바꾼 이력이 남는다 — 엔딩에서 「그 사람을
// 처음 맞힌 날」을 보여 주는 데 쓴다. 그것도 본인에게만.
//
// 운영자 대시보드에도 나가지 않는다. 남의 추리를 들여다보는 순간
// 이 노트는 혼자 생각하는 자리가 아니게 된다.
import { ROLE_IDS, type RoleId } from '../missions/roleNames'
import { dayNumber } from '../rules/clock'

/** 아직 모르겠다. 태그를 비워 두는 것과 「모름」을 고르는 것은 다르다. */
export const UNKNOWN = 'unknown' as const
export type Guess = RoleId | typeof UNKNOWN

export const GUESS_OPTIONS: readonly Guess[] = [UNKNOWN, ...ROLE_IDS]

export interface PersonTag {
  /** 누구에 대한 추리인가. */
  targetId: string
  guess: Guess
  /** 한 줄 메모. */
  note: string
  updatedAtMs: number
}

export interface TagChange {
  targetId: string
  from: Guess
  to: Guess
  atMs: number
}

export interface DeductionNote {
  ownerId: string
  /** 보관함 항목 id → 메모. */
  entryNotes: Record<string, string>
  /** 나를 뺀 열세 명. */
  board: PersonTag[]
  /** 태그를 바꾼 이력. 엔딩에서만 쓴다. */
  history: TagChange[]
}

export function emptyNote(ownerId: string): DeductionNote {
  return { ownerId, entryNotes: {}, board: [], history: [] }
}

/** 그 사람에 대한 지금 태그. 없으면 모름이다. */
export function tagOf(note: DeductionNote, targetId: string): PersonTag {
  return (
    note.board.find((t) => t.targetId === targetId) ?? {
      targetId,
      guess: UNKNOWN,
      note: '',
      updatedAtMs: 0,
    }
  )
}

export type NoteRefusal = 'self' | 'tooLong'

/** 한 줄 메모의 길이. 노트지 한 줄이다. */
export const NOTE_MAX = 120

/**
 * 태그를 바꾼다. 값이 실제로 달라졌을 때만 이력에 남는다 —
 * 같은 값을 다시 고른 것까지 세면 「처음 맞힌 날」이 흐려진다.
 */
export function setGuess(
  note: DeductionNote,
  targetId: string,
  guess: Guess,
  atMs: number,
): { ok: boolean; note: DeductionNote; reason: NoteRefusal | null } {
  if (targetId === note.ownerId) return { ok: false, note, reason: 'self' }

  const before = tagOf(note, targetId)
  if (before.guess === guess) {
    return { ok: true, note, reason: null }
  }

  const next: PersonTag = { ...before, guess, updatedAtMs: atMs }
  const board = note.board.some((t) => t.targetId === targetId)
    ? note.board.map((t) => (t.targetId === targetId ? next : t))
    : [...note.board, next]

  return {
    ok: true,
    reason: null,
    note: {
      ...note,
      board,
      history: [...note.history, { targetId, from: before.guess, to: guess, atMs }],
    },
  }
}

/** 한 줄 메모를 고친다. 이력에는 남기지 않는다 — 태그만 센다. */
export function setPersonNote(
  note: DeductionNote,
  targetId: string,
  text: string,
  atMs: number,
): { ok: boolean; note: DeductionNote; reason: NoteRefusal | null } {
  if (targetId === note.ownerId) return { ok: false, note, reason: 'self' }
  if (text.length > NOTE_MAX) return { ok: false, note, reason: 'tooLong' }

  const before = tagOf(note, targetId)
  const next: PersonTag = { ...before, note: text, updatedAtMs: atMs }
  const board = note.board.some((t) => t.targetId === targetId)
    ? note.board.map((t) => (t.targetId === targetId ? next : t))
    : [...note.board, next]
  return { ok: true, reason: null, note: { ...note, board } }
}

/** 보관함 항목에 메모를 붙인다. 빈 글은 지우는 것으로 본다. */
export function setEntryNote(
  note: DeductionNote,
  entryId: string,
  text: string,
): { ok: boolean; note: DeductionNote; reason: NoteRefusal | null } {
  if (text.length > NOTE_MAX) return { ok: false, note, reason: 'tooLong' }
  const entryNotes = { ...note.entryNotes }
  if (text.trim() === '') delete entryNotes[entryId]
  else entryNotes[entryId] = text
  return { ok: true, reason: null, note: { ...note, entryNotes } }
}

// ── 엔딩에서만 ──────────────────────────────────────────────────

export interface Scored {
  targetId: string
  guess: Guess
  actual: RoleId
  correct: boolean
  /** 처음 맞힌 날. 끝까지 못 맞혔으면 null. */
  firstCorrectDay: number | null
}

/**
 * 최종 태그와 실제 역할을 나란히 놓는다. **끝난 뒤에만 부른다.**
 *
 * 「처음 맞힌 날」은 이력에서 찾는다. 맞혔다가 바꿨다가 다시 맞혔으면
 * 가장 이른 날이다 — 한 번이라도 닿았으면 닿은 것이다.
 */
export function scoreBoard(
  note: DeductionNote,
  actualOf: (targetId: string) => RoleId,
  startedAtMs: number,
): Scored[] {
  const targets = new Set<string>([
    ...note.board.map((t) => t.targetId),
    ...note.history.map((h) => h.targetId),
  ])

  return [...targets].sort().map((targetId) => {
    const actual = actualOf(targetId)
    const guess = tagOf(note, targetId).guess
    const hit = note.history
      .filter((h) => h.targetId === targetId && h.to === actual)
      .map((h) => h.atMs)
    return {
      targetId,
      guess,
      actual,
      correct: guess === actual,
      firstCorrectDay: hit.length > 0 ? dayNumber(startedAtMs, Math.min(...hit)) : null,
    }
  })
}

export interface BoardResult {
  rows: Scored[]
  correct: number
  total: number
}

/** 맞힌 수 / 13. */
export function boardResult(
  note: DeductionNote,
  actualOf: (targetId: string) => RoleId,
  startedAtMs: number,
  everyone: readonly string[],
): BoardResult {
  const others = everyone.filter((id) => id !== note.ownerId)
  const scored = scoreBoard(note, actualOf, startedAtMs)
  const byId = new Map(scored.map((s) => [s.targetId, s]))

  const rows = others.map(
    (targetId) =>
      byId.get(targetId) ?? {
        targetId,
        guess: UNKNOWN as Guess,
        actual: actualOf(targetId),
        correct: false,
        firstCorrectDay: null,
      },
  )
  return { rows, correct: rows.filter((r) => r.correct).length, total: rows.length }
}
