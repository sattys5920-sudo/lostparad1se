// 메모 탭 — 책상에 붙인 메모지 열셋.
//
// 한 장에 한 사람이다. 짐작한 역할을 고르고, 한 줄을 손글씨로 적는다.
// 마지막에 감독관이 답안지를 띄우면 여기 고른 역할로 칸이 미리 채워진다.
//
// 저장은 서버 함수를 안 거친다. 판정에 쓰이지 않는 개인 메모라 서버가
// 검사할 것이 없다. 규칙이 본인 말고는 읽지도 쓰지도 못하게 막는다.
// 쓰기는 몰아서 보낸다(makeNoteSaver) — 한 글자마다 보내지 않는다.
import { useEffect, useMemo, useRef, useState } from 'react'

import { loadNote, makeNoteSaver } from '../reveal/notesSync'
import { NOTE_MAX, setPersonNote, setRoleGuess, tagOf, type DeductionNote } from '../../../shared/reveal/notes'
import { ROLE_NAMES } from '../../../shared/missions/roleNames'
import { ANSWER_ROLES } from '../../../shared/rules/answers'
import { TEAM_COLOR } from './MapPlan'
import { teamName } from '../../../shared/rules/bundan'
import './memo.css'

/** 메모지 색 다섯. 한 사람은 늘 같은 색이다 */
const TINTS = ['#f7e58f', '#f6c8cf', '#bfe3c8', '#bcd7f2', '#f4d2a8'] as const
/** 살짝 비뚤게 붙인다. 한 사람은 늘 같은 각도다 */
const TILTS = [-1.6, 1.1, -0.6, 1.8, -1.2, 0.5] as const

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
        짐작한 역할을 골라 두면 마지막 답안지에 그대로 옮겨 적힌다. 나만 본다. · {guessed}/{classmates.length}
      </p>
      <ul className="sc-memo__board">
        {classmates.map((c) => {
          const h = hash(c.id)
          const tag = tagOf(note, c.id)
          const guess = note.roleGuess?.[c.id] ?? ''
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
              <select
                id={`memo-role-${c.id}`}
                className={'sc-memo__role' + (guess ? '' : ' is-empty')}
                aria-label={`${c.name}의 역할 짐작`}
                value={guess}
                onChange={(e) => change(setRoleGuess(note, c.id, e.target.value))}
              >
                <option value="">역할은…?</option>
                {ANSWER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_NAMES[r]}
                  </option>
                ))}
              </select>
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
