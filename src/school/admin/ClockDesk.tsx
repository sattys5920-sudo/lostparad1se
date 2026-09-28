// 운영자 — 개발용 시계. 배속(×1~×240)과 시각 점프. **서버가 운영자를 확인한다.**
//
// 판의 모든 시각 판단이 이 시계를 본다(shared/rules/clock gameNow). 배속을
// 걸면 페이즈 한 시간이 실제 1분(×60)으로 흐른다. 점프는 지금 시각을
// 그 시각으로 옮기고 배속은 그대로 둔다.
import { useState } from 'react'

import { DEV_CLOCK_SPEED_MAX, DEV_CLOCK_SPEED_MIN } from '../../../shared/rules/v2'
import { dayHourMs } from '../../../shared/rules/clock'
import type { GameDoc } from '../../../shared/model'
import type { GameActions } from '../game/useGame'

const SPEEDS = [1, 10, 60, 120, 240]

function seoul(ms: number): string {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(ms))
}

export function ClockDesk({ game, nowMs, act, onSaid }: { game: GameDoc; nowMs: number; act: GameActions; onSaid: (t: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [speed, setSpeed] = useState(game.clock?.speed ?? 1)
  const set = async (anchorGameMs: number, sp: number) => {
    setBusy(true)
    try {
      await act.setDevClock(anchorGameMs, sp)
      setSpeed(sp)
      onSaid(`시계 — ${seoul(anchorGameMs)} · ×${sp}`)
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const started = game.startedAtMs ?? null
  return (
    <div className="sc-ck">
      <p className="sc-ad__hint">
        지금 <b>{seoul(nowMs)}</b> · 배속 ×{game.clock?.speed ?? 1}
        {game.clock && game.clock.speed !== 1 ? ' (개발용 시계)' : ''}
      </p>
      <div className="sc-ad__row">
        <label>
          배속{' '}
          <select id="ck-speed" value={speed} disabled={busy} onChange={(e) => setSpeed(Number(e.target.value))}>
            {SPEEDS.filter((s) => s >= DEV_CLOCK_SPEED_MIN && s <= DEV_CLOCK_SPEED_MAX).map((s) => (
              <option key={s} value={s}>
                ×{s}
              </option>
            ))}
          </select>
        </label>
        <button disabled={busy} onClick={() => void set(nowMs, speed)}>
          배속 적용
        </button>
      </div>
      <div className="sc-ad__row">
        <button disabled={busy} onClick={() => void set(nowMs + 3_600_000, speed)}>+1시간</button>
        <button disabled={busy} onClick={() => void set(nowMs + 86_400_000, speed)}>+1일</button>
        {started !== null && (
          <>
            {[1, 2, 3, 4].map((d) => (
              <button key={d} disabled={busy} onClick={() => void set(dayHourMs(started, d, 8), speed)}>
                DAY {d} 08:00
              </button>
            ))}
          </>
        )}
        <button disabled={busy} onClick={() => void set(Date.now(), 1)}>실제 시각 ×1</button>
      </div>
    </div>
  )
}
