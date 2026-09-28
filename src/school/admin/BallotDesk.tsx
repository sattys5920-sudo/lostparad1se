// 운영자 — 투명인간 투표의 문. 열면 투표 탭이 열리고, 닫으면 그 자리에서 센다.
import { useState } from 'react'

import { TOTAL_DAYS } from '../../../shared/rules/v2'
import type { GameDoc } from '../../../shared/model'
import type { GameActions } from '../game/useGame'

export function BallotDesk({ game, act, onSaid }: { game: GameDoc; act: GameActions; onSaid: (t: string) => void }) {
  const [busy, setBusy] = useState(false)
  const day = game.day
  const open = game.ballot?.open === true && game.ballot.day === day
  const counted = String(day + 1) in (game.invisibleByDay ?? {})
  const last = day >= TOTAL_DAYS
  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      onSaid(`${label} 했다.`)
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="sc-ad__row">
      <span className="sc-ad__pill">
        DAY {day} 투표 · {last ? '마지막 날 없음' : counted ? '셌다' : open ? '열림' : '닫힘'}
      </span>
      {!last && !counted && (
        open ? (
          <button className="sc-ad__danger" disabled={busy} onClick={() => void run('투표 닫기 · 집계', () => act.hostCloseBallot())}>
            투표 닫기
          </button>
        ) : (
          <button className="is-primary" disabled={busy} onClick={() => void run('투표 열기', () => act.hostOpenBallot())}>
            투표 열기
          </button>
        )
      )}
    </div>
  )
}
