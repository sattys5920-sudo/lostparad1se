// 모두에게 알린 그날 미션 결과 — 「민수 성공 · 예지 실패」.
//
// **판 문서(games/{판}.missionBoards)에서 읽는다.** 누구나 읽는 문서라
// 여기 든 것은 이름(자리에서 찾는다)과 해냈는지뿐이다 — 역할도 조건도
// 숫자도 서버가 애초에 안 싣는다(functions/src/missionDays.ts 의
// hostMissionBoard).
//
// 두 군데가 같은 종이를 띄운다.
//   - Play.tsx 의 BoardMailbox — 이 기기에서 아직 안 닫은 공개가 있으면
//     뜬다. 내 판정 종이(MissionMailbox)가 먼저고, 그것을 다 닫은 뒤다
//   - 「나」 탭의 모두의 결과 — 누르면 다시 띄운다
import { useEffect, useRef, useState } from 'react'

import type { MissionBoard } from '../../../shared/missions/mail'
import type { SeatEntry } from '../../../shared/model'
import type { TeamId } from '../../../shared/rules/v2'
import { Snow } from '../reveal/Snow'
import { TEAM_COLOR } from './MapPlan'
import { PaperSheet } from './Paper'
import './missionPopup.css'

/** 공개된 날 전부, 날짜순. 열쇠(d10 · d2)가 아니라 안에 적힌 day 로 줄 세운다 */
export function boardsOf(boards: Record<string, MissionBoard> | undefined): MissionBoard[] {
  return Object.values(boards ?? {})
    .filter((b): b is MissionBoard => !!b && typeof b.day === 'number' && Array.isArray(b.rows))
    .sort((a, b) => a.day - b.day)
}

/** 한 장을 가르는 열쇠. 다시 공개하면 시각이 바뀌어 새 종이가 된다 */
export const boardKey = (b: MissionBoard): string => `d${b.day}@${b.atMs}`

// ── 이 기기에서 닫은 것 ─────────────────────────────────────────
// 모두가 같은 한 장을 보는 것이라 서버에 「봤다」를 적을 까닭이 없다.
// 저장이 막힌 기기(사생활 창)에서는 매번 뜬다 — 그래도 한 번 닫으면 끝이다

const seenKey = (gameId: string) => `sc-board-seen:${gameId}`

function readSeen(gameId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(seenKey(gameId))
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return new Set(Array.isArray(arr) ? arr.map(String) : [])
  } catch {
    return new Set()
  }
}

function writeSeen(gameId: string, seen: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(seenKey(gameId), JSON.stringify([...seen].slice(-40)))
  } catch {
    // 못 적어도 이번 화면에서는 닫힌다
  }
}

export function BoardMailbox({
  gameId,
  boards,
  seats,
  meId,
  waiting,
}: {
  gameId: string
  boards: Record<string, MissionBoard> | undefined
  seats: readonly SeatEntry[]
  meId: string
  /** 내 판정 종이가 아직 떠 있으면 기다린다. 두 장이 겹쳐 뜨면 안 된다 */
  waiting: boolean
}) {
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => readSeen(gameId))
  if (waiting) return null
  const next = boardsOf(boards).find((b) => !seen.has(boardKey(b)))
  if (!next) return null
  const key = boardKey(next)
  return (
    <BoardPopup
      key={key}
      board={next}
      seats={seats}
      meId={meId}
      onClose={() => {
        const all = new Set(seen).add(key)
        setSeen(all)
        writeSeen(gameId, all)
      }}
    />
  )
}

export function BoardPopup({
  board,
  seats,
  meId,
  onClose,
}: {
  board: MissionBoard
  seats: readonly SeatEntry[]
  meId: string
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const seatOf = new Map(seats.map((s) => [s.playerId, s]))
  const met = board.rows.filter((r) => r.met).length
  const titleId = `sc-bd-${board.day}`
  return (
    <div className="sc-jd is-still" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <Snow level={2} />
      <button type="button" className="sc-jd__back" aria-label="닫기" tabIndex={-1} onClick={onClose} />
      <section className="sc-jd__sheet sc-bd">
        <PaperSheet cls="sc-mi" />
        <span className="sc-jd__frame" aria-hidden />
        <div className="sc-jd__in">
          <p className="sc-jd__day">DAY {board.day}{board.final ? ' · 마지막' : ''}</p>
          <h2 id={titleId} className="sc-bd__title">
            오늘의 미션
          </h2>
          <p className="sc-bd__sum">
            {board.rows.length}명 중 {met}명이 해냈다.
          </p>
          <ul className="sc-bd__rows">
            {board.rows.map((r) => {
              const s = seatOf.get(r.playerId)
              return (
                <li key={r.playerId} className={r.playerId === meId ? 'is-me' : ''}>
                  <span className="sc-bd__band" style={{ background: s?.team ? TEAM_COLOR[s.team as TeamId] : 'transparent' }} aria-hidden />
                  <span className="sc-bd__name">{s?.name ?? '누군가'}</span>
                  <b className={r.met ? 'is-met' : 'is-failed'}>{r.met ? '성공' : '실패'}</b>
                </li>
              )
            })}
          </ul>
          <p className="sc-bd__note">무슨 미션이었는지는 적혀 있지 않다.</p>
          <button type="button" ref={closeRef} className="sc-jd__close" onClick={onClose}>
            닫기
          </button>
        </div>
      </section>
    </div>
  )
}
