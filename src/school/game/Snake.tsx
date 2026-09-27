// 뱀 — 캔버스 한 판. 십자 단추·방향키·밀기로 꺾는다.
//
// 화면은 규칙 파일의 snakeStep 을 박자마다 그대로 부르고, **꺾은 틱만**
// 적어 둔다. 죽으면 그 기록을 서버로 보낸다. 서버는 같은 씨앗으로 처음부터
// 다시 굴려 사과를 센다 — 화면이 사과 수를 보내지 않는다.
import { useEffect, useRef, useState } from 'react'

import {
  SNAKE_H,
  SNAKE_W,
  snakeStart,
  snakeStep,
  snakeTickMs,
  type SnakeDir,
  type SnakeInput,
} from '../../../shared/rules/arcadeSnake'
import { chip, tone } from './chip'
import { Countdown, Results } from './arcadeKit'
import { countdown, serverNow, submitLog, useNow } from './arcadeTime'
import type { GameActions } from './useGame'
import type { LiveRoom } from './useArcade'

const KEY_DIR: Record<string, SnakeDir> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
}
/** 밀었다고 치는 거리(px). 그보다 짧으면 톡 누른 것이다 */
const SWIPE_PX = 18
const PAD: { dir: SnakeDir; label: string }[] = [
  { dir: 'up', label: '▲' },
  { dir: 'left', label: '◀' },
  { dir: 'right', label: '▶' },
  { dir: 'down', label: '▼' },
]

type Phase = 'play' | 'send' | 'sent' | 'fail'

export function Snake({ room, meId, act, onAgain, onMenu, onQuit }: {
  room: LiveRoom
  meId: string
  act: GameActions
  onAgain: () => void
  onMenu: () => void
  onQuit: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const want = useRef<SnakeDir | null>(null)
  const [phase, setPhase] = useState<Phase>(room.doneIds.includes(meId) ? 'sent' : 'play')
  const [err, setErr] = useState<string | null>(null)
  const [eaten, setEaten] = useState(0)
  const done = room.status === 'done'
  const now = useNow(!done && phase === 'play')
  const seed = room.seed ?? 0

  useEffect(() => {
    if (done || phase !== 'play' || room.startAtMs === null) return
    const cv = canvasRef.current
    const g2 = cv?.getContext('2d')
    if (!cv || !g2) return
    const canvas: HTMLCanvasElement = cv
    const ctx: CanvasRenderingContext2D = g2
    const g = snakeStart(seed)
    const turns: SnakeInput[] = []
    const anchor = performance.now() + (room.startAtMs - serverNow())
    let raf = 0
    let sent = false

    const onKey = (e: KeyboardEvent) => {
      const d = KEY_DIR[e.key]
      if (!d) return
      // 지도도 방향키로 걷는다 — 먼저 가로채야 자리에서 안 일어난다
      e.preventDefault()
      e.stopImmediatePropagation()
      want.current = d
    }
    window.addEventListener('keydown', onKey, true)

    const frame = () => {
      raf = requestAnimationFrame(frame)
      const t = performance.now() - anchor
      // 흐른 시간만큼 박자를 따라잡는다. 박자 길이는 사과 수로 바뀐다
      while (g.alive && t >= g.timeMs + snakeTickMs(g.eaten)) {
        const turn = want.current
        want.current = null
        const before = g.dir
        const ate = g.eaten
        snakeStep(g, turn)
        if (g.dir !== before) turns.push({ tick: g.tick - 1, dir: g.dir })
        if (g.eaten > ate) {
          setEaten(g.eaten)
          const a = chip()
          if (a && a.state === 'running') tone(a, a.currentTime, 660 + g.eaten * 20, 0.08, 0.06)
        }
      }
      draw()
      if (!g.alive && !sent) {
        sent = true
        const a = chip()
        if (a && a.state === 'running') tone(a, a.currentTime, 140, 0.4, 0.08, 'sawtooth')
        setPhase('send')
        void submitLog(act, room.id, turns).then((bad) => {
          if (bad) {
            setErr(bad)
            setPhase('fail')
          } else setPhase('sent')
        })
      }
    }

    function draw() {
      const dpr = window.devicePixelRatio || 1
      const w = Math.round(canvas.clientWidth * dpr)
      if (canvas.width !== w || canvas.height !== w) {
        canvas.width = w
        canvas.height = w
      }
      const c = w / SNAKE_W
      ctx.fillStyle = '#0b0d18'
      ctx.fillRect(0, 0, w, w)
      // 바둑판 무늬. 칸이 보여야 몇 칸 남았는지 잰다
      ctx.fillStyle = '#10142a'
      for (let y = 0; y < SNAKE_H; y++) for (let x = (y % 2); x < SNAKE_W; x += 2) ctx.fillRect(x * c, y * c, c, c)
      // 사과
      ctx.fillStyle = '#ff8fb0'
      ctx.fillRect(g.food.x * c + c * 0.2, g.food.y * c + c * 0.2, c * 0.6, c * 0.6)
      // 뱀. 머리는 금빛
      g.body.forEach((b, i) => {
        ctx.fillStyle = i === 0 ? '#f0d68a' : g.alive ? '#6fd3ff' : '#555b7a'
        ctx.fillRect(b.x * c + 1, b.y * c + 1, c - 2, c - 2)
      })
    }

    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [act, done, phase, room.id, room.startAtMs, seed])

  // 밀기. 캔버스 위에서 손가락을 끈 쪽으로 꺾는다
  const touch = useRef<{ x: number; y: number } | null>(null)
  const onDown = (e: React.PointerEvent) => {
    touch.current = { x: e.clientX, y: e.clientY }
  }
  const onMove = (e: React.PointerEvent) => {
    const s = touch.current
    if (!s) return
    const dx = e.clientX - s.x
    const dy = e.clientY - s.y
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PX) return
    want.current = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up'
    touch.current = { x: e.clientX, y: e.clientY }
  }

  if (done) return <Results room={room} meId={meId} onAgain={onAgain} onMenu={onMenu} />

  return (
    <div className="sc-sn">
      <p className="sc-ar__title">뱀 <span>사과 {eaten}개 · 밀거나 단추로 꺾는다</span></p>
      <div className="sc-rh__stage">
        <canvas
          ref={canvasRef}
          className="sc-sn__canvas"
          aria-label="뱀 판"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={() => (touch.current = null)}
        />
        <Countdown n={countdown(room, now)} />
        {phase !== 'play' && (
          <p className="sc-rh__over" role="status">
            {phase === 'send' ? '채점 중…' : phase === 'sent' ? '결과를 기다린다…' : err ?? '못 냈다'}
          </p>
        )}
      </div>
      <div className="sc-sn__pad">
        {PAD.map((p) => (
          <button
            key={p.dir}
            className={`is-${p.dir}`}
            aria-label={p.dir}
            onPointerDown={(e) => {
              e.preventDefault()
              want.current = p.dir
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="sc-ar__row">
        <button onClick={onQuit}>그만둔다</button>
      </div>
    </div>
  )
}
