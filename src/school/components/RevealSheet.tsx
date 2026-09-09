import { useState } from 'react'
import './RevealSheet.css'
import { REVEAL_OPTIONS } from '../engine/reveals'
import type { RevealKind, RoleSpec } from '../types'

export function RevealSheet({
  role,
  scopeLabel,
  onClose,
  onReveal,
}: {
  role: RoleSpec
  /** '교실 전체에' 또는 '도윤에게' 처럼, 어디로 나가는지 본인이 착각하지 않게 하는 문구. */
  scopeLabel: string
  onClose: () => void
  onReveal: (kind: RevealKind, custom: string) => Promise<void>
}) {
  const [kind, setKind] = useState<RevealKind | null>(null)
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)

  const option = REVEAL_OPTIONS.find((o) => o.kind === kind) ?? null
  const preview = option ? (option.kind === 'custom' ? custom.trim() : option.preview(role)) : ''
  const canSubmit = Boolean(kind) && preview.length > 0

  async function submit() {
    if (!kind || !canSubmit) return
    setBusy(true)
    try {
      await onReveal(kind, custom)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sc-reveal-sheet__backdrop" onClick={onClose}>
      <div className="sc-reveal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sc-reveal-sheet__head">
          <span>{scopeLabel} 공개하기</span>
          <button className="sc-reveal-sheet__close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="sc-reveal-sheet__body">
          <div className="sc-reveal-sheet__options">
            {REVEAL_OPTIONS.map((o) => (
              <button
                key={o.kind}
                className={`sc-reveal-sheet__option ${kind === o.kind ? 'is-selected' : ''}`}
                onClick={() => setKind(o.kind)}
              >
                <span>{o.label}</span>
                {o.heavy && <span className="sc-reveal-sheet__heavy">되돌릴 수 없음</span>}
              </button>
            ))}
          </div>

          {kind === 'custom' && (
            <textarea
              value={custom}
              placeholder="무엇을 털어놓을지 직접 쓴다"
              onChange={(e) => setCustom(e.target.value)}
              rows={3}
            />
          )}

          {kind && kind !== 'custom' && <p className="sc-reveal-sheet__preview">“{preview}”</p>}

          <p className="sc-reveal-sheet__warning">한 번 공개하면 상대 화면에 그대로 남는다.</p>

          <button className="sc-reveal-sheet__submit" disabled={!canSubmit || busy} onClick={submit}>
            공개한다
          </button>
        </div>
      </div>
    </div>
  )
}
