// 두더지 잡기 — 아홉 구멍, 30초. 두더지 +1, 금두더지 +3, 폭탄 −3, 빈 구멍 −1.
//
// 언제 무엇이 나오는지는 씨앗에서 나온다 — 넷이 겨루면 넷 다 같은
// 두더지를 친다. 끝나면 누른 기록을 서버로 보내고 서버가 다시 센다.
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  MOLE_HOLES,
  MOLE_MS,
  MOLE_POINTS,
  MOLE_EMPTY,
  moleSchedule,
  moleStart,
  moleTap,
  upAt,
  type MoleKind,
  type MoleTap,
} from '../../../shared/rules/arcadeMole'
import { chip, kick, tone } from './chip'
import { Countdown, Results } from './arcadeKit'
import { countdown, serverNow, submitLog, useNow } from './arcadeTime'
import type { GameActions } from './useGame'
import type { LiveRoom } from './useArcade'

type Phase = 'play' | 'send' | 'sent' | 'fail'
/** 친 자리에 점수가 떠 있는 시간 */
const POP_MS = 500
const FACE: Record<MoleKind, string> = { mole: '두더지', gold: '금두더지', bomb: '폭탄' }

export function Mole({ room, meId, act, onAgain, onMenu, onQuit }: {
  room: LiveRoom
  meId: string
  act: GameActions
  onAgain: () => void
  onMenu: () => void
  onQuit: () => void
}) {
  const pops = useMemo(() => moleSchedule(room.seed ?? 0), [room.seed])
  const [state, setState] = useState(() => moleStart(pops))
  /** 한 프레임에 두 번 눌려도 앞의 것을 딛고 판정한다 — 그린 값(state)은 한 박자 늦다 */
  const live = useRef(state)
  const [phase, setPhase] = useState<Phase>(room.doneIds.includes(meId) ? 'sent' : 'play')
  const [err, setErr] = useState<string | null>(null)
  const [float, setFloat] = useState<{ hole: number; v: number; at: number }[]>([])
  const taps = useRef<MoleTap[]>([])
  const done = room.status === 'done'
  const now = useNow(!done && phase === 'play')
  const t = now - (room.startAtMs ?? 0)

  const send = async () => {
    setPhase('send')
    const bad = await submitLog(act, room.id, taps.current)
    if (bad) {
      setErr(bad)
      setPhase('fail')
    } else setPhase('sent')
  }
  useEffect(() => {
    if (phase === 'play' && !done && t > MOLE_MS) void send()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t > MOLE_MS])

  const hit = (hole: number) => {
    // 누른 그 순간의 시각. 마지막으로 그린 때의 시각을 쓰면 한 프레임 늦다
    const at = serverNow() - (room.startAtMs ?? 0)
    if (phase !== 'play' || at < 0 || at > MOLE_MS) return
    const tap = { t: Math.round(at), hole }
    const r = moleTap(pops, live.current, tap)
    if (r.got === null) return
    taps.current.push(tap)
    live.current = r.s
    setState(r.s)
    const v = r.got === 'empty' ? MOLE_EMPTY : MOLE_POINTS[r.got]
    setFloat((f) => [...f.filter((x) => at - x.at < POP_MS), { hole, v, at }])
    const a = chip()
    if (a && a.state === 'running') {
      if (r.got === 'bomb') kick(a, a.currentTime, 0.4)
      else if (r.got === 'empty') tone(a, a.currentTime, 180, 0.05, 0.04, 'triangle')
      else tone(a, a.currentTime, r.got === 'gold' ? 1320 : 880, 0.07, 0.06)
    }
  }

  if (done) return <Results room={room} meId={meId} onAgain={onAgain} onMenu={onMenu} />

  const left = Math.max(0, Math.min(MOLE_MS, MOLE_MS - Math.max(0, t)))
  return (
    <div className="sc-ml">
      <p className="sc-ar__title">두더지 잡기 <span>{state.score}점 · 폭탄은 치지 마라</span></p>
      <div className="sc-ml__bar"><i style={{ width: `${(left / MOLE_MS) * 100}%` }} /></div>
      <div className="sc-rh__stage">
        <div className="sc-ml__grid">
          {Array.from({ length: MOLE_HOLES }, (_, h) => {
            const i = t >= 0 ? upAt(pops, h, t) : -1
            const kind = i >= 0 && !state.hit[i] ? pops[i].kind : null
            const f = float.filter((x) => x.hole === h && t - x.at < POP_MS).at(-1)
            return (
              <button
                key={h}
                className={`sc-ml__hole${kind ? ` is-${kind}` : ''}`}
                aria-label={kind ? FACE[kind] : '빈 구멍'}
                onPointerDown={(e) => {
                  e.preventDefault()
                  hit(h)
                }}
              >
                <i />
                {f && <em className={f.v > 0 ? 'is-plus' : 'is-minus'}>{f.v > 0 ? `+${f.v}` : f.v}</em>}
              </button>
            )
          })}
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
