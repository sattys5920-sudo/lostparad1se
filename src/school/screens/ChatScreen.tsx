import { useEffect, useRef, useState } from 'react'
import './ChatScreen.css'
import { useSchoolGame } from '../state/SchoolGameContext'
import { RevealSheet } from '../components/RevealSheet'
import { REVEAL_LABEL } from '../engine/reveals'
import { withParticle } from '../lib/particle'

export function ChatScreen({ otherId, onBack }: { otherId: string; onBack: () => void }) {
  const { players, viewerId, myRole, dmWith, sendDm, revealToPerson } = useSchoolGame()
  const [draft, setDraft] = useState('')
  const [revealOpen, setRevealOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const other = players[otherId]
  const messages = dmWith(otherId)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages.length])

  async function submit() {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    await sendDm(otherId, text)
  }

  return (
    <div className="sc-chat">
      <div className="sc-chat__head">
        <button className="sc-chat__back" onClick={onBack}>
          ←
        </button>
        <span className="sc-chat__name">{other?.nickname ?? '???'}</span>
        <span className="sc-chat__note">둘만 본다</span>
      </div>

      <div className="sc-chat__feed" ref={scrollRef}>
        {messages.length === 0 && <p className="sc-chat__empty">아직 아무 말도 하지 않았다.</p>}
        {messages.map((m) => {
          const mine = m.authorId === viewerId
          if (m.kind === 'reveal') {
            return (
              <div key={m.id} className={`sc-chat__reveal ${mine ? 'is-mine' : ''}`}>
                <span className="sc-chat__reveal-label">
                  {mine ? '내가 공개했다' : `${withParticle(other?.nickname ?? '???', 'subject')} 공개했다`} ·{' '}
                  {REVEAL_LABEL[m.revealKind ?? 'custom']}
                </span>
                <span className="sc-chat__reveal-text">{m.text}</span>
              </div>
            )
          }
          return (
            <div key={m.id} className={`sc-chat__msg ${mine ? 'is-mine' : ''}`}>
              <span className="sc-chat__msg-text">{m.text}</span>
            </div>
          )
        })}
      </div>

      <div className="sc-chat__composer">
        <button className="sc-chat__reveal-btn" onClick={() => setRevealOpen(true)} disabled={!myRole}>
          공개
        </button>
        <input
          value={draft}
          placeholder={`${other?.nickname ?? ''}에게 말하기`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <button className="sc-chat__send" onClick={submit} disabled={!draft.trim()}>
          →
        </button>
      </div>

      {revealOpen && myRole && (
        <RevealSheet
          role={myRole}
          scopeLabel={`${other?.nickname ?? '이 사람'}에게`}
          onClose={() => setRevealOpen(false)}
          onReveal={(kind, custom) => revealToPerson(otherId, kind, custom)}
        />
      )}
    </div>
  )
}
