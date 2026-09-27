// 탑 쌓기 — 돌아가며 흔들리는 블록을 떨어뜨려 다 같이 쌓는다.
//
// 흔들림은 「차례가 열린 시각(서버)」부터 잰 식이라, 차례가 아닌 사람의
// 화면에도 같은 블록이 같은 자리에서 흔들린다. 제 차례에 누르면 「차례가
// 열리고 몇 ms 뒤」만 서버로 간다 — 어디에 떨어졌는지는 서버가 정한다.
import { useEffect, useRef, useState } from 'react'

import {
  TOWER_BASE_W,
  TOWER_GOAL,
  TOWER_SWING,
  TOWER_TURN_MS,
  swingX,
  towerHeight,
  whoseTurn,
} from '../../../shared/rules/arcadeTower'
import { chip, kick, tone } from './chip'
import { Countdown, Results } from './arcadeKit'
import { countdown, serverNow, useNow } from './arcadeTime'
import type { GameActions } from './useGame'
import type { LiveRoom } from './useArcade'

/** 블록 한 층의 두께(세계 단위). 너비는 규칙의 단위를 그대로 쓴다 */
const BLOCK_H = 14
/** 화면에 한 번에 보이는 층 수. 그 위로 올라가면 따라 올라간다 */
const SHOW_ROWS = 9
const COLORS = ['#6fd3ff', '#f0d68a', '#ff8fb0', '#9fe0a0']

export function Tower({ room, meId, act, onAgain, onMenu, onQuit }: {
  room: LiveRoom
  meId: string
  act: GameActions
  onAgain: () => void
  onMenu: () => void
  onQuit: () => void
}) {
  const s = room.tower
  const done = room.status === 'done'
  const now = useNow(!done)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [sent, setSent] = useState<number | null>(null)
  const [say, setSay] = useState<string | null>(null)
  const sref = useRef(s)
  sref.current = s

  // 떨어진 것에 소리를 붙인다 — 딱 맞으면 높게, 무너지면 둔하게
  const lastTurn = useRef(s?.turn ?? 0)
  useEffect(() => {
    if (!s || s.turn === lastTurn.current) return
    lastTurn.current = s.turn
    const a = chip()
    if (!a || a.state !== 'running') return
    if (s.fell) kick(a, a.currentTime, 0.5)
    else if (s.last?.perfect) tone(a, a.currentTime, 1320, 0.15, 0.07)
    else tone(a, a.currentTime, 440, 0.08, 0.06)
  }, [s])

  useEffect(() => {
    if (done) return
    const cv = canvasRef.current
    const g = cv?.getContext('2d')
    if (!cv || !g) return
    const canvas: HTMLCanvasElement = cv
    const ctx: CanvasRenderingContext2D = g
    let raf = 0
    const frame = () => {
      raf = requestAnimationFrame(frame)
      const st = sref.current
      if (!st) return
      const dpr = window.devicePixelRatio || 1
      const w = Math.round(canvas.clientWidth * dpr)
      const h = Math.round(canvas.clientHeight * dpr)
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      // 세계 → 화면. 가로는 흔들림 끝까지 들어오게, 세로는 층 수로
      const span = (TOWER_SWING + TOWER_BASE_W / 2) * 2 + 20
      const k = w / span
      /*
       * **층 높이는 판 높이에 맞춘다.** 가로로만 맞추면 낮은 폰(667)에서
       * 탑이 판 위로 넘쳐 오가는 블록이 안 보였다. 적어도 SHOW_ROWS 층은
       * 들어가게 줄이고, 오가는 블록 위로 한 층을 비워 둔다
       */
      const rowPx = Math.min(BLOCK_H * k, (h - 4 * dpr) / SHOW_ROWS)
      const rows = Math.floor((h - 4 * dpr) / rowPx)
      const height = towerHeight(st)
      const top = Math.max(0, height + 3 - rows)
      const yOf = (row: number) => h - (row - top + 1) * rowPx - 4 * dpr
      const xOf = (x: number) => w / 2 + x * k

      ctx.fillStyle = '#0b0d18'
      ctx.fillRect(0, 0, w, h)
      // 목표 선
      if (TOWER_GOAL >= top && TOWER_GOAL - top < rows) {
        const y = yOf(TOWER_GOAL) + rowPx
        ctx.fillStyle = '#f0d68a55'
        ctx.fillRect(0, y - dpr, w, 2 * dpr)
        ctx.fillStyle = '#f0d68a'
        ctx.font = `${11 * dpr}px Galmuri11, sans-serif`
        ctx.textAlign = 'left'
        ctx.fillText(`목표 ${TOWER_GOAL}층`, 4 * dpr, y - 4 * dpr)
      }
      st.blocks.forEach((b, i) => {
        if (i < top) return
        ctx.fillStyle = i === 0 ? '#555b7a' : COLORS[(i - 1) % COLORS.length]
        ctx.fillRect(xOf(b.x - b.w / 2), yOf(i), b.w * k, rowPx - dpr)
      })
      // 흔들리는 블록
      const who = whoseTurn(st)
      if (who && !st.fell) {
        const t = Math.max(0, Math.min(TOWER_TURN_MS, serverNow() - st.turnAtMs))
        const topB = st.blocks[height]
        const x = swingX(height, t)
        ctx.globalAlpha = serverNow() < st.turnAtMs ? 0.35 : 1
        ctx.fillStyle = COLORS[height % COLORS.length]
        ctx.fillRect(xOf(x - topB.w / 2), yOf(height + 1), topB.w * k, rowPx - dpr)
        ctx.globalAlpha = 1
      }
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [done])

  if (done) return <Results room={room} meId={meId} onAgain={onAgain} onMenu={onMenu} />
  if (!s) return null

  const who = whoseTurn(s)
  const mine = who === meId && sent !== s.turn
  const nameOf = (id: string) => (id === meId ? '나' : (room.members.find((m) => m.id === id)?.name ?? '?'))
  const n = countdown(room, now)
  const open = now >= s.turnAtMs
  const left = Math.max(0, s.turnAtMs + TOWER_TURN_MS - now)
  const drop = () => {
    if (!mine || !open) return
    const t = Math.round(serverNow() - s.turnAtMs)
    setSent(s.turn)
    setSay(null)
    act.arcadePlay(room.id, { t }).catch((e) => {
      setSay((e as Error).message)
      setSent(null)
    })
  }

  return (
    <div className="sc-tw">
      <p className="sc-ar__title">탑 쌓기 <span>{towerHeight(s)}층 · 다 같이 {TOWER_GOAL}층</span></p>
      <ol className="sc-tw__order">
        {s.order.map((id) => (
          <li key={id} className={id === who ? 'is-turn' : ''}>{nameOf(id)}</li>
        ))}
      </ol>
      <div className="sc-rh__stage">
        <canvas
          ref={canvasRef}
          className="sc-tw__canvas"
          aria-label="쌓인 탑"
          onPointerDown={(e) => {
            e.preventDefault()
            drop()
          }}
        />
        <Countdown n={n} />
        {s.last && (
          <p className={`sc-tw__pop${s.last.perfect ? ' is-perfect' : ''}`} key={s.turn}>
            {s.fell ? '무너졌다!' : s.last.perfect ? '딱!' : `−${Math.round(s.last.cut)}`}
          </p>
        )}
      </div>
      <div className="sc-ml__bar"><i style={{ width: `${(open ? left / TOWER_TURN_MS : 1) * 100}%` }} /></div>
      <button className="sc-tw__drop is-go" disabled={!mine || !open} onPointerDown={(e) => {
        e.preventDefault()
        drop()
      }}>
        {mine ? (open ? '떨어뜨린다!' : '곧 내 차례') : `${who ? nameOf(who) : ''} 차례`}
      </button>
      {say && <p className="sc-ar__say">{say}</p>}
      <div className="sc-ar__row">
        <button onClick={onQuit}>그만둔다</button>
      </div>
    </div>
  )
}
