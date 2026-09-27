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

