// 오락기 게임들이 같이 쓰는 화면 조각 — 셈 덮개, 결과 목록.
// 시계와 기록 내기는 arcadeTime 에 있다.

import { ARCADE_BY_ID, type ArcadeOutcome } from '../../../shared/rules/arcade'
import { EndRow } from './ArcadeEnd'
import { BIG } from './arcadeTime'
import type { LiveRoom } from './useArcade'

/** 셈 덮개. 판 위에 크게 3 · 2 · 1 */
export function Countdown({ n }: { n: number }) {
  if (n <= 0) return null
  return (
    <p className="sc-kit__count" aria-live="assertive">
      {n}
    </p>
  )
}

const WORD: Record<ArcadeOutcome, string> = { win: '이김', lose: '짐', draw: '비김' }

/**
 * 끝난 판. **서버가 적은 결과만 보인다** — 사람마다 이김·짐과 한 줄.
 * 제일 잘한 사람부터.
 */
export function Results({ room, meId, title, onAgain, onMenu }: {
  room: LiveRoom
  meId: string
  title?: string
  onAgain: () => void
  onMenu: () => void
}) {
  const spec = ARCADE_BY_ID[room.game]
  const results = room.results ?? {}
  const mine = results[meId]
  const rows = room.members
    .filter((m) => results[m.id])
    .sort((a, b) => results[b.id].score - results[a.id].score)
  // 겨루기는 이김·짐, 혼자와 협동(과 혼자 한 겨루기)은 깼나 못 깼나
  const alone = rows.length <= 1
  const big = !mine ? '' : spec.mode === 'versus' && !alone ? BIG[mine.outcome] : mine.outcome === 'win' ? 'CLEAR!' : 'FAILED'
  return (
    <div className="sc-kit__end">
      <p className="sc-ar__title">{title ?? spec.name} <span>결과</span></p>
      {mine && <p className={`sc-ud__big is-${mine.outcome}`}>{big}</p>}
      {rows.length > 1 ? (
        <ol className="sc-kit__rows">
          {rows.map((m) => (
            <li key={m.id} className={`is-${results[m.id].outcome}`}>
              <b>{m.id === meId ? '나' : m.name}</b>
              <span>{results[m.id].line}</span>
              <em>{spec.mode === 'coop' ? '' : WORD[results[m.id].outcome]}</em>
            </li>
          ))}
        </ol>
      ) : (
        mine && <p className="sc-rh__line">{mine.line}</p>
      )}
      <EndRow onAgain={onAgain} onMenu={onMenu} />
    </div>
  )
}


const PAD_COLOR = ['#ff8fb0', '#f0d68a', '#6fd3ff', '#9fe0a0']

/**
 * 드럼 패드 넷. 2×2 로 크게 — 손가락이 안 보고도 찾는다. lit 은 지금
 * 불이 들어온 패드(들을 때 기계가 친 것, 칠 때 내가 친 것).
 */
export function BeatPads({ lit, names, onHit, disabled = false }: {
  lit: readonly boolean[]
  names: readonly string[]
  onHit: (pad: number) => void
  disabled?: boolean
}) {
  return (
    <div className="sc-bt__pads">
      {names.map((n, i) => (
        <button
          key={i}
          className={lit[i] ? 'is-lit' : ''}
          style={{ ['--pad' as string]: PAD_COLOR[i] }}
          disabled={disabled}
          aria-label={n}
          onPointerDown={(e) => {
            e.preventDefault()
            onHit(i)
          }}
        >
          {n}
        </button>
      ))}
    </div>
  )
}

/** 목숨. 하트 대신 네모 — 오락기 화면이다 */
export function Lives({ left, of }: { left: number; of: number }) {
  return (
    <span className="sc-bt__lives" aria-label={`목숨 ${left}`}>
      {Array.from({ length: of }, (_, i) => <i key={i} className={i < left ? 'is-on' : ''} />)}
    </span>
  )
}

/** 리듬의 박 수만큼 점. 칠 때는 맞춘 박이 찬다 */
export function BeatDots({ n, filled }: { n: number; filled: readonly boolean[] }) {
  return (
    <ol className="sc-bt__dots" aria-label={`${n} 박`}>
      {Array.from({ length: n }, (_, i) => <li key={i} className={filled[i] ? 'is-on' : ''} />)}
    </ol>
  )
}
