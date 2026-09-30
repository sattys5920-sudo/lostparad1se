// 1 to 50 — 5×5 판. 1부터 50까지 차례로 누른다.
//
// 넷이 겨루면 넷 다 같은 판이다(같은 씨앗). 틀리게 누르면 판이 잠깐
// 잠긴다. 50 을 누르거나 시간이 다 되면 누른 기록을 서버로 보내고,
// 서버가 다시 돌려 시간을 잰다.
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  FIFTY_LAST,
  FIFTY_LIMIT_MS,
  fiftyBoard,
  fiftyStart,
  fiftyTap,
  type FiftyTap,
} from '../../../shared/rules/arcadeFifty'
import { chip, tone } from './chip'
import { Countdown, Results } from './arcadeKit'
import { countdown, serverNow, submitLog, useNow } from './arcadeTime'
import type { GameActions } from './useGame'
import type { LiveRoom } from './useArcade'

type Phase = 'play' | 'send' | 'sent' | 'fail'

export function Fifty({ room, meId, act, onAgain, onMenu, onQuit }: {
  room: LiveRoom
  meId: string
  act: GameActions
  onAgain: () => void
  onMenu: () => void
  onQuit: () => void
}) {
  const board = useMemo(() => fiftyBoard(room.seed ?? 0), [room.seed])
  const [state, setState] = useState(() => fiftyStart(board))
  /** 한 프레임에 두 번 눌려도 앞의 것을 딛고 판정한다 — 그린 값(state)은 한 박자 늦다 */
  const live = useRef(state)
  const [phase, setPhase] = useState<Phase>(room.doneIds.includes(meId) ? 'sent' : 'play')
  const [err, setErr] = useState<string | null>(null)
  const [shake, setShake] = useState(false)
  const taps = useRef<FiftyTap[]>([])
  const done = room.status === 'done'
  const now = useNow(!done && phase === 'play')
  const start = room.startAtMs ?? 0
  const t = now - start
  const locked = t < state.lockUntil

  const send = async () => {
    setPhase('send')
    const bad = await submitLog(act, room.id, taps.current)
    if (bad) {
      setErr(bad)
      setPhase('fail')
    } else setPhase('sent')
  }

  // 시간이 다 되면 거기까지 낸다
  useEffect(() => {
    if (phase === 'play' && !done && t > FIFTY_LIMIT_MS) void send()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t > FIFTY_LIMIT_MS])

  const press = (cell: number) => {
    // 누른 그 순간의 시각. 마지막으로 그린 때의 시각을 쓰면 한 프레임 늦다
    const at = serverNow() - start
    if (phase !== 'play' || at < 0) return
    const tap = { t: Math.round(at), cell }
    const r = fiftyTap(board, live.current, tap)
    if (r.hit === null) return
    taps.current.push(tap)
    live.current = r.s
    setState(r.s)
    const a = chip()
    if (r.hit) {
      if (a && a.state === 'running') tone(a, a.currentTime, 440 + r.s.next * 8, 0.05, 0.05)
      if (r.s.doneAt !== null) void send()
    } else {
      if (a && a.state === 'running') tone(a, a.currentTime, 120, 0.15, 0.07, 'sawtooth')
      setShake(true)
      setTimeout(() => setShake(false), 260)
    }
  }

  if (done) return <Results room={room} meId={meId} onAgain={onAgain} onMenu={onMenu} />

  const secs = Math.max(0, (state.doneAt ?? Math.min(t, FIFTY_LIMIT_MS)) / 1000)
  return (
    <div className="sc-ff">
      <p className="sc-ar__title">1 to 50 <span>다음 {Math.min(state.next, FIFTY_LAST)}</span></p>
      <p className="sc-ff__clock" aria-live="off">{secs.toFixed(2)} 초</p>
      <div className="sc-rh__stage">
        <div className={`sc-ff__grid${shake ? ' is-shake' : ''}${locked ? ' is-locked' : ''}`}>
          {state.cells.map((n, i) => (
            <button
              key={i}
              className={n === null ? 'is-empty' : n > FIFTY_LAST / 2 ? 'is-back' : ''}
              disabled={n === null}
              onPointerDown={(e) => {
                e.preventDefault()
                press(i)
              }}
            >
              {n ?? ''}
            </button>
          ))}
        </div>
        <Countdown n={countdown(room, now)} />
        {phase !== 'play' && (
          <p className="sc-rh__over" role="status">
            {phase === 'send' ? '채점 중…' : phase === 'sent' ? '다른 사람을 기다린다…' : err ?? '못 냈다'}
          </p>
        )}
      </div>
      <div className="sc-ar__row">
        <button onClick={onQuit}>그만둔다</button>
      </div>
    </div>
  )
}
