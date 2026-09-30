// 먼저 쏴 — 「준비…」 뒤 신호가 뜨면 먼저 누른 쪽이 이긴다. 세 판 두 선승.
//
// 신호는 서버가 정한 시각(벽시계)에 둘 다에게 뜬다. **얼마나 빨랐는지는
// 제 화면이 신호를 띄운 순간부터 잰다** — 폰끼리 시계가 조금 어긋나도
// 잰 값은 안 어긋난다. 신호 전에 누르면 부정출발이다(서버도 따로 잰다).
//
// 먼저 쏜 사람의 값은 서버가 봉인한다. 둘 다 쏘거나 시간이 다 돼야 편다.
import { useEffect, useRef, useState } from 'react'

import { DRAW_WINS, type Shot } from '../../../shared/rules/arcadeDraw'
import { inMembers } from '../../../shared/rules/arcade'
import { chip, hat, tone } from './chip'
import { Countdown, Results } from './arcadeKit'
import { countdown, serverNow, useNow } from './arcadeTime'
import type { GameActions } from './useGame'
import type { LiveRoom } from './useArcade'

const shotText = (s: Shot | undefined): string =>
  s === undefined ? '-' : s === 'early' ? '부정출발' : s === 'none' ? '못 쏨' : `${s}ms`

export function Quickdraw({ room, meId, act, onAgain, onMenu, onQuit }: {
  room: LiveRoom
  meId: string
  act: GameActions
  onAgain: () => void
  onMenu: () => void
  onQuit: () => void
}) {
  const d = room.draw
  const done = room.status === 'done'
  const now = useNow(!done)
  const foe = inMembers(room).find((m) => m.id !== meId) ?? room.members.find((m) => m.id !== meId)
  const [mine, setMine] = useState<{ round: number; shot: Shot } | null>(null)
  const [say, setSay] = useState<string | null>(null)
  /** 신호를 띄운 순간(화면 시계). 여기서부터 잰다 */
  const shown = useRef<{ round: number; at: number } | null>(null)
  const round = d?.round ?? 0
  const go = !!d && now >= d.signalAtMs

  // 신호가 뜨는 순간을 한 프레임 안에 잡는다 — 뜨자마자 소리도 낸다
  useEffect(() => {
    if (!d || done) return
    let raf = 0
    const loop = () => {
      if (serverNow() >= d.signalAtMs) {
        if (shown.current?.round !== d.round) {
          shown.current = { round: d.round, at: performance.now() }
          const a = chip()
          if (a && a.state === 'running') tone(a, a.currentTime, 1320, 0.12, 0.08)
        }
        return
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [d, done])

  if (done) return <Results room={room} meId={meId} onAgain={onAgain} onMenu={onMenu} />
  if (!d) return null

  const fired = mine?.round === round || d.inIds.includes(meId)
  const fire = () => {
    if (fired) return
    const s = shown.current
    const shot: Shot = s && s.round === round ? Math.round(performance.now() - s.at) : 'early'
    setMine({ round, shot })
    const a = chip()
    if (a && a.state === 'running') hat(a, a.currentTime, 0.2)
    act.arcadePlay(room.id, { round, shot: shot === 'early' ? 'early' : shot }).catch((e) => setSay((e as Error).message))
  }
  const n = countdown(room, now)

  return (
    <div className="sc-qd">
      <p className="sc-ar__title">먼저 쏴 <span>{DRAW_WINS} 판 먼저 · 나 {d.wins[meId] ?? 0} : {d.wins[foe?.id ?? ''] ?? 0} {foe?.name}</span></p>
      <div className="sc-rh__stage">
        <button
          className={`sc-qd__field${go && !fired ? ' is-go' : ''}${fired ? ' is-fired' : ''}`}
          onPointerDown={(e) => {
            e.preventDefault()
            if (n <= 0) fire()
          }}
        >
          {n > 0 ? '' : fired ? (mine?.round === round ? (mine.shot === 'early' ? '부정출발!' : `탕! ${mine.shot}ms`) : '쐈다') : go ? '쏴!' : '준비…'}
          <small>{fired ? `${foe?.name ?? '상대'}: ${d.inIds.includes(foe?.id ?? '') ? '쐈다' : '기다린다…'}` : go ? '지금 누른다' : '신호가 뜨면 누른다 — 먼저 누르면 반칙'}</small>
        </button>
        <Countdown n={n} />
      </div>
      <ol className="sc-du__rounds">
        {d.rounds.map((r, i) => (
          <li key={i} className={`is-${r.winner === meId ? 'win' : r.winner ? 'lose' : 'draw'}`}>
            <span>{i + 1} 판</span>
            <b>{shotText(r.shots[meId])}</b>
            <em>:</em>
            <b>{shotText(r.shots[foe?.id ?? ''])}</b>
            <span>{r.winner === meId ? '이김' : r.winner ? '짐' : '비김'}</span>
          </li>
        ))}
      </ol>
      {say && <p className="sc-ar__say">{say}</p>}
      <div className="sc-ar__row">
        <button onClick={onQuit}>그만둔다</button>
      </div>
    </div>
  )
}
