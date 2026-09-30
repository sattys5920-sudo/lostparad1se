// 메모 탭 — 책상에 붙인 메모지 열셋.
//
// 한 장에 한 사람이다. 짐작한 역할과 한 줄을 손글씨로 적는다.
//
// **역할은 고르지 않고 적는다.** 고르게 하면 목록이 곧 「이 판에 어떤
// 역할들이 있는가」라서, 메모 탭을 여는 순간 숨긴 것이 다 보인다.
// 답안지와는 이어지지 않는다 — 혼자 보는 메모다.
//
// 저장은 서버 함수를 안 거친다. 판정에 쓰이지 않는 개인 메모라 서버가
// 검사할 것이 없다. 규칙이 본인 말고는 읽지도 쓰지도 못하게 막는다.
// 쓰기는 몰아서 보낸다(makeNoteSaver) — 한 글자마다 보내지 않는다.
import { useEffect, useMemo, useRef, useState } from 'react'

import { loadNote, makeNoteSaver } from '../reveal/notesSync'
import { NOTE_MAX, setPersonNote, setRoleGuess, tagOf, type DeductionNote } from '../../../shared/reveal/notes'
import { ROLE_NAMES, canonRoleId } from '../../../shared/missions/roleNames'
import { TEAM_COLOR } from './MapPlan'
import { teamName } from '../../../shared/rules/bundan'
import './memo.css'

/** 메모지 색 다섯. 한 사람은 늘 같은 색이다 */
const TINTS = ['#f7e58f', '#f6c8cf', '#bfe3c8', '#bcd7f2', '#f4d2a8'] as const
/** 살짝 비뚤게 붙인다. 한 사람은 늘 같은 각도다 */
const TILTS = [-1.6, 1.1, -0.6, 1.8, -1.2, 0.5] as const

/** 역할 짐작 한 칸에 적을 수 있는 글자 수 */
const ROLE_GUESS_MAX = 12

const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)

export function Notes({
  gameId,
  meId,
  classmates,
}: {
  gameId: string
  meId: string
  classmates: readonly { id: string; name: string; team?: string | null }[]
}) {
  const [note, setNote] = useState<DeductionNote | null>(null)
  const saver = useMemo(() => makeNoteSaver(gameId), [gameId])
  const latest = useRef<DeductionNote | null>(null)

  useEffect(() => {
    let live = true
    loadNote(gameId, meId)
      .then((n) => {
        if (live) setNote(n)
      })
      .catch(() => {})
    return () => {
      live = false
      void saver.flush()
    }
  }, [gameId, meId, saver])

  function change(next: DeductionNote) {
    latest.current = next
    setNote(next)
    saver.queue(next)
  }

  // 아직 안 왔다. 빈 판을 먼저 보였다가 불러온 것으로 덮으면, 그 사이에
  // 적은 한 줄이 사라진다
  if (!note) return null
  const guessed = classmates.filter((c) => note.roleGuess?.[c.id]).length
  return (
    <div className="sc-memo">
      <p className="sc-memo__hint">
        짐작한 역할을 적어 둔다. 나만 본다. · {guessed}/{classmates.length}
      </p>
      <ul className="sc-memo__board">
        {classmates.map((c) => {
          const h = hash(c.id)
          const tag = tagOf(note, c.id)
          // 전에 고르던 때 저장된 값은 역할 id 다 — 적은 글처럼 이름으로 보인다
          const raw = note.roleGuess?.[c.id] ?? ''
          const id = canonRoleId(raw)
          const guess = id ? ROLE_NAMES[id] : raw
          return (
            <li
              key={c.id}
              className="sc-memo__sheet"
              style={{ background: TINTS[h % TINTS.length], transform: `rotate(${TILTS[h % TILTS.length]}deg)` }}
            >
              <span className="sc-memo__tape" aria-hidden="true" />
              <p className="sc-memo__name">
                {c.team && (
                  <i
                    className="sc-memo__band"
                    style={{ background: TEAM_COLOR[c.team as keyof typeof TEAM_COLOR] }}
                    aria-label={teamName(c.team)}
                  />
                )}
                {c.name}
              </p>
              <input
                id={`memo-role-${c.id}`}
                className="sc-memo__role"
                type="text"
                aria-label={`${c.name}의 역할 짐작`}
                maxLength={ROLE_GUESS_MAX}
                autoComplete="off"
                placeholder="역할은…?"
                value={guess}
                onChange={(e) => change(setRoleGuess(note, c.id, e.target.value.trim() === '' ? '' : e.target.value))}
              />
              <textarea
                id={`memo-note-${c.id}`}
                className="sc-memo__line"
                aria-label={`${c.name}에 대한 메모`}
                rows={2}
                maxLength={NOTE_MAX}
                placeholder="끄적끄적"
                value={tag.note}
                onChange={(e) => {
                  const out = setPersonNote(note, c.id, e.target.value, Date.now())
                  if (out.ok) change(out.note)
                }}
              />
            </li>
          )
        })}
      </ul>
    </div>
  )
}
