// 둘이서 한 곡 — 번갈아 따라 치고 한 박씩 보태 곡을 만든다.
//
// 차례마다 지금까지의 곡이 **둘 다에게** 울린다(서버가 정한 벽시계에
// 맞춰). 차례인 사람은 곡을 따라 친 뒤 곡 끝 한 마디 안에 제 박을 하나
// 친다. 그 차례가 닫히면 누른 기록이 서버로 가고, 서버가 판정해 곡에
// 박을 붙이거나(깸) 팀 목숨을 깎는다(틀림).
import { useEffect, useRef, useState } from 'react'

import {
  BEAT_PADS,
  COUNT_IN,
  PAD_NAME,
  RELAY_GOAL,
  RELAY_LIVES,
  judgeRound,
  relayTimes,
  relayWho,
  type BeatTap,
} from '../../../shared/rules/arcadeBeat'
import { josa } from '../../../shared/text'
import { chip, click, pad as padSound } from './chip'
import { BeatDots, BeatPads, Countdown, Lives, Results } from './arcadeKit'
import { countdown, serverNow, useNow } from './arcadeTime'
import type { GameActions } from './useGame'
import type { LiveRoom } from './useArcade'

const KEYS: Record<string, number> = { d: 0, f: 1, j: 2, k: 3, D: 0, F: 1, J: 2, K: 3 }
const LIT_MS = 140
const AHEAD_MS = 150
/** 차례가 닫히고 이만큼 뒤에 낸다 — 마지막 박이 판정 창 끝에 걸려도 들어가게 */
const SEND_AFTER_MS = 60

export function Relay({ room, meId, act, onAgain, onMenu, onQuit }: {
  room: LiveRoom
  meId: string
  act: GameActions
  onAgain: () => void
  onMenu: () => void
  onQuit: () => void
}) {
  const s = room.relay
  const done = room.status === 'done'
  const now = useNow(!done)
  const [flash, setFlash] = useState<number[]>(() => Array.from({ length: BEAT_PADS }, () => -Infinity))
  const [say, setSay] = useState<string | null>(null)
  /** 이번 차례에 누른 것(벽시계). 차례가 바뀌면 비운다 */
  const taps = useRef<{ turn: number; list: BeatTap[] }>({ turn: -1, list: [] })
  const sentTurn = useRef(-1)

  // 소리 — 셈과 곡은 차례마다 모두에게 울린다
  useEffect(() => {
    if (!s || done) return
    const tm = relayTimes(s)
    const evs: { t: number; play: (a: AudioContext, w: number) => void }[] = []
    for (let i = 0; i < COUNT_IN; i += 2) {
      evs.push({ t: tm.listenAt + i * tm.e, play: (a, w) => click(a, w, i === 0) })
      evs.push({ t: tm.answerAt + i * tm.e, play: (a, w) => click(a, w, i === 0) })
    }
    for (const n of s.notes) evs.push({ t: tm.listenZero + n.step * tm.e, play: (a, w) => padSound(a, n.pad, w) })
    const sent = new Set<number>()
    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const a = chip()
      if (!a || a.state !== 'running') return
      const t = serverNow()
      evs.forEach((ev, i) => {
        if (sent.has(i) || ev.t > t + AHEAD_MS || ev.t < t - 30) return
        sent.add(i)
        ev.play(a, a.currentTime + Math.max(0, (ev.t - t) / 1000))
      })
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [s, done])

  // 내 차례가 닫히면 누른 것을 낸다. 차례가 열린 때부터의 ms 로 바꿔서
  const mine = !!s && relayWho(s) === meId
  const closeAt = s ? relayTimes(s).closeAt : 0
  useEffect(() => {
    if (!s || done || !mine || sentTurn.current === s.turn) return
    const wait = closeAt + SEND_AFTER_MS - serverNow()
    const timer = setTimeout(() => {
      sentTurn.current = s.turn
      const list = taps.current.turn === s.turn ? taps.current.list : []
      act.arcadePlay(room.id, { taps: list.map((x) => ({ t: x.t - s.turnAtMs, pad: x.pad })) }).catch((e) => setSay((e as Error).message))
    }, Math.max(0, wait))
    return () => clearTimeout(timer)
  }, [s, done, mine, closeAt, act, room.id])

  const hit = (p: number) => {
    if (!s) return
    const at = serverNow()
    if (mine && at >= relayTimes(s).listenAt && at < closeAt) {
      if (taps.current.turn !== s.turn) taps.current = { turn: s.turn, list: [] }
      taps.current.list.push({ t: Math.round(at), pad: p })
    }
    setFlash((f) => f.map((x, i) => (i === p ? performance.now() : x)))
    const a = chip()
    if (a && a.state === 'running') padSound(a, p, a.currentTime)
  }
  const hitRef = useRef(hit)
  hitRef.current = hit
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const p = KEYS[e.key]
      if (p === undefined) return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (!e.repeat) hitRef.current(p)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  if (done) return <Results room={room} meId={meId} onAgain={onAgain} onMenu={onMenu} />
  if (!s || room.startAtMs === null) return null

  const tm = relayTimes(s)
  const who = relayWho(s)
  const nameOf = (id: string | null) => (id === meId ? '나' : (room.members.find((m) => m.id === id)?.name ?? '?'))
  const t = now
  const beatsLeft = (to: number) => Math.max(1, Math.ceil((to - t) / (tm.e * 2)))
  const lit = Array.from({ length: BEAT_PADS }, (_, p) => {
    if (performance.now() - flash[p] < LIT_MS) return true
    if (t < tm.listenZero || t >= tm.answerAt) return false
    return s.notes.some((n) => n.pad === p && t >= tm.listenZero + n.step * tm.e && t < tm.listenZero + n.step * tm.e + LIT_MS)
  })
  const myTaps = taps.current.turn === s.turn ? taps.current.list : []
  const live = mine && t >= tm.from ? judgeRound(s.notes, tm.answerZero, tm.e, myTaps, tm.from, Math.min(t + 1, tm.addFrom)) : null
  const banner = s.last && t < tm.listenZero
    ? s.last.ok
      ? `${nameOf(s.last.by)}: 좋다! ${s.last.added ? `+${PAD_NAME[s.last.added.pad]}` : ''}`
      : `${nameOf(s.last.by)}: 틀렸다 — 목숨 하나`
    : null
  const step =
    t < tm.listenZero ? `들어 봐 · ${beatsLeft(tm.listenZero)}`
    : t < tm.answerAt ? '듣는 중…'
    : t < tm.answerZero ? (mine ? `따라 쳐 · ${beatsLeft(tm.answerZero)}` : `${nameOf(who)} 차례 · ${beatsLeft(tm.answerZero)}`)
    : t < tm.addFrom ? (mine ? '따라 치는 중' : `${nameOf(who)}${josa(nameOf(who), '이/가')} 치는 중`)
    : t < tm.closeAt ? (mine ? '하나 보태!' : `${nameOf(who)}${josa(nameOf(who), '이/가')} 보태는 중`)
    : '듣는다…'

  return (
    <div className="sc-bt">
      <p className="sc-ar__title">
        둘이서 한 곡 <span>{s.notes.length}박 · 목표 {RELAY_GOAL}박 · {tm.bpm} BPM</span>
      </p>
      <div className="sc-bt__head">
        <Lives left={s.lives} of={RELAY_LIVES} />
        <p className={`sc-bt__say${banner ? (s.last?.ok ? ' is-ok' : ' is-bad') : mine && t >= tm.addFrom && t < tm.closeAt ? ' is-add' : ''}`}>
          {banner ?? step}
        </p>
      </div>
      <ol className="sc-tw__order">
        {s.order.map((id) => (
          <li key={id} className={id === who ? 'is-turn' : ''}>{nameOf(id)}</li>
        ))}
      </ol>
      <BeatDots n={s.notes.length} filled={live?.hit ?? []} />
      <div className="sc-rh__stage">
        <BeatPads lit={lit} names={PAD_NAME} onHit={hit} />
        <Countdown n={countdown(room, now)} />
      </div>
      {say && <p className="sc-ar__say">{say}</p>}
      <div className="sc-ar__row">
        <button onClick={onQuit}>그만둔다</button>
      </div>
    </div>
  )
}
