// 리듬 쌓기 — 들은 리듬을 따라 치고, 판마다 한 박씩 쌓아 간다.
//
// 화면은 규칙 파일의 soloRun 을 매 프레임 불러 「지금 몇 번째 판의 어느
// 때인가」를 알고, 들을 때는 기계가 치는 박을 소리와 불로 내고, 칠 때는
// 누른 시각과 패드만 적어 둔다. 판이 다 끝나면 그 기록만 서버로 가고,
// 서버가 같은 soloRun 으로 처음부터 다시 판정한다.
import { useEffect, useRef, useState } from 'react'

import {
  BEAT_PADS,
  COUNT_IN,
  PAD_NAME,
  SOLO_LIVES,
  judgeRound,
  soloRun,
  type BeatTap,
  type SoloRound,
} from '../../../shared/rules/arcadeBeat'
import { chip, click, pad as padSound } from './chip'
import { BeatDots, BeatPads, Countdown, Lives, Results } from './arcadeKit'
import { countdown, serverNow, submitLog, useNow } from './arcadeTime'
import type { GameActions } from './useGame'
import type { LiveRoom } from './useArcade'

/** 패드 키. D·F·J·K */
const KEYS: Record<string, number> = { d: 0, f: 1, j: 2, k: 3, D: 0, F: 1, J: 2, K: 3 }
/** 들을 때 박이 울린 뒤 패드에 불이 남아 있는 시간 */
const LIT_MS = 140
/** 소리를 미리 걸어 두는 폭 */
const AHEAD_MS = 150

type Phase = 'play' | 'send' | 'sent' | 'fail'

/** 한 판에서 울릴 것 — 듣기·치기 셈과 들을 때의 박. 판 시작부터의 ms */
function roundSounds(r: SoloRound): { key: string; t: number; play: (a: AudioContext, w: number) => void }[] {
  const out: { key: string; t: number; play: (a: AudioContext, w: number) => void }[] = []
  for (let i = 0; i < COUNT_IN; i += 2) {
    out.push({ key: `${r.index}:c${i}`, t: r.listenAt + i * r.e, play: (a, w) => click(a, w, i === 0) })
    out.push({ key: `${r.index}:a${i}`, t: r.answerAt + i * r.e, play: (a, w) => click(a, w, i === 0) })
  }
  for (const n of r.notes) out.push({ key: `${r.index}:n${n.step}`, t: r.listenZero + n.step * r.e, play: (a, w) => padSound(a, n.pad, w) })
  return out
}

export function Beat({ room, meId, act, onAgain, onMenu, onQuit }: {
  room: LiveRoom
  meId: string
  act: GameActions
  onAgain: () => void
  onMenu: () => void
  onQuit: () => void
}) {
  const seed = room.seed ?? 0
  const start = room.startAtMs ?? 0
  const taps = useRef<BeatTap[]>([])
  const [flash, setFlash] = useState<number[]>(() => Array.from({ length: BEAT_PADS }, () => -Infinity))
  const [phase, setPhase] = useState<Phase>(room.doneIds.includes(meId) ? 'sent' : 'play')
  const [err, setErr] = useState<string | null>(null)
  const done = room.status === 'done'
  const now = useNow(!done && phase === 'play')
  const t = now - start
  const run = soloRun(seed, taps.current, t)

  // 소리 — 앞으로 잠깐 안에 울릴 셈과 박을 미리 걸어 둔다. 한 번씩만
  useEffect(() => {
    if (done || phase !== 'play') return
    const sent = new Set<string>()
    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const a = chip()
      const tt = serverNow() - start
      const cur = soloRun(seed, taps.current, tt).current
      if (!a || a.state !== 'running' || !cur) return
      for (const ev of roundSounds(cur)) {
        if (sent.has(ev.key) || ev.t > tt + AHEAD_MS || ev.t < tt - 30) continue
        sent.add(ev.key)
        ev.play(a, a.currentTime + Math.max(0, (ev.t - tt) / 1000))
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [done, phase, seed, start])

  // 끝나면 기록을 낸다
  useEffect(() => {
    if (phase !== 'play' || done || !run.over || run.endMs === null || t < run.endMs) return
    setPhase('send')
    void submitLog(act, room.id, taps.current).then((bad) => {
      if (bad) {
        setErr(bad)
        setPhase('fail')
      } else setPhase('sent')
    })
  }, [phase, done, run.over, run.endMs, t, act, room.id])

  const hit = (p: number) => {
    const at = Math.round(serverNow() - start)
    if (phase !== 'play' || at < 0) return
    taps.current.push({ t: at, pad: p })
    setFlash((f) => f.map((x, i) => (i === p ? performance.now() : x)))
    const a = chip()
    if (a && a.state === 'running') padSound(a, p, a.currentTime)
  }

  // 키보드. 지도도 방향키·글자키를 듣는다 — 먼저 가로챈다
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

  const cur = run.current
  const last = [...run.rounds].reverse().find((r) => r.judge)
  const between = !!last && (!cur || t < cur.listenAt)
  // 지금 불: 들을 때는 기계가 친 박, 칠 때는 내가 친 패드
  const lit = Array.from({ length: BEAT_PADS }, (_, p) => {
    if (performance.now() - flash[p] < LIT_MS) return true
    if (!cur || t < cur.listenZero || t >= cur.answerAt) return false
    return cur.notes.some((n) => n.pad === p && t >= cur.listenZero + n.step * cur.e && t < cur.listenZero + n.step * cur.e + LIT_MS)
  })
  const live = cur && t >= cur.from ? judgeRound(cur.notes, cur.answerZero, cur.e, taps.current, cur.from, t + 1) : null
  const beatsLeft = (from: number) => Math.max(1, Math.ceil((from - t) / (cur ? cur.e * 2 : 1)))
  const say =
    t < 0 ? '셋 세고 시작'
    : between ? (last?.judge?.ok ? '좋다!' : '틀렸다')
    : !cur ? '끝'
    : t < cur.listenZero ? `들어 봐 · ${beatsLeft(cur.listenZero)}`
    : t < cur.answerAt ? '듣는 중…'
    : t < cur.answerZero ? `따라 쳐 · ${beatsLeft(cur.answerZero)}`
    : '치는 중'
  const listening = !!cur && t >= cur.listenAt && t < cur.answerAt

  return (
    <div className="sc-bt">
      <p className="sc-ar__title">
        리듬 쌓기 <span>{run.cleared} 판 깸 · {cur ? `${cur.notes.length} 박 · ${cur.bpm} BPM` : ''}</span>
      </p>
      <div className="sc-bt__head">
        <Lives left={run.lives} of={SOLO_LIVES} />
        <p className={`sc-bt__say${between ? (last?.judge?.ok ? ' is-ok' : ' is-bad') : listening ? ' is-listen' : ''}`}>{say}</p>
      </div>
      <BeatDots n={cur?.notes.length ?? 0} filled={live?.hit ?? []} />
      <div className="sc-rh__stage">
        <BeatPads lit={lit} names={PAD_NAME} onHit={hit} />
        <Countdown n={countdown(room, now)} />
        {phase !== 'play' && (
          <p className="sc-rh__over" role="status">
            {phase === 'send' ? '채점 중…' : phase === 'sent' ? '결과를 기다린다…' : err ?? '못 냈다'}
          </p>
        )}
      </div>
      <div className="sc-ar__row">
        <button onClick={onQuit}>그만둔다</button>
      </div>
    </div>
  )
}
