// v2 진입 화면.
//
// 로그인 → 자리에 앉기 → 닷새.
//
// 여기서 게임 규칙을 판단하지 않는다. 무엇을 할 수 있는지도 서버가
// 정하고, 화면은 서버가 거절하면 그 말을 그대로 보인다.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'

import { auth, callServer, firebaseConfigured } from '../../firebase'
import { amHost, claimHost, logIn, signUp } from '../accounts'
import { gameActions, useGame } from './useGame'
import { LiveArchive, LiveEnding, LiveMorning, LiveRetro } from '../reveal/live'
import { Actions, Standing } from './Actions'
import { Board } from './Board'
import { Chat } from './Chat'
import { Deals } from './Deals'
import { People } from './People'
import { TEAMS, TOTAL_SEATS, seatsLeft } from '../../../shared/rules/lobby'
import type { TeamId } from '../../../shared/rules/v2'
import type { TileId } from '../../../shared/rules/board'
import './play.css'

const GAME_ID = new URLSearchParams(location.search).get('game') ?? 'live'

// ── 로그인 ──────────────────────────────────────────────────────

function Gate({ onIn }: { onIn: () => void }) {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [id, setId] = useState('')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function go() {
    setBusy(true)
    setError('')
    try {
      await (mode === 'up' ? signUp(id, pw) : logIn(id, pw))
      onIn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sc-pl__gate">
      <h1>남겨진 아이들</h1>
      <div className="sc-pl__tabs">
        <button className={mode === 'in' ? 'is-on' : ''} onClick={() => setMode('in')}>로그인</button>
        <button className={mode === 'up' ? 'is-on' : ''} onClick={() => setMode('up')}>가입</button>
      </div>
      <input placeholder="아이디" value={id} onChange={(e) => setId(e.target.value)} autoCapitalize="off" />
      <input placeholder="비밀번호" type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
      {error && <p className="sc-pl__error">{error}</p>}
      <button className="sc-pl__go" disabled={busy || !id || !pw} onClick={go}>
        {mode === 'up' ? '가입하기' : '들어가기'}
      </button>
    </div>
  )
}

// ── 운영자 ──────────────────────────────────────────────────────

/** 증표 안에 운영자 표시가 있는지 본다. 로그인이 바뀌면 다시 본다. */
function useHost(): [boolean, () => void] {
  const [host, setHost] = useState(false)
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    let alive = true
    void amHost().then((v) => alive && setHost(v))
    return () => {
      alive = false
    }
  }, [nonce])
  return [host, () => setNonce((n) => n + 1)]
}

/**
 * 운영자 코드 칸.
 *
 * 코드는 화면에도 번들에도 없다. 서버가 배포 환경변수로 들고 있고
 * 여기서는 맞는지 물어보기만 한다. 틀린 횟수도 서버가 센다.
 */
function HostGate({ onIn }: { onIn: () => void }) {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function go() {
    setBusy(true)
    setError('')
    try {
      await claimHost(code)
      setCode('')
      setOpen(false)
      onIn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button className="sc-pl__hostlink" onClick={() => setOpen(true)}>
        운영자로 들어가기
      </button>
    )
  }
  return (
    <div className="sc-pl__hostgate">
      <input
        placeholder="운영자 코드"
        type="password"
        value={code}
        autoComplete="off"
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) void go()
        }}
      />
      <button disabled={busy || code.trim().length === 0} onClick={() => void go()}>
        확인
      </button>
      {error && <p className="sc-pl__error">{error}</p>}
    </div>
  )
}

/** 판을 만들고 시작한다. 되는지 안 되는지는 서버가 말해 준다. */
function HostTools({ gameId, hasGame, onSaid }: { gameId: string; hasGame: boolean; onSaid: (t: string) => void }) {
  const act = useMemo(() => gameActions(gameId), [gameId])
  const [busy, setBusy] = useState(false)

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
    <div className="sc-pl__hosttools">
      <span>운영자</span>
      {!hasGame && (
        <button disabled={busy} onClick={() => void run('판 만들기', () => act.createGame())}>
          판 만들기
        </button>
      )}
      {hasGame && (
        <button disabled={busy} onClick={() => void run('시작', () => act.startGame())}>
          닷새 시작
        </button>
      )}
    </div>
  )
}

// ── 로비 ────────────────────────────────────────────────────────

function Lobby({ gameId }: { gameId: string }) {
  const state = useGame(gameId)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [host, recheckHost] = useHost()
  const uid = auth?.currentUser?.uid ?? null
  const seats = state.game?.seats ?? []
  const mine = seats.find((s) => s.playerId === uid)
  const left = seatsLeft(seats)

  const join = useCallback(
    async (team?: TeamId) => {
      setError('')
      try {
        await callServer('joinGame', { gameId, name: name || mine?.name || '이름없음', team })
      } catch (e) {
        setError((e as Error).message)
      }
    },
    [gameId, name, mine?.name],
  )

  if (state.loading) return <p className="sc-pl__wait">불러오는 중</p>
  if (!state.game) {
    return (
      <div className="sc-pl__lobby">
        <h1>남겨진 아이들</h1>
        <p className="sc-pl__none">아직 열린 판이 없다. 운영자가 만들어야 한다.</p>
        {host ? (
          <HostTools gameId={gameId} hasGame={false} onSaid={setError} />
        ) : (
          <HostGate onIn={recheckHost} />
        )}
        {error && <p className="sc-pl__error">{error}</p>}
      </div>
    )
  }

  return (
    <div className="sc-pl__lobby">
      <h1>자리</h1>
      <p className="sc-pl__count">
        {seats.length} / {TOTAL_SEATS}
      </p>
      {!mine && (
        <input placeholder="이름 (1~12자)" value={name} maxLength={12} onChange={(e) => setName(e.target.value)} />
      )}
      <ul className="sc-pl__teams">
        {TEAMS.map((t) => (
          <li key={t}>
            <span className="sc-pl__team">{t}팀</span>
            <span className="sc-pl__left">{left[t]}자리</span>
            <button disabled={left[t] === 0 && mine?.team !== t} onClick={() => join(t)}>
              {mine?.team === t ? '여기 앉아 있다' : '앉기'}
            </button>
          </li>
        ))}
      </ul>
      <ul className="sc-pl__seated">
        {seats.map((s) => (
          <li key={s.playerId} className={s.playerId === uid ? 'is-me' : ''}>
            {s.name} <span>{s.team}</span>
          </li>
        ))}
      </ul>
      {host ? <HostTools gameId={gameId} hasGame onSaid={setError} /> : <HostGate onIn={recheckHost} />}
      {error && <p className="sc-pl__error">{error}</p>}
    </div>
  )
}

// ── 닷새 ────────────────────────────────────────────────────────

type Screen = 'map' | 'people' | 'deals' | 'talk' | 'archive' | 'retro'

function Running({ gameId }: { gameId: string }) {
  const state = useGame(gameId)
  const [screen, setScreen] = useState<Screen>('map')
  const [morningDone, setMorningDone] = useState(false)

  // 들어올 때마다 밀린 일을 따라잡는다. 아무도 없던 사이의 아침과
  // 정산이 여기서 처리된다
  useEffect(() => {
    void gameActions(gameId).tick().catch(() => {})
  }, [gameId])

  const game = state.game
  if (!game) return <p className="sc-pl__wait">불러오는 중</p>

  // 종례가 끝났으면 엔딩과 회고만 남는다
  if (game.phase === 'finished') {
    return (
      <div className="sc-pl">
        {screen === 'retro' ? <LiveRetro gameId={gameId} /> : <LiveEnding gameId={gameId} />}
        <nav className="sc-pl__tabbar">
          <button className={screen !== 'retro' ? 'is-on' : ''} onClick={() => setScreen('map')}>엔딩</button>
          <button className={screen === 'retro' ? 'is-on' : ''} onClick={() => setScreen('retro')}>회고</button>
        </nav>
      </div>
    )
  }

  // 아침 시퀀스가 먼저다. 볼 것이 없으면 저절로 지나간다
  if (!morningDone) {
    return <LiveMorning gameId={gameId} onDone={() => setMorningDone(true)} />
  }

  return (
    <div className="sc-pl">
      {screen === 'archive' ? (
        <LiveArchive gameId={gameId} onClose={() => setScreen('map')} />
      ) : (
        <Today gameId={gameId} screen={screen} />
      )}
      <nav className="sc-pl__tabbar">
        <button className={screen === 'map' ? 'is-on' : ''} onClick={() => setScreen('map')}>지도</button>
        <button className={screen === 'people' ? 'is-on' : ''} onClick={() => setScreen('people')}>사람</button>
        <button className={screen === 'deals' ? 'is-on' : ''} onClick={() => setScreen('deals')}>거래</button>
        <button className={screen === 'talk' ? 'is-on' : ''} onClick={() => setScreen('talk')}>말</button>
        <button className={screen === 'archive' ? 'is-on' : ''} onClick={() => setScreen('archive')}>보관함</button>
      </nav>
    </div>
  )
}

/**
 * 오늘 화면 — 지도 · 사람 · 거래.
 *
 * 무엇을 할 수 있는지는 **화면이 판단하지 않는다.** 단추는 다 보이고,
 * 안 되는 것은 서버가 거절하며 그 이유를 말해 준다. 화면이 미리 막으면
 * 규칙이 두 벌이 되고, 둘이 어긋나는 날 사람은 왜 안 되는지 알 수 없다.
 */
function Today({ gameId, screen }: { gameId: string; screen: Screen }) {
  const state = useGame(gameId)
  const act = useMemo(() => gameActions(gameId), [gameId])
  const uid = auth?.currentUser?.uid ?? null
  const [picked, setPicked] = useState<TileId | null>(null)
  const [said, setSaid] = useState('')

  const game = state.game
  const me = game?.seats.find((s) => s.playerId === uid)
  const invisibleName = game?.invisibleId
    ? (game.seats.find((s) => s.playerId === game.invisibleId)?.name ?? null)
    : null
  // 내가 선 칸. 걷는 중이면 null이다
  const standingOn = (state.view?.visiblePawns.find((p) => p.playerId === uid)?.tileId ?? null) as TileId | null

  // 서버가 한 말을 잠깐 띄운다. 그대로 두면 쌓여서 화면을 가린다
  useEffect(() => {
    if (!said) return
    const t = setTimeout(() => setSaid(''), 3200)
    return () => clearTimeout(t)
  }, [said])

  if (!game || !me) return <p className="sc-pl__wait">불러오는 중</p>

  return (
    <div className="sc-pl__today">
      <header className="sc-pl__head">
        <h1>DAY {game.day}</h1>
        <span className="sc-pl__me">
          {me.name} · {me.team}팀
        </span>
      </header>
      {invisibleName && <p className="sc-pl__invisible">오늘의 투명인간 · {invisibleName}</p>}

      <ul className="sc-pl__stat">
        <li>
          <span>토큰</span>
          <span>{state.teams[me.team]?.tokens ?? '—'}</span>
        </li>
        <li>
          <span>돈</span>
          <span>{state.teams[me.team]?.resources.money ?? '—'}</span>
        </li>
        <li>
          <span>지식</span>
          <span>{state.teams[me.team]?.resources.knowledge ?? '—'}</span>
        </li>
        <li>
          <span>영향력</span>
          <span>{state.teams[me.team]?.resources.influence ?? '—'}</span>
        </li>
      </ul>

      {screen === 'map' && (
        <>
          <Standing standingOn={standingOn} act={act} onSaid={setSaid} />
          <Board
            view={state.view}
            tiles={state.tiles}
            openedTiles={game.openedTiles}
            boostedTiles={game.boostedTiles}
            picked={picked}
            onPick={setPicked}
          />
          {picked ? (
            <Actions tileId={picked} act={act} onSaid={setSaid} />
          ) : (
            <p className="sc-pl__hint">칸을 누르면 거기서 할 수 있는 일이 나온다.</p>
          )}
        </>
      )}

      {screen === 'people' && (
        <People
          me={me}
          seats={game.seats}
          day={game.day}
          invisibleId={game.invisibleId}
          chosenId={state.view?.myChoice?.chosenId ?? null}
          day4={state.view?.myChoice?.day4 ?? null}
          act={act}
          onSaid={setSaid}
        />
      )}

      {screen === 'deals' && (
        <Deals me={me} view={state.view} teams={state.teams} act={act} onSaid={setSaid} />
      )}

      {screen === 'talk' && <Chat me={me} act={act} onSaid={setSaid} />}

      {said && <p className="sc-pl__said">{said}</p>}
    </div>
  )
}

// ── 묶기 ────────────────────────────────────────────────────────

export function Play() {
  const [ready, setReady] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const state = useGame(signedIn ? GAME_ID : null)

  useEffect(() => {
    if (!auth) {
      setReady(true)
      return
    }
    return onAuthStateChanged(auth, (u) => {
      setSignedIn(Boolean(u))
      setReady(true)
    })
  }, [])

  if (!firebaseConfigured) return <p className="sc-pl__wait">firebase 설정이 없다.</p>
  if (!ready) return null
  if (!signedIn) return <Gate onIn={() => setSignedIn(true)} />

  const phase = state.game?.phase
  if (phase === 'running' || phase === 'finished') return <Running gameId={GAME_ID} />
  return <Lobby gameId={GAME_ID} />
}
