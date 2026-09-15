// v2 진입 화면.
//
// 로그인 → 자리에 앉기 → 닷새.
//
// 여기서 게임 규칙을 판단하지 않는다. 무엇을 할 수 있는지도 서버가
// 정하고, 화면은 서버가 거절하면 그 말을 그대로 보인다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'

import { auth, callServer, firebaseConfigured } from '../../firebase'
import { logIn, myAccount, saveAccountCharacter, signUp } from '../accounts'
import { CharacterCreator } from '../components/CharacterCreator'
import { randomLook } from '../char/look'
import type { AvatarLook, TeamId } from '../types'
import { gameActions, useGame } from './useGame'
import { LiveArchive, LiveEnding, LiveMorning, LiveRetro } from '../reveal/live'
import { Actions, QuickActions, Shop, Standing } from './Actions'
import { Walk } from './Walk'
import { FullMap, MiniMap, useMiniMapOn } from './Atlas'
import { Phase, PhaseLog } from './Phase'
import { Slips } from './Slips'
import { Quiz } from './Quiz'
import { Ballot } from './Ballot'
import { AddToHome, OfflineBar, TurnNotice, Waiting, useGameNow, useOnline, useStaticCache, useWakeUp } from './Shell'
import { Sheet, useAsk } from './Sheet'
import { setSnowOff, snowIsOff } from '../reveal/Snow'
import { Chat } from './Chat'
import { Deals } from './Deals'
import { People } from './People'
import { TOTAL_SEATS } from '../../../shared/rules/lobby'
import { ADJACENCY, TILE_BY_ID, type TileId } from '../../../shared/rules/board'
import { SHOP_TILE } from '../../../shared/rules/shop'
import { MOVE_MINUTES } from '../../../shared/rules/occupy'
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
      {/*
        관리자 입구.
        **여기서 코드를 묻지 않는다.** 처음에는 이 화면에서 로그인까지
        같이 하게 했는데, 코드를 틀리면 로그인만 먹고 그대로 게임
        화면으로 넘어갔다 — 로그인이 성공한 순간 이 화면이 사라져서
        「코드가 틀렸다」를 띄울 자리가 없어진다. 들어가는 문은 한
        군데(admin.html)로 두고 여기서는 데려다 주기만 한다
      */}
      <a className="sc-pl__hostlink" href={`${import.meta.env.BASE_URL}admin.html${location.search}`}>
        관리자로 들어가기
      </a>
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

// ── 로비 ────────────────────────────────────────────────────────

function Lobby({ gameId, me }: { gameId: string; me: { nickname: string } }) {
  const state = useGame(gameId)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
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

  if (state.loading || state.error) return <Waiting what="판" error={state.error} />
  if (!state.game) {
    return (
      <div className="sc-pl__lobby">
        <h1>남겨진 아이들</h1>
        <p className="sc-pl__none">아직 열린 판이 없다. 운영자가 만들어야 한다.</p>
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
  // **거절을 삼키지 않는다.** 여태 여기서 그냥 「불러오는 중」이었다
  if (!game) return <Waiting what="판" error={state.error} />

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

/** 아래 탭바의 세 칸. 화면은 세 장뿐이고, 나머지는 전부 시트다. */
type Tab = 'map' | 'me' | 'note'

/** 컨트롤 바의 「더보기」에서 열리는 것들. */
type SheetId = 'act' | 'talk' | 'more' | 'deal' | 'shop'

/**
 * 오늘 하루. **맵이 화면이다.**
 *
 * 세로로 네 층이다 — 방 화면(남는 공간 전부) · 자원 줄 44 · 컨트롤 바
 * 104 · 탭바 56. 높이를 %로 나누면 주소창이 줄었다 늘었다 할 때마다
 * 탭바가 화면 밖으로 밀려 나간다. flex 로 나누고 dvh 로 잰다.
 *
 * 탭은 세 장이지만 **만나야 하는 일은 여전히 맵에서만 일어난다.**
 * 「나」는 내 것만 보고, 「수첩」은 지나간 것만 본다 — 거기서 학교
 * 반대편 사람에게 말을 걸 수는 없다.
 *
 * 무엇을 할 수 있는지는 여전히 화면이 판단하지 않는다. 안 되는 것은
 * 서버가 거절하고 그 이유를 말해 준다.
 */
function Today({ gameId, look }: { gameId: string; look: AvatarLook | null }) {
  const state = useGame(gameId)
  const act = useMemo(() => gameActions(gameId), [gameId])
  const online = useOnline()
  // **앱이 돌아오면 서버에 다시 묻는다.** 화면을 껐다 켜는 사이에
  // 페이즈가 열렸을 수도 닫혔을 수도 있다 — 옛 화면에 대고 단추를
  // 누르게 두면 안 된다
  useWakeUp(useCallback(() => { void act.tick() }, [act]))
  const uid = auth?.currentUser?.uid ?? null
  const [standingRoom, setStandingRoom] = useState<TileId | null>(null)
  /** 맵에서 누른 먼 방. 거기로 걸어가거나 내일 아침을 예약한다. */
  const [far, setFar] = useState<TileId | null>(null)
  const [said, setSaid] = useState('')
  /** 서버가 거절한 말인가. 거절은 눌러서 지울 때까지 남는다. */
  const [bad, setBad] = useState(false)
  const say = useCallback((text: string) => { setBad(false); setSaid(text) }, [])
  const refuse = useCallback((text: string) => { setBad(true); setSaid(text) }, [])
  const [tab, setTab] = useState<Tab>('map')
  const [sheet, setSheet] = useState<SheetId | null>(null)
  const [archive, setArchive] = useState(false)
  const [atlas, setAtlas] = useState(false)
  const [miniOn, setMiniOn] = useMiniMapOn()
  const [snowOff, setSnowOffState] = useState(snowIsOff)
  // 십자키는 컨트롤 바에 있고 그림은 위에 있다. 자리만 건네준다
  const padRef = useRef<HTMLDivElement | null>(null)
  const [asking, ask] = useAsk()
  // 글을 쓰는 동안에는 탭바를 감춘다. 키보드 위에 얹혀 있으면
  // 입력창이 그만큼 가려진다
  const typing = useTyping()

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
  /** 오늘 지워진 사람. 나라면 화면이 반투명해진다 */
  const iAmInvisible = game?.invisibleId === uid
  // 마주 선 팀. 교역도 동맹도 사람이 꺼내는 말이라 그 팀 사람이 앞에 있어야 한다
  const facingTeams = [...new Set(hereNow.map((p) => p.team))].filter((t) => t !== me?.team)

  // 서버가 한 말을 잠깐 띄운다. 그대로 두면 쌓여서 화면을 가린다.
  //
  // **거절은 안 지운다.** 3.2초는 걷다가 놓치기 딱 좋은 시간이고,
  // 놓치면 「아무 일도 안 일어났다」와 구별이 안 된다 — 문에 대고
  // 걸었는데 왜 안 가는지 모르는 채로 남는다. 누르면 지워진다
  useEffect(() => {
    if (!said || bad) return
    const t = setTimeout(() => setSaid(''), 3200)
    return () => clearTimeout(t)
  }, [said, bad])

  // **판마다 시계가 따로 돈다.** 서버와 같은 함수로 잰다
  const nowMs = useGameNow(state.game?.clock)

  // 걷는 동안에는 서버를 두드려 준다. 도착은 따라잡기가 처리하는데,
  // 아무도 부르지 않으면 영영 안 돈다 — 문을 넘어 놓고 「이동 중」에
  // 갇혀서, 밖에서 보기에는 방에서 방으로 못 건너가는 것과 같다
  const arriveAtMs = state.view?.myArriveAtMs ?? null
  useEffect(() => {
    if (arriveAtMs == null) return
    const t = setInterval(() => void act.tick().catch(() => {}), 4000)
    return () => clearInterval(t)
  }, [arriveAtMs, act])

  const phaseNo = state.game?.phaseNow?.no ?? 0
  const phaseOpen = state.game?.phaseNow?.open === true
  const phaseEndsAtMs = state.game?.phaseNow?.endsAtMs ?? null

  if (!game || !me) return <Waiting what={game ? '내 자리' : '판'} error={state.error} />

  if (archive) return <LiveArchive gameId={gameId} onClose={() => setArchive(false)} />

  const closeSheet = () => setSheet(null)

  /**
   * 먼 방을 골랐다. **보여 주기만 한다** — 누가 차지했는지와 정원.
   *
   * 거기로 보내 주는 단추는 없다. 자유 시간에는 맵에서 걸어가면
   * 공짜로 바로 가고, 페이즈에는 문을 넘을 때 값을 치른다 —
   * 어느 쪽이든 발로 간다.
   */
  const goFar = (id: TileId) => {
    setFar(id)
    setAtlas(false)
    setTab('map')
    setSheet('act')
  }

  return (
    <div
      className={
        'sc-pl__today' +
        (miniOn ? ' has-mini' : '') +
        (iAmInvisible ? ' is-invisible' : '') +
        (online ? '' : ' is-offline') +
        (typing ? ' is-typing' : '')
      }
    >
      <TurnNotice />
      {/* 한 번만 권한다. 주소창이 있으면 방 화면이 그만큼 작다 */}
      <AddToHome />
      {/* 끊긴 동안 누른 행동이 나중에 한꺼번에 나가면 안 된다.
          띠를 띄우고 행동 단추는 CSS 로 잠근다 */}
      {!online && <OfflineBar />}

      {/* ── 맵 탭 ─────────────────────────────────────────────
          숨길 때도 떼지 않는다. 떼면 걷던 자리가 처음으로 돌아간다 */}
      <section className="sc-pl__tab sc-pl__map" hidden={tab !== 'map'}>
        <div className="sc-pl__room">
          <Walk
            me={{ playerId: me.playerId, team: me.team, look }}
            view={state.view}
            tiles={state.tiles}
            nowMs={nowMs}
            padRef={padRef}
            /* 종이 치면 서버가 전선으로 옮겨 세운다. 화면도 그때 따라간다 */
            placeAtMs={phaseOpen ? (state.game?.phaseNow?.openedAtMs ?? null) : null}
            onCross={(to) => {
              // 자유 시간의 방 이동에는 시간이 들지 않는다. 문을 지나면
              // 바로 옆방이다 — 마주치라고 있는 시간이라 걸음에 쓰면
              // 아무도 안 움직인다. 값은 페이즈가 열릴 때 한 번 치른다
              // 페이즈 중에는 들어가는 데 토큰이 들고 10분이 걸린다.
              // 자유 시간에는 공짜고 즉시다
              const go = phaseOpen ? act.phaseAct('move', { targetTile: to }) : act.roamTo(to)
              // **됐는지 안 됐는지를 돌려준다.** 안 돌려주면 화면이 대답을
              // 기다리는 채로 굳어서, 한 번 거절당한 뒤로는 어느 문도
              // 못 넘는다 — 실제로 그렇게 막혔다
              return go
                .then((r) => {
                  const left = (r as { tokens?: number }).tokens
                  say(
                    phaseOpen
                      ? `${TILE_BY_ID[to].name}(으)로 간다. ${MOVE_MINUTES}분 · 토큰 ${left ?? '?'}개 남았다.`
                      : `${TILE_BY_ID[to].name}(으)로 들어갔다.`,
                  )
                  return true
                })
                .catch((e) => {
                  refuse((e as Error).message)
                  return false
                })
            }}
            onRoom={setStandingRoom}
            onTapRoom={(id) => {
              if (id === standingRoom) {
                setFar(null)
                return
              }
              goFar(id)
            }}
          />

          {/* 방 위에 얹는 것들. 줄을 따로 내주면 방이 그만큼 작아진다.
              **타이머는 시트가 올라와도 보여야 해서 여기 둔다** —
              시트는 화면의 70%까지만 올라온다 */}
          <header className="sc-pl__head">
            <span className="sc-pl__day">DAY {game.day}</span>
            <PhaseClock
              open={phaseOpen}
              no={phaseNo}
              endsAtMs={phaseEndsAtMs}
              nowMs={nowMs}
              post={(state.view?.myPost ?? null) as TileId | null}
              standing={standingOn}
            />
            <span className="sc-pl__me">{me.name} · {me.team}팀</span>
          </header>
          {/* 본인에게만 옅은 표시. 남에게는 위치 자체가 안 간다 */}
          {iAmInvisible && <p className="sc-pl__ghost">오늘 당신은 보이지 않습니다.</p>}
          {miniOn && (
            <MiniMap
              facts={{ here: standingOn, meId: me.playerId, myTeam: me.team, view: state.view, tiles: state.tiles }}
              onOpen={() => setAtlas(true)}
            />
          )}
        </div>

        <ul className="sc-pl__stat">
          <li><span>토큰</span><span>{state.view?.myTokens ?? '—'}</span></li>
          <li><span>돈</span><span>{state.view?.myVault?.money ?? '—'}</span></li>
          <li><span>지식</span><span>{state.view?.myVault?.knowledge ?? '—'}</span></li>
        </ul>

        {/* **할 수 있는 일은 눌러 보기 전에 보인다.** 전에는 전부
            「행동」 뒤에 있어서, 처음 들어온 사람은 거래라는 것이
            있는 줄도 몰랐다 */}
        <QuickActions
          standingOn={standingOn}
          standingRoom={standingRoom}
          phaseOpen={phaseOpen}
          far={far}
          act={act}
          onSaid={setSaid}
          onSheet={setSheet}
        />

        <div className="sc-pl__ctl">
          {/* 한 번 누르면 한 칸. 길게 눌러도 이어 걷지 않는다 */}
          <div className="sc-pl__pad" ref={padRef}>
            <button data-dir="up" aria-label="위">↑</button>
            <button data-dir="left" aria-label="왼쪽">←</button>
            <button data-dir="down" aria-label="아래">↓</button>
            <button data-dir="right" aria-label="오른쪽">→</button>
          </div>
          <div className="sc-pl__acts">
            <button onClick={() => setSheet('act')}>{phaseOpen ? '자리' : '이 방'}</button>
            <button onClick={() => setAtlas(true)}>전체 맵</button>
            <button onClick={() => setSheet('talk')}>말</button>
            <button onClick={() => setSheet('more')}>더보기</button>
          </div>
        </div>
      </section>

      {/* ── 나 탭 ─────────────────────────────────────────────
          내 것만 본다. 여기서 남에게 말을 걸 수는 없다 */}
      <section className="sc-pl__tab sc-pl__scroll" hidden={tab !== 'me'}>
        <header className="sc-pl__paneHead">
          <h2>{me.name}</h2>
          <span>{me.team}팀 · DAY {game.day}</span>
        </header>
        {invisibleName && <p className="sc-pl__invisible">오늘의 투명인간 · {invisibleName}</p>}

        <ul className="sc-pl__mine">
          <li><span>토큰</span><span>{state.view?.myTokens ?? '—'}</span></li>
          <li><span>돈</span><span>{state.view?.myVault?.money ?? '—'}</span></li>
          <li><span>지식</span><span>{state.view?.myVault?.knowledge ?? '—'}</span></li>
          <li><span>든 짝</span><span>{state.view?.myCarriedRobots ?? '—'}</span></li>
          <li><span>우리 짝</span><span>{state.view?.myTeamRobots ?? '—'}</span></li>
          <li><span>이번 페이즈 부순 수</span><span>{state.view?.mySmashes ?? '—'}</span></li>
        </ul>

        {/* 문제 종이는 페이즈 중에도 푼다. 토큰이 안 들어서, 토큰이
            떨어진 사람이 한 시간 동안 할 수 있는 유일한 일이기도 하다 */}
        <Quiz view={state.view} act={act} onSaid={setSaid} />

        {/* 쪽지. 페이즈 중에는 점령전 말고 할 일이 없다 */}
        {!phaseOpen && uid && (
          <Slips
            view={state.view}
            seats={game.seats}
            hereIds={hereIds}
            meId={uid}
            act={act}
            onSaid={setSaid}
            ask={ask}
          />
        )}

        {/* 오늘의 투명인간. 만나지 않고 하는 투표라 어디서든 열린다 */}
        {!phaseOpen && (
          <Ballot
            me={me}
            seats={game.seats}
            captainIds={Object.values(state.teams)
              .map((t) => t?.captainId ?? null)
              .filter((id): id is string => typeof id === 'string')}
            invisibleId={game.invisibleId ?? null}
            day={game.day}
            view={state.view}
            act={act}
            onSaid={setSaid}
            ask={ask}
          />
        )}

        {!phaseOpen && (
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
        )}
      </section>

      {/* ── 수첩 탭 ───────────────────────────────────────────
          지나간 것만 본다 */}
      <section className="sc-pl__tab sc-pl__scroll" hidden={tab !== 'note'}>
        <header className="sc-pl__paneHead">
          <h2>수첩</h2>
          <span>지난 페이즈</span>
        </header>
        <PhaseLog rows={state.phaseLog} seats={game.seats} />
        <button className="sc-pl__wide" onClick={() => setArchive(true)}>보관함 열기</button>
      </section>

      {/* ── 탭바 ─────────────────────────────────────────────── */}
      <nav className="sc-pl__tabbar">
        <button className={tab === 'map' ? 'is-on' : ''} onClick={() => setTab('map')}>맵</button>
        <button className={tab === 'me' ? 'is-on' : ''} onClick={() => setTab('me')}>나</button>
        <button className={tab === 'note' ? 'is-on' : ''} onClick={() => setTab('note')}>수첩</button>
      </nav>

      {/* ── 전체 맵 ───────────────────────────────────────────
          전체 화면 오버레이. 여기만 두 손가락 확대를 허용한다 */}
      {atlas && (
        <FullMap
          facts={{ here: standingOn, meId: me.playerId, myTeam: me.team, view: state.view, tiles: state.tiles }}
          clock={{ open: phaseOpen, no: phaseNo, endsAtMs: phaseEndsAtMs, nowMs }}
          snowLevel={state.game?.snow?.level ?? 5}
          onClose={() => setAtlas(false)}
        />
      )}

      {/* ── 시트 ─────────────────────────────────────────────── */}
      {/* 방 이름은 안쪽 머리글이 이미 말한다. 시트 머리에 또 쓰면
          같은 말이 두 줄 선다 */}
      {sheet === 'act' && (
        <Sheet
          title={
            phaseOpen
              ? '자리 차지하기'
              : far && far !== standingRoom
                ? `${TILE_BY_ID[far].name}(으)로`
                : '행동'
          }
          onClose={closeSheet}
        >
          {phaseOpen ? (
            <Phase
              me={me}
              here={standingOn}
              seats={game.seats}
              view={state.view}
              tiles={state.tiles}
              endsAtMs={phaseEndsAtMs}
              nowMs={nowMs}
              act={act}
              onSaid={setSaid}
              ask={ask}
            />
          ) : (
            <>
              {/* **고른 방이 먼저다.** 「저기로 가자」고 눌러서 열었는데
                  걸어가기가 선 자리 행동들 밑에 깔려 있으면, 시트를
                  굴려 내려가야 찾는다 */}
              {far && far !== standingRoom && (
                <Actions
                  tileId={far}
                  where="there"
                  owner={(state.tiles[far]?.ownerTeam ?? null) as TeamId | null}
                  onClose={() => setFar(null)}
                />
              )}
              {standingRoom ? (
                <Actions tileId={standingRoom} where="here">
                  <Standing standingOn={standingOn} act={act} onSaid={setSaid} />
                </Actions>
              ) : (
                <p className="sc-pl__none">복도에서는 할 것이 없다.</p>
              )}
            </>
          )}
        </Sheet>
      )}

      {sheet === 'talk' && (
        <Sheet title="말" onClose={closeSheet}>
          <Chat
            me={me}
            hereName={standingOn ? TILE_BY_ID[standingOn].name : null}
            act={act}
            onSaid={setSaid}
          />
        </Sheet>
      )}

      {sheet === 'deal' && (
        <Sheet title="거래" onClose={closeSheet}>
          <Deals
            me={me}
            view={state.view}
            teams={state.teams}
            facingTeams={facingTeams}
            herePeople={hereNow.map((p) => ({
              playerId: p.playerId,
              name: game.seats.find((s) => s.playerId === p.playerId)?.name ?? '누군가',
              team: p.team,
            }))}
            act={act}
            onSaid={setSaid}
            ask={ask}
          />
        </Sheet>
      )}

      {sheet === 'shop' && (
        <Sheet title="상점" onClose={closeSheet}>
          <Shop
            myTeam={me.team}
            owner={(state.tiles[SHOP_TILE]?.ownerTeam ?? null) as TeamId | null}
            money={state.view?.myVault?.money ?? 0}
            act={act}
            onSaid={setSaid}
          />
        </Sheet>
      )}

      {sheet === 'more' && (
        <Sheet title="더보기" onClose={closeSheet}>
          <div className="sc-pl__more">
            <button onClick={() => setMiniOn(!miniOn)}>{miniOn ? '미니맵 끄기' : '미니맵 켜기'}</button>
            <button
              onClick={() => {
                const next = !snowOff
                setSnowOff(next)
                setSnowOffState(next)
              }}
            >
              {snowOff ? '눈 켜기' : '눈 끄기'}
            </button>
            <button onClick={() => { closeSheet(); setArchive(true) }}>보관함</button>
          </div>
          {/* **한 장으로 상태를 다 보이게 한다.** 「안 움직여요」만으로는
              어디가 막혔는지 알 수 없어서, 판이 지금 어떤 상태인지를
              그대로 적어 둔다. 숨긴 값은 없다 — 전부 내 화면이 이미
              아는 것들이다 */}
          <details className="sc-pl__why">
            <summary>지금 상태</summary>
            <ul>
              <li><span>날짜</span><span>DAY {game.day}</span></li>
              <li><span>시간</span><span>{phaseOpen ? `${phaseNo}교시` : '자유 시간'}</span></li>
              <li><span>선 방</span><span>{standingOn ? TILE_BY_ID[standingOn].name : '걷는 중'}</span></li>
              <li><span>내 칸</span><span>{standingRoom ? TILE_BY_ID[standingRoom].name : '복도'}</span></li>
              <li>
                <span>옆방</span>
                <span>
                  {standingOn ? (ADJACENCY[standingOn] ?? []).map((n) => TILE_BY_ID[n].name).join(' · ') : '—'}
                </span>
              </li>
              <li><span>도착 대기</span><span>{arriveAtMs == null ? '없다' : `${Math.max(0, Math.ceil((arriveAtMs - nowMs) / 60000))}분`}</span></li>
              <li><span>토큰</span><span>{state.view?.myTokens ?? '—'}</span></li>
              <li><span>마지막 응답</span><span>{said || '없다'}</span></li>
            </ul>
          </details>

        </Sheet>
      )}

      {asking}
      {said && (
        <p
          className={bad ? 'sc-pl__said is-bad' : 'sc-pl__said'}
          onClick={() => setSaid('')}
        >
          {said}
        </p>
      )}
    </div>
  )
}

/**
 * 남은 시간. 게임 속 시계로 잰다. 1초에 한 번만 갱신한다 — 매 프레임
 * 다시 그리면 그것만으로 배터리가 눈에 띄게 준다.
 */
function PhaseClock({
  open,
  no,
  endsAtMs,
  nowMs,
  post,
  standing,
}: {
  open: boolean
  no: number
  endsAtMs: number | null
  /** 게임 속 지금. 실제 시각이 아니다 — 판마다 시계가 따로 돈다 */
  nowMs: number
  /** 종이 치면 돌아갈 자리. 지난 페이즈가 끝날 때 서 있던 방이다. */
  post: TileId | null
  /** 지금 서 있는 방. 거기가 곧 전선이면 굳이 안 알려 준다. */
  standing: TileId | null
}) {
  if (!open || endsAtMs == null) {
    // **어디까지 가도 된다는 것을 여기서 알려 준다.** 종이 치면
    // 서버가 전선으로 옮겨 세우니, 돌아올 길을 계산할 필요가 없다
    const back = post && post !== standing ? ` · 종이 치면 ${TILE_BY_ID[post].name}` : ''
    return <span className="sc-pl__clock">자유 시간{back}</span>
  }
  const left = Math.max(0, endsAtMs - nowMs)
  const mm = Math.floor(left / 60000)
  const ss = Math.floor((left % 60000) / 1000)
  return (
    <span className="sc-pl__clock is-on">
      {no}교시 {mm}:{String(ss).padStart(2, '0')}
    </span>
  )
}

/**
 * 지금 글을 쓰고 있는가. 키보드가 올라오면 화면이 그만큼 줄어드는데,
 * 거기에 탭바까지 얹혀 있으면 입력창이 가려진다.
 */
function useTyping(): boolean {
  const [typing, setTyping] = useState(false)
  useEffect(() => {
    const on = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null
      const tag = el?.tagName
      if (tag !== 'INPUT' && tag !== 'TEXTAREA') return
      setTyping(true)
      // **키보드가 입력창을 가리면 안 된다.** 뷰포트가 줄어드는 것은
      // 키보드가 다 올라온 뒤라, 바로 밀면 밀기 전 높이로 계산해서
      // 한 뼘 모자란다
      setTimeout(() => el?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 260)
    }
    const off = () => setTyping(false)
    window.addEventListener('focusin', on)
    window.addEventListener('focusout', off)
    return () => {
      window.removeEventListener('focusin', on)
      window.removeEventListener('focusout', off)
    }
  }, [])
  return typing
}

// ── 묶기 ────────────────────────────────────────────────────────

export function Play() {
  // 껍데기만 미리 쥔다. 지하철에서 앱을 다시 켜도 흰 화면이 안 뜬다
  useStaticCache()
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

  /** 계정을 못 읽은 까닭. 읽는 중이면 null. */
  const [meError, setMeError] = useState<string | null>(null)

  const loadMe = useCallback(() => {
    setMe(undefined)
    setMeError(null)
    // **영영 기다리지 않는다.** 서버에 못 닿으면 getDoc 은 대답도
    // 거절도 없이 계속 기다린다 — 화면은 「불러오는 중」에 굳는다
    let done = false
    const late = setTimeout(() => {
      if (!done) setMeError('서버가 대답하지 않는다.')
    }, 8000)
    void myAccount()
      .then((a) => {
        done = true
        clearTimeout(late)
        setMe(a)
      })
      .catch((e) => {
        done = true
        clearTimeout(late)
        // 계정이 없는 것과 못 읽은 것은 다르다. 없으면 만들러 가고,
        // 못 읽었으면 그 말을 보인다
        const why = (e as Error).message
        if (/없|not-found/i.test(why)) setMe(null)
        else setMeError(why)
      })
  }, [])

  useEffect(() => {
    if (signedIn) loadMe()
    else setMe(null)
  }, [signedIn, loadMe])

  if (!firebaseConfigured) return <p className="sc-pl__wait">firebase 설정이 없다.</p>
  if (!ready) return null
  if (!signedIn) return <Gate onIn={() => setSignedIn(true)} />
  if (meError !== null) return <Waiting what="내 계정" error={meError} onRetry={loadMe} />
  if (me === undefined) return <Waiting what="내 계정" error={null} onRetry={loadMe} />

  // 가입 다음은 나를 만드는 자리다. 이름이 없으면 아직 안 만든 것이다
  if (!me || !me.nickname) {
    return <Setup first={me ?? { nickname: '', avatar: null }} onDone={loadMe} />
  }

  const phase = state.game?.phase
  if (phase === 'running' || phase === 'finished') return <Running gameId={GAME_ID} look={me.avatar} />
  return <Lobby gameId={GAME_ID} me={me} />
}
