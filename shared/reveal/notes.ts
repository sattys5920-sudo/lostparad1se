// 추리 노트. 본인 전용이고, 어떤 판정에도 쓰지 않는다.
//
// 보관함 항목마다 메모를 붙이고, 열세 명 각자에게 한 줄을 적는다.
//
// **역할 태그는 없앴다.** 남의 역할을 맞히는 판이 아니게 됐다 —
// 개인 미션은 저마다 할 일이지 서로 알아맞힐 정체가 아니다. 남은
// 것은 혼자 적는 메모뿐이다.
//
// 운영자 대시보드에도 나가지 않는다. 남의 추리를 들여다보는 순간
// 이 노트는 혼자 생각하는 자리가 아니게 된다.

export interface PersonTag {
  /** 누구에 대한 메모인가. */
  targetId: string
  /** 한 줄 메모. */
  note: string
  updatedAtMs: number
}

export interface DeductionNote {
  ownerId: string
  /** 보관함 항목 id → 메모. */
  entryNotes: Record<string, string>
  /** 나를 뺀 열세 명. */
  board: PersonTag[]
}

export function emptyNote(ownerId: string): DeductionNote {
  return { ownerId, entryNotes: {}, board: [] }
}

/** 그 사람에 대한 지금 메모. 없으면 빈 줄이다. */
export function tagOf(note: DeductionNote, targetId: string): PersonTag {
  return note.board.find((t) => t.targetId === targetId) ?? { targetId, note: '', updatedAtMs: 0 }
}

export type NoteRefusal = 'self' | 'tooLong'

/** 한 줄 메모의 길이. 노트지 한 줄이다. */
export const NOTE_MAX = 120

/** 한 사람에 대한 한 줄 메모를 고친다. */
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
