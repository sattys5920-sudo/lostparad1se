// 리듬 스타 — 세 줄로 떨어지는 음표를 판정선에서 누른다.
//
// **화면이 굴리고, 서버가 채점한다.** 서버가 준 씨앗으로 악보를 만들고
// (rules/arcadeRhythm), 누른 시각과 줄을 적어 둔다. 곡이 끝나면 그
// 기록만 서버로 간다 — 서버는 같은 함수로 처음부터 다시 판정한다.
// 여기 뜨는 PERFECT·콤보는 미리 보여 주는 것이고, 결과는 서버가 낸다.
//
// 시계는 performance.now() 다. 서버가 정한 시작 시각(벽시계)에 맞춰
// 한 번 닻을 내리고, 그 뒤로는 화면 시계만 본다 — Date.now() 는 가끔
// 뒤로 튄다.
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  BAD_MS,
  BEAT_MS,
  DUET_BARS,
  RHYTHM_BARS,
  RHYTHM_END_MS,
  RHYTHM_LANES,
  RHYTHM_LEAD_BEATS,
  duetOwner,
  rhythmChart,
  rhythmStart,
  rhythmSweep,
  rhythmTap,
  type Mark,
  type Tap,
} from '../../../shared/rules/arcadeRhythm'
import { chip, hat, kick, tone } from './chip'
import { EndRow } from './ArcadeEnd'
import { Results } from './arcadeKit'
import { serverNow, submitLog } from './arcadeTime'
import type { GameActions } from './useGame'
import type { LiveRoom } from './useArcade'

/** 음표가 화면 꼭대기에서 판정선까지 내려오는 시간. */
const FALL_MS = 1500
/** 줄마다 색. 어두운 화면에 네온처럼 */
const LANE_COLOR = ['#6fd3ff', '#f0d68a', '#ff8fb0']
/** 줄마다 키. 방향키와 D·F·J */
const KEYS: Record<string, number> = { ArrowLeft: 0, ArrowDown: 1, ArrowRight: 2, d: 0, f: 1, j: 2, D: 0, F: 1, J: 2 }
/** 누른 뒤 판정 글자가 떠 있는 시간 */
const POP_MS = 450
/** 곡. 가단조 5음 음계를 줄과 마디로 돌려 뽑는다 */
const SCALE = [220, 261.6, 293.7, 329.6, 392, 440, 523.3, 587.3]

type Phase = 'play' | 'send' | 'sent' | 'fail'

interface Ev {
  t: number
  play: (a: AudioContext, when: number) => void
}

/** 반주. 박마다 북, 뒷박마다 찰박, 음표마다 네모파 한 음, 앞 네 박은 셈. */
function score(notes: ReturnType<typeof rhythmChart>): Ev[] {
  const out: Ev[] = []
  const beats = RHYTHM_LEAD_BEATS + RHYTHM_BARS * 4
  for (let b = 0; b < beats; b++) {
    const t = b * BEAT_MS
    if (b < RHYTHM_LEAD_BEATS) out.push({ t, play: (a, w) => tone(a, w, b === RHYTHM_LEAD_BEATS - 1 ? 1320 : 880, 0.08, 0.05) })
    else {
      out.push({ t, play: (a, w) => kick(a, w) })
      out.push({ t: t + BEAT_MS / 2, play: (a, w) => hat(a, w) })
    }
  }
  notes.forEach((n, i) => {
    const bar = Math.floor((n.t / BEAT_MS - RHYTHM_LEAD_BEATS) / 4)
    const f = SCALE[(n.lane * 2 + bar + (i % 2)) % SCALE.length]
    out.push({ t: n.t, play: (a, w) => tone(a, w, f, 0.16, 0.05) })
  })
  return out.sort((x, y) => x.t - y.t)
}

export function Rhythm({ room, meId, act, part = null, onAgain, onMenu, onQuit }: {
  room: LiveRoom
  meId: string
  act: GameActions
  /**
   * 둘이서 한 곡이면 몇 번째 사람인가. 제 마디 음표만 판정하고, 남의
   * 음표는 흐리게 흘려보낸다(반주처럼 소리는 난다).
   */
  part?: { who: number; of: number } | null
  onAgain: () => void
  onMenu: () => void
  onQuit: () => void
}) {
  const full = useMemo(() => rhythmChart(room.seed ?? 0), [room.seed])
  // **객체 말고 숫자로 붙든다.** 부르는 쪽이 그릴 때마다 새 객체를 넘기면,
  // 그걸 딛는 판 전체가 매 프레임 새로 켜진다 — 닻도 판정도 날아간다
  const who = part?.who ?? -1
  const of = part?.of ?? 1
  const duet = part !== null
  const mineOf = useMemo(
    () => (who >= 0 ? full.map((n) => duetOwner(n, of) === who) : full.map(() => true)),
    [full, who, of],
  )
  const chart = useMemo(() => full.filter((_, i) => mineOf[i]), [full, mineOf])
  const others = useMemo(() => full.filter((_, i) => !mineOf[i]), [full, mineOf])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [phase, setPhase] = useState<Phase>(room.doneIds.includes(meId) ? 'sent' : 'play')
  const [err, setErr] = useState<string | null>(null)
  const tapRef = useRef<(lane: number) => void>(() => undefined)
  const [held, setHeld] = useState<number | null>(null)
  const done = room.status === 'done'

  useEffect(() => {
    if (done || phase !== 'play' || room.startAtMs === null) return
    const cv = canvasRef.current
    const g = cv?.getContext('2d')
    if (!cv || !g) return
    const canvas: HTMLCanvasElement = cv
    const ctx: CanvasRenderingContext2D = g

    // 닻: 서버가 정한 시작 시각이 화면 시계로 언제인가
    const anchor = performance.now() + (room.startAtMs - serverNow())
    const clock = () => performance.now() - anchor
    let judge = rhythmStart(chart)
    const taps: Tap[] = []
    const flash = Array.from({ length: RHYTHM_LANES }, () => -Infinity)
    let pop: { mark: Mark; at: number } | null = null
    // 반주는 곡 전체다 — 짝의 마디도 소리는 난다
    const evs = score(full)
    let ei = 0
    let sent = false
    let raf = 0

    const hit = (lane: number) => {
      const t = clock()
      if (t < -BAD_MS || t > RHYTHM_END_MS) return
      const tap = { t: Math.round(t), lane }
      taps.push(tap)
      flash[lane] = performance.now()
      const r = rhythmTap(chart, judge, tap)
      judge = r.j
      if (r.hit) pop = { mark: r.hit.mark, at: performance.now() }
    }
    tapRef.current = hit

    // **방향키를 먼저 가로챈다.** 지도도 방향키로 걷는다 — 안 막으면
    // 치는 동안 자리에서 일어나 걸어가 버린다
    const onKey = (e: KeyboardEvent) => {
      const lane = KEYS[e.key]
      if (lane === undefined) return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (!e.repeat) hit(lane)
    }
    window.addEventListener('keydown', onKey, true)

    const send = async () => {
      setPhase('send')
      const bad = await submitLog(act, room.id, taps)
      if (bad) {
        setErr(bad)
        setPhase('fail')
      } else setPhase('sent')
    }

    const frame = () => {
      raf = requestAnimationFrame(frame)
      const now = clock()
      judge = rhythmSweep(chart, judge, now)

      // 소리 — 앞으로 0.12초 안에 울릴 것을 미리 걸어 둔다
      const a = chip()
      if (a && a.state === 'running') {
        while (ei < evs.length && evs[ei].t < now + 120) {
          const ev = evs[ei++]
          if (ev.t < now - 30) continue
          ev.play(a, a.currentTime + Math.max(0, (ev.t - now) / 1000))
        }
      } else {
        while (ei < evs.length && evs[ei].t < now) ei++
      }

      draw(now)
      if (!sent && now > RHYTHM_END_MS) {
        sent = true
        void send()
      }
    }

    function draw(now: number) {
      const dpr = window.devicePixelRatio || 1
      const w = Math.round(canvas.clientWidth * dpr)
      const h = Math.round(canvas.clientHeight * dpr)
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      const laneW = w / RHYTHM_LANES
      const judgeY = h - 36 * dpr
      ctx.fillStyle = '#0b0d18'
      ctx.fillRect(0, 0, w, h)

      // 줄. 누른 줄은 아래에서 빛이 올라온다
      for (let l = 0; l < RHYTHM_LANES; l++) {
        const age = performance.now() - flash[l]
        if (age < 160) {
          const grad = ctx.createLinearGradient(0, judgeY, 0, judgeY - 140 * dpr)
          grad.addColorStop(0, `${LANE_COLOR[l]}66`)
          grad.addColorStop(1, `${LANE_COLOR[l]}00`)
          ctx.fillStyle = grad
          ctx.fillRect(l * laneW, judgeY - 140 * dpr, laneW, 140 * dpr)
        }
        if (l > 0) {
          ctx.fillStyle = '#1d2238'
          ctx.fillRect(Math.round(l * laneW), 0, Math.max(1, dpr), h)
        }
      }

      const noteH = 10 * dpr
      // 짝의 음표. 흐리게, 판정선에 닿으면 사라진다
      ctx.globalAlpha = 0.22
      for (const n of others) {
        if (n.t - FALL_MS > now) break
        if (n.t < now) continue
        const y = judgeY - ((n.t - now) / FALL_MS) * judgeY
        ctx.fillStyle = LANE_COLOR[n.lane]
        ctx.fillRect(n.lane * laneW + 6 * dpr, y - noteH / 2, laneW - 12 * dpr, noteH)
      }
      ctx.globalAlpha = 1
      // 음표. 아직 판정 안 난 것만
      for (let i = 0; i < chart.length; i++) {
        const n = chart[i]
        if (n.t - FALL_MS > now) break
        if (judge.marks[i] !== null) continue
        const y = judgeY - ((n.t - now) / FALL_MS) * judgeY
        if (y > h + noteH) continue
        ctx.fillStyle = LANE_COLOR[n.lane]
        ctx.fillRect(n.lane * laneW + 6 * dpr, y - noteH / 2, laneW - 12 * dpr, noteH)
        ctx.fillStyle = '#ffffff55'
        ctx.fillRect(n.lane * laneW + 6 * dpr, y - noteH / 2, laneW - 12 * dpr, 2 * dpr)
      }

      // 판정선
      ctx.fillStyle = '#f0d68a'
      ctx.fillRect(0, judgeY - dpr, w, 2 * dpr)
      ctx.fillStyle = '#f0d68a33'
      ctx.fillRect(0, judgeY - 6 * dpr, w, 12 * dpr)

      // 위: 얼마나 왔나
      ctx.fillStyle = '#262b44'
      ctx.fillRect(0, 0, w, 3 * dpr)
      ctx.fillStyle = '#9fd4e8'
      ctx.fillRect(0, 0, w * Math.max(0, Math.min(1, now / RHYTHM_END_MS)), 3 * dpr)

      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const font = (px: number) => `${px * dpr}px Galmuri11, 'Apple SD Gothic Neo', sans-serif`

      // 콤보. 가운데에 옅게
      if (judge.combo >= 3) {
        ctx.fillStyle = '#ffffff30'
        ctx.font = font(44)
        ctx.fillText(String(judge.combo), w / 2, h * 0.38)
        ctx.font = font(11)
        ctx.fillText('COMBO', w / 2, h * 0.38 + 30 * dpr)
      }

      // 판정 글자
      if (pop && performance.now() - pop.at < POP_MS) {
        const k = (performance.now() - pop.at) / POP_MS
        ctx.globalAlpha = 1 - k
        ctx.fillStyle = pop.mark === 'perfect' ? '#f0d68a' : pop.mark === 'good' ? '#9fd4e8' : '#e07a72'
        ctx.font = font(22)
        ctx.fillText(pop.mark.toUpperCase(), w / 2, judgeY - 60 * dpr - k * 16 * dpr)
        ctx.globalAlpha = 1
      }

      // 셈. 시작 전에는 3·2·1, 앞 네 박은 READY
      const firstNote = RHYTHM_LEAD_BEATS * BEAT_MS
      if (now < 0) {
        ctx.fillStyle = '#f0d68a'
        ctx.font = font(44)
        ctx.fillText(String(Math.ceil(-now / 1000)), w / 2, h * 0.4)
      } else if (now < firstNote) {
        const left = RHYTHM_LEAD_BEATS - Math.floor(now / BEAT_MS)
        ctx.fillStyle = '#f0d68a'
        ctx.font = font(22)
        ctx.fillText(left <= 1 ? 'GO!' : 'READY', w / 2, h * 0.4)
      }

      // 둘이서 칠 때 — 지금 누구 마디인가
      if (who >= 0 && now >= firstNote) {
        const bar = Math.floor((now / BEAT_MS - RHYTHM_LEAD_BEATS) / 4)
        const mineNow = Math.floor(bar / DUET_BARS) % of === who
        // 판정선 바로 위 가운데 줄에 판을 깔고 적는다 — 음표가 지나가도 안 가린다
        const label = mineNow ? '내 차례' : '쉬어'
        ctx.font = font(11)
        const tw = ctx.measureText(label).width + 12 * dpr
        const ty = judgeY + 20 * dpr
        ctx.fillStyle = mineNow ? '#f0d68a' : '#262b44'
        ctx.fillRect(w - tw - 4 * dpr, ty - 9 * dpr, tw, 18 * dpr)
        ctx.textAlign = 'center'
        ctx.fillStyle = mineNow ? '#1c1f33' : '#7d86ad'
        ctx.fillText(label, w - tw / 2 - 4 * dpr, ty)
      }

      // 아래 구석: 지금까지
      ctx.textAlign = 'left'
      ctx.fillStyle = '#7d86ad'
      ctx.font = font(11)
      ctx.fillText(`P ${judge.perfect}  G ${judge.good}  M ${judge.miss}`, 6 * dpr, h - 12 * dpr)
    }

    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey, true)
      tapRef.current = () => undefined
    }
  }, [act, chart, full, others, who, of, done, phase, room.id, room.startAtMs])

  // ── 끝 ──
  if (done && duet) return <Results room={room} meId={meId} onAgain={onAgain} onMenu={onMenu} />
  if (done) {
    const mine = room.results?.[meId]
    const grade = mine?.line.split(' · ')[0] ?? '?'
    return (
      <div className="sc-rh">
        <p className="sc-ar__title">리듬 스타 <span>결과</span></p>
        <p className={`sc-rh__grade is-${mine?.outcome ?? 'lose'}`}>{grade}</p>
        <p className={`sc-ud__big is-${mine?.outcome ?? 'lose'}`}>{mine ? (mine.outcome === 'win' ? 'CLEAR!' : 'FAILED') : ''}</p>
        <p className="sc-rh__line">{mine?.line ?? ''}</p>
        <EndRow onAgain={onAgain} onMenu={onMenu} />
      </div>
    )
  }

  return (
    <div className="sc-rh">
      <p className="sc-ar__title">{duet ? '둘이서 한 곡' : '리듬 스타'} <span>{duet ? '밝은 음표가 내 몫' : '판정선에 닿을 때 누른다'}</span></p>
      <div className="sc-rh__stage">
        <canvas ref={canvasRef} className="sc-rh__canvas" aria-label="떨어지는 음표" />
        {phase !== 'play' && (
          <p className="sc-rh__over" role="status">
            {phase === 'send' ? '채점 중…' : phase === 'sent' ? '결과를 기다린다…' : err ?? '못 냈다'}
          </p>
        )}
      </div>
      <div className="sc-rh__pads">
        {Array.from({ length: RHYTHM_LANES }, (_, l) => (
          <button
            key={l}
            className={held === l ? 'is-down' : ''}
            style={{ ['--lane' as string]: LANE_COLOR[l] }}
            aria-label={`${l + 1}번 줄`}
            onPointerDown={(e) => {
              e.preventDefault()
              setHeld(l)
              tapRef.current(l)
            }}
            onPointerUp={() => setHeld(null)}
            onPointerLeave={() => setHeld(null)}
          >
            <i />
          </button>
        ))}
      </div>
      <div className="sc-ar__row">
        <button onClick={onQuit}>그만둔다</button>
      </div>
    </div>
  )
}
