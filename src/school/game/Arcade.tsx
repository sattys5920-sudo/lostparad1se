// 오락기 화면 — 기계 한 대, 그 안의 게임 고르기와 게임들.
//
// **화면은 답을 모른다.** 업다운의 숫자는 판이 끝나야 온다. 대결에서
// 상대가 낸 수는 둘 다 내야 온다. 여기서 하는 일은 물어보고, 받은 것을
// 그리는 것뿐이다 — 승부를 여기서 정하면 개발자도구로 누구나 이긴다.
//
// 숫자는 **화면 안 자판**으로 누른다. 휴대폰 자판이 올라오면 지도와
// 조작부가 통째로 밀려 올라간다 — 이 앱이 여러 번 겪었다. 오락기에는
// 오락기의 단추가 있는 편이 맞기도 하다.
import { useState } from 'react'

import './arcade.css'

import {
  ARCADE_BY_ID,
  ARCADE_GAMES,
  RPS_LABEL,
  RPS_PICKS,
  UPDOWN_MAX,
  UPDOWN_TRIES,
  type ArcadeGameId,
  type RpsPick,
  type UpDownView,
} from '../../../shared/rules/arcade'
import type { GameActions } from './useGame'
import type { LiveMatch } from './useArcade'

export interface ArcadeProps {
  act: GameActions
  meId: string
  /** 지금 오락기 옆에 선 사람들(나 빼고). 대결 상대는 여기서 고른다. */
  beside: readonly { id: string; name: string }[]
  nameOf: (id: string | null) => string
  /** 내가 낀 대결. 있으면 그 화면이 먼저다. */
  match: LiveMatch | null
  onDismissMatch: () => void
}

type Screen = { kind: 'menu' } | { kind: 'updown'; view: UpDownView } | { kind: 'foe'; game: ArcadeGameId }

export function Arcade({ act, meId, beside, nameOf, match, onDismissMatch }: ArcadeProps) {
  const [screen, setScreen] = useState<Screen>({ kind: 'menu' })
  const [busy, setBusy] = useState(false)
  const [say, setSay] = useState<string | null>(null)

  async function run<T>(fn: () => Promise<T>): Promise<T | null> {
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

  const start = async (id: ArcadeGameId) => {
    const g = ARCADE_BY_ID[id]
    if (g.players === 2) return setScreen({ kind: 'foe', game: id })
    const r = (await run(() => act.arcadeStart(id))) as { view?: UpDownView } | null
    if (r?.view) setScreen({ kind: 'updown', view: r.view })
  }

  // 대결 중이면 그게 먼저다 — 신청을 받아 앉았거나, 내가 걸고 기다리는 중
  const body = match ? (
    <Duel match={match} meId={meId} nameOf={nameOf} act={act} busy={busy} run={run} onLeave={() => {
      onDismissMatch()
      setScreen({ kind: 'menu' })
    }} />
  ) : screen.kind === 'updown' ? (
    <UpDown view={screen.view} busy={busy} run={run} act={act}
      onView={(view) => setScreen({ kind: 'updown', view })}
      onMenu={() => setScreen({ kind: 'menu' })} />
  ) : screen.kind === 'foe' ? (
    <PickFoe game={screen.game} beside={beside} busy={busy}
      onPick={(id) => void run(() => act.arcadeChallenge(screen.game, id))}
      onBack={() => setScreen({ kind: 'menu' })} />
  ) : (
    <Menu busy={busy} onPick={(id) => void start(id)} />
  )

  return (
    <div className="sc-ar">
      {/* 간판. 전구가 번갈아 켜진다 — 오락실 앞을 지나갈 때 보던 그것 */}
      <div className="sc-ar__marquee" aria-hidden>
        <i /><i /><i />
        <span>오락기</span>
        <i /><i /><i />
      </div>
      <div className="sc-ar__screen">{body}</div>
      {say && <p className="sc-ar__say" role="alert">{say}</p>}
    </div>
  )
}

// ── 고르기 ──────────────────────────────────────────────────────

function Menu({ busy, onPick }: { busy: boolean; onPick: (id: ArcadeGameId) => void }) {
  return (
    <>
      <p className="sc-ar__title">게임을 고른다</p>
      <ul className="sc-ar__menu">
        {ARCADE_GAMES.map((g) => (
          <li key={g.id}>
            <button
              className={g.ready ? '' : 'is-off'}
              disabled={busy || !g.ready}
              onClick={() => onPick(g.id)}
            >
              <b>{g.name}</b>
              <em className={g.players === 2 ? 'is-duo' : ''}>{g.players === 2 ? '2P' : '1P'}</em>
              <span>{g.ready ? g.blurb : '준비 중'}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

// ── 업다운 ──────────────────────────────────────────────────────

function UpDown({ view, busy, run, act, onView, onMenu }: {
  view: UpDownView
  busy: boolean
  run: <T>(fn: () => Promise<T>) => Promise<T | null>
  act: GameActions
  onView: (v: UpDownView) => void
  onMenu: () => void
}) {
  const [typed, setTyped] = useState('')
  const last = view.guesses.at(-1)
  const over = view.outcome !== null

  const call = async () => {
    const n = Number(typed)
    const r = (await run(() => act.arcadeMove(n))) as { view?: UpDownView } | null
    if (r?.view) {
      onView(r.view)
      setTyped('')
    }
  }
  const again = async () => {
    const r = (await run(() => act.arcadeStart('updown'))) as { view?: UpDownView } | null
    if (r?.view) {
      onView(r.view)
      setTyped('')
    }
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

      <p className={`sc-ud__big${over ? ` is-${view.outcome}` : last ? ` is-${last.hint}` : ''}`} aria-live="polite">
        {over
          ? view.outcome === 'win' ? 'YOU WIN' : 'GAME OVER'
          : last ? (last.hint === 'up' ? `${last.n}  UP ▲` : `${last.n}  DOWN ▼`)
          : typed || '?'}
      </p>
      {over && <p className="sc-ud__answer">정답은 <b>{view.answer}</b></p>}
      {!over && last && <p className="sc-ud__typed">{typed || '다음 숫자'}</p>}

      <ol className="sc-ud__log">
        {view.guesses.map((g, i) => (
          <li key={i} className={`is-${g.hint}`}>{g.n}{g.hint === 'up' ? '▲' : g.hint === 'down' ? '▼' : '●'}</li>
        ))}
      </ol>

      {over ? (
        <div className="sc-ar__row">
          <button disabled={busy} onClick={onMenu}>게임 고르기</button>
          <button className="is-go" disabled={busy} onClick={() => void again()}>한 판 더</button>
        </div>
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

// ── 대결 상대 고르기 ────────────────────────────────────────────

function PickFoe({ game, beside, busy, onPick, onBack }: {
  game: ArcadeGameId
  beside: readonly { id: string; name: string }[]
  busy: boolean
  onPick: (id: string) => void
  onBack: () => void
}) {
  return (
    <>
      <p className="sc-ar__title">{ARCADE_BY_ID[game].name} <span>누구와?</span></p>
      {beside.length === 0 ? (
        <p className="sc-ar__none">오락기 옆에 선 사람이 없다.<br />옆에 누가 와야 한 판 할 수 있다.</p>
      ) : (
        <ul className="sc-ar__foes">
          {beside.map((p) => (
            <li key={p.id}>
              <button disabled={busy} onClick={() => onPick(p.id)}>{p.name}<span>에게 한 판 하자고 한다</span></button>
            </li>
          ))}
        </ul>
      )}
      <div className="sc-ar__row">
        <button disabled={busy} onClick={onBack}>게임 고르기</button>
      </div>
    </>
  )
}

// ── 대결 ────────────────────────────────────────────────────────

function Duel({ match, meId, nameOf, act, busy, run, onLeave }: {
  match: LiveMatch
  meId: string
  nameOf: (id: string | null) => string
  act: GameActions
  busy: boolean
  run: <T>(fn: () => Promise<T>) => Promise<T | null>
  onLeave: () => void
}) {
  const side: 'a' | 'b' = match.aId === meId ? 'a' : 'b'
  const foe = nameOf(side === 'a' ? match.bId : match.aId)
  const mineIn = side === 'a' ? match.aIn : match.bIn
  const theirsIn = side === 'a' ? match.bIn : match.aIn
  const title = ARCADE_BY_ID[match.game]?.name ?? '대결'
  const leave = async () => {
    if (match.status === 'asked' || match.status === 'playing') await run(() => act.arcadeLeave(match.id))
    onLeave()
  }
  // 내 쪽에서 본 판. 서버는 a 쪽에서 적는다
  const mine = (r: LiveMatch['rounds'][number]) => (side === 'a' ? r.a : r.b)
  const theirs = (r: LiveMatch['rounds'][number]) => (side === 'a' ? r.b : r.a)
  const won = (w: 'a' | 'b' | 'tie' | 'draw' | null) => (w === side ? 'win' : w === 'tie' || w === 'draw' ? 'draw' : 'lose')

  return (
    <div className="sc-du">
      <p className="sc-ar__title">{title} <span>나 vs {foe}</span></p>

      {match.status === 'asked' && (
        match.aId === meId
          ? <p className="sc-ar__none">{foe}에게 신청했다.<br />받기를 기다린다…</p>
          : <p className="sc-ar__none">{foe}가 한 판 하자고 한다.</p>
      )}
      {match.status === 'declined' && <p className="sc-ar__none">{foe}가 안 한다고 했다.</p>}
      {match.status === 'gone' && <p className="sc-ar__none">대결이 흩어졌다.</p>}

      {match.rounds.length > 0 && (
        <ol className="sc-du__rounds">
          {match.rounds.map((r, i) => (
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

      {match.status === 'playing' && (
        <>
          {/* 상대가 냈는지는 보인다. **무엇을 냈는지는 안 보인다** — 서버가 봉인했다 */}
          <p className="sc-du__them">
            {foe}: <b className={theirsIn ? 'is-in' : ''}>{theirsIn ? '냈다' : '고민 중'}</b>
          </p>
          {mineIn ? (
            <p className="sc-ar__none">냈다. 상대를 기다린다…</p>
          ) : (
            <div className="sc-du__picks">
              {RPS_PICKS.map((p: RpsPick) => (
                <button key={p} disabled={busy} onClick={() => void run(() => act.arcadePick(match.id, p))}>
                  {RPS_LABEL[p]}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {match.status === 'done' && (
        <p className={`sc-ud__big is-${won(match.outcome)}`}>
          {won(match.outcome) === 'win' ? 'YOU WIN' : won(match.outcome) === 'lose' ? 'YOU LOSE' : 'DRAW'}
        </p>
      )}

      <div className="sc-ar__row">
        {match.status === 'asked' && match.bId === meId && (
          <button className="is-go" disabled={busy} onClick={() => void run(() => act.arcadeAnswer(match.id, true))}>한다</button>
        )}
        <button disabled={busy} onClick={() => void leave()}>
          {match.status === 'asked' || match.status === 'playing' ? '그만둔다' : '게임 고르기'}
        </button>
      </div>
    </div>
  )
}

// ── 받는 쪽 한 줄 ───────────────────────────────────────────────

/** 오락기 창이 닫혀 있어도 뜬다. 거래 신청(DealAsk)과 같은 자리다. */
export function ArcadeAsk({ fromName, game, onAnswer }: { fromName: string; game: ArcadeGameId; onAnswer: (yes: boolean) => void }) {
  return (
    <div className="sc-da sc-da--arcade">
      <p className="sc-da__who"><b>{fromName}</b><span>오락기</span></p>
      <p className="sc-da__say">{ARCADE_BY_ID[game]?.name ?? '게임'} 한 판 하자고 한다.</p>
      <div className="sc-da__row">
        <button onClick={() => onAnswer(false)}>안 한다</button>
        <button className="is-on" onClick={() => onAnswer(true)}>한다</button>
      </div>
    </div>
  )
}
