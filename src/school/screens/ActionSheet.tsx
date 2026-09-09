import { useState } from 'react'
import './ActionSheet.css'
import { useSchoolGame } from '../state/SchoolGameContext'
import { ACTIONS, actionByKind } from '../data/actions'
import type { ActionKind } from '../types'

const VISIBLE_ACTIONS = ACTIONS.filter((a) => a.kind !== 'groupPost')

export function ActionSheet({ onClose }: { onClose: () => void }) {
  const { players, otherPlayerIds, session, performAction, spreadRumor } = useSchoolGame()
  const [kind, setKind] = useState<ActionKind | null>(null)
  const [targetId, setTargetId] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [parentRumorId, setParentRumorId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const spec = kind ? actionByKind[kind] : null
  const canSubmit = Boolean(
    kind && (!spec?.needsTarget || targetId) && (!spec?.needsText || text.trim()),
  )

  async function submit() {
    if (!kind || !canSubmit) return
    setBusy(true)
    try {
      if (kind === 'spreadRumor' && targetId) {
        await spreadRumor(targetId, text.trim(), parentRumorId)
      } else {
        await performAction(kind, targetId, text.trim() || null)
      }
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sc-sheet__backdrop" onClick={onClose}>
      <div className="sc-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sc-sheet__head">
          <span>오늘의 행동</span>
          <button className="sc-sheet__close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="sc-sheet__body">
          {!kind && (
            <div className="sc-sheet__grid">
              {VISIBLE_ACTIONS.map((a) => (
                <button key={a.kind} className="sc-sheet__option" onClick={() => setKind(a.kind)}>
                  <span className="sc-sheet__option-label">{a.label}</span>
                  <span className="sc-sheet__option-desc">{a.description}</span>
                </button>
              ))}
            </div>
          )}

          {kind && spec && (
            <div className="sc-sheet__form">
              <button className="sc-sheet__back" onClick={() => setKind(null)}>
                ← 다른 행동 고르기
              </button>
              <div className="sc-sheet__chosen">{spec.label}</div>

              {spec.needsTarget && (
                <div className="sc-sheet__targets">
                  {otherPlayerIds.map((id) => (
                    <button
                      key={id}
                      className={`sc-sheet__target ${targetId === id ? 'is-selected' : ''}`}
                      onClick={() => setTargetId(id)}
                    >
                      {players[id]?.nickname ?? '???'}
                    </button>
                  ))}
                </div>
              )}

              {kind === 'spreadRumor' && session.rumors.length > 0 && (
                <div className="sc-sheet__rumors">
                  <span className="sc-sheet__rumors-label">떠도는 이야기 중에서 옮기기</span>
                  <div className="sc-sheet__rumor-list">
                    {session.rumors.slice(-6).map((r) => (
                      <button
                        key={r.id}
                        className={`sc-sheet__rumor ${parentRumorId === r.id ? 'is-selected' : ''}`}
                        onClick={() => {
                          setParentRumorId(r.id)
                          setText(r.text)
                        }}
                      >
                        {r.text}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {spec.needsText && (
                <textarea
                  value={text}
                  placeholder={kind === 'spreadRumor' ? '들은 대로 옮겨도, 조금 다르게 옮겨도 된다' : '무슨 말을 할지 적는다'}
                  onChange={(e) => setText(e.target.value)}
                  rows={3}
                />
              )}

              <button className="sc-sheet__submit" disabled={!canSubmit || busy} onClick={submit}>
                한다
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
