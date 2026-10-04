// 성적통지표 — 감독관이 「성적통지표 보내기」를 누르면 열넷 화면에 한 번 뜬다.
//
//   첫 장   내 성적통지표 — 이름 · 분단 · 역할 · 최종 점수 · 석차 · 날마다 개인 미션
//   둘째 장 석차표 — 점수를 적은 사람 전부(완장 색 · 이름 · 점수). 내 줄은 칠한다
//
// 판정 팝업(MissionPopup)과 같은 종이 · 같은 막이다. 닫으면 그 보낸 시각을
// 기억해 두고 다시 안 띄운다 — 감독관이 고쳐 다시 보내면(시각이 바뀌면) 또 뜬다.
// 「나」 탭의 최종 점수 칸에서 다시 열 수 있다.
import { useEffect, useRef, useState } from 'react'

import type { ReportCard as Card } from '../../../shared/rules/reportCard'
import { teamName } from '../../../shared/rules/bundan'
import type { TeamId } from '../../../shared/rules/v2'
import type { GameActions } from './useGame'
import { PaperSheet } from './Paper'
import { TEAM_COLOR } from './MapPlan'
import './missionPopup.css'
import './reportCard.css'

const SEEN = 'sc.reportCard.seen'
const keyOf = (gameId: string, uid: string) => `${SEEN}:${gameId}:${uid}`

/** 이 보낸 시각의 성적통지표를 이미 닫았나 */
export function reportCardSeen(gameId: string, uid: string, atMs: number): boolean {
  try {
    return localStorage.getItem(keyOf(gameId, uid)) === String(atMs)
  } catch {
    return false
  }
}
function markSeen(gameId: string, uid: string, atMs: number): void {
  try {
    localStorage.setItem(keyOf(gameId, uid), String(atMs))
  } catch {
    // 못 적으면 다음에 한 번 더 뜰 뿐이다
  }
}

const chip = (team: TeamId | null) => (
  <i className="sc-rc__chip" style={{ background: team ? TEAM_COLOR[team] : 'var(--ink-3)' }} aria-hidden />
)

/**
 * 보낸 시각(atMs)이 있고 아직 안 닫았으면 띄운다. open 이 참이면 닫은 뒤에도 띄운다(「나」 탭에서 다시 보기)
 */
export function ReportCardPop({
  gameId,
  uid,
  atMs,
  act,
  open,
  onClosed,
  waiting = false,
}: {
  gameId: string
  uid: string
  atMs: number | null | undefined
  act: GameActions
  /** 「나」 탭에서 다시 보기 */
  open?: boolean
  onClosed?: () => void
  /** 판정 종이가 남아 있으면 그 뒤에 뜬다 */
  waiting?: boolean
}) {
  const [card, setCard] = useState<Card | null>(null)
  const [page, setPage] = useState<'mine' | 'all'>('mine')
  const [err, setErr] = useState('')
  /** 방금 닫은 보낸 시각. 저장소를 못 쓰는 기기에서도 닫으면 닫힌다 */
  const [dismissed, setDismissed] = useState<number | null>(null)
  const show =
    !!atMs && !!uid && (open === true || (!waiting && dismissed !== atMs && !reportCardSeen(gameId, uid, atMs)))
  const closeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!show) return
    let alive = true
    setErr('')
    setPage('mine')
    act
      .myReportCard()
      .then((c) => alive && setCard(c as unknown as Card))
      .catch((e) => alive && setErr((e as Error).message))
    return () => {
      alive = false
    }
  }, [show, atMs, act])

  useEffect(() => {
    if (show) closeRef.current?.focus({ preventScroll: true })
  }, [show, page, card])

  if (!show) return null
  const close = () => {
    if (atMs) {
      markSeen(gameId, uid, atMs)
      setDismissed(atMs)
    }
    setCard(null)
    onClosed?.()
  }

  return (
    <div className="sc-jd sc-rc" role="dialog" aria-modal="true" aria-labelledby="sc-rc-title">
      <button type="button" className="sc-jd__back" aria-label="닫기" tabIndex={-1} onClick={close} />
      <section className="sc-jd__sheet">
        <PaperSheet cls="sc-mi" />
        <div className="sc-jd__in sc-rc__in">
          <p className="sc-rc__kicker">2 학 년 3 반</p>
          {!card ? (
            <>
              <h2 id="sc-rc-title" className="sc-rc__title">성적통지표</h2>
              <p className="sc-rc__foot">{err || '펴는 중이다.'}</p>
              <button type="button" ref={closeRef} className="sc-jd__close" onClick={close}>
                닫 기
              </button>
            </>
          ) : page === 'mine' ? (
            <>
              <h2 id="sc-rc-title" className="sc-rc__title">성적통지표</h2>
              <dl className="sc-rc__who">
                <dt>이름</dt>
                <dd>{card.me.name}</dd>
                <dt>분단</dt>
                <dd>
                  {chip(card.me.team)}
                  {teamName(card.me.team)}
                </dd>
                <dt>역할</dt>
                <dd>{card.me.roleName || '—'}</dd>
                <dt>기간</dt>
                <dd>DAY 1~{card.days.length}</dd>
              </dl>
              <p className="sc-rc__score">
                {card.me.score === null ? (
                  <b>—</b>
                ) : (
                  <>
                    <b>{card.me.score}</b>
                    <span>점</span>
                  </>
                )}
              </p>
              <p className="sc-rc__rank">
                {card.me.rank === null ? (
                  '점수가 안 적혔다.'
                ) : (
                  <>
                    석차 <b>{card.me.rank}</b> / {card.all.length}
                  </>
                )}
              </p>
              <p className="sc-rc__sub">개 인 미 션</p>
              <table className="sc-rc__days">
                <thead>
                  <tr>
                    {card.days.map((d) => (
                      <th key={d.day} scope="col">
                        DAY {d.day}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {card.days.map((d) => (
                      <td key={d.day} className={d.status ? `is-${d.status}` : ''}>
                        {d.status === 'met' ? '달성' : d.status === 'failed' ? '실패' : '—'}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
              <p className="sc-rc__foot">위 학생의 나흘을 이와 같이 알립니다.</p>
              <div className="sc-rc__end">
                <button type="button" ref={closeRef} className="sc-jd__close" onClick={() => setPage('all')}>
                  전체 석차 보기
                </button>
                <span className="sc-rc__stamp" aria-label="감독관 확인">
                  감독관
                  <br />
                  확인
                </span>
              </div>
            </>
          ) : (
            <>
              <h2 id="sc-rc-title" className="sc-rc__title">석 차 표</h2>
              <ol className="sc-rc__list">
                {card.all.map((r) => (
                  <li key={r.playerId} className={r.playerId === uid ? 'is-me' : ''}>
                    <span className="sc-rc__r">{r.rank}</span>
                    {chip(r.team)}
                    <span className="sc-rc__name">
                      {r.name}
                      {r.playerId === uid ? ' (나)' : ''}
                    </span>
                    <b>{r.score} 점</b>
                  </li>
                ))}
              </ol>
              <p className="sc-rc__foot">같은 점수는 같은 석차다.</p>
              <div className="sc-rc__pair">
                <button type="button" className="sc-jd__close" onClick={() => setPage('mine')}>
                  내 것
                </button>
                <button type="button" ref={closeRef} className="sc-jd__close" onClick={close}>
                  닫 기
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  )
}
