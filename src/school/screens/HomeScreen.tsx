import { useEffect, useRef, useState } from 'react'
import './HomeScreen.css'
import { useSchoolGame } from '../state/SchoolGameContext'
import { dayByNumber } from '../data/days'
import { ActionSheet } from './ActionSheet'
import { RevealSheet } from '../components/RevealSheet'
import { REVEAL_LABEL } from '../engine/reveals'
import { withParticle } from '../lib/particle'

export function HomeScreen() {
  const { session, players, viewerId, myRole, sendGroupChat, revealToClass, todaysFragment } = useSchoolGame()
  const [draft, setDraft] = useState('')
  const [actionSheetOpen, setActionSheetOpen] = useState(false)
  const [revealOpen, setRevealOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const day = dayByNumber(session.day)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [session.groupChat.length])

  async function submit() {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    await sendGroupChat(text)
  }

  return (
    <div className="sc-home">
      <div className="sc-home__banner">
        <span className="sc-home__day">{day.subtitle}</span>
        <h1>{day.title}</h1>
        <p className="sc-home__desc">{day.description}</p>
        {session.activeEventCard && <span className="sc-home__event">오늘: {session.activeEventCard}</span>}
      </div>

      {todaysFragment && (
        <div className="sc-home__fragment">
          <span className="sc-home__fragment-label">{todaysFragment.title}</span>
          <p className="sc-home__fragment-text">{todaysFragment.text}</p>
          <span className="sc-home__fragment-foot">A가 남긴 기록이다. 아무도 대답할 수 없다.</span>
        </div>
      )}

      <div className="sc-home__feed" ref={scrollRef}>
        {session.groupChat.length === 0 && <p className="sc-home__empty">아직 아무 말도 오가지 않았다.</p>}
        {session.groupChat
          .filter((m) => m.day === session.day)
          .map((m) => {
            const isMine = m.authorId === viewerId
            const name = players[m.authorId]?.nickname ?? '???'
            if (m.kind === 'reveal') {
              return (
                <div key={m.id} className="sc-home__reveal">
                  <span className="sc-home__reveal-label">
                    {isMine ? '나' : name} · {withParticle(REVEAL_LABEL[m.revealKind ?? 'custom'], 'object')} 공개했다
                  </span>
                  <span className="sc-home__reveal-text">{m.text}</span>
                </div>
              )
            }
            return (
              <div key={m.id} className={`sc-home__msg ${isMine ? 'is-mine' : ''}`}>
                <span className="sc-home__msg-name">{isMine ? '나' : name}</span>
                <span className="sc-home__msg-text">{m.text}</span>
              </div>
            )
          })}
      </div>

      <div className="sc-home__composer">
        <button className="sc-home__act" onClick={() => setActionSheetOpen(true)}>
          행동
        </button>
        <button className="sc-home__reveal-btn" onClick={() => setRevealOpen(true)} disabled={!myRole}>
          공개
        </button>
        <input
          value={draft}
          placeholder="교실에 말하기"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <button className="sc-home__send" onClick={submit} disabled={!draft.trim()}>
          →
        </button>
      </div>

      {actionSheetOpen && <ActionSheet onClose={() => setActionSheetOpen(false)} />}

      {revealOpen && myRole && (
        <RevealSheet
          role={myRole}
          scopeLabel="교실 전체에"
          onClose={() => setRevealOpen(false)}
          onReveal={(kind, custom) => revealToClass(kind, custom)}
        />
      )}
    </div>
  )
}
