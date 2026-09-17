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
import type { TeamId } from '../types'
import type { AvatarLook } from '../../../shared/look'
import { gameActions, useGame } from './useGame'
import { LiveArchive, LiveEnding, LiveMorning, LiveRetro } from '../reveal/live'
import { Actions, Shop } from './Actions'
import { Walk, type DirWay } from './Walk'
import { FullMap, MiniMap, useMiniMapOn } from './Atlas'
import { Phase, PhaseLog, leftText } from './Phase'
import { Slips } from './Slips'
import { Quiz } from './Quiz'
import { Ballot } from './Ballot'
import { AddToHome, OfflineBar, SignOut, TurnNotice, Waiting, useGameNow, useOnline, useStaticCache, useWakeUp } from './Shell'
import { Sheet, useAsk } from './Sheet'
import { setSnowOff, snowIsOff } from '../reveal/Snow'
import { Chat } from './Chat'
import { Hand } from './Hand'
import { DealAsk } from './DealAsk'
import { TRANSFER_NO, whyNotTransfer } from '../../../shared/rules/transfer'
import { TransferAsk } from './TransferAsk'
import { DealRoom } from './DealRoom'
import { useDeal } from './useDeal'
import { useTransfer } from './useTransfer'
import { pushLive, useLive } from './useLive'
import { ActionGrid, Pad, ResourceRow, TabBar, Toast, buzzOn, setBuzz, useToast, padFace, type Act } from './Controls'
import { TEAM_COLOR } from './MapPlan'
import { uiIcon } from './uiArt'
import type { Dir } from '../map/sprites'
import './controls.css'
import { People } from './People'
import { TOTAL_SEATS } from '../../../shared/rules/lobby'
import { ADJACENCY, TILE_BY_ID, cellsTouch, type TileId } from '../../../shared/rules/board'
import { SHOP_TILE } from '../../../shared/rules/shop'
import type { GamePhase } from '../../../shared/model'
import { ENTER_COST, MOVE_MINUTES } from '../../../shared/rules/occupy'
import { ACTION_TOKEN_COST } from '../../../shared/rules/actions'
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

  /*
   * 고르는 것과 정하는 것을 위아래로 가른다.
   *
   * 고를 것이 여덟 줄이라 한 덩어리로 두면 「이걸로 하기」가 화면 밖에
   * 있다. 게다가 앱 바깥은 구르지 않게 막아 두어서(캔버스를 끌 때
   * 화면이 늘어나면 안 되니까) 내려서 찾을 수도 없었다 — **만들 방법이
   * 아예 없는 화면이었다.**
   */
  return (
    <div className="sc-pl__setup">
      <div className="sc-pl__setupBody">
        <h1>나</h1>
        <input
          placeholder="이름 (1~12자)"
          value={nickname}
          maxLength={12}
          onChange={(e) => setNickname(e.target.value)}
        />
        <CharacterCreator look={look} team={null} onChange={setLook} />
        {error && <p className="sc-pl__error">{error}</p>}
        {/* 엉뚱한 계정으로 들어왔으면 여기서 되돌아갈 수 있어야 한다.
            아직 나를 만들지도 않은 자리라 물을 것이 없다 */}
        <SignOut />
      </div>
      <div className="sc-pl__setupFoot">
        <button className="sc-pl__go" disabled={busy || nickname.trim().length === 0} onClick={() => void go()}>
          이걸로 하기
        </button>
      </div>
    </div>
  )
}

// ── 로비 ────────────────────────────────────────────────────────

function Lobby({ gameId, me }: { gameId: string; me: { nickname: string; avatar: AvatarLook | null } }) {
  const state = useGame(gameId)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [room, setRoom] = useState<TileId | null>(null)
  const [roster, setRoster] = useState(false)
  /** 시작 전 설정·로그아웃. 판이 돌 때의 「더보기」와 같은 자리다 */
  const [before, setBefore] = useState(false)
  const padRef = useRef<HTMLDivElement | null>(null)
  const uid = auth?.currentUser?.uid ?? null
  const seats = state.game?.seats ?? []
  const mine = seats.find((s) => s.playerId === uid)

  /**
   * 시작 전에도 서로가 보인다.
   *
   * **안개가 없으니 가릴 것도 없다.** 말이 아직 없어서 서버가
   * 「누가 보이는가」를 정해 줄 것이 없고, 명단에 앉은 사람이 곧
   * 보이는 사람이다. 열넷이 차기를 기다리는 동안 같은 교실에 둘이
   * 서 있어도 각자 빈 학교를 걷고 있었다 — 기다리는 시간이 그대로
   * 죽는다.
   */
  const mates = useMemo(
    () => seats.filter((sx) => sx.playerId !== uid).map((sx) => ({ playerId: sx.playerId, team: sx.team })),
    [seats, uid],
  )
  const looks = useMemo(
    () => Object.fromEntries(seats.map((sx) => [sx.playerId, sx.look ?? null])),
    [seats],
  )
  const live = useLive(gameId, mates.map((m) => m.playerId))

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

  // 아직 명부에 없으면 문 앞이다. 들어가야 학교가 열린다
  if (!mine || !uid) {
    return (
      <div className="sc-pl__lobby">
        <h1>교실</h1>
        <p className="sc-pl__count">
          {seats.length} / {TOTAL_SEATS}
        </p>
        <button className="sc-pl__go" disabled={busy} onClick={() => void join()}>
          들어가기
        </button>
        <ul className="sc-pl__seated">
          {seats.map((s) => (
            <li key={s.playerId} className={s.playerId === uid ? 'is-me' : ''}>
              {s.name} <span>{s.team}</span>
            </li>
          ))}
        </ul>
        {error && <p className="sc-pl__error">{error}</p>}
        <SignOut note={`들어와 있는 계정 · ${me.nickname}`} />
      </div>
    )
  }

  /*
   * **시작 전에도 학교는 열려 있다.**
   *
   * 전에는 「진행자가 시작할 때까지 기다린다」 한 줄 앞에 앉아 있어야
   * 했다. 열넷이 다 모일 때까지 몇십 분이 걸리는데 그동안 할 것이
   * 아무것도 없으면, 처음 들어온 사람은 이 학교가 어떻게 생겼는지도
   * 모른 채 닷새를 시작한다.
   *
   * 다만 **여기서 일어나는 일은 아무것도 판에 남지 않는다.** 말은
   * 아직 없다 — 서버는 시작할 때 비로소 말을 세운다. 걸음도 판정에
   * 안 들어가고, 할 수 있는 일도 없다. 학교를 미리 걸어 보는 것뿐이다.
   *
   * 서로는 보인다. 안개가 없으니 가릴 것이 없고, 열넷이 차기를
   * 기다리는 동안 각자 빈 학교를 걷게 두면 그 시간이 그대로 죽는다.
   */
  // sc-pl 로 감싼다. 이 껍데기가 높이를 100% 로 잡아 주는 것이라,
  // 빼먹으면 방이 제 키만큼만 서고 아래가 허옇게 빈다
  return (
    <div className="sc-pl">
      <div className="sc-pl__today sc-pl__before">
        <section className="sc-pl__tab sc-pl__map">
          <div className="sc-pl__room">
            <Walk
              me={{ playerId: uid, team: mine.team, look: me.avatar }}
              view={null}
              tiles={{}}
              nowMs={Date.now()}
              padRef={padRef}
              /* 시작 전에는 view 가 없다. 명단이 그 자리를 대신한다 */
              roster={mates}
              looks={looks}
              live={live}
              onLive={(at) => pushLive(gameId, uid, at)}
              /* 서버에 묻지 않는다. 말이 아직 없어서 물어도 거절당한다 */
              onCross={() => Promise.resolve(true)}
              onRoom={setRoom}
              onTapRoom={() => {}}
              onTapPerson={() => {}}
              onStand={() => {}}
            />
            <header className="sc-pl__head">
              <span className="sc-pl__day">DAY 0</span>
              <span>{seats.length} / {TOTAL_SEATS} 모였다</span>
              <span className="sc-pl__me">{me.nickname} · {mine.team}팀</span>
            </header>
          </div>

          <p className="sc-pl__before-note">
            {room ? `${TILE_BY_ID[room].name} · ` : ''}
            아직 시작 전이다. 먼저 온 사람들과 걸어 다녀 볼 수는 있다.
          </p>

          {/* 시작 전에도 십자키는 같은 것을 쓴다. 판이 열린 뒤에 손가락이
              자리를 다시 외우게 할 까닭이 없다 */}
          <div className="sc-ct">
            <div className="sc-ct__ctl">
              <Pad padRef={padRef} dirs={{}} onBlocked={() => {}} />
              {/*
                **나가는 문이 「모인 사람」 뒤에 있으면 안 된다.**
                로그아웃을 명단 시트 맨 아래에 두었더니, 열넷을 다
                지나쳐 내려가야 나왔다 — 이름이 「모인 사람」이라
                거기 있을 것이라고 생각할 까닭도 없다. 판이 돌 때와
                같은 자리(더보기)에 둔다.
              */}
              <ActionGrid
                acts={[
                  { key: 'roster', icon: 'tabMe', label: '모인 사람', run: () => setRoster(true) },
                  { key: 'more', icon: 'more', label: '더보기', run: () => setBefore(true) },
                ]}
                onBlocked={() => {}}
              />
            </div>
          </div>
        </section>

        {roster && (
          <Sheet title="모인 사람" onClose={() => setRoster(false)}>
            <p className="sc-dl__none">
              {seats.length}명이 모였다. 열넷이 차면 진행자가 닷새를 시작한다.
            </p>
            <ul className="sc-pl__seated">
              {seats.map((s) => (
                <li key={s.playerId} className={s.playerId === uid ? 'is-me' : ''}>
                  {s.name} <span>{s.team}</span>
                </li>
              ))}
            </ul>
            {error && <p className="sc-pl__error">{error}</p>}
          </Sheet>
        )}

        {before && (
          <Sheet title="더보기" onClose={() => setBefore(false)}>
            {/* 시작 전에는 그냥 나간다. 아직 잃을 것이 없어서 묻지 않는다 */}
            <SignOut note={`들어와 있는 계정 · ${me.nickname}`} />
          </Sheet>
        )}
      </div>
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

  // **명단에 없으면 여기서 돌려보낸다.** 아래 아침 시퀀스보다 먼저다 —
  // 그러지 않으면 이 판과 아무 상관 없는 사람이 오늘 아침의 일기장을
  // 한 장씩 넘겨 본 뒤에야 자리가 없다는 말을 듣는다
  const myUid = auth?.currentUser?.uid ?? null
  if (myUid && !game.seats.some((s) => s.playerId === myUid)) {
    return <NoSeat phase={game.phase} />
  }

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
type Tab = 'map' | 'me' | 'note' | 'radio'

/** 컨트롤 바의 「더보기」에서 열리는 것들. */
type SheetId = 'act' | 'talk' | 'more' | 'hand' | 'shop' | 'team'

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
/**
 * 이 판에 자리가 없는 사람.
 *
 * **기다려도 오지 않는 것을 기다리게 두면 안 된다.** 여태 여기서
 * 「내 자리를 기다리고 있다」가 영영 돌았다 — 연결이 느린 것도,
 * 서버가 대답을 안 하는 것도 아닌데 그렇게 말하고 있었다. 시작한
 * 판의 명단은 더 바뀌지 않으므로 자리는 영영 안 생긴다.
 *
 * 무엇이 일어났는지 말하고, 할 수 있는 일을 준다.
 */
function NoSeat({ phase }: { phase: GamePhase }) {
  const over = phase === 'finished'
  return (
    <div className="sc-wait">
      <p className="sc-wait__what">{over ? '이 판은 끝났다.' : '이 판에 네 자리가 없다.'}</p>
      <p className="sc-wait__why">
        {over
          ? '끝난 판에는 들어갈 수 없다. 운영자가 새 판을 열어야 한다.'
          : '닷새가 이미 시작했다. 시작한 뒤에는 앉을 수 없다 — 처음 열넷이 끝까지 같은 열넷이어야 인연이 이어진다.'}
      </p>
      <p className="sc-wait__why">
        네 아이디로 앉은 판이 따로 있으면 그 아이디로 다시 들어와라.
      </p>
      <SignOut />
    </div>
  )
}

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
  /** 맵에서 짚은 사람. 거래는 여기서 시작한다. */
  const [person, setPerson] = useState<string | null>(null)
  const [archive, setArchive] = useState(false)
  const [atlas, setAtlas] = useState(false)
  const [miniOn, setMiniOn] = useMiniMapOn()
  const [snowOff, setSnowOffState] = useState(snowIsOff)
  const [buzzing, setBuzzing] = useState(buzzOn)
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

  /**
   * 지금 앉아 있는 거래판. **views 가 아니라 거래판 문서를 직접 본다** —
   * 상대가 물건을 올리는 것이 그 자리에서 보여야 흥정이다.
   */
  const { deal, dismiss: leaveDeal } = useDeal(gameId, uid)
  const { ask: moveAsk, dismiss: dropMoveAsk } = useTransfer(gameId, uid)
  /**
   * 그 사람이 **바로 옆 칸**에 서 있는가.
   *
   * 거래는 마주 보고 물건을 주고받는 것이다 — 같은 방이라는 것만으로는
   * 교실 반대편에서 소리치는 것과 구별이 안 된다. 서버도 같은 것을
   * 본다(cellsTouch). 화면은 미리 알려 줄 뿐이다.
   */
  const myAt = state.view?.visiblePawns.find((p) => p.playerId === uid)?.at ?? null
  const nextTo = person
    ? cellsTouch(myAt, state.view?.visiblePawns.find((p) => p.playerId === person)?.at ?? null)
    : false

  /** 짚은 사람의 팀. 안 보이면 null 이다. */
  const personTeam = (hereNow.find((p) => p.playerId === person)?.team ?? null) as TeamId | null


  /**
   * 거래창을 닫는다. **살아 있는 판은 접고, 끝난 판은 치우기만 한다** —
   * 끝난 판에 대고 또 접자고 하면 서버가 「그런 거래가 없다」로 답한다.
   */
  const closeDeal = useCallback(
    (d: { id: string; status: string }) => {
      if (d.status === 'asking' || d.status === 'open' || d.status === 'settling') {
        void act.cancelDeal(d.id).catch(() => {})
      }
      leaveDeal()
    },
    [act, leaveDeal],
  )
  const nameOf = useCallback(
    (id: string | null) => (id ? (game?.seats.find((s) => s.playerId === id)?.name ?? '누군가') : '누군가'),
    [game],
  )
  /**
   * 누가 어떻게 생겼는가. 명단에서 한 번 펴 두고 지도에 건넨다.
   *
   * 이름을 꺼내는 곳과 같은 자리다 — 「이 사람이 누구인가」는 이름과
   * 얼굴이 한 벌이고, 둘 다 명단에 있다.
   */
  const looks = useMemo(
    () => Object.fromEntries((game?.seats ?? []).map((sx) => [sx.playerId, sx.look ?? null])),
    [game],
  )
  /**
   * 보이는 사람들의 실시간 자리.
   *
   * **누구 것을 열지는 서버가 정한 목록 그대로다**(view.visibleIds).
   * 규칙도 같은 줄을 본다 — 화면이 남의 문서를 청해도 열리지 않는다.
   */
  const liveIds = state.view?.visibleIds ?? []
  const live = useLive(gameId, liveIds)

  const [toast, showToast] = useToast()
  /** 지금 선 칸에서 어느 쪽으로 갈 수 있는가. 지도가 한 칸 옮길 때마다 알려 준다 */
  const [ways, setWays] = useState<Record<Dir, DirWay>>({ up: 'open', down: 'open', left: 'open', right: 'open' })


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
  /** 무언가 하느라 묶인 시각. 그동안은 걸음도 다른 행동도 안 된다 */
  const busyUntilMs = state.view?.myBusyUntilMs ?? null
  const busyKind = state.view?.myBusyKind ?? null
  const busyLeftMs = busyUntilMs === null ? 0 : Math.max(0, busyUntilMs - nowMs)
  useEffect(() => {
    if (arriveAtMs == null && busyUntilMs == null) return
    const t = setInterval(() => void act.tick().catch(() => {}), 4000)
    return () => clearInterval(t)
  }, [arriveAtMs, busyUntilMs, act])

  const phaseNo = state.game?.phaseNow?.no ?? 0
  const phaseOpen = state.game?.phaseNow?.open === true

  /**
   * 이적을 못 꺼내는 까닭. **서버와 같은 함수를 부른다.**
   *
   * 남의 pawn 은 화면에 안 오므로 「이미 옮기기로 했다」와 「그 팀
   * 마지막 한 사람이다」 둘은 넣지 않는다 — 모르는 것을 지어내느니
   * 켜 둔 채로 서버가 거절하며 까닭을 말하게 둔다.
   */
  const moveNo =
    person && personTeam && me
      ? whyNotTransfer({
          day: game?.day ?? 0,
          phaseOpen,
          byId: me.playerId,
          byTeam: me.team,
          toId: person,
          toTeam: personTeam,
          bothStanding: standingOn !== null,
          nextTo,
          asking: moveAsk?.status === 'asking',
        })
      : 'walking'

  const phaseEndsAtMs = state.game?.phaseNow?.endsAtMs ?? null

  /**
   * 십자키 네 칸이 어떤 얼굴을 하는가.
   *
   * 벽은 어둡게 두고 누를 수도 없게 한다. **갈 수는 있는데 지금 못
   * 가는 쪽은 다르다** — 멀쩡하게 두고, 누르면 까닭을 한 줄로 말한다.
   * 페이즈 중에 토큰이 떨어졌을 때가 그렇다. 어둡게 해 버리면 벽과
   * 구별이 안 돼서 「이 방에 갇혔다」로 읽힌다.
   *
   * 값은 문·계단을 넘는 쪽에만 붙는다. 방 안에서 한 칸 옮기는 데는
   * 아무것도 들지 않는다.
   */
  const dirs = useMemo(
    () => padFace(ways, phaseOpen, state.view?.myTeamTokens ?? 0, ENTER_COST),
    [ways, phaseOpen, state.view?.myTeamTokens],
  )

  /**
   * 여섯 칸에 무엇을 놓는가.
   *
   * **이 방에서 되는 것이 앞 칸에 온다.** 상점에 서 있으면 「구매」가
   * 첫 칸이고, 아니면 그 칸을 다른 것이 쓴다. 여섯을 넘으면 나머지는
   * 더보기 시트로 간다 — 잘라 버리지 않는다.
   *
   * 못 하는 것도 칸에 남긴다. 사라지면 그런 것이 있는 줄도 모르고,
   * 흐린 채로 있으면 눌러서 까닭을 들을 수 있다.
   */
  const phaseTokens = state.view?.myTeamTokens ?? null
  const acts = useMemo<Act[]>(() => {
    const walking = standingOn === null
    /**
     * 못 하는 까닭.
     *
     * **화면이 규칙을 판단하지 않는다.** 여기서 보는 것은 서버가 이미
     * 보내 준 숫자뿐이다 — 페이즈 상자가 비었으면 무엇을 눌러도
     * 서버가 거절한다. 그 말을 미리 대신 해 줄 뿐이다.
     */
    const stop = busyLeftMs > 0
      ? `${busyKind ?? '하는'} 중이다 — ${leftText(busyLeftMs)} 남았다`
      : walking
        ? '걷는 중이다 — 멈춰야 한다'
        : phaseTokens === 0
          ? '팀 토큰이 없다'
          : undefined
    // 지금 이 방에서만 되는 것. 있으면 첫 칸을 가져간다
    const room: Act[] = []
    if (!phaseOpen && standingOn === SHOP_TILE) {
      room.push({ key: 'buy', icon: 'buy', label: '구매', run: () => setSheet('shop') })
    }
    /*
     * **생산과 공부는 페이즈에만 있다.**
     *
     * 자유 시간은 만나고 거래하고 이야기하는 시간이다. 거기에 값을
     * 치르는 일이 섞여 있으면 「자유」가 아니라 그냥 짧은 페이즈가
     * 된다 — 실제로 자유 시간마다 생산부터 누르고 흩어졌다.
     */
    const fixed: Act[] = phaseOpen
      ? [
          { key: 'post', icon: 'post', label: '자리 차지', cost: ENTER_COST, run: () => setSheet('act') },
          {
            key: 'make',
            icon: 'make',
            label: '생산',
            cost: ACTION_TOKEN_COST.produce,
            why: stop,
            run: () => void act.produce(standingOn as TileId).then((r) => say(String((r as { said?: string }).said ?? '생산했다.'))).catch((e) => refuse((e as Error).message)),
          },
          {
            key: 'study',
            icon: 'study',
            label: '공부',
            cost: ACTION_TOKEN_COST.study,
            why: stop,
            run: () => void act.study(standingOn as TileId).then((r) => say(String((r as { said?: string }).said ?? '공부했다.'))).catch((e) => refuse((e as Error).message)),
          },
          { key: 'hand', icon: 'hand', label: '손패', run: () => setSheet('hand') },
        ]
      : [
          // 자유 시간에 하는 일 — 만나서 이야기하고, 손패를 보고, 거래한다
          { key: 'talk', icon: 'talk', label: '말', run: () => setSheet('talk') },
          { key: 'hand', icon: 'hand', label: '손패', run: () => setSheet('hand') },
        ]
    const tail: Act[] = [
      { key: 'room', icon: 'room', label: '이 방', run: () => setSheet('act') },
      { key: 'atlas', icon: 'atlas', label: '전체 맵', run: () => setAtlas(true) },
    ]
    return [...room, ...fixed, ...tail]
  }, [phaseOpen, standingOn, phaseTokens, busyLeftMs, busyKind, act, say, refuse])

  /**
   * 여섯 칸에 다 안 들어가면 마지막 칸을 「더보기」가 쓴다.
   *
   * **잘라 버리지 않는다.** 넘친 것은 시트에 그대로 있고, 거기서도
   * 같은 그림과 같은 이름으로 나온다 — 자리만 옮긴 것이지 없어진
   * 것이 아니라는 게 보여야 한다.
   */
  const more: Act = { key: 'more', icon: 'more', label: '더보기', run: () => setSheet('more') }
  // 마지막 칸은 늘 더보기다. 설정과 보관함이 그 뒤에 있어서, 칸이
  // 남는 날에만 열리게 두면 어떤 날은 아예 못 연다
  const grid = [...acts.slice(0, 5), more]
  const spill = acts.slice(5)

  /**
   * 우리 팀 넷이 지금 켜 두고 있는가.
   *
   * **live 문서가 곧 접속 표시다.** 걷는 동안만 적히므로 가만히 선
   * 사람은 잠시 뒤 흐려지는데, 그 편이 「켜 두고 자리를 비웠다」와
   * 「같이 있다」를 가르는 데는 오히려 맞다.
   */
  const mates = useMemo(() => {
    const capIds = new Set(
      Object.values(state.teams)
        .map((t) => t?.captainId ?? null)
        .filter((x): x is string => typeof x === 'string'),
    )
    return (game?.seats ?? [])
      .filter((sx) => sx.team === me?.team)
      .map((sx) => ({
        playerId: sx.playerId,
        here: sx.playerId === me?.playerId || live.current.has(sx.playerId),
        captain: capIds.has(sx.playerId),
      }))
  }, [game, state.teams, me?.team, me?.playerId, live])

  if (!game) return <Waiting what="판" error={state.error} />
  // **기다려도 오지 않는다.** 명단에 없는 사람은 자리가 생길 일이
  // 없는데, 여태 「내 자리를 기다리고 있다」를 영영 띄우고 있었다
  if (!me) return <NoSeat phase={game.phase} />

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
            looks={looks}
            live={live}
            onLive={(at) => pushLive(gameId, me.playerId, at)}
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
            onDirs={setWays}
            onTapRoom={(id) => {
              if (id === standingRoom) {
                setFar(null)
                return
              }
              goFar(id)
            }}
            onTapPerson={setPerson}
            /* 멈춰 선 자리를 서버가 알아야 「바로 옆 칸」을 판정한다.
               거절은 흘려보낸다 — 걷다 멈춘 자리를 못 적었다고 화면에
               빨간 글씨가 뜰 일은 아니다 */
            onStand={(x, y) => { void act.standAt(x, y).catch(() => {}) }}
            /* 거래창이 열려 있는 동안에는 자리를 안 뜬다 */
            /* 거래 탁자에 앉아 있거나, 무언가 하느라 묶여 있으면 못 움직인다 */
            frozen={(deal !== null && deal.status !== 'done' && deal.status !== 'gone') || busyLeftMs > 0}
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

        <div className="sc-ct">
          <Toast text={toast} />
          {/* 자유 시간에는 토큰 칸이 아예 없다. 쓸 데가 없는 숫자다 */}
          <ResourceRow
            tokens={phaseOpen ? (state.view?.myTeamTokens ?? null) : null}
            tokenLabel="팀 토큰"
            money={state.view?.myVault?.money ?? null}
            knowledge={state.view?.myVault?.knowledge ?? null}
            mates={mates}
            teamColor={TEAM_COLOR[me.team]}
            onOpen={() => setSheet('team')}
          />
          <div className="sc-ct__ctl">
            {/* 한 번 누르면 한 칸. 길게 눌러도 이어 걷지 않는다 */}
            <Pad padRef={padRef} dirs={dirs} onBlocked={showToast} />
            <ActionGrid acts={grid} onBlocked={showToast} />
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
        {/* 합의해 둔 이적. **나만 본다** — 옛 팀에게도 새 팀에게도 안 간다 */}
        {state.view?.myMovingTo && (
          <p className="sc-pl__moving">
            다음 점령전부터 <b>{state.view.myMovingTo}팀</b>이다. {me.team}팀 금고와 손패는 두고 간다.
          </p>
        )}
        {invisibleName && <p className="sc-pl__invisible">오늘의 투명인간 · {invisibleName}</p>}

        <ul className="sc-pl__mine">
          {/* **토큰은 팀에 한 주머니다.** 넷이 나눠 쓴다 */}
          <li><span>팀 토큰</span><span>{state.view?.myTeamTokens ?? '—'}</span></li>
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

        <SignOut ask={ask} note={`들어와 있는 계정 · ${me.name}`} />
      </section>

      {/* ── 수첩 탭 ───────────────────────────────────────────
          지나간 것만 본다 */}
      {/* ── 무전 탭 ───────────────────────────────────────────
          방에 매이지 않는 유일한 말이다. 흩어져서도 팀이 팀으로
          움직이려면 떨어져서 말이 통해야 한다 */}
      <section className="sc-pl__tab sc-pl__radio" hidden={tab !== 'radio'}>
        <Chat me={me} hereName={null} act={act} onSaid={setSaid} channel="team" />
      </section>

      <section className="sc-pl__tab sc-pl__scroll" hidden={tab !== 'note'}>
        <header className="sc-pl__paneHead">
          <h2>수첩</h2>
          <span>지난 페이즈</span>
        </header>
        <PhaseLog rows={state.phaseLog} seats={game.seats} />
        <button className="sc-pl__wide" onClick={() => setArchive(true)}>보관함 열기</button>
      </section>

      {/* ── 탭바 ─────────────────────────────────────────────── */}
      <TabBar
        now={tab}
        onPick={(k) => setTab(k as Tab)}
        tabs={[
          { key: 'map', icon: 'tabMap', label: '맵' },
          { key: 'me', icon: 'tabMe', label: '나', dot: (state.view?.notices?.length ?? 0) > 0 },
          { key: 'radio', icon: 'tabRadio', label: '무전' },
          { key: 'note', icon: 'tabNote', label: '수첩' },
        ]}
      />

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
                /* 생산·공부는 페이즈로 갔다. 자유 시간에 이 방에서
                   할 것은 만나는 일뿐이다 */
                <Actions tileId={standingRoom} where="here" />
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

      {sheet === 'hand' && (
        <Sheet title="손패" onClose={closeSheet}>
          <Hand
            me={me}
            view={state.view}
            teams={state.teams}
            facingTeams={facingTeams}
            act={act}
            onSaid={setSaid}
            ask={ask}
          />
        </Sheet>
      )}

      {/* ── 맵에서 짚은 사람 ────────────────────────────────
          열세 명이 늘어선 목록은 없다. 눈앞에 선 사람 하나다 */}
      {person && (
        <Sheet title={nameOf(person)} onClose={() => setPerson(null)}>
          <div className="sc-pr">
            <p className="sc-pr__who">
              {hereNow.find((p) => p.playerId === person)?.team ?? '?'}팀 ·{' '}
              {nextTo ? '바로 옆 칸에 서 있다' : '같은 방에 있다'}
            </p>
            <button
              className="sc-pr__go"
              disabled={phaseOpen || deal !== null || !nextTo}
              onClick={() => {
                const who = person
                setPerson(null)
                act
                  .askDeal(who)
                  .then(() => say('거래하자고 했다. 열다섯 초 안에 답이 온다.'))
                  .catch((e) => refuse((e as Error).message))
              }}
            >
              거래하기
              <span>
                {phaseOpen
                  ? '페이즈 중에는 흥정하지 않는다'
                  : deal !== null
                    ? '이미 거래 중이다'
                    : !nextTo
                      ? '바로 옆 칸에 서야 한다 — 한 걸음 더 다가간다'
                      : `성립하면 개인 토큰 1개 · 오늘 ${state.view?.myDealTokens ?? 0}개 남았다`}
              </span>
            </button>

            {/* 우리 팀 사람에게는 꺼낼 말이 아니다. 아예 안 보인다 */}
            {personTeam !== null && personTeam !== me.team && (
              <button
                className="sc-pr__go sc-pr__go--move"
                disabled={moveNo !== null}
                onClick={() => {
                  const who = person
                  setPerson(null)
                  act
                    .askTransfer(who)
                    .then(() => say('우리 팀으로 오겠느냐고 물었다. 열다섯 초 안에 답이 온다.'))
                    .catch((e) => refuse((e as Error).message))
                }}
              >
                이적 제안하기
                <span>
                  {moveNo !== null
                    ? TRANSFER_NO[moveNo]
                    : `받아들이면 다음 점령전부터 ${me.team}팀이다`}
                </span>
              </button>
            )}
          </div>
        </Sheet>
      )}

      {/* ── 거래 ────────────────────────────────────────────
          청하는 동안은 띠 한 줄, 앉고 나면 창이 올라온다 */}
      {deal?.status === 'asking' && deal.askedBy !== me.playerId && (
        <DealAsk
          fromName={nameOf(deal.askedBy)}
          fromTeam={(deal.a.playerId === deal.askedBy ? deal.a.team : deal.b.team) as TeamId}
          askedAtMs={deal.askedAtMs}
          nowMs={nowMs}
          onAnswer={(accept) => {
            act.answerDeal(deal.id, accept).catch((e) => refuse((e as Error).message))
          }}
        />
      )}
      {/* ── 이적 ────────────────────────────────────────────
          불린 쪽에만 뜬다. 옛 팀은 발효될 때까지 아무것도 모른다 */}
      {moveAsk?.status === 'asking' && moveAsk.toId === me.playerId && (
        <TransferAsk
          fromName={nameOf(moveAsk.byId)}
          toTeam={moveAsk.byTeam}
          myTeam={me.team}
          askedAtMs={moveAsk.askedAtMs}
          nowMs={nowMs}
          onAnswer={(accept) => {
            dropMoveAsk()
            act
              .answerTransfer(moveAsk.id, accept)
              .then((r) => say(String((r as { said?: string }).said ?? '남기로 했다.')))
              .catch((e) => refuse((e as Error).message))
          }}
        />
      )}
      {moveAsk?.status === 'asking' && moveAsk.byId === me.playerId && (
        <p className="sc-da__wait">{nameOf(moveAsk.toId)}의 답을 기다린다.</p>
      )}

      {deal?.status === 'asking' && deal.askedBy === me.playerId && (
        <p className="sc-da__wait">
          {nameOf(deal.a.playerId === me.playerId ? deal.b.playerId : deal.a.playerId)}의 답을 기다린다.
        </p>
      )}
      {deal && deal.status !== 'asking' && (
        <Sheet title="거래" onClose={() => closeDeal(deal)}>
          <DealRoom
            me={me}
            deal={deal}
            view={state.view}
            otherName={nameOf(deal.a.playerId === me.playerId ? deal.b.playerId : deal.a.playerId)}
            nowMs={nowMs}
            act={act}
            onSaid={refuse}
            onClose={() => closeDeal(deal)}
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

      {/* 우리 팀 넷. **자원 줄을 누르면 여기가 열린다** — 작은 네모 넷만
          보고는 누가 누구인지 알 수 없다 */}
      {sheet === 'team' && (
        <Sheet title={`${me.team}팀`} onClose={closeSheet}>
          <ul className="sc-pl__team">
            {mates.map((m) => (
              <li key={m.playerId}>
                <i className="sc-pl__teamDot" style={{ background: m.here ? TEAM_COLOR[me.team] : 'transparent' }} />
                <span>{nameOf(m.playerId)}</span>
                {m.captain && <em>팀장</em>}
                <span className="sc-pl__teamState">{m.here ? '접속 중' : '자리 비움'}</span>
              </li>
            ))}
          </ul>
          <ul className="sc-pl__teamNums">
            {/* **페이즈 상자는 넷이 나눠 쓴다.** 내 것이 아니라는 게 여기서
                보여야 한다 — 먼저 쓰는 사람이 임자다 */}
            <li><span>페이즈 토큰(팀 공용)</span><span>{state.view?.myTeamTokens ?? '—'}</span></li>
            <li><span>내 돈</span><span>{state.view?.myVault?.money ?? '—'}</span></li>
            <li><span>내 지식</span><span>{state.view?.myVault?.knowledge ?? '—'}</span></li>
          </ul>
        </Sheet>
      )}

      {sheet === 'more' && (
        <Sheet title="더보기" onClose={closeSheet}>
          {/* 여섯 칸에서 밀려난 것들. 같은 그림, 같은 이름으로 나온다 */}
          {spill.length > 0 && (
            <div className="sc-pl__spill">
              {spill.map((a) => (
                <button
                  key={a.key}
                  className={a.why ? 'is-off' : undefined}
                  onClick={() => {
                    if (a.why) {
                      setSaid(a.why)
                      return
                    }
                    closeSheet()
                    a.run()
                  }}
                >
                  <img src={uiIcon(a.icon)} alt="" width={16} height={16} />
                  {a.label}
                  {a.cost !== undefined && <em>{a.cost}</em>}
                </button>
              ))}
            </div>
          )}
          <div className="sc-pl__more">
            <button onClick={() => setMiniOn(!miniOn)}>{miniOn ? '미니맵 끄기' : '미니맵 켜기'}</button>
            {/* 진동은 기기에만 남는다. 같은 계정이라도 다른 폰에서는 따로다 */}
            <button
              onClick={() => {
                const next = !buzzing
                setBuzz(next)
                setBuzzing(next)
              }}
            >
              {buzzing ? '진동 끄기' : '진동 켜기'}
            </button>
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
          {/*
            **나가는 문은 한 군데 더 있어야 한다.**
            여태 로그아웃은 「나」 탭 맨 아래에만 있었다. 맵을 보다가
            나가려면 탭을 옮기고 끝까지 내려야 나온다 — 설정이 여기
            있으니 나가는 것도 여기 있는 것이 맞다.
          */}
          <SignOut ask={ask} note={`들어와 있는 계정 · ${me.name}`} />
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
              <li><span>팀 토큰</span><span>{state.view?.myTeamTokens ?? '—'}</span></li>
              <li><span>마지막 응답</span><span>{said || '없다'}</span></li>
            </ul>
          </details>

        </Sheet>
      )}

      {/*
        **하는 동안은 그 자리다.**

        생산·공부·호출에는 시간이 든다. 그동안 걸음도 다른 행동도 막고,
        무엇을 얼마나 더 해야 하는지 화면 한가운데에 적어 둔다 — 안
        적으면 십자키가 고장 난 줄 안다.
      */}
      {busyLeftMs > 0 && (
        <div className="sc-pl__busy" role="status">
          <p className="sc-pl__busyWhat">{busyKind ?? '하는 중'}</p>
          <p className="sc-pl__busyLeft">{leftText(busyLeftMs)}</p>
          <p className="sc-pl__busyWhy">끝날 때까지 그 자리에 있는다.</p>
        </div>
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
