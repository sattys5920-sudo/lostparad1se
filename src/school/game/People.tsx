// 사람에게 하는 일 — 표 · 털어놓기 · 중요한 사람.
//
// 표는 익명이다. 던지고 나면 화면에도 아무것도 남지 않는다 — 서버가
// 「던졌다」만 알려 주고, 누구에게 줬는지는 내 몫에도 안 담긴다.
//
// 털어놓기는 되돌릴 수 없다. 1:1은 들은 사람마다 약점을 쥐므로 누르기
// 전에 무엇을 잃는지 보여 준다.
import { useState } from 'react'

import { REVEAL_PRIVATE_WARNING } from '../../../shared/rules/reveal'
import { CHOSEN_ONE_DAY, DAY4_CHOICES, DAY4_CHOICE_DAY } from '../../../shared/rules/choices'
import { VOTE_LABEL, type VoteKind } from '../../../shared/rules/v2'
import type { GameActions } from './useGame'
import type { SeatEntry } from '../../../shared/model'

export interface PeopleProps {
  me: SeatEntry
  seats: readonly SeatEntry[]
  day: number
  /** 오늘 지워진 사람. 표를 받지 않는다. */
  invisibleId: string | null
  /** 내가 고른 중요한 사람. */
  chosenId: string | null
  day4: string | null
  act: GameActions
  onSaid: (text: string) => void
}

const VOTES: VoteKind[] = ['trust', 'liking', 'suspicion']

export function People(props: PeopleProps) {
  const { me, seats, act, onSaid } = props
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const [confirmReveal, setConfirmReveal] = useState<'class' | 'private' | null>(null)
  const [listeners, setListeners] = useState<string[]>([])

  const others = seats.filter((s) => s.playerId !== me.playerId)

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true)
    try {
      await fn()
      onSaid(`${label} 했다.`)
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sc-pe">
      <h2>사람</h2>
      <ul className="sc-pe__list">
        {others.map((s) => (
          <li key={s.playerId} className={picked === s.playerId ? 'is-picked' : ''}>
            <button className="sc-pe__who" onClick={() => setPicked(picked === s.playerId ? null : s.playerId)}>
              {s.name}
              <span>{s.team}</span>
              {props.invisibleId === s.playerId && <em>오늘 지워짐</em>}
              {props.chosenId === s.playerId && <i>중요한 사람</i>}
            </button>
            {picked === s.playerId && (
              <div className="sc-pe__acts">
                {VOTES.map((k) => (
                  <button key={k} disabled={busy} onClick={() => run(VOTE_LABEL[k], () => act.castVote(s.playerId, k))}>
                    {VOTE_LABEL[k]}
                  </button>
                ))}
                {props.day === CHOSEN_ONE_DAY && (
                  <button disabled={busy} onClick={() => run('선택', () => act.chooseImportant(s.playerId))}>
                    중요한 사람으로
                  </button>
                )}
                <label className="sc-pe__hear">
                  <input
                    type="checkbox"
                    checked={listeners.includes(s.playerId)}
                    onChange={(e) =>
                      setListeners((ls) =>
                        e.target.checked ? [...ls, s.playerId] : ls.filter((x) => x !== s.playerId),
                      )
                    }
                  />
                  들을 사람
                </label>
              </div>
            )}
          </li>
        ))}
      </ul>

      <h2>털어놓기</h2>
      <p className="sc-pe__warn">{REVEAL_PRIVATE_WARNING}</p>
      <div className="sc-ac__row">
        <button disabled={busy || listeners.length === 0} onClick={() => setConfirmReveal('private')}>
          1:1 ({listeners.length}명)
        </button>
        <button disabled={busy} onClick={() => setConfirmReveal('class')}>
          전체에게
        </button>
      </div>
      {confirmReveal && (
        <div className="sc-pe__confirm">
          <p>
            {confirmReveal === 'class'
              ? '반 전체가 듣는다. 되돌릴 수 없다.'
              : `${listeners.length}명이 듣는다. 그만큼 약점이 생긴다. 되돌릴 수 없다.`}
          </p>
          <div className="sc-ac__row">
            <button onClick={() => setConfirmReveal(null)}>그만두기</button>
            <button
              className="is-danger"
              disabled={busy}
              onClick={async () => {
                const scope = confirmReveal
                setConfirmReveal(null)
                await run('털어놓기', () => act.reveal(scope, listeners))
                setListeners([])
              }}
            >
              털어놓는다
            </button>
          </div>
        </div>
      )}

      {props.day === DAY4_CHOICE_DAY && (
        <>
          <h2>무엇을 지킬 것인가</h2>
          <ul className="sc-ac__menu">
            {DAY4_CHOICES.map((c) => (
              <li key={c.id}>
                <button
                  className={props.day4 === c.id ? 'is-on' : ''}
                  disabled={busy}
                  onClick={() => run(c.label, () => act.chooseDay4(c.id))}
                >
                  {c.label}
                  <span>{c.text}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
