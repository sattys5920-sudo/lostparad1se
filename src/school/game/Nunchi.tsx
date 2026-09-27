// 눈치 게임 — 1부터 차례로 외친다. 겹치면 둘 다 탈락, 끝까지 못
// 외친 한 사람도 탈락.
//
// **숫자는 서버가 매긴다.** 화면에는 「다음 숫자」 단추 하나뿐이다 —
// 누르면 서버에 닿은 순서대로 1, 2, 3… 이 붙는다. 앞사람과 거의 같이
// 닿으면(NUNCHI_SAME_MS) 같은 숫자로 겹친다.
import { useState } from 'react'

import { NUNCHI_LIMIT_MS } from '../../../shared/rules/arcadeNunchi'
import { inMembers } from '../../../shared/rules/arcade'
import { chip, tone } from './chip'
import { Countdown, Results } from './arcadeKit'
import { countdown, useNow } from './arcadeTime'
import type { GameActions } from './useGame'
import type { LiveRoom } from './useArcade'

export function Nunchi({ room, meId, act, onAgain, onMenu, onQuit }: {
  room: LiveRoom
  meId: string
  act: GameActions
  onAgain: () => void
  onMenu: () => void
  onQuit: () => void
}) {
  const s = room.nunchi
  const done = room.status === 'done'
  const now = useNow(!done)
  const [busy, setBusy] = useState(false)
  const [say, setSay] = useState<string | null>(null)
  if (done) return <Results room={room} meId={meId} onAgain={onAgain} onMenu={onMenu} />
  if (!s || room.startAtMs === null) return null

  const players = inMembers(room)
  const nameOf = (id: string) => (id === meId ? '나' : (room.members.find((m) => m.id === id)?.name ?? '?'))
  const called = s.calls.some((c) => c.id === meId)
  const n = countdown(room, now)
  const target = players.length - 1
  const left = Math.max(0, room.startAtMs + NUNCHI_LIMIT_MS - now)
  const shout = async () => {
    setBusy(true)
    setSay(null)
    const a = chip()
    if (a && a.state === 'running') tone(a, a.currentTime, 520 + s.calls.length * 120, 0.12, 0.07)
    try {
      await act.arcadePlay(room.id)
    } catch (e) {
      setSay((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sc-nc">
      <p className="sc-ar__title">눈치 게임 <span>{players.length}명 · {target}까지 외친다</span></p>
      <div className="sc-ml__bar"><i style={{ width: `${(left / NUNCHI_LIMIT_MS) * 100}%` }} /></div>
      <div className="sc-rh__stage">
        <button
          className={`sc-nc__shout${called ? ' is-done' : ''}${s.clash ? ' is-clash' : ''}`}
          disabled={busy || called || n > 0 || !!s.clash}
          onPointerDown={(e) => {
            e.preventDefault()
            if (!busy && !called && n <= 0 && !s.clash) void shout()
          }}
        >
          {s.clash ? '겹쳤다!' : called ? '외쳤다' : n > 0 ? '준비' : `${s.calls.length + 1}!`}
          <small>{called ? '남은 사람을 본다' : n > 0 ? '시작하면 누른다' : '눈치껏 — 겹치면 탈락'}</small>
        </button>
        <Countdown n={n} />
      </div>
      <ol className="sc-nc__calls">
        {s.calls.map((c, i) => (
          <li key={i} className={s.clash?.includes(c.id) ? 'is-clash' : c.id === meId ? 'is-me' : ''}>
            <b>{c.n}</b>
            <span>{nameOf(c.id)}</span>
          </li>
        ))}
        {players
          .filter((p) => !s.calls.some((c) => c.id === p.id))
          .map((p) => (
            <li key={p.id} className="is-wait">
              <b>?</b>
              <span>{nameOf(p.id)}</span>
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
