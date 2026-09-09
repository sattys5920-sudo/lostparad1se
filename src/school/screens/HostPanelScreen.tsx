import { useState } from 'react'
import './HostPanelScreen.css'
import { useSchoolGame } from '../state/SchoolGameContext'
import { dayByNumber, DAYS } from '../data/days'
import { REVEAL_LABEL } from '../engine/reveals'

const DISTORTION_LABEL: Record<string, string> = {
  truth: '진실',
  partial: '일부 진실',
  misunderstanding: '오해',
  false: '거짓',
  exaggeration: '과장',
}

export function HostPanelScreen() {
  const { session, players, hostAdvanceDay, hostSetEventCard, hostEndGame, hostResetSession } = useSchoolGame()
  const [customCard, setCustomCard] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const day = dayByNumber(session.day)
  const isLastDay = session.day >= DAYS.length

  async function advance() {
    await hostAdvanceDay(Math.min(session.day + 1, DAYS.length), null)
  }

  async function reset() {
    if (!confirmReset) {
      setConfirmReset(true)
      return
    }
    await hostResetSession()
    setConfirmReset(false)
  }

  return (
    <div className="sc-host">
      <div className="sc-host__status">
        <span className="sc-host__phase">{session.phase}</span>
        <h1>
          {day.subtitle} · {day.title}
        </h1>
        <p>{day.focusPrompt}</p>
      </div>

      {session.phase === 'day' && (
        <section className="sc-host__section">
          <span className="sc-host__label">오늘의 사건</span>
          <div className="sc-host__cards">
            {day.eventCards.map((c) => (
              <button
                key={c}
                className={`sc-host__card ${session.activeEventCard === c ? 'is-selected' : ''}`}
                onClick={() => hostSetEventCard(c)}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="sc-host__custom">
            <input value={customCard} placeholder="직접 정하기" onChange={(e) => setCustomCard(e.target.value)} />
            <button
              disabled={!customCard.trim()}
              onClick={() => {
                hostSetEventCard(customCard.trim())
                setCustomCard('')
              }}
            >
              적용
            </button>
          </div>

          {isLastDay ? (
            <button className="sc-host__advance" onClick={hostEndGame}>
              게임을 마친다
            </button>
          ) : (
            <button className="sc-host__advance" onClick={advance}>
              다음 날로 넘어간다
            </button>
          )}
        </section>
      )}

      {session.phase === 'roleReveal' && (
        <section className="sc-host__section">
          <p className="sc-host__hint">모두가 역할을 확인하면 첫째 날을 시작한다.</p>
          <button
            className="sc-host__advance"
            onClick={() => hostAdvanceDay(1, day.eventCards[0] ?? null)}
          >
            첫째 날을 시작한다
          </button>
        </section>
      )}

      <section className="sc-host__section">
        <span className="sc-host__label">떠도는 이야기 · 진행자 전용</span>
        {session.rumors.length === 0 && <p className="sc-host__hint">아직 없다.</p>}
        <ul className="sc-host__rumors">
          {session.rumors
            .slice()
            .reverse()
            .map((r) => (
              <li key={r.id}>
                <span className="sc-host__rumor-tag">{DISTORTION_LABEL[r.distortion]}</span>
                <span className="sc-host__rumor-text">{r.text}</span>
                <span className="sc-host__rumor-by">{players[r.tellerId]?.nickname ?? '???'}</span>
              </li>
            ))}
        </ul>
      </section>

      <section className="sc-host__section">
        <span className="sc-host__label">공개된 것들 · 진행자 전용</span>
        {session.revealLog.length === 0 && <p className="sc-host__hint">아직 아무도 공개하지 않았다.</p>}
        <ul className="sc-host__rumors">
          {session.revealLog
            .slice()
            .reverse()
            .map((r) => (
              <li key={r.id}>
                <span className="sc-host__rumor-tag">{REVEAL_LABEL[r.revealKind]}</span>
                <span className="sc-host__rumor-text">
                  {players[r.actorId]?.nickname ?? '???'} →{' '}
                  {r.scope === 'class' ? '교실 전체' : (players[r.targetId ?? '']?.nickname ?? '한 사람')}
                </span>
                <span className="sc-host__rumor-by">DAY {r.day}</span>
              </li>
            ))}
        </ul>
      </section>

      <section className="sc-host__section">
        <span className="sc-host__label">위험 구역</span>
        <button className="sc-host__reset" onClick={reset}>
          {confirmReset ? '정말 초기화한다 (다시 누르면 실행)' : '세션 초기화'}
        </button>
      </section>
    </div>
  )
}
