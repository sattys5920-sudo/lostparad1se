// 기록 보관함과 추리 노트.
//
// 네 탭이 있고, 어느 항목에나 메모를 붙일 수 있다. 「내 추리」 탭에는
// 열세 명이 줄지어 있고 각자에게 역할 태그 하나와 한 줄을 단다.
//
// 이 화면은 서버가 **내 몫으로 이미 깎아 둔** 목록만 받는다. 남의 1:1
// 고백은 목록에 없다 — 여기서 걸러 내는 게 아니라 애초에 오지 않는다.
import { useMemo, useState } from 'react'
import './reveal.css'
import {
  ARCHIVE_TABS,
  itemsOf,
  unreadCount,
  type ArchiveItem,
  type ArchiveTab,
} from '../../../shared/reveal/archive'
import {
  GUESS_OPTIONS,
  NOTE_MAX,
  setEntryNote,
  setGuess,
  setPersonNote,
  tagOf,
  UNKNOWN,
  type DeductionNote,
  type Guess,
} from '../../../shared/reveal/notes'
// 이름만 쓴다. roles.ts를 부르면 숨긴 사실 열넷이 번들에 실린다
import { ROLE_NAMES } from '../../../shared/missions/roleNames'

export interface ArchiveProps {
  items: readonly ArchiveItem[]
  note: DeductionNote
  /** 나를 뺀 열세 명. */
  classmates: readonly { id: string; name: string }[]
  /** 항목을 열었을 때 나오는 본문. 서버가 준 것만 있다. */
  bodyOf: (item: ArchiveItem) => string[]
  onNoteChange: (next: DeductionNote) => void
  onClose?: () => void
}

const guessLabel = (g: Guess): string => (g === UNKNOWN ? '모름' : ROLE_NAMES[g])

export function Archive(props: ArchiveProps) {
  const [tab, setTab] = useState<ArchiveTab>('record')
  const [openId, setOpenId] = useState<string | null>(null)

  const counts = useMemo(() => {
    const out: Partial<Record<ArchiveTab, number>> = {}
    for (const t of ARCHIVE_TABS) out[t.id] = unreadCount(itemsOf(props.items, t.id))
    return out
  }, [props.items])

  const list = itemsOf(props.items, tab)

  function editEntryNote(id: string, text: string) {
    const out = setEntryNote(props.note, id, text)
    if (out.ok) props.onNoteChange(out.note)
  }

  return (
    <div className="sc-ar">
      <header className="sc-ar__head">
        <h1>기록 보관함</h1>
        {props.onClose && (
          <button className="sc-ar__close" onClick={props.onClose} aria-label="닫기">
            ✕
          </button>
        )}
      </header>

      <nav className="sc-ar__tabs" role="tablist">
        {ARCHIVE_TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`sc-ar__tab ${tab === t.id ? 'is-on' : ''}`}
            onClick={() => {
              setTab(t.id)
              setOpenId(null)
            }}
          >
            {t.label}
            {(counts[t.id] ?? 0) > 0 && <span className="sc-ar__dot" aria-label="읽지 않음" />}
          </button>
        ))}
      </nav>

      {tab === 'mine' ? (
        <PersonBoard
          note={props.note}
          classmates={props.classmates}
          onNoteChange={props.onNoteChange}
        />
      ) : (
        <ul className="sc-ar__list">
          {list.map((item) => {
            const open = openId === item.id
            return (
              <li key={item.id} className={`sc-ar__item ${item.private ? 'is-private' : ''}`}>
                <button
                  className="sc-ar__row"
                  onClick={() => setOpenId(open ? null : item.id)}
                  aria-expanded={open}
                >
                  <span className="sc-ar__title">
                    {item.title}
                    {item.private && <span className="sc-ar__badge">1:1</span>}
                  </span>
                  {item.unread && <span className="sc-ar__unread">읽지 않음</span>}
                </button>
                {open && (
                  <div className="sc-ar__body">
                    {props.bodyOf(item).map((line, i) => (
                      <p key={i}>{line}</p>
                    ))}
                    <label className="sc-ar__memo">
                      <span>메모</span>
                      <textarea
                        rows={2}
                        maxLength={NOTE_MAX}
                        value={props.note.entryNotes[item.id] ?? ''}
                        placeholder="나만 보는 메모"
                        onChange={(e) => editEntryNote(item.id, e.target.value)}
                      />
                    </label>
                  </div>
                )}
              </li>
            )
          })}
          {list.length === 0 && <li className="sc-ar__empty">아직 아무것도 없다.</li>}
        </ul>
      )}
    </div>
  )
}

function PersonBoard({
  note,
  classmates,
  onNoteChange,
}: {
  note: DeductionNote
  classmates: readonly { id: string; name: string }[]
  onNoteChange: (n: DeductionNote) => void
}) {
  function pick(targetId: string, guess: Guess) {
    const out = setGuess(note, targetId, guess, Date.now())
    if (out.ok) onNoteChange(out.note)
  }

  function jot(targetId: string, text: string) {
    const out = setPersonNote(note, targetId, text, Date.now())
    if (out.ok) onNoteChange(out.note)
  }

  return (
    <div className="sc-ar__board">
      <p className="sc-ar__board-hint">
        나만 본다. 판정에는 쓰이지 않는다. 언제든 바꿀 수 있다.
      </p>
      <ul>
        {classmates.map((p) => {
          const tag = tagOf(note, p.id)
          return (
            <li key={p.id} className="sc-ar__person">
              <div className="sc-ar__person-head">
                <span className="sc-ar__person-name">{p.name}</span>
                <select
                  className={`sc-ar__guess ${tag.guess === UNKNOWN ? 'is-unknown' : ''}`}
                  value={tag.guess}
                  onChange={(e) => pick(p.id, e.target.value as Guess)}
                  aria-label={`${p.name}의 역할 추리`}
                >
                  {GUESS_OPTIONS.map((g) => (
                    <option key={g} value={g}>
                      {guessLabel(g)}
                    </option>
                  ))}
                </select>
              </div>
              <input
                className="sc-ar__person-note"
                maxLength={NOTE_MAX}
                value={tag.note}
                placeholder="한 줄"
                onChange={(e) => jot(p.id, e.target.value)}
                aria-label={`${p.name}에 대한 메모`}
              />
            </li>
          )
        })}
      </ul>
    </div>
  )
}
