// 오락기 화면 — 뒷골목 기계 한 대. 게임 고르기, 다른 기계 부르기, 게임들.
//
// **화면은 답을 모른다.** 업다운의 숫자는 판이 끝나야 온다. 대결에서
// 상대가 낸 수는 둘 다 내야 온다. 리듬은 화면이 제 손으로 굴리지만
// 점수는 서버가 누른 기록을 다시 돌려 낸다 — 여기서 승부를 정하면
// 개발자도구로 누구나 이긴다.
//
// 숫자는 **화면 안 자판**으로 누른다. 휴대폰 자판이 올라오면 지도와
// 조작부가 통째로 밀려 올라간다 — 이 앱이 여러 번 겪었다. 오락기에는
// 오락기의 단추가 있는 편이 맞기도 하다.
import { useState } from 'react'

import './arcade.css'

import {
  ARCADE_BY_ID,
  ARCADE_COUNT,
  ARCADE_GAMES,
  RPS_LABEL,
  RPS_PICKS,
  UPDOWN_MAX,
  UPDOWN_TRIES,
  inMembers,
  machineName,
  playersLabel,
  type ArcadeGameId,
  type RpsPick,
  type RpsRound,
} from '../../../shared/rules/arcade'
import { josa } from '../../../shared/text'
import { BIG, EndRow } from './ArcadeEnd'
import { unlockChip } from './chip'
import { Rhythm } from './Rhythm'
import type { GameActions } from './useGame'
import type { LiveRoom } from './useArcade'

export interface Seated {
  id: string
  name: string
}

export interface ArcadeProps {
  act: GameActions
  meId: string
  /** 내가 앉은 기계. */
  machine: number
  /** 기계마다 앉은 사람. 빈 자리는 null. 골목은 한눈에 보이니 다 안다. */
  seated: readonly (Seated | null)[]
  /** 내가 든 방. 없으면 고르는 화면이다. */
  room: LiveRoom | null
  /** 나를 부른 방들. */
  invites: readonly LiveRoom[]
  onDismiss: (roomId: string) => void
}

type Run = <T>(fn: () => Promise<T>) => Promise<T | null>

export function Arcade({ act, meId, machine, seated, room, invites, onDismiss }: ArcadeProps) {
  const [busy, setBusy] = useState(false)
  const [say, setSay] = useState<string | null>(null)

  const run: Run = async (fn) => {
    setBusy(true)
    setSay(null)
    try {
      return await fn()
    } catch (e) {
      setSay((e as Error).message)
      return null
    } finally {
      setBusy(false)
    }
  }

  const open = (id: ArcadeGameId) => {
    // 소리는 누른 손끝에서만 켜진다(휴대폰이 그렇다). 판이 열리기 전에 깨워 둔다
    if (ARCADE_BY_ID[id].kind === 'live') unlockChip()
    void run(() => act.arcadeOpen(id))
  }
  const again = (r: LiveRoom) => {
    onDismiss(r.id)
    open(r.game)
  }
  const toMenu = (r: LiveRoom) => onDismiss(r.id)

  let body
  if (!room) {
    body = <Menu busy={busy} onPick={open} />
  } else if (room.status === 'lobby') {
    body = <Lobby room={room} meId={meId} machine={machine} seated={seated} busy={busy} run={run} act={act} />
  } else if (room.status === 'gone') {
    body = (
      <>
        <p className="sc-ar__title">{ARCADE_BY_ID[room.game].name}</p>
        <p className="sc-ar__none">판이 깨졌다.<br />누가 그만두거나 자리에서 일어났다.</p>
        <div className="sc-ar__row">
          <button disabled={busy} onClick={() => toMenu(room)}>게임 고르기</button>
        </div>
      </>
    )
  } else if (room.game === 'updown') {
    body = <UpDown room={room} meId={meId} busy={busy} run={run} act={act} onAgain={() => again(room)} onMenu={() => toMenu(room)} />
  } else if (room.game === 'rps') {
    body = <Rps room={room} meId={meId} busy={busy} run={run} act={act} onAgain={() => again(room)} onMenu={() => toMenu(room)} />
  } else if (room.game === 'rhythm') {
    body = (
      <Rhythm
        room={room}
        meId={meId}
        act={act}
        onAgain={() => again(room)}
        onMenu={() => toMenu(room)}
        onQuit={() => void run(() => act.arcadeLeave(room.id))}
      />
    )
  } else {
    body = <p className="sc-ar__none">아직 준비 중인 게임이다.</p>
  }

  const ask = invites[0]
  return (
    <div className="sc-ar">
      {/* 간판. 전구가 번갈아 켜진다 — 오락실 앞을 지나갈 때 보던 그것 */}
      <div className="sc-ar__marquee" aria-hidden>
        <i /><i /><i />
        <span>{machine + 1}번 기계</span>
        <i /><i /><i />
      </div>
      {/* 다른 기계가 부르면 화면 위에 띠가 선다. 하던 판은 그대로 둔다 */}
      {ask && (
        <div className="sc-ar__ask" role="alert">
          <p>
            <b>{hostOf(ask)?.name || '누군가'}</b> <span>{machineName(hostOf(ask)?.machine ?? 0)}</span>
            <br />
            {ARCADE_BY_ID[ask.game].name} 하자고 한다
          </p>
          <div className="sc-ar__row">
            <button disabled={busy} onClick={() => void run(() => act.arcadeLeave(ask.id))}>안 한다</button>
            <button
              className="is-go"
              disabled={busy}
              onClick={() => {
                if (ARCADE_BY_ID[ask.game].kind === 'live') unlockChip()
                void run(() => act.arcadeAnswer(ask.id, true))
              }}
            >
              한다
            </button>
          </div>
        </div>
      )}
      <div className="sc-ar__screen">{body}</div>
      {say && <p className="sc-ar__say" role="alert">{say}</p>}
    </div>
  )
}

const hostOf = (r: LiveRoom) => r.members.find((m) => m.id === r.hostId)

// ── 고르기 ──────────────────────────────────────────────────────

function Menu({ busy, onPick }: { busy: boolean; onPick: (id: ArcadeGameId) => void }) {
  return (
    <>
      <p className="sc-ar__title">게임을 고른다</p>
      <ul className="sc-ar__menu">
        {ARCADE_GAMES.map((g) => (
          <li key={g.id}>
            <button className={g.ready ? '' : 'is-off'} disabled={busy || !g.ready} onClick={() => onPick(g.id)}>
              <b>{g.name}</b>
              <em className={g.max > 1 ? 'is-duo' : ''}>{playersLabel(g)}</em>
              <span>{g.ready ? g.blurb : '준비 중'}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

// ── 부르기 ──────────────────────────────────────────────────────

const STATE_WORD = { in: '들어옴', invited: '부르는 중…', declined: '안 한대', left: '나감' } as const

/**
 * 고르는 중. **방장은 다른 기계를 부르고, 받은 사람은 기다린다.**
 *
 * 골목 기계 열 대를 그대로 늘어놓는다. 누가 몇 번에 앉았는지는 골목이
 * 한눈에 보이니 화면도 안다 — 그 사람에게 부름을 보낸다.
 */
function Lobby({ room, meId, machine, seated, busy, run, act }: {
  room: LiveRoom
  meId: string
  machine: number
  seated: readonly (Seated | null)[]
  busy: boolean
  run: Run
  act: GameActions
}) {
  const spec = ARCADE_BY_ID[room.game]
  const host = room.hostId === meId
  const inN = inMembers(room).length
  const taken = room.members.filter((m) => m.state === 'in' || m.state === 'invited').length
  const stateOf = (id: string) => room.members.find((m) => m.id === id)?.state ?? null
  const hostName = hostOf(room)?.name || '고른 사람'

  return (
    <div className="sc-lb">
      <p className="sc-ar__title">{spec.name} <span>{playersLabel(spec)} · 지금 {inN}명</span></p>

      <ul className="sc-lb__members">
        {room.members.map((m) => (
          <li key={m.id} className={`is-${m.state}`}>
            <span>{machineName(m.machine)}</span>
            <b>{m.id === meId ? '나' : m.name}</b>
            <em>{m.id === room.hostId ? '고른 사람' : STATE_WORD[m.state]}</em>
          </li>
        ))}
      </ul>

      {host ? (
        <>
          <p className="sc-lb__hint">다른 기계에 앉은 사람을 부른다</p>
          <ol className="sc-lb__cabs">
            {Array.from({ length: ARCADE_COUNT }, (_, i) => {
              const who = seated[i]
              const st = who ? stateOf(who.id) : null
              const mine = i === machine
              const can = !!who && !mine && who.id !== meId && st !== 'in' && st !== 'invited' && taken < spec.max
              return (
                <li key={i}>
                  <button
                    className={mine ? 'is-me' : st ? `is-${st}` : who ? '' : 'is-empty'}
                    disabled={busy || !can}
                    onClick={() => who && void run(() => act.arcadeInvite(room.id, who.id))}
                  >
                    <span>{i + 1}</span>
                    <b>{mine ? '나' : who ? who.name : '빈 자리'}</b>
                    {!mine && who && <em>{st === 'in' ? '들어옴' : st === 'invited' ? '부름' : st === 'declined' ? '다시' : '부르기'}</em>}
                  </button>
                </li>
              )
            })}
          </ol>
          <div className="sc-ar__row">
            <button disabled={busy} onClick={() => void run(() => act.arcadeLeave(room.id))}>그만둔다</button>
            <button
              className="is-go"
              disabled={busy || inN < spec.min}
              onClick={() => {
                if (spec.kind === 'live') unlockChip()
                void run(() => act.arcadeBegin(room.id))
              }}
            >
              {inN < spec.min ? `${spec.min - inN}명 더 있어야` : '시작'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="sc-ar__none">{hostName}{josa(hostName, '이/가')} 시작하기를 기다린다…</p>
          <div className="sc-ar__row">
            <button disabled={busy} onClick={() => void run(() => act.arcadeLeave(room.id))}>나간다</button>
          </div>
        </>
      )}
    </div>
  )
}

// ── 업다운 ──────────────────────────────────────────────────────

function UpDown({ room, meId, busy, run, act, onAgain, onMenu }: {
  room: LiveRoom
  meId: string
  busy: boolean
  run: Run
  act: GameActions
  onAgain: () => void
  onMenu: () => void
}) {
  const [typed, setTyped] = useState('')
  const view = room.updown ?? { guesses: [], left: UPDOWN_TRIES, outcome: null, answer: null }
  const last = view.guesses.at(-1)
  const over = room.status === 'done'
  const outcome = room.results?.[meId]?.outcome ?? view.outcome

  const call = async () => {
    const n = Number(typed)
    const r = await run(() => act.arcadeMove(room.id, n))
    if (r) setTyped('')
  }
  const press = (k: string) => {
    if (k === '←') return setTyped((t) => t.slice(0, -1))
    setTyped((t) => (t.length >= String(UPDOWN_MAX).length ? t : (t + k).replace(/^0+/, '')))
  }

  return (
    <div className="sc-ud">
      <p className="sc-ar__title">업다운 <span>1 ~ {UPDOWN_MAX}</span></p>
      {/* 남은 기회. 숫자보다 칸이 빨리 읽힌다 */}
      <p className="sc-ud__lives" aria-label={`남은 기회 ${view.left}번`}>
        {Array.from({ length: UPDOWN_TRIES }, (_, i) => <i key={i} className={i < view.left ? 'is-on' : ''} />)}
      </p>

      <p className={`sc-ud__big${over && outcome ? ` is-${outcome}` : last ? ` is-${last.hint}` : ''}`} aria-live="polite">
        {over && outcome
          ? outcome === 'win' ? 'YOU WIN' : 'GAME OVER'
          : last ? (last.hint === 'up' ? `${last.n}  UP ▲` : `${last.n}  DOWN ▼`)
          : typed || '?'}
      </p>
      {over && view.answer !== null && <p className="sc-ud__answer">정답은 <b>{view.answer}</b></p>}
      {!over && last && <p className="sc-ud__typed">{typed || '다음 숫자'}</p>}

      <ol className="sc-ud__log">
        {view.guesses.map((g, i) => (
          <li key={i} className={`is-${g.hint}`}>{g.n}{g.hint === 'up' ? '▲' : g.hint === 'down' ? '▼' : '●'}</li>
        ))}
      </ol>

      {over ? (
        <EndRow busy={busy} onAgain={onAgain} onMenu={onMenu} />
      ) : (
        <div className="sc-ud__pad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '←', '0'].map((k) => (
            <button key={k} disabled={busy} onClick={() => press(k)} aria-label={k === '←' ? '지우기' : k}>{k}</button>
          ))}
          <button className="is-go" disabled={busy || typed === ''} onClick={() => void call()}>부른다</button>
        </div>
      )}
    </div>
  )
}

// ── 가위바위보 ──────────────────────────────────────────────────

function Rps({ room, meId, busy, run, act, onAgain, onMenu }: {
  room: LiveRoom
  meId: string
  busy: boolean
  run: Run
  act: GameActions
  onAgain: () => void
  onMenu: () => void
}) {
  // a 는 부른 사람, b 는 받은 사람 — 서버가 그렇게 적는다
  const players = room.members.filter((m) => m.state === 'in' || m.state === 'left')
  const side: 'a' | 'b' = players[0]?.id === meId ? 'a' : 'b'
  const foe = players.find((m) => m.id !== meId)
  const state = room.rps ?? { inIds: [], rounds: [] }
  const mineIn = state.inIds.includes(meId)
  const theirsIn = !!foe && state.inIds.includes(foe.id)
  const mine = (r: RpsRound) => (side === 'a' ? r.a : r.b)
  const theirs = (r: RpsRound) => (side === 'a' ? r.b : r.a)
  const won = (w: RpsRound['winner']) => (w === side ? 'win' : w === 'tie' ? 'draw' : 'lose')
  const outcome = room.results?.[meId]?.outcome ?? null

  return (
    <div className="sc-du">
      <p className="sc-ar__title">가위바위보 <span>나 vs {foe?.name ?? '?'}</span></p>

      {state.rounds.length > 0 && (
        <ol className="sc-du__rounds">
          {state.rounds.map((r, i) => (
            <li key={i} className={`is-${won(r.winner)}`}>
              <span>{i + 1}판</span>
              <b>{RPS_LABEL[mine(r)]}</b>
              <em>:</em>
              <b>{RPS_LABEL[theirs(r)]}</b>
              <span>{won(r.winner) === 'win' ? '이김' : won(r.winner) === 'lose' ? '짐' : '비김'}</span>
            </li>
          ))}
        </ol>
      )}

      {room.status === 'playing' && (
        <>
          {/* 상대가 냈는지는 보인다. **무엇을 냈는지는 안 보인다** — 서버가 봉인했다 */}
          <p className="sc-du__them">
            {foe?.name}: <b className={theirsIn ? 'is-in' : ''}>{theirsIn ? '냈다' : '고민 중'}</b>
          </p>
          {mineIn ? (
            <p className="sc-ar__none">냈다. 상대를 기다린다…</p>
          ) : (
            <div className="sc-du__picks">
              {RPS_PICKS.map((p: RpsPick) => (
                <button key={p} disabled={busy} onClick={() => void run(() => act.arcadePick(room.id, p))}>
                  {RPS_LABEL[p]}
                </button>
              ))}
            </div>
          )}
          <div className="sc-ar__row">
            <button disabled={busy} onClick={() => void run(() => act.arcadeLeave(room.id))}>그만둔다</button>
          </div>
        </>
      )}

      {room.status === 'done' && outcome && (
        <>
          <p className={`sc-ud__big is-${outcome}`}>{BIG[outcome]}</p>
          <EndRow busy={busy} onAgain={onAgain} onMenu={onMenu} />
        </>
      )}
    </div>
  )
}

// ── 받는 쪽 한 줄 ───────────────────────────────────────────────

/** 오락기 창이 닫혀 있어도 뜬다. 거래 신청(DealAsk)과 같은 자리다. */
export function ArcadeAsk({ room, onAnswer }: { room: LiveRoom; onAnswer: (yes: boolean) => void }) {
  const host = hostOf(room)
  return (
    <div className="sc-da sc-da--arcade">
      <p className="sc-da__who"><b>{host?.name || '누군가'}</b><span>{machineName(host?.machine ?? 0)}</span></p>
      <p className="sc-da__say">{ARCADE_BY_ID[room.game]?.name ?? '게임'} 하자고 한다.</p>
      <div className="sc-da__row">
        <button onClick={() => onAnswer(false)}>안 한다</button>
        <button className="is-on" onClick={() => onAnswer(true)}>한다</button>
      </div>
    </div>
  )
}
