// v2 진입 화면.
//
// 로그인 → 자리에 앉기 → 닷새.
//
// 여기서 게임 규칙을 판단하지 않는다. 무엇을 할 수 있는지도 서버가
// 정하고, 화면은 서버가 거절하면 그 말을 그대로 보인다.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'

import { auth, callServer, firebaseConfigured } from '../../firebase'
import { amHost, claimHost, logIn, myAccount, saveAccountCharacter, signUp } from '../accounts'
import { CharacterCreator } from '../components/CharacterCreator'
import { randomLook } from '../char/look'
import type { AvatarLook } from '../types'
import { gameActions, useGame } from './useGame'
import { LiveArchive, LiveEnding, LiveMorning, LiveRetro } from '../reveal/live'
import { Actions, Standing } from './Actions'
import { Walk } from './Walk'
import { FullMap, MiniMap, useMiniMapOn } from './Atlas'
import { Phase, PhaseHost, PhaseLog } from './Phase'
import { PHASE_POLL_MS } from './timing'
import type { ActionKind } from '../../../shared/rules/occupy'
import { Chat } from './Chat'
import { Deals } from './Deals'
import { People } from './People'
import { TOTAL_SEATS } from '../../../shared/rules/lobby'
import { TILE_BY_ID, type TileId } from '../../../shared/rules/board'
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

// ── 나를 만든다 ─────────────────────────────────────────────────

/**
 * 가입하고 나면 제일 먼저 나를 만든다.
 *
 * 팀은 아직 없다. 팀은 고르는 것이 아니라 판에 들어갈 때 받는 것이라,
 * 교복 색도 그때 정해진다. 여기서는 얼굴과 이름만 정한다.
 */
function Setup({ first, onDone }: { first: { nickname: string; avatar: AvatarLook | null }; onDone: () => void }) {
  // 처음 여는 사람에게 빈 화면 대신 아무나 하나 보여 준다. 바꾸면 된다
  const [look, setLook] = useState<AvatarLook>(() => first.avatar ?? randomLook(Math.random() < 0.5 ? 'F' : 'M'))
  const [nickname, setNickname] = useState(first.nickname)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function go() {
    const name = nickname.trim()
    if (name.length === 0 || name.length > 12) {
      setError('이름은 1~12자다.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await saveAccountCharacter('', name, look)
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sc-pl__setup">
      <h1>나</h1>
      <input
        placeholder="이름 (1~12자)"
        value={nickname}
        maxLength={12}
        onChange={(e) => setNickname(e.target.value)}
      />
      <CharacterCreator look={look} team={null} onChange={setLook} />
      {error && <p className="sc-pl__error">{error}</p>}
      <button className="sc-pl__go" disabled={busy || nickname.trim().length === 0} onClick={() => void go()}>
        이걸로 하기
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
  const [qaPw, setQaPw] = useState('')

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
        <>
          <button disabled={busy} onClick={() => void run('시작', () => act.startGame())}>
            닷새 시작
          </button>
          {/* QA용. 비밀번호를 여기서 정하게 둔다 — 뻔한 값을 박아 두면
              qa01 이 그대로 뒷문이 된다 */}
          <input
            className="sc-pl__qapw"
            type="password"
            placeholder="QA 비밀번호 (8자 이상)"
            value={qaPw}
            autoComplete="off"
            onChange={(e) => setQaPw(e.target.value)}
          />
          <button
            disabled={busy || qaPw.length < 8}
            onClick={() =>
              void run('열셋 채우기', async () => {
                const r = (await act.seedPlayers(qaPw)) as { seated?: number }
                onSaid(`${r.seated ?? 0}명이 앉았다. qa01~qa13 으로 들어갈 수 있다.`)
              })
            }
          >
            QA 채우기
          </button>
        </>
      )}
    </div>
  )
}

// ── 로비 ────────────────────────────────────────────────────────

function Lobby({ gameId, me }: { gameId: string; me: { nickname: string } }) {
  const state = useGame(gameId)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [host, recheckHost] = useHost()
  const uid = auth?.currentUser?.uid ?? null
  const seats = state.game?.seats ?? []
  const mine = seats.find((s) => s.playerId === uid)

  // 팀을 안 보낸다. 어느 반인지는 서버가 정해서 알려 준다 —
  // 고르게 두면 친구끼리 한 팀으로 몰리고 그러면 게임이 아니다
  async function join() {
    setBusy(true)
    setError('')
    try {
      await callServer('joinGame', { gameId, name: me.nickname })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (state.loading) return <p className="sc-pl__wait">불러오는 중</p>
  if (!state.game) {
    return (
      <div className="sc-pl__lobby">
        <h1>남겨진 아이들</h1>
        <p className="sc-pl__none">아직 열린 판이 없다. 운영자가 만들어야 한다.</p>
        {host ? <HostTools gameId={gameId} hasGame={false} onSaid={setError} /> : <HostGate onIn={recheckHost} />}
        {error && <p className="sc-pl__error">{error}</p>}
      </div>
    )
  }

  return (
    <div className="sc-pl__lobby">
      <h1>교실</h1>
      <p className="sc-pl__count">
        {seats.length} / {TOTAL_SEATS}
      </p>

      {mine ? (
        <p className="sc-pl__mine">
          너는 <strong>{mine.team}팀</strong>이다. 다 모이면 시작한다.
        </p>
      ) : (
        <button className="sc-pl__go" disabled={busy} onClick={() => void join()}>
          들어가기
        </button>
      )}

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

/**
 * 닷새. 끝나면 엔딩과 회고만 남는다.
 *
 * 진행 중에는 **화면이 하나다.** 탭을 두지 않는다 — 할 수 있는 일은
 * 내가 선 자리에서 나오고, 그 자리는 맵이 정한다.
 */
function Running({ gameId, look }: { gameId: string; look: AvatarLook | null }) {
  const state = useGame(gameId)
  const [morningDone, setMorningDone] = useState(false)
  const [afterEnding, setAfterEnding] = useState(false)

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
        {afterEnding ? <LiveRetro gameId={gameId} /> : <LiveEnding gameId={gameId} />}
        <nav className="sc-pl__tabbar">
          <button className={!afterEnding ? 'is-on' : ''} onClick={() => setAfterEnding(false)}>엔딩</button>
          <button className={afterEnding ? 'is-on' : ''} onClick={() => setAfterEnding(true)}>회고</button>
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
      <Today gameId={gameId} look={look} />
    </div>
  )
}

/**
 * 오늘 하루. **화면은 하나다.**
 *
 * 탭으로 갈라 놓으면 「사람」 탭에 열세 명이 늘어서고, 학교 반대편
 * 사람에게도 표를 줄 수 있을 것처럼 보인다. 이 게임은 그렇지 않다 —
 * 표도 교역도 털어놓기도 **그 자리에서 만나야** 한다. 그래서 맵이
 * 화면이고, 할 수 있는 일은 내가 선 자리와 거기 있는 사람에서 나온다.
 *
 * 무엇을 할 수 있는지는 여전히 화면이 판단하지 않는다. 안 되는 것은
 * 서버가 거절하고 그 이유를 말해 준다.
 */
function Today({ gameId, look }: { gameId: string; look: AvatarLook | null }) {
  const state = useGame(gameId)
  const act = useMemo(() => gameActions(gameId), [gameId])
  const uid = auth?.currentUser?.uid ?? null
  const [standingRoom, setStandingRoom] = useState<TileId | null>(null)
  /** 맵에서 누른 먼 방. 거기로 걸어가거나 내일 아침을 예약한다. */
  const [far, setFar] = useState<TileId | null>(null)
  const [said, setSaid] = useState('')
  const [overlay, setOverlay] = useState<'talk' | 'archive' | null>(null)
  const [chosen, setChosen] = useState<ActionKind | null>(null)
  const [ready, setReady] = useState<{ submitted: number; total: number } | null>(null)
  const [host] = useHost()
  const [atlas, setAtlas] = useState(false)
  const [miniOn, setMiniOn] = useMiniMapOn()

  const game = state.game
  const me = game?.seats.find((s) => s.playerId === uid)
  const invisibleName = game?.invisibleId
    ? (game.seats.find((s) => s.playerId === game.invisibleId)?.name ?? null)
    : null
  const standingOn = (state.view?.visiblePawns.find((p) => p.playerId === uid)?.tileId ?? null) as TileId | null
  // 같은 자리에 서 있는 사람들. 걷는 사람은 어느 자리에도 없다
  const hereNow = standingOn
    ? (state.view?.visiblePawns ?? []).filter((p) => p.playerId !== uid && p.tileId === standingOn)
    : []
  const hereIds = hereNow.map((p) => p.playerId)
  // 마주 선 팀. 교역도 동맹도 사람이 꺼내는 말이라 그 팀 사람이 앞에 있어야 한다
  const facingTeams = [...new Set(hereNow.map((p) => p.team))].filter((t) => t !== me?.team)

  // 서버가 한 말을 잠깐 띄운다. 그대로 두면 쌓여서 화면을 가린다
  useEffect(() => {
    if (!said) return
    const t = setTimeout(() => setSaid(''), 3200)
    return () => clearTimeout(t)
  }, [said])

  const phaseNo = state.game?.phaseNow?.no ?? 0
  const phaseOpen = state.game?.phaseNow?.open === true

  // 페이즈가 바뀌면 낸 것은 없던 일이 된다
  useEffect(() => {
    setChosen(null)
  }, [phaseNo, phaseOpen])

  // 몇 명이 냈는지. 무엇을 냈는지는 서버가 안 준다
  const countReady = useCallback(() => {
    void act
      .phaseReady()
      .then((r) => setReady(r as { submitted: number; total: number }))
      .catch(() => {})
  }, [act])

  useEffect(() => {
    if (!phaseOpen) {
      setReady(null)
      return
    }
    countReady()
    const t = setInterval(countReady, PHASE_POLL_MS)
    return () => clearInterval(t)
  }, [phaseOpen, phaseNo, countReady])

  if (!game || !me) return <p className="sc-pl__wait">불러오는 중</p>

  if (overlay === 'archive') return <LiveArchive gameId={gameId} onClose={() => setOverlay(null)} />

  return (
    <div className={miniOn ? 'sc-pl__today has-mini' : 'sc-pl__today'}>
      <header className="sc-pl__head">
        <h1>DAY {game.day}</h1>
        <span className="sc-pl__me">
          {me.name} · {me.team}팀
        </span>
      </header>
      {invisibleName && <p className="sc-pl__invisible">오늘의 투명인간 · {invisibleName}</p>}

      <ul className="sc-pl__stat">
        <li><span>토큰</span><span>{state.teams[me.team]?.tokens ?? '—'}</span></li>
        <li><span>돈</span><span>{state.teams[me.team]?.resources.money ?? '—'}</span></li>
        <li><span>지식</span><span>{state.teams[me.team]?.resources.knowledge ?? '—'}</span></li>
        <li><span>영향력</span><span>{state.teams[me.team]?.resources.influence ?? '—'}</span></li>
      </ul>

      {/* 걸어 다니는 학교는 한 방밖에 안 보인다. 구석에 판 전체를 얹는다 */}
      {miniOn && (
        <MiniMap
          facts={{ here: standingOn, meId: me.playerId, myTeam: me.team, view: state.view, tiles: state.tiles }}
          onOpen={() => setAtlas(true)}
        />
      )}
      {atlas && (
        <FullMap
          facts={{ here: standingOn, meId: me.playerId, myTeam: me.team, view: state.view, tiles: state.tiles }}
          onClose={() => setAtlas(false)}
        />
      )}

      <Walk
        me={{ playerId: me.playerId, team: me.team, look }}
        game={game}
        view={state.view}
        tiles={state.tiles}
        nowMs={Date.now()}
        onCross={(to) => {
          void act
            .moveTo(to)
            .then(() => setSaid(`${TILE_BY_ID[to].name} 쪽으로 간다.`))
            .catch((e) => setSaid((e as Error).message))
        }}
        onRoom={setStandingRoom}
        onTapRoom={(id) => setFar(id === standingRoom ? null : id)}
      />

      {phaseOpen ? (
        <Phase
          me={me}
          postTile={standingOn}
          seats={game.seats}
          view={state.view}
          chosen={chosen}
          onChosen={(k) => {
            setChosen(k)
            // 바로 다시 센다. 기다리면 내가 낸 것이 한참 뒤에야 숫자에 든다
            countReady()
          }}
          act={act}
          onSaid={setSaid}
        />
      ) : (
        <PhaseLog rows={state.phaseLog} seats={game.seats} />
      )}

      {host && <PhaseHost open={phaseOpen} no={phaseNo} ready={ready} act={act} onSaid={setSaid} />}

      <div className="sc-pl__quick">
        <button onClick={() => setOverlay('talk')}>말</button>
        <button onClick={() => setOverlay('archive')}>보관함</button>
        <button onClick={() => setMiniOn(!miniOn)}>{miniOn ? '미니맵 끄기' : '미니맵 켜기'}</button>
      </div>

      {/* 자유 시간의 것들. 페이즈 중에는 자리를 지키는 것 말고 할 일이 없다 */}
      {!phaseOpen && far && far !== standingRoom && (
        <Actions tileId={far} where="there" act={act} onSaid={setSaid} onClose={() => setFar(null)} />
      )}

      {!phaseOpen && standingRoom && (
        <Actions tileId={standingRoom} where="here" act={act} onSaid={setSaid}>
          <Standing standingOn={standingOn} act={act} onSaid={setSaid} />
        </Actions>
      )}

      {!phaseOpen && (
        <>
      <People
        me={me}
        seats={game.seats}
        day={game.day}
        hereIds={hereIds}
        hereName={standingOn ? TILE_BY_ID[standingOn].name : null}
        invisibleId={game.invisibleId}
        chosenId={state.view?.myChoice?.chosenId ?? null}
        day4={state.view?.myChoice?.day4 ?? null}
        act={act}
        onSaid={setSaid}
      />

        <Deals me={me} view={state.view} teams={state.teams} facingTeams={facingTeams} act={act} onSaid={setSaid} />
        </>
      )}

      {overlay === 'talk' && (
        <div className="sc-pl__sheet">
          <button className="sc-pl__sheetClose" onClick={() => setOverlay(null)}>닫기</button>
          <Chat
            me={me}
            hereName={standingOn ? TILE_BY_ID[standingOn].name : null}
            act={act}
            onSaid={setSaid}
          />
        </div>
      )}

      {said && <p className="sc-pl__said">{said}</p>}
    </div>
  )
}

// ── 묶기 ────────────────────────────────────────────────────────

export function Play() {
  const [ready, setReady] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  // 계정을 아직 못 읽었으면 undefined. 없으면 null
  const [me, setMe] = useState<{ nickname: string; avatar: AvatarLook | null } | null | undefined>(undefined)
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

  const loadMe = useCallback(() => {
    setMe(undefined)
    void myAccount().then(setMe).catch(() => setMe(null))
  }, [])

  useEffect(() => {
    if (signedIn) loadMe()
    else setMe(null)
  }, [signedIn, loadMe])

  if (!firebaseConfigured) return <p className="sc-pl__wait">firebase 설정이 없다.</p>
  if (!ready) return null
  if (!signedIn) return <Gate onIn={() => setSignedIn(true)} />
  if (me === undefined) return <p className="sc-pl__wait">불러오는 중</p>

  // 가입 다음은 나를 만드는 자리다. 이름이 없으면 아직 안 만든 것이다
  if (!me || !me.nickname) {
    return <Setup first={me ?? { nickname: '', avatar: null }} onDone={loadMe} />
  }

  const phase = state.game?.phase
  if (phase === 'running' || phase === 'finished') return <Running gameId={GAME_ID} look={me.avatar} />
  return <Lobby gameId={GAME_ID} me={me} />
}
