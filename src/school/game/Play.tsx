// v2 진입 화면.
//
// 로그인 → 자리에 앉기 → 닷새.
//
// 여기서 게임 규칙을 판단하지 않는다. 무엇을 할 수 있는지도 서버가
// 정하고, 화면은 서버가 거절하면 그 말을 그대로 보인다.
import { whileVisible } from './timing'
import { PING_MS } from '../../../shared/rules/online'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { onAuthStateChanged } from 'firebase/auth'

import { auth, callServer, firebaseConfigured } from '../../firebase'
import { markPrologueSeen, myAccount, saveAccountCharacter } from '../accounts'
import { AvatarFace, CharacterCreator } from '../components/CharacterCreator'
import { Gate } from './Gate'
import { randomLook } from '../char/look'
// 지도 쪽 TileId 는 스물다섯 방짜리 유니온이다. 규칙 쪽(string)과
// 이름이 같아서 여기서만 다른 이름으로 받는다
import type { TeamId, TileId as RoomId } from '../types'
import { TOTAL_DAYS, VOTE_LABEL, type VoteKind } from '../../../shared/rules/v2'

/** 마주친 사람에게 줄 수 있는 표. 투명인간 투표는 다른 화면이다. */
const MEET_VOTES: VoteKind[] = ['trust', 'liking']
import type { AvatarLook } from '../../../shared/look'
import { gameActions, useGame } from './useGame'
import { LiveArchive, LiveEnding, LiveMorning, LiveRetro } from '../reveal/live'
import { FinalNoteOverlay } from '../reveal/FinalNoteOverlay'
import { Actions } from './Actions'
import { Vending } from './Vending'
import { BoardSheet, ErrandStrip } from './Errand'
import { BOARDS } from '../../../shared/rules/errand'
import { POT_CELLS, type PotStage } from '../../../shared/rules/crop'
import { GardenSheet } from './Garden'

/** 단계마다 어느 그림인가. 이름은 map/thingArt 의 POT_ART 키다 */
const POT_ART_OF: Record<PotStage, string> = {
  empty: 'potEmpty',
  soil: 'potSoil',
  sprout: 'potSprout',
  leaf: 'potLeaf',
  fruit: 'potFruit',
}

/**
 * 그 칸 옆에 서 있는가. **둘레 한 칸까지다** — 서버도 같은 자로
 * 잰다(garden.ts 의 near). 여기서 재는 것은 헛누름을 줄이려는 것뿐이고,
 * 되는지 안 되는지는 서버가 정한다.
 */
const beside = (me: { x: number; y: number } | null, c: { x: number; y: number }): boolean =>
  me !== null && Math.abs(me.x - c.x) <= 1 && Math.abs(me.y - c.y) <= 1
import { Walk, type DirWay, type PersonAt, type TapThing } from './Walk'
import { Meet, type MeetRow } from './Meet'
import { MADE_NO } from '../../../shared/rules/made'
import { LAB_MACHINES, LAB_TILE } from '../../../shared/rules/trap'
import { FullMap, LiveMiniMap, useMiniMapOn } from './Atlas'
import { ScoreBar } from './Score'
import { Phase, leftText } from './Phase'
import { josa } from '../../../shared/text'
import { Slips } from './Slips'
import { TECH_TILE } from '../../../shared/rules/trap'
import { MakerSheet } from './Maker'
import { Ballot } from './Ballot'
import { AddToHome, OfflineBar, SignOut, TurnNotice, Waiting, useGameNow, useOnline, useStaticCache, useWakeUp } from './Shell'
import { correctedNow } from './skew'
import { Sheet } from './Sheet'

/**
 * 페이즈 중에 벌이 창구를 열었을 때 대신 뜨는 한 줄.
 *
 * **서버가 이미 거절한다**(turn.ts 의 mustBeFreeTime). 여기서 막는 것은
 * 규칙이 아니라 헛도는 버튼을 안 내밀기 위해서다 — 누르면 거절당하는
 * 버튼은 누를 수 있는 것처럼 생겼다는 것만으로 거짓말이다.
 */
function FreeTimeOnly({ what }: { what: string }) {
  return <p className="sc-pl__none">{what}{josa(what, '은/는')} 자유 시간에 한다. 지금은 페이즈 중이다.</p>
}
import { setSnowOff, snowIsOff } from '../reveal/Snow'
import { Say } from './Say'
import { bubbleText, bubbleUp, useChatLines } from './useChat'
import { useKeyboardInset } from './useKeyboardInset'
import { Radio } from './Radio'
import { Hand } from './Hand'
import { DealAsk } from './DealAsk'
import { LOCKED_DOOR, countOf } from '../../../shared/rules/items'
import { Arcade, ArcadeAsk } from './Arcade'
import { useArcade } from './useArcade'
import { ARCADE_COUNT, ARCADE_BY_ID, LIVE_ROOM, machineAtSeat } from '../../../shared/rules/arcade'
import { unlockChip } from './chip'
import { TRANSFER_NO, askExpired, whyNotTransfer } from '../../../shared/rules/transfer'
import { TransferAsk } from './TransferAsk'
import { DealRoom } from './DealRoom'
import { useDeal } from './useDeal'
import { useTransfer } from './useTransfer'
import { pushLive, useLive } from './useLive'
import {
  ActionGrid,
  Pad,
  ResourceRow,
  TabBar,
  Toast,
  buzzOn,
  padFace,
  plainOn,
  setBuzz,
  setPlain,
  useToast,
  type Act,
} from './Controls'
import { KIND_MARK, colorOfTeam } from './MapPlan'

/**
 * 배정 전에 말을 세워 둘 팀.
 *
 * 로비 화면은 사람마다 말 하나를 그리는데, 배정 전에는 팀이 없다.
 * 색이 없으면 말을 못 그려서 한 팀으로 세워 둔다 — 완장은
 * colorOfTeam 이 회색으로 그린다. **이 값이 화면에 뜻을 갖지는 않는다.**
 */
const PRE_TEAM: TeamId = 'A'
import { uiIcon } from './uiArt'
import type { Dir } from '../map/sprites'
import './controls.css'
import { Around } from './People'
import { Me, PastVerdicts } from './Me'
import { MissionMailbox, unseenMails } from './MissionPopup'
import { BoardMailbox } from './MissionBoard'
import { NoticePop, hasUnseenNotice } from './NoticePop'
import { NotifyBanner } from './notify/NotifyBanner'
import type { NotifyLink } from '../../../shared/notify/notifyData'
import { Dealt, dealtSeen, markDealtSeen } from './Dealt'
import { useMyPaper } from './useMyPaper'
import { logOut } from '../accounts'
import { Notes } from './Notes'
import { TOTAL_SEATS, seatName } from '../../../shared/rules/lobby'
import { ADJACENCY, ALLEY_NAME, START_TILE, TILE_BY_ID, cellsTouch, isAlleyCell, isHallCell, type TileId } from '../../../shared/rules/board'
import { atVending } from '../../../shared/rules/shop'
import type { GamePhase, SeatEntry } from '../../../shared/model'
import {
  ACT_MINUTES,
  ENTER_COST,
  MOVE_MINUTES,
  researchKnowledge,
  ROOM_KIND,
  capacityOf,
} from '../../../shared/rules/occupy'
import { armSfx, setSoundOn, soundIsOn } from './sfx'
import { Prologue, ReplayPrologue } from '../reveal/Prologue'

/* 규칙집은 게임 안에서 열지 않는다 — 감독관이 따로 링크로 나눠 준다 */
import './play.css'
import './ballot.css'
import './note.css'
import './me.css'
import './vending.css'

const GAME_ID = new URLSearchParams(location.search).get('game') ?? 'live'

// ── 소리 ────────────────────────────────────────────────────────

/** 소리 끄기 · 켜기. 기기에만 남는다 — 진동 · 연출 줄이기와 같다 */
function SoundToggle() {
  const [on, setOn] = useState(soundIsOn)
  return (
    <button
      type="button"
      onClick={() => {
        setSoundOn(!on)
        setOn(!on)
      }}
    >
      {on ? '소리 끄기' : '소리 켜기'}
    </button>
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
      setError('이름은 1~12 자다.')
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
   * 거울은 위, 서랍은 가운데, 정하는 단추는 아래에 붙박는다.
   *
   * 고를 것이 많아서 한 덩어리로 두면 「정한다」가 화면 밖에 있다.
   * 게다가 앱 바깥은 구르지 않게 막아 두어서(캔버스를 끌 때 화면이
   * 늘어나면 안 되니까) 내려서 찾을 수도 없었다 — **만들 방법이
   * 아예 없는 화면이었다.** 구르는 것은 서랍 안뿐이다.
   */
  return (
    <div className="sc-pl__setup">
      <CharacterCreator
        look={look}
        team={null}
        onChange={setLook}
        name={nickname}
        onName={setNickname}
        error={error}
        busy={busy}
        onDone={() => void go()}
        /* 엉뚱한 계정으로 들어왔으면 여기서 되돌아갈 수 있어야 한다.
           아직 나를 만들지도 않은 자리라 물을 것이 없다 */
        corner={<SignOut />}
      />
    </div>
  )
}

// ── 로비 ────────────────────────────────────────────────────────

/**
 * 자리 열넷.
 *
 * 이름만 늘어놓으면 **몇 자리 남았는지를 세어야 안다.** 빈 책상까지
 * 다 그려 놓으면 세지 않아도 보인다 — 교실에 들어서서 빈자리를 찾는
 * 것과 같은 일이다.
 *
 * 얼굴을 같이 보인다. 이름과 생김새는 한 벌이고 둘 다 원래 공개다.
 * 시작하고 나서 「어제 그 애」가 성립하려면, 여기서부터 얼굴이 눈에
 * 익어 있어야 한다.
 */
function Roll({ seats, uid }: { seats: SeatEntry[]; uid: string | null }) {
  const empty = Math.max(0, TOTAL_SEATS - seats.length)
  return (
    <ul className="sc-roll">
      {seats.map((s) => (
        <li
          key={s.playerId}
          className={`sc-roll__one${s.playerId === uid ? ' is-me' : ''}`}
          style={{ '--roll-team': colorOfTeam(s.team) } as CSSProperties}
        >
          <span className="sc-roll__face">
            {/* 계정에 캐릭터가 없으면 팀 색 점이다. 서버가 그렇게 보낸다 */}
            {s.look ? <AvatarFace look={s.look} team={s.team} scale={2} /> : <i className="sc-roll__dot" />}
          </span>
          <b>{s.name}</b>
          <em>{s.team ? teamNo(s.team) : ''}</em>
        </li>
      ))}
      {Array.from({ length: empty }, (_, i) => (
        <li key={`empty${i}`} className="sc-roll__one is-empty">
          <span className="sc-roll__face" />
          <b>빈자리</b>
        </li>
      ))}
    </ul>
  )
}

function Lobby({ gameId, me }: { gameId: string; me: { nickname: string; avatar: AvatarLook | null } }) {
  const state = useGame(gameId)
  const act = useMemo(() => gameActions(gameId), [gameId])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [roster, setRoster] = useState(false)
  /** 시작 전 설정·로그아웃. 판이 돌 때의 「더보기」와 같은 자리다 */
  const [before, setBefore] = useState(false)
  /** 시작 전에도 십자키는 벽을 안다. 나가는 쪽은 어둡다 */
  const [ways, setWays] = useState<Record<Dir, DirWay>>({ up: 'open', down: 'open', left: 'open', right: 'open' })
  const [toast, showToast] = useToast()
  const padRef = useRef<HTMLDivElement | null>(null)
  const uid = auth?.currentUser?.uid ?? null
  const seats = state.game?.seats ?? []
  const mine = seats.find((s) => s.playerId === uid)

  /*
   * 시작 전에도 말한다. **교실이 하나뿐인 동안의 교실 대화다.**
   *
   * 열넷이 차기를 기다리는 동안 한 교실에 같이 서 있는데 입을 막아
   * 두면 그 시간이 그대로 죽는다. 서버도 이때는 2-3 교실 한 칸으로
   * 본다(chat.ts 의 beforeStart).
   */
  const talk = useChatLines(act, 'room', { room: START_TILE })
  // 배정을 숨겨 둔 동안은 말줄의 분단 색도 지운다
  const dealHidden = !!state.game?.hideDeal
  const talkLines = useMemo(() => (dealHidden ? talk.lines.map((l) => ({ ...l, team: '' })) : talk.lines), [dealHidden, talk.lines])
  const typing = useTyping()
  useKeyboardInset()
  const blurNow = useCallback(() => {
    ;(document.activeElement as HTMLElement | null)?.blur()
  }, [])

  /*
   * 배정된 학생증.
   *
   * **운영자가 한 사람씩 정한다**(lobby.ts 의 hostAssignSeat). 내 자리에
   * 「정해진 시각」(dealtAtMs)이 찍히면 받아 온다 — 운영자가 고쳐 주면
   * 시각이 바뀌어 다시 받고 다시 띄운다.
   */
  const stamp = mine?.dealtAtMs ?? 0
  const card = useMyPaper(act, stamp > 0, stamp)
  /** 받아 온 학생증이 어느 배정의 것인가. 옛 배정의 카드를 새 것처럼 띄우지 않는다 */
  const [paperFor, setPaperFor] = useState(0)
  useEffect(() => {
    if (card.paper) setPaperFor(stamp)
    // 새 학생증이 도착한 그 순간의 배정 시각을 붙인다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.paper])
  const [shutFor, setShutFor] = useState(0)
  /** 「내 학생증」 단추로 다시 편 것 */
  const [showCard, setShowCard] = useState(false)
  // 배정마다 한 번만 띄운다. 새로고침마다 나오면 그건 공지가 아니다
  const sawCard = uid !== null && dealtSeen(gameId, uid, stamp)

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
    () => seats.filter((sx) => sx.playerId !== uid).map((sx) => ({ playerId: sx.playerId, team: sx.team ?? PRE_TEAM })),
    [seats, uid],
  )
  const looks = useMemo(
    () => Object.fromEntries(seats.map((sx) => [sx.playerId, sx.look ?? null])),
    [seats],
  )
  /* 발치에 다는 이름표. 열넷이 같은 교복을 입고 서 있다 */
  const names = useMemo(
    () => Object.fromEntries(seats.map((sx, i) => [sx.playerId, seatName(sx, i)])),
    [seats],
  )
  const live = useLive(gameId, mates.map((m) => m.playerId))

  /**
   * 시작 전 조작부.
   *
   * 판이 돌 때와 같은 여섯 칸을 같은 자리에 세우되, 게임 안의 일은
   * 전부 흐리다. **빈 조작부는 만들다 만 화면처럼 보이고**, 시작하고
   * 나서 손가락이 자리를 다시 외워야 한다.
   */
  const NOT_YET = '아직 시작 전이다.'
  /*
   * **시작 전 잠금.** 가입 · 아바타 · 프롤로그 뒤에는 아무것도 못 한다.
   * 감독관이 풀면(talk) 2-3 교실 안에서 걷고 말한다. 그 밖의 단추는
   * 판이 시작돼야 열린다.
   */
  const talkOpen = state.game?.lobbyStage === 'talk'
  // 풀린 뒤에도 단추는 판이 시작돼야 열린다 — 그때는 까닭이 다르다
  const WAIT = talkOpen ? '판이 시작되면 열린다.' : '감독관이 풀 때까지 기다린다.'
  const beforeDirs = useMemo(
    () =>
      talkOpen
        ? padFace(ways, false, 0, ENTER_COST)
        : { up: { open: false }, down: { open: false }, left: { open: false }, right: { open: false } },
    [ways, talkOpen],
  )
  const beforeGrid: Act[] = [
    // 배정받은 뒤에는 학생증을 다시 펼 수 있다. 판이 서면 「나」 탭에 늘 있다
    {
      key: 'card',
      icon: 'hand',
      label: '내 학생증',
      why: WAIT,
      run: () => setShowCard(true),
    },
    { key: 'atlas', icon: 'atlas', label: '전체 맵', why: NOT_YET, run: () => {} },
    // **판이 시작되기 전에는 아무것도 안 눌린다** — 감독관이 연다
    { key: 'roster', icon: 'tabMe', label: '모인 사람', why: WAIT, run: () => setRoster(true) },
    { key: 'more', icon: 'more', label: '더 보기', why: WAIT, run: () => setBefore(true) },
  ]

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

  /*
   * 문 앞도 게임 안이다.
   *
   * 여기만 밝은 회색 목록이면, 문(구겨진 투표용지)에서 여기로,
   * 여기서 학교로 넘어가는 동안 세계가 한 번 뒤집힌다. 색과 글꼴을
   * 판과 같은 것으로 쓴다 — 기다리는 자리도 판의 일부다.
   */
  const left = TOTAL_SEATS - seats.length

  if (state.loading || state.error) {
    return (
      <div className="sc-lb">
        <Waiting what="판" error={state.error} />
      </div>
    )
  }
  if (!state.game) {
    return (
      <div className="sc-lb">
        <header className="sc-lb__top">
          <span className="sc-lb__where">2 - 3 교실</span>
          {/* 판이 없어도 나갈 문은 있어야 한다. 전에는 여기 갇혔다 */}
          <SignOut />
        </header>
        <div className="sc-lb__body is-bare">
          <p className="sc-lb__none">
            아직 열린 판이 없다.
          </p>
        </div>
        <footer className="sc-lb__foot">
          <p className="sc-lb__who">들어와 있는 계정 · {me.nickname}</p>
        </footer>
      </div>
    )
  }

  // 아직 명부에 없으면 문 앞이다. 들어가야 학교가 열린다
  if (!mine || !uid) {
    return (
      <div className="sc-lb">
        <header className="sc-lb__top">
          <span className="sc-lb__where">2 - 3 교실</span>
          <SignOut />
        </header>

        <div className="sc-lb__body">
          <p className="sc-lb__count">
            <b>{seats.length}</b>
            <i>/</i>
            <span>{TOTAL_SEATS}</span>
          </p>
          <p className="sc-lb__note">
            {left > 0 ? `${left} 자리 남았다` : '자리가 다 찼다'}
          </p>
          <Roll seats={seats} uid={uid} />
        </div>

        <footer className="sc-lb__foot">
          {error && <p className="sc-lb__error">{error}</p>}
          <button className="sc-lb__go" disabled={busy || left <= 0} onClick={() => void join()}>
            들어가기
          </button>
          <p className="sc-lb__who">들어와 있는 계정 · {me.nickname}</p>
        </footer>
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
  /*
   * 배정이 끝났다. **학생증 한 장이 넘어온다.**
   *
   * 여기서 한 번 보고 나면 그 뒤로는 「나」 탭에 늘 있다. 팀은 어차피
   * 명단에 있어 모두가 아는 것이고, 역할과 숨긴 사실은 이 카드가
   * 처음이자 본인에게만 오는 자리다.
   */
  if (card.paper && paperFor === stamp && stamp > 0 && uid && (showCard || (shutFor !== stamp && !sawCard))) {
    return (
      <Dealt
        name={me.nickname}
        team={mine.team ?? PRE_TEAM}
        look={me.avatar}
        paper={card.paper}
        snowLevel={state.game?.snow?.level ?? 5}
        onClose={() => {
          markDealtSeen(gameId, uid, stamp)
          setShutFor(stamp)
          setShowCard(false)
        }}
      />
    )
  }

  // sc-pl 로 감싼다. 이 껍데기가 높이를 100% 로 잡아 주는 것이라,
  // 빼먹으면 방이 제 키만큼만 서고 아래가 허옇게 빈다
  return (
    <div className="sc-pl">
      <div className="sc-pl__today sc-pl__before">
        <section className="sc-pl__tab sc-pl__map">
          <div className="sc-pl__room">
            <Walk
              me={{ playerId: uid, team: mine.team ?? PRE_TEAM, look: me.avatar }}
              view={null}
              tiles={{}}
              nowMs={Date.now()}
              padRef={padRef}
              /* 시작 전에는 view 가 없다. 명단이 그 자리를 대신한다 */
              roster={mates}
              /* 열넷이 한 칸에 겹치지 않게 자리 순서대로 선다 */
              slot={seats.findIndex((sx) => sx.playerId === uid)}
              looks={looks}
              names={names}
              live={live}
              onLive={(at) => pushLive(gameId, uid, at)}
              /* 서버에 묻지 않는다. 말이 아직 없어서 물어도 거절당한다 */
              onCross={() => Promise.resolve(true)}
              /* 시작 전에는 갈 수 있는 방이 하나뿐이라 물어볼 것이 없다 */
              onRoom={() => {}}
              onDirs={setWays}
              /*
               * **2-3 교실 밖으로는 못 나간다.**
               *
               * 첫 아침은 다 같이 한 교실에서 연다. 시작도 안 한 학교를
               * 혼자 다 돌아 보고 나서 닷새를 시작하면, 첫날 아침에
               * 처음 보는 것이 아무것도 없다.
               *
               */
              stayIn={START_TILE as RoomId}
              onTapRoom={() => {}}
              onTapPerson={() => {}}
              onStand={() => {}}
              /* 감독관이 풀기 전에는 한 걸음도 못 뗀다 */
              frozen={!talkOpen}
            />
            <header className="sc-pl__head">
              <div className="sc-pl__hud1">
                <span className="sc-pl__day">DAY 0</span>
                <span className="sc-pl__clock">{seats.length} / {TOTAL_SEATS} 모였다</span>
                <span className="sc-pl__me">
                  <i className="sc-pl__band" style={{ background: colorOfTeam(mine.team) }}>
                    {mine.team ?? ''}
                  </i>
                  {me.nickname}
                </span>
              </div>
              {/* 둘째 층. 판이 돌 때의 「방 이름 · 인원」 자리에 시작
                  전이라는 말을 둔다 — 전에는 지도 아래 한 줄이었는데,
                  말줄이 그 자리에 앉으면서 글자 위에 글자가 겹쳤다 */}
              <div className="sc-pl__hud2">
                <span className="sc-pl__where">{TILE_BY_ID[START_TILE as TileId].name}</span>
                <span className="sc-pl__crowd">{talkOpen ? '밖으로는 못 나간다' : WAIT}</span>
              </div>
            </header>
          </div>

          {/* 말줄. 판이 돌 때와 **같은 자리에 같은 것**이다 — 흐름
              밖에 서서 키보드만큼 올라간다(controls.css 의 .sc-sy) */}
          <Say
            hereName={TILE_BY_ID[START_TILE as TileId].name}
            act={act}
            onSaid={showToast}
            lines={talkLines}
            pull={talk.pull}
            open={typing}
            onClose={blurNow}
            stuck={talk.stuck}
            self={{ playerId: mine.playerId, name: mine.name, team: mine.team ?? null }}
            mute={!talkOpen}
            muteText={WAIT}
          />

          {/*
            조작부는 판이 돌 때와 **같은 것을 같은 자리에** 세워 둔다.
            여섯 칸이 비어 있으면 아직 만들다 만 화면처럼 보이고,
            시작하고 나서 손가락이 자리를 다시 외워야 한다.
            다만 판이 서기 전에는 아무것도 눌리지 않는다 — 흐리게
            두고, 누르면 까닭을 한 줄로 말한다.

            **「모인 사람」과 「더보기」는 살려 둔다.** 게임 안의 일이
            아니고, 나가는 문(로그아웃)이 더보기 뒤에 있다 — 둘 다
            막으면 이 화면에 갇힌다.
          */}
          <div className="sc-ct">
            <Toast text={toast} />
            <div className="sc-ct__ctl">
              <Pad padRef={padRef} dirs={beforeDirs} onBlocked={showToast} />
              <ActionGrid acts={beforeGrid} onBlocked={showToast} />
            </div>
          </div>
        </section>

        {roster && (
          <Sheet title="모인 사람" onClose={() => setRoster(false)}>
            <p className="sc-dl__none">
              {seats.length} 명이 모였다.
            </p>
            <Roll seats={seats} uid={uid} />
            {error && <p className="sc-pl__error">{error}</p>}
          </Sheet>
        )}

        {before && (
          <Sheet title="더 보기" onClose={() => setBefore(false)}>
            <div className="sc-pl__more">
              <ReplayPrologue />
              <SoundToggle />
            </div>
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
  /** 끝난 판의 세 칸 — 엔딩 · 회고 · 판정(마지막 날까지의 개인 미션) */
  const [endTab, setEndTab] = useState<'ending' | 'retro' | 'verdicts'>('ending')

  /*
   * **숨겨 둔 배정을 공개하는 학생증.** 「연습 끝 · DAY 1 시작」이 자리마다 배정
   * 시각을 새로 찍는다(판이 시작된 시각 이후). 로비에서 본 배정은 시작보다 앞이라
   * 여기서 다시 뜨지 않는다. 사람마다 한 번만 — 닫으면 다시 안 뜬다
   */
  const revealUid = auth?.currentUser?.uid ?? null
  const revealSeat = state.game?.seats.find((s) => s.playerId === revealUid) ?? null
  const startedAt = state.game?.startedAtMs ?? null
  const revealStamp =
    // 판이 도는 동안에만 — 끝난 판을 새 기기로 열었을 때 학생증이 다시 뜨지 않게
    state.game?.phase === 'running' && revealSeat?.team && revealSeat.dealtAtMs && startedAt !== null && revealSeat.dealtAtMs >= startedAt && !state.game?.hideDeal
      ? revealSeat.dealtAtMs
      : 0
  const [revealShut, setRevealShut] = useState(0)
  const revealSeen = revealUid !== null && revealStamp > 0 && dealtSeen(gameId, revealUid, revealStamp)
  const revealAct = useMemo(() => gameActions(gameId), [gameId])
  const revealCard = useMyPaper(revealAct, revealStamp > 0 && !revealSeen && revealShut !== revealStamp, revealStamp)
  /** 공개 학생증을 아직 받는 중이다 — 받기 전에 아침이 먼저 시작되면 학생증이 그 위를 덮어 아침이 처음부터 다시 돈다 */
  const revealPending = revealStamp > 0 && !revealSeen && revealShut !== revealStamp && !revealCard.err

  /*
   * **연습이 끝나면 DAY 1 아침을 그때 연다.** 연습 동안은 열린 날이 없어서
   * 아침이 그냥 지나갔다(morningDone). 연습 → DAY 1 로 바뀌는 순간 다시 세워
   * 학생증 다음에 DAY 1 아침이 재생되게 한다
   */
  const practiceNow = !!state.game?.practice
  const wasPractice = useRef(practiceNow)
  useEffect(() => {
    if (wasPractice.current && !practiceNow) setMorningDone(false)
    wasPractice.current = practiceNow
  }, [practiceNow])
  /*
   * **감독관이 「다음 날 아침」을 누르면 그날 아침도 그 자리에서 연다.** 날은
   * 달력이 아니라 감독관이 넘긴다 — 켜 둔 화면도 새로고침 없이 그날 기록을 본다
   */
  const dayNow = state.game?.day ?? 0
  const lastDay = useRef(dayNow)
  useEffect(() => {
    if (lastDay.current > 0 && dayNow > lastDay.current) setMorningDone(false)
    lastDay.current = dayNow
  }, [dayNow])

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

  if (revealCard.paper && revealStamp > 0 && !revealSeen && revealShut !== revealStamp && revealUid && revealSeat?.team) {
    return (
      <Dealt
        name={revealSeat.name}
        team={revealSeat.team}
        look={look}
        paper={revealCard.paper}
        snowLevel={game.snow?.level ?? 5}
        onClose={() => {
          markDealtSeen(gameId, revealUid, revealStamp)
          setRevealShut(revealStamp)
        }}
      />
    )
  }

  // 종례가 끝났으면 엔딩과 회고만 남는다
  if (game.phase === 'finished') {
    return (
      <div className="sc-pl">
        {endTab === 'retro' ? (
          <LiveRetro gameId={gameId} />
        ) : endTab === 'verdicts' ? (
          <div className="sc-pl__verdicts">
            <PastVerdicts inbox={state.inbox} />
          </div>
        ) : game.endingBroadcast ? (
          <LiveEnding gameId={gameId} />
        ) : (
          /* **엔딩은 감독관이 송출해야 뜬다.** 그 전에는 기다린다 */
          <div className="sc-en">
            <p className="sc-en__wait">종례가 끝났다.</p>
          </div>
        )}
        {/* 끝난 뒤에도 공지 · 1위 발표가 뜬다 */}
        <NoticePop gameId={gameId} uid={myUid ?? ''} notices={state.view?.notices} waiting={unseenMails(state.inbox).length > 0} />
        {/* 마지막 날 판정은 판이 끝난 뒤에 온다. 엔딩 위에도 뜬다 */}
        <MissionMailbox inbox={state.inbox} act={gameActions(gameId)} />
        <BoardMailbox gameId={gameId} boards={game.missionBoards} seats={game.seats} meId={myUid ?? ''} waiting={unseenMails(state.inbox).length > 0} />
        <nav className="sc-pl__tabbar">
          <button className={endTab === 'ending' ? 'is-on' : ''} onClick={() => setEndTab('ending')}>엔딩</button>
          <button className={endTab === 'retro' ? 'is-on' : ''} onClick={() => setEndTab('retro')}>회고</button>
          <button className={endTab === 'verdicts' ? 'is-on' : ''} onClick={() => setEndTab('verdicts')}>판정</button>
        </nav>
      </div>
    )
  }

  // 아침 시퀀스가 먼저다. 볼 것이 없으면 저절로 지나간다
  if (!morningDone) {
    // 학생증이 먼저다 — 받아 오는 짧은 사이는 비워 둔다
    if (revealPending) return <div className="sc-pl" />
    return <LiveMorning gameId={gameId} onDone={() => setMorningDone(true)} />
  }

  return (
    <div className="sc-pl">
      <Today gameId={gameId} look={look} />
    </div>
  )
}

/** 아래 탭바의 세 칸. 화면은 세 장뿐이고, 나머지는 전부 시트다. */
type Tab = 'map' | 'me' | 'radio' | 'vote' | 'note'

/** 컨트롤 바의 「더보기」에서 열리는 것들. */
/**
 * 컨트롤 바의 「더보기」에서 열리는 것들.
 *
 * **방 안의 말은 여기 없다.** 전에는 로그를 누르면 지난 줄이 전부
 * 담긴 창이 열렸는데, 그러면 「그 자리에 있던 사람만 안다」가
 * 「나중에 읽어도 된다」가 된다 — 방 대화의 휘발성이 통째로 사라진다.
 * 지나간 줄은 지나간 것으로 둔다.
 */
/**
 * 「여기」의 이름. 말줄이 이걸로 열리고 닫힌다.
 *
 * 방이면 방 이름, 복도면 **복도**, 걷는 중이면 null 이다. 셋을
 * 가르는 것이 중요하다 — 복도에서는 말을 걸 수 있고 걷는 중에는 못
 * 건다. 선 방만 보면 둘이 똑같이 null 이라 복도에서 입이 막힌다.
 */
function placeName(room: TileId | null, cell: { x: number; y: number } | null): string | null {
  // **복도가 먼저다.** 복도로 나서도 선 방(tileId)은 마지막 방 그대로다
  // — 방 이름부터 보면 복도에 서서 「2-3 교실에서 말한다」가 뜬다.
  // 서버도 선 칸으로 가른다(chat.ts) — 화면이 다르게 말하면 안 된다.
  if (cell && isAlleyCell(cell.x, cell.y)) return ALLEY_NAME
  if (cell && isHallCell(cell.x, cell.y)) return '복도'
  if (room) return TILE_BY_ID[room].name
  return null
}

type SheetId = 'act' | 'more' | 'hand' | 'shop' | 'team' | 'board' | 'garden' | 'maker' | 'arcade'

/**
 * 오늘 하루. **맵이 화면이다.**
 *
 * 세로로 네 층이다 — 방 화면(남는 공간 전부) · 자원 줄 44 · 컨트롤 바
 * 104 · 탭바 56. 높이를 %로 나누면 주소창이 줄었다 늘었다 할 때마다
 * 탭바가 화면 밖으로 밀려 나간다. flex 로 나누고 dvh 로 잰다.
 *
 * 탭은 다섯 장이지만 **만나야 하는 일은 여전히 맵에서만 일어난다.**
 * 「나」는 내 것만 보고, 「투표」는 표만 던지고, 「메모」는 나만 본다 —
 * 거기서 학교 반대편 사람에게 말을 걸 수는 없다. 「무전」 하나가
 * 예외인데, 그것도 같은 팀에게만 간다.
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
      {!over && <p className="sc-wait__why">판이 이미 시작했다.</p>}
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
  // **앱을 켜 두었다고 알린다.** 보이는 동안 1 분마다, 다시 보이는 순간 한 번.
  // 5 분 넘게 안 오면 남의 맵에서 사라지고 칸도 안 막는다(rules/online)
  useEffect(() => {
    const send = () => void act.ping().catch(() => {})
    send()
    return whileVisible(send, PING_MS)
  }, [act])
  const uid = auth?.currentUser?.uid ?? null
  const [standingRoom, setStandingRoom] = useState<TileId | null>(null)
  /** 맵에서 누른 먼 방. 거기로 걸어가거나 내일 아침을 예약한다. */
  const [far, setFar] = useState<TileId | null>(null)
  /**
   * 잠긴 문 앞에서 락픽을 쓸지 묻는 중. **걸음은 대답을 기다린다** —
   * 예를 누르면 따고 그대로 들어가고, 아니오면 문 앞에 선 채로 끝난다.
   */
  const [pickAsk, setPickAsk] = useState<{ to: TileId; answer: (yes: boolean) => void } | null>(null)
  /**
   * 내가 멈춰 선 칸. **복도에 섰는지를 이걸로 안다.**
   *
   * 선 방(standingOn)은 복도에서 null 이라, 그것만으로는 「복도에 서
   * 있다」와 「걷는 중이다」가 구별되지 않는다 — 앞은 말을 걸 수 있고
   * 뒤는 못 건다.
   */
  const [myCell, setMyCell] = useState<{ x: number; y: number } | null>(null)
  /** 걷는 동안 칸마다 바뀌는 내 자리. 미니맵이 매 프레임 읽는다 — state 로 두면 화면 전체가 다시 그려진다 */
  const selfCellRef = useRef<{ x: number; y: number } | null>(null)
  /**
   * 그 방을 잠근 팀. **서버가 보내 준 것만 본다** — 안 보이는 방의
   * 자물쇠는 애초에 안 내려온다.
   */
  const lockedBy = useCallback(
    (id: TileId | null): TeamId | null =>
      (id === null ? null : (state.view?.lockedTiles?.find((l) => l.tileId === id)?.team ?? null)) as TeamId | null,
    [state.view],
  )
  const [said, setSaid] = useState('')
  /** 서버가 거절한 말인가. 거절은 눌러서 지울 때까지 남는다. */
  const [bad, setBad] = useState(false)
  const say = useCallback((text: string) => { setBad(false); setSaid(text) }, [])
  const refuse = useCallback((text: string) => { setBad(true); setSaid(text) }, [])
  /** 바닥의 종이 둘 — 문제와 비밀 쪽지. 맵에는 한 목록으로 그린다 */
  const floorPapers = useMemo(
    () => [
      ...(state.view?.quizzesHere ?? []).map((q) => ({ x: q.x, y: q.y, kind: 'quiz' as const })),
      // 비밀 쪽지는 봉인한 그림, 메모(운영자 메모 · 빈 종이)는 봉인 없는 그림이다
      ...(state.view?.slipPapers ?? []).map((q) => ({ x: q.x, y: q.y, kind: q.kind === 'memo' ? ('memo' as const) : ('slip' as const) })),
      // 찢긴 종이. 테이프로 붙일 수 있다
      ...(state.view?.scrapPapers ?? []).map((q) => ({ x: q.x, y: q.y, kind: 'scrap' as const })),
    ],
    [state.view?.quizzesHere, state.view?.slipPapers, state.view?.scrapPapers],
  )
  /** 바닥에서 읽은 메모. 닫으면 사라진다 — 종이는 바닥에 그대로 있다 */
  const [floorRead, setFloorRead] = useState<{ line: string } | null>(null)
  /**
   * 바닥의 쪽지에 하는 일 — 읽기 · 찢기. **줍지 않는다.** 칸으로 어느
   * 종이인지 찾는다. 테이프는 찢긴 종이 쪽이다
   */
  const onFloorMemo = useCallback(
    (at: { x: number; y: number }, what: 'read' | 'tear' | 'tape') => {
      if (what === 'tape') {
        const scrap = (state.view?.scrapPapers ?? []).find((q) => q.x === at.x && q.y === at.y)
        if (!scrap) return
        void act
          .useItem('tape', { scrapId: scrap.id })
          .then(() => setSaid('붙였다. 접힌 채로 내 손에 있다 — 나 탭 쪽지에서 읽는다.'))
          .catch((e: Error) => refuse(e.message))
        return
      }
      const memo = (state.view?.slipPapers ?? []).find((q) => q.x === at.x && q.y === at.y)
      if (!memo) return
      if (what === 'read') {
        void act
          .readSlipHere(memo.id)
          .then((out) => setFloorRead({ line: out.line ?? '' }))
          .catch((e: Error) => refuse(e.message))
      } else {
        void act
          .tearSlipHere(memo.id)
          .then(() => setSaid('찢었다. 찢긴 종이가 그 자리에 남는다.'))
          .catch((e: Error) => refuse(e.message))
      }
    },
    [act, refuse, state.view?.slipPapers, state.view?.scrapPapers],
  )
  /**
   * 옆 칸의 종이를 줍는다. 맵에서 탭해도, 아래 단추를 눌러도 여기로 온다.
   * 어느 종이인지는 칸으로 찾는다 — 한 칸에 한 장뿐이다(서버가 막는다).
   */
  const takePaper = useCallback(
    (at: { x: number; y: number }) => {
      const quiz = (state.view?.quizzesHere ?? []).find((q) => q.x === at.x && q.y === at.y)
      const slip = (state.view?.slipPapers ?? []).find((q) => q.x === at.x && q.y === at.y)
      if (quiz) {
        void act
          .takeQuiz(quiz.id)
          .then(() => setSaid('문제를 펼쳤다. 가방에서 푼다. 누가 맞히기 전까지 종이는 바닥에 남는다.'))
          .catch((e: Error) => refuse(e.message))
      } else if (slip) {
        void act
          .takeSlip(slip.id)
          .then(() => setSaid('챙겼다. 나 탭 가진 것 · 쪽지에 있다.'))
          .catch((e: Error) => refuse(e.message))
      }
    },
    [act, refuse, state.view?.quizzesHere, state.view?.slipPapers],
  )
  const [tab, setTab] = useState<Tab>('map')
  /** 감독관이 잠근 탭. 보고 있던 탭이 잠기면 잠기지 않은 첫 탭으로 옮긴다 */
  const lockedTabs = useMemo(() => new Set(state.game?.lockedTabs ?? []), [state.game?.lockedTabs])
  useEffect(() => {
    if (!lockedTabs.has(tab)) return
    const free = (['map', 'me', 'radio', 'vote', 'note'] as Tab[]).find((t) => !lockedTabs.has(t))
    if (free) setTab(free)
  }, [lockedTabs, tab])
  /*
   * **탭마다 구르던 자리를 기억한다.** 탭은 떼지 않고 숨기기만 하는데,
   * 숨기는 동안(display:none) 브라우저가 구른 자리를 잊는다. 떠날 때
   * 구른 상자와 자리를 적어 두고, 돌아오면 그대로 되돌린다.
   */
  const scrollKept = useRef(new Map<Tab, Array<[Element, number]>>())
  const pickTab = useCallback(
    (next: Tab) => {
      const now = document.querySelector('.sc-pl__tab:not([hidden])')
      if (now) {
        const rows: Array<[Element, number]> = []
        if (now.scrollTop > 0) rows.push([now, now.scrollTop])
        now.querySelectorAll('*').forEach((el) => {
          if (el.scrollTop > 0) rows.push([el, el.scrollTop])
        })
        scrollKept.current.set(tab, rows)
      }
      setTab(next)
    },
    [tab],
  )
  /** 알림이 가리키는 곳으로. 알림의 「memo」는 수첩 탭이다 */
  const goLink = useCallback(
    (link: NotifyLink) => pickTab(link === 'memo' ? 'note' : link),
    [pickTab],
  )
  /*
   * 앱 밖 알림을 눌러 들어왔다 — 주소의 ?tab= 이 갈 곳이다. 이미 열린
   * 창이면 서비스 워커가 말로 알려 준다(public/sw.js notificationclick).
   */
  useEffect(() => {
    const want = new URLSearchParams(location.search).get('tab')
    if (want && ['map', 'me', 'radio', 'vote', 'memo'].includes(want)) goLink(want as NotifyLink)
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { kind?: string; url?: string } | null
      if (d?.kind !== 'open-tab' || !d.url) return
      const t = new URL(d.url).searchParams.get('tab')
      if (t && ['map', 'me', 'radio', 'vote', 'memo'].includes(t)) goLink(t as NotifyLink)
    }
    navigator.serviceWorker?.addEventListener('message', onMsg)
    return () => navigator.serviceWorker?.removeEventListener('message', onMsg)
    // 처음 한 번만 — 주소는 들어올 때의 것이다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useLayoutEffect(() => {
    for (const [el, top] of scrollKept.current.get(tab) ?? []) el.scrollTop = top
  }, [tab])
  /** 무전에 안 읽은 줄이 몇인가. 탭 그림 모서리에 점을 찍는다 */
  const [radioNew, setRadioNew] = useState(0)
  const [sheet, setSheet] = useState<SheetId | null>(null)
  /** 맵에서 짚은 사람. 거래는 여기서 시작한다. */
  /**
   * 맵에서 짚은 사람과 **그 사람이 화면 어디에 서 있는지**.
   *
   * 자리를 같이 쥐는 것은 차림표를 그 옆에 붙이기 위해서다. 짚은
   * 순간의 자리로 굳힌다 — 창이 떠 있는 동안 나는 못 움직이고,
   * 상대가 방을 나가면 창을 닫아 버리므로 따라다닐 일이 없다.
   */
  const [person, setPerson] = useState<{ id: string; at: PersonAt } | null>(null)
  /**
   * 맵에서 짚은 물건과 그 자리. 사람과 같은 작은 차림표가 그 옆에 뜬다.
   * **멀어도 뜬다** — 손이 안 닿으면 줄마다 몇 칸 더 가야 하는지 적는다.
   */
  const [thing, setThing] = useState<{ t: TapThing; at: PersonAt } | null>(null)
  /** 「앉는다」를 눌렀다. 자리에 닿으면 오락기가 켜진다 */
  const [sitting, setSitting] = useState(false)
  const [archive, setArchive] = useState(false)
  const [atlas, setAtlas] = useState(false)
  const [miniOn, setMiniOn] = useMiniMapOn()
  const [snowOff, setSnowOffState] = useState(snowIsOff)
  const [buzzing, setBuzzing] = useState(buzzOn)
  const [plain, setPlainState] = useState(plainOn)
  // 십자키는 컨트롤 바에 있고 그림은 위에 있다. 자리만 건네준다
  const padRef = useRef<HTMLDivElement | null>(null)
  // 글을 쓰는 동안에는 탭바를 감춘다. 키보드 위에 얹혀 있으면
  // 입력창이 그만큼 가려진다
  const typing = useTyping()
  const kb = useKeyboardInset()
  /** 초점을 뗀다. 맵을 짚거나 로그를 쓸어내리면 채팅 모드가 닫힌다 */
  const blurNow = useCallback(() => {
    ;(document.activeElement as HTMLElement | null)?.blur()
  }, [])
  /**
   * 채팅 바 윗변의 화면 y. 캐릭터가 이보다 아래면 카메라를 민다.
   *
   * **재서 넘긴다.** 바의 높이와 자리를 CSS 가 정하므로(40 ↔ 48,
   * `bottom: max(--kb, 조작부)`) 여기서 같은 셈을 두 벌 두면 반드시
   * 어긋난다. 키보드가 움직일 때만 재니 비싸지도 않다.
   */
  const [barTop, setBarTop] = useState<number | null>(null)
  useEffect(() => {
    if (!typing) { setBarTop(null); return }
    // 바가 다 올라간 뒤의 자리를 재야 한다. 전환이 0.25초다
    const t = setTimeout(() => {
      const el = document.querySelector('.sc-sy')
      setBarTop(el ? Math.round(el.getBoundingClientRect().top) : null)
    }, 260)
    return () => clearTimeout(t)
  }, [typing, kb])

  /**
   * 머리 위 표시 아랫변의 화면 y. 풍선을 이보다 위로는 안 올린다.
   *
   * **재서 넘긴다.** 표시가 한 층일 때(대기실)와 두 층일 때, 안전
   * 영역이 있을 때와 없을 때 높이가 다 다르다 — 숫자를 여기 적어
   * 두면 어느 기기에선가 반드시 어긋난다.
   */
  const [headBottom, setHeadBottom] = useState<number | null>(null)

  const game = state.game
  const me = game?.seats.find((s) => s.playerId === uid)
  /*
   * 내 팀. **판이 돌고 있으면 반드시 있다** — 배정 없이는 시작이 안
   * 되고, 이 화면은 시작한 뒤에만 그려진다. 타입만 그걸 모른다
   */
  // 배정을 숨겨 둔 동안은 분단이 없다(null) — 「1 분단」으로 메우면 거래창 · 무전에 엉뚱한 분단이 찍힌다
  const myTeam = (me?.team ?? (game?.hideDeal ? null : 'A')) as TeamId
  const invisibleName = game?.invisibleId
    ? (game.seats.find((s) => s.playerId === game.invisibleId)?.name ?? null)
    : null
  const standingOn = (state.view?.visiblePawns.find((p) => p.playerId === uid)?.tileId ?? null) as TileId | null

  /*
   * **방이 바뀌면 쥐고 있던 칸을 버린다.**
   *
   * 서버가 사람을 옮길 때는 칸을 비운다(phase.ts 의 roamTo·arrive).
   * 화면이 들고 있던 값은 그 순간 옛 자리다 — 복도에서 방으로 끌려
   * 들어간 뒤에도 「게시판」 단추가 남아 있었다. 다음 걸음(Walk 의
   * 500ms 보고)이 곧 새 자리를 적어 준다.
   */
  useEffect(() => {
    setMyCell(null)
  }, [standingOn])
  /** 복도에 서 있는가. 방 안이면 false 다 — 서버와 같은 기준이다 */
  const inHall = myCell !== null && isHallCell(myCell.x, myCell.y)

  /*
   * **기계 앞을 떠나면 자판기가 저절로 닫힌다.**
   *
   * 화면이 남아 있으면 눌러 봐야 서버가 「자판기 앞에 서야 산다」로
   * 거절한다. 거절로 알려 주는 것보다 닫아 주는 편이 맞다 — 떠난
   * 것은 사람이 한 일이라 설명할 것이 없다.
   *
   * **선 방이 아니라 선 칸을 본다.** 기계가 복도로 나간 뒤로 방을
   * 봐서는 떠났는지 알 수가 없다 — 복도에서는 방이 안 바뀐다.
   */
  const vendingHere = atVending(myCell)
  /**
   * 앉은 오락기. **기계 앞자리에 선 것이 앉은 것이다**(rules/arcade).
   * 자판기와 같다 — 일어나면 창이 닫힌다.
   */
  const myMachine = machineAtSeat(myCell)
  const arcadeHere = myMachine !== null
  useEffect(() => {
    if (!arcadeHere) setSheet((s) => (s === 'arcade' ? null : s))
  }, [arcadeHere])
  /*
   * 「앉는다」로 걸어갔다. **멈춘 자리가 앞자리면 기계를 켠다.** 다른
   * 데서 멈췄으면 잊는다 — 한참 뒤 우연히 앉았는데 창이 튀어나오면 안 된다
   */
  useEffect(() => {
    if (!sitting) return
    if (arcadeHere) setSheet('arcade')
    setSitting(false)
  }, [myCell]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (vendingHere === null) setSheet((s) => (s === 'shop' ? null : s))
    if (standingOn !== TECH_TILE) setSheet((s) => (s === 'maker' ? null : s))
  }, [vendingHere])
  // 같은 자리에 서 있는 사람들. 걷는 사람은 어느 자리에도 없다
  const hereNow = standingOn
    ? (state.view?.visiblePawns ?? []).filter((p) => p.playerId !== uid && p.tileId === standingOn)
    : []
  const hereIds = hereNow.map((p) => p.playerId)
  /** 오늘 지워진 사람. 나라면 화면이 반투명해진다 */
  const iAmInvisible = game?.invisibleId === uid

  /*
   * 학생증과 생활기록부. **views 에 안 싣는다** — 미션 진행도는 판
   * 전체의 기록을 훑어야 나오고, views 는 누가 한 걸음 옮길 때마다
   * 열넷을 통째로 다시 쓴다. 「나」 탭을 볼 때와 날짜가 바뀔 때만
   * 부른다(useMyPaper).
   */
  // 배정을 공개하는 순간(hideDeal 이 풀릴 때)에도 다시 받는다 — 「배정 전」에 머물지 않게
  const mine = useMyPaper(act, tab === 'me', (game?.day ?? 0) + (game?.hideDeal ? 0.5 : 0))

  // 표시가 한 층일 때와 두 층일 때, 안전 영역이 있을 때와 없을 때
  // 높이가 다 다르다. 방이 바뀌거나 화면이 돌면 다시 잰다
  useEffect(() => {
    const fit = () => {
      const el = document.querySelector('.sc-pl__head')
      setHeadBottom(el ? Math.round(el.getBoundingClientRect().bottom) : null)
    }
    fit()
    const t = window.setTimeout(fit, 400)
    window.addEventListener('resize', fit)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('resize', fit)
    }
  }, [standingOn, kb])

  /**
   * 지금 앉아 있는 거래판. **views 가 아니라 거래판 문서를 직접 본다** —
   * 상대가 물건을 올리는 것이 그 자리에서 보여야 흥정이다.
   */
  const { deal: dealDoc, dismiss: leaveDeal } = useDeal(gameId, uid)
  // 배정을 숨겨 둔 동안은 거래창에 분단이 안 나온다
  const dealHidden = !!state.game?.hideDeal
  const deal = useMemo(
    () =>
      dealDoc && dealHidden
        ? { ...dealDoc, a: { ...dealDoc.a, team: null as unknown as TeamId }, b: { ...dealDoc.b, team: null as unknown as TeamId } }
        : dealDoc,
    [dealDoc, dealHidden],
  )
  // 오락실 방. 먼저 낸 수와 먼저 끝낸 점수는 이 문서에 없다 — 서버가 봉인한다
  const { room: arcadeRoom, invites: arcadeInvites, dismiss: dismissRoom } = useArcade(gameId, uid)
  /*
   * **자리에서 일어나면 판에서 빠진다.** 앉아 있던 사람이 걸어 나가면
   * 서버는 다음 수를 둘 때에야 안다 — 그동안 상대는 안 올 수를 기다린다.
   * 일어나는 순간 화면이 알린다. 앉았다 일어나는 그 한 번만 본다 —
   * 화면이 켜지는 동안 자리가 잠깐 비는 것을 일어난 것으로 치면 안 된다.
   */
  const satRef = useRef(arcadeHere)
  useEffect(() => {
    const was = satRef.current
    satRef.current = arcadeHere
    if (!was || arcadeHere) return
    if (arcadeRoom && LIVE_ROOM.has(arcadeRoom.status)) void act.arcadeLeave(arcadeRoom.id).catch(() => undefined)
  }, [arcadeHere, arcadeRoom, act])

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
    ? cellsTouch(myAt, state.view?.visiblePawns.find((p) => p.playerId === person.id)?.at ?? null)
    : false
  // 표도 거래와 같은 기준이다 — 수첩 탭의 「여기 있는 사람」은 방
  // 전체를 보여 주지만, 표를 줄 수 있는 것은 그중 옆 칸뿐이다
  const nearIds = new Set(hereNow.filter((p) => cellsTouch(myAt, p.at)).map((p) => p.playerId))

  /** 짚은 사람의 팀. 안 보이면 null 이다. */
  const personTeam = (hereNow.find((p) => p.playerId === person?.id)?.team ?? null) as TeamId | null

  /*
   * **짚은 사람이 방을 나가면 차림표를 닫는다.**
   *
   * 자리는 짚은 순간으로 굳혀 두었다 — 창이 떠 있는 동안 나는 못
   * 움직이니 따라다닐 일이 없다. 다만 상대는 걸어 나갈 수 있고,
   * 그러면 창만 빈 자리를 가리킨 채 남는다. 없는 사람에게 표를
   * 주려다 서버에 거절당하느니 여기서 닫는다.
   */
  const gonePerson = person !== null && !hereIds.includes(person.id)
  useEffect(() => {
    if (gonePerson) setPerson(null)
  }, [gonePerson])


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
    (id: string | null) => {
      // 명단에 없는 사람은 「누군가」다. 명단에 있는데 이름이 비었으면 자리 번호다
      const i = id ? (game?.seats.findIndex((s) => s.playerId === id) ?? -1) : -1
      return game && i >= 0 ? seatName(game.seats[i], i) : '누군가'
    },
    [game],
  )
  /** 기계마다 앉은 사람. 골목은 한눈에 보이니 보이는 사람으로 다 안다 */
  const seatedAt = useMemo(() => {
    const out: ({ id: string; name: string } | null)[] = Array.from({ length: ARCADE_COUNT }, () => null)
    for (const p of state.view?.visiblePawns ?? []) {
      if (p.walking) continue
      const m = machineAtSeat(p.at ?? null)
      if (m !== null) out[m] = { id: p.playerId, name: nameOf(p.playerId) }
    }
    return out
  }, [state.view?.visiblePawns, nameOf])
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
  /* 발치에 다는 이름표. **명단은 다 알고 있다** — 누가 보이는지는
     view 가 정하고, 여기서는 보이는 사람의 이름만 꺼내 쓴다 */
  const names = useMemo(
    () => Object.fromEntries((game?.seats ?? []).map((sx, i) => [sx.playerId, seatName(sx, i)])),
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
  /** 서버가 거절한 칸 — 이 칸으로 한 번 도로 선다(Walk bounce). n 이 바뀔 때만 */
  const [bounce, setBounce] = useState<{ x: number; y: number; n: number; from: { x: number; y: number } } | null>(null)
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

  /**
   * 이 방에서 오간 말. **한 군데서 가져온다** — 아래 말줄과 머리 위
   * 풍선이 같은 줄을 봐야 하는데, 따로 세면 둘이 다른 것을 보게 된다.
   */
  const talk = useChatLines(act, 'room', { room: standingOn })
  // 배정을 숨겨 둔 동안은 말줄의 분단 색도 지운다
  const talkLines = useMemo(() => (dealHidden ? talk.lines.map((l) => ({ ...l, team: '' })) : talk.lines), [dealHidden, talk.lines])

  /**
   * 지금 머리 위에 떠 있어야 할 말. 사람마다 마지막 한 줄이다.
   *
   * **실제 시계로 잰다.** 여기서 한 번 크게 틀렸다 — 줄에 찍힌 시각이
   * 게임 시각이라기에 게임 시계로 뺐는데, 판은 닷새를 하룻저녁에
   * 돌리느라 시계가 빨리 간다. 배속 60이면 4초가 실제로는 67ms 다.
   * **풍선이 아예 안 뜬 것처럼 보였다.**
   *
   * 풍선이 얼마나 떠 있어야 하는가는 게임의 규칙이 아니라 **사람이 한
   * 줄 읽는 데 걸리는 시간**이다. 그건 시계를 어떻게 돌리든 4초다.
   * 그래서 찍힌 게임 시각을 실제 시각으로 되돌려서(realTimeOf) real
   * 시계와 뺀다.
   *
   * nowMs 는 1초마다 바뀌니 다시 셈하는 계기로만 쓴다.
   */
  /* 돈·지식이 드나든 만큼. 머리 위로 떠올랐다 사라진다 */
  const pops = usePops(state.view?.myMoney ?? null, state.view?.teamVault?.knowledge ?? null)

  const says = useMemo(() => {
    // 말풍선 수명도 서버에 맞춘 시각으로 잰다 — 폰 시계가 틀리면 말이 안 뜨거나 안 사라졌다
    const realNow = correctedNow()
    const out: Record<string, string> = {}
    for (const l of talk.lines) {
      if (!bubbleUp(l.atMs, state.game?.clock, realNow)) continue
      // 두 줄에 안 들어가는 말은 뒤를 자른다. 전체는 아래 로그에서 읽는다
      out[l.playerId] = bubbleText(l.text)
    }
    return out
  }, [talk.lines, nowMs, state.game?.clock])

  /**
   * 화면 어디든 처음 닿으면 소리 장치를 연다.
   *
   * 브라우저가 손끝이 닿기 전에는 안 열어 주기도 하고, 들어오자마자
   * 소리가 나면 조용히 보려던 사람이 놀라기도 한다. 한 번만 듣는다
   */
  useEffect(() => {
    const on = () => armSfx()
    window.addEventListener('pointerdown', on, { once: true })
    return () => window.removeEventListener('pointerdown', on)
  }, [])

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

  // 화면에 보이는 교시 — 날마다 1부터
  const phaseNo = state.game?.phaseNow?.period ?? state.game?.phaseNow?.no ?? 0
  const phaseOpen = state.game?.phaseNow?.open === true

  /**
   * 이적을 못 꺼내는 까닭. **서버와 같은 함수를 부른다.**
   *
   * 남의 pawn 은 화면에 안 오므로 「이미 옮기기로 했다」와 「그 팀
   * 마지막 한 사람이다」 둘은 넣지 않는다 — 모르는 것을 지어내느니
   * 켜 둔 채로 서버가 거절하며 까닭을 말하게 둔다.
   */
  /** 아직 살아 있는 이적 제안. **15 초가 지나면 무산** — 양쪽 다 창이 닫힌다 */
  const moveLive = moveAsk !== null && moveAsk.status === 'asking' && !askExpired(moveAsk, nowMs)
  const moveNo =
    person && personTeam && me
      ? whyNotTransfer({
          day: game?.day ?? 0,
          phaseOpen,
          byId: me.playerId,
          byTeam: me.team as TeamId,
          toId: person.id,
          toTeam: personTeam,
          bothStanding: standingOn !== null,
          nextTo,
          asking: moveLive,
        })
      : 'walking'

  const phaseEndsAtMs = state.game?.phaseNow?.endsAtMs ?? null

  /**
   * 오늘 표가 이미 세어졌는가.
   *
   * 집계는 **운영자가 그날 정산을 넘길 때** 한 번 돈다(announceBallots).
   * 세고 나면 내일 칸(invisibleByDay)이 생기므로 그것을 보고 잠근다.
   * 마지막 날에는 내일이 없어서 처음부터 잠겨 있다.
   */
  const ballotDay = state.game?.day ?? 0
  const ballotCounted = String(ballotDay + 1) in (state.game?.invisibleByDay ?? {})
  /** 운영자가 오늘 문을 열었는가(ballotGate). 열기 전에는 탭이 잠겨 있다 */
  const ballotOpened = state.game?.ballot?.open === true && state.game.ballot.day === ballotDay
  const ballotClosed = state.game?.phase !== 'running' || ballotDay >= TOTAL_DAYS || ballotCounted || !ballotOpened
  /**
   * 마감까지 몇 분인가. **모르면 안 적는다.**
   *
   * 정산은 운영자가 손으로 넘긴다. 언제일지 화면은 모르고, 그럴듯한
   * 숫자를 적어 두면 그 숫자를 믿고 기다리다 못 던지는 사람이 생긴다.
   */
  const ballotClosesInMin: number | null = null

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
   * 아래 칸에 무엇을 놓는가.
   *
   * **늘 같다.** 가방 · 이 방 · 전체 맵 · 더보기, 페이즈 중에는 앞에
   * 깃발이 붙는다. 서는 자리에 따라 칸이 바뀌면 같은 자리를 눌러도
   * 다른 일이 일어난다 — 물건에 붙은 일은 맵에서 그 물건을 짚는다.
   */
  const acts = useMemo<Act[]>(() => {
    /*
     * 「못 하는 까닭」을 여기서 짓던 것은 없앴다. 생산·공부 두 단추만
     * 그걸 썼고, 남은 단추들은 시트를 여는 일뿐이라 까닭이 없다 —
     * 페이즈 안에서 무엇이 왜 안 되는지는 Phase 가 제 자리에서 말한다.
     */
    /*
     * **이 방에서만 되는 것은 여기 없다.** 자판기·오락기·게시판·화분·
     * 종이·제조기·완성품은 맵에서 그 물건을 짚으면 옆에 차림표가 뜬다.
     * 손이 닿는 것에는 머리 위에 「!」가 선다(Walk). 아래 칸은 늘 같은
     * 넷이라, 서는 자리마다 단추가 바뀌어 손이 헛짚는 일이 없다.
     */
    /*
     * **페이즈에 토큰을 쓰는 길은 둘뿐이다** — 방을 먹는 것(자리
     * 차지·이동)과 연구. 전에는 여기에 생산·공부가 더 있었는데,
     * 토큰이 넷으로 갈리니 페이즈가 「무엇을 고르나」가 아니라
     * 「몇 개 남았나」가 됐다.
     */
    const fixed: Act[] = phaseOpen
      ? [
          // 페이즈의 일은 깃발이 먼저다. 누르면 행동 시트가 열리고 맨 위가 꽂기다
          { key: 'post', icon: 'plant', label: '깃발', run: () => setSheet('act') },
          { key: 'hand', icon: 'hand', label: '가방', run: () => setSheet('hand') },
        ]
      : [
          // 자유 시간에 하는 일. **「말」은 여기 없다** — 화면 아래에
          // 늘 떠 있는 줄로 옮겼다. 말하는 것이 생산·공부와 같은 칸에
          // 서 있으면, 한마디 건네는 일이 마음먹고 고르는 행동이 된다
          { key: 'hand', icon: 'hand', label: '가방', run: () => setSheet('hand') },
        ]
    /*
     * 「이 방」 칸은 없앴다. 방에서 하던 일은 물건을 짚어서 하고, 페이즈의
     * 일은 깃발 칸이 같은 시트를 연다 — 남은 것이 방 이름뿐이었다
     */
    const tail: Act[] = [{ key: 'atlas', icon: 'atlas', label: '전체 맵', run: () => setAtlas(true) }]
    return [...fixed, ...tail]
  }, [phaseOpen])

  /** 마지막 칸은 늘 더보기다. 설정과 보관함이 그 뒤에 있다 */
  const more: Act = { key: 'more', icon: 'more', label: '더 보기', run: () => setSheet('more') }
  const grid = [...acts, more]

  /*
   * ── 짚은 물건의 차림표 ─────────────────────────────────────
   *
   * 물건마다 할 수 있는 일이 한두 줄이다. **손이 안 닿으면 줄을 흐리고
   * 몇 칸 더 가야 하는지 적는다** — 눌러도 아무 일이 없는 것보다
   * 무엇이 모자란지 보이는 편이 낫다. 종이에는 「그냥 둔다」가 늘 있다.
   * 주울지 말지를 고르는 자리라서, 안 줍는 것도 고르는 것으로 둔다.
   */
  const THING_NAME: Record<TapThing['what'], string> = {
    board: '게시판',
    vending: '자판기',
    pot: '화분',
    maker: '제조기',
    lab: '연구 기계',
    arcade: '오락기',
    quiz: '문제 종이',
    slip: '쪽지',
    memo: '쪽지',
    scrap: '찢긴 종이',
  }
  // 머리줄은 「무엇 · 어디」. 멀고 가까운 것은 줄마다 적으니 여기 또 안 적는다
  const thingName = (t: TapThing) => THING_NAME[t.what]
  const thingSub = (t: TapThing) =>
    t.what === 'quiz' || t.what === 'slip' || t.what === 'memo' || t.what === 'scrap' ? '바닥' : t.name !== undefined && t.name !== THING_NAME[t.what] ? t.name : ''
  const thingRows = (t: TapThing): MeetRow[] => {
    const far = t.near ? null : `가까이 가야 한다 · ${t.steps} 칸`
    // 연구는 페이즈의 일이다. 자유 시간에는 까닭을 적는다
    const phaseOnly = far ?? (phaseOpen ? null : '페이즈 중에만 된다')
    const pick = (fn: () => void) => () => {
      setThing(null)
      fn()
    }
    const open = (key: string, label: string, id: SheetId): MeetRow => ({ key, label, why: far, onPick: pick(() => setSheet(id)) })
    const leave: MeetRow = { key: 'leave', label: '그냥 둔다', onPick: () => setThing(null) }
    switch (t.what) {
      case 'quiz':
        // 문제 종이는 줍지 않는다 — 펼쳐 보고, 맞히는 사람이 나올 때까지 바닥에 남는다
        return [{ key: 'take', label: '펼쳐 본다', why: far, onPick: pick(() => takePaper(t.cell)) }, leave]
      /*
       * **바닥의 쪽지는 네 가지다** — 비밀 쪽지도 메모(운영자 메모 · 빈
       * 종이)도 같다. 챙기면 바닥에서 사라지고 내 것이 된다(거래도 된다).
       * 읽으면 그 자리에 그대로 있다. 찢으면 찢긴 종이가 그 칸에 남는다
       */
      case 'slip':
      case 'memo':
        return [
          { key: 'take', label: '챙긴다', why: far, onPick: pick(() => takePaper(t.cell)) },
          { key: 'read', label: '읽는다', why: far, onPick: pick(() => onFloorMemo(t.cell, 'read')) },
          { key: 'tear', label: '찢는다', why: far, onPick: pick(() => onFloorMemo(t.cell, 'tear')) },
          leave,
        ]
      case 'scrap':
        return [
          {
            key: 'tape',
            label: '테이프로 붙인다',
            why: far ?? (countOf(state.view?.myItems, 'tape') > 0 ? null : '테이프가 있어야 한다'),
            onPick: pick(() => onFloorMemo(t.cell, 'tape')),
          },
          leave,
        ]
      case 'board':
        return [open('board', '심부름 보기', 'board')]
      case 'vending':
        return [open('shop', '고른다', 'shop')]
      case 'pot':
        return [open('garden', '들여다본다', 'garden')]
      case 'maker':
        // 맡기는 것은 페이즈에만이지만, 남이 안 찾아간 덫은 자유 시간에도 찾는다 — 시트가 가른다
        return [open('maker', '덫 만들기', 'maker')]
      case 'lab': {
        /*
         * **연구 기계 한 대에 한 건.** 짚은 기계가 지금 어떤지에 따라 한 줄이다 —
         * 비었으면 연구하기, 돌고 있으면 남은 시간, 다 됐으면 로봇 가져가기.
         * 다 된 것은 연구한 페이즈 동안 연구한 사람 것이고, 그 뒤로는 누구든
         */
        const i = LAB_MACHINES.findIndex((c) => c.x === t.cell.x && c.y === t.cell.y)
        const lab = (state.view?.labsHere ?? []).find((l) => l.i === i) ?? null
        const need = researchKnowledge(myTeam != null && state.tiles[LAB_TILE]?.ownerTeam === myTeam)
        const have = state.view?.teamVault?.knowledge ?? 0
        const research: MeetRow = {
          key: 'lab',
          label: `연구하기 · 지식 ${need}`,
          why: phaseOnly ?? (have < need ? `지식이 모자란다 · ${have}/${need}` : null),
          onPick: pick(() =>
            void act
              .phaseAct('research', { machine: i })
              .then(() => say(`연구를 걸었다. ${ACT_MINUTES.research} 분 뒤 이 기계에서 로봇을 가져간다.`))
              .catch((e) => refuse((e as Error).message)),
          ),
        }
        if (lab === null || lab.state === 'free') return [research]
        if (lab.state === 'mine') {
          const left = Math.max(0, (lab.readyAtMs ?? 0) - nowMs)
          return [{ ...research, why: `내 연구 중 · ${leftText(left)} 남았다` }]
        }
        if (lab.state === 'busy') return [{ ...research, why: '다른 사람이 연구 중이다' }]
        const madeId = lab.madeId
        return [
          {
            key: 'made',
            label: '로봇 가져가기',
            why: lab.state === 'locked' ? MADE_NO.notYours : far,
            onPick: pick(() =>
              void act
                .takeMade(madeId ?? '')
                .then((r) => say(String((r as { said?: string }).said ?? '가져갔다.')))
                .catch((e) => refuse((e as Error).message)),
            ),
          },
        ]
      }
      case 'arcade':
        // 앞자리에 앉아 있으면 켜고, 옆에 섰으면 그 자리로 가서 앉는다
        return t.seated
          ? [open('arcade', '켠다', 'arcade')]
          : [
              {
                key: 'sit',
                label: '앉는다',
                why: far,
                onPick: pick(() => {
                  setSitting(true)
                  t.sit?.()
                }),
              },
            ]
    }
  }
  const spill = acts.slice(5)

  /**
   * 우리 팀 넷이 지금 켜 두고 있는가.
   *
   * **live 문서가 곧 접속 표시다.** 걷는 동안만 적히므로 가만히 선
   * 사람은 잠시 뒤 흐려지는데, 그 편이 「켜 두고 자리를 비웠다」와
   * 「같이 있다」를 가르는 데는 오히려 맞다.
   */
  const mates = useMemo(() => {
    return (game?.seats ?? [])
      // 분단을 숨겨 둔 동안(null)은 아무도 같은 분단이 아니다
      .filter((sx) => me?.team != null && sx.team === me.team)
      .map((sx) => ({
        playerId: sx.playerId,
        here: sx.playerId === me?.playerId || live.current.has(sx.playerId),
      }))
  }, [game, me?.team, me?.playerId, live])

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
        {/* 지도를 짚으면 키보드가 내려간다. 말줄은 이 상자 바깥에
            있으므로, 여기 닿았다는 것은 곧 칸 바깥을 짚었다는 뜻이다 */}
        <div
          className="sc-pl__room"
          onPointerDownCapture={() => {
            if (!typing) return
            ;(document.activeElement as HTMLElement | null)?.blur()
          }}
        >
          <Walk
            me={{ playerId: me.playerId, team: me.team as TeamId, look }}
            looks={looks}
            live={live}
            onLive={(at) => pushLive(gameId, me.playerId, at)}
            onSelf={(x, y) => {
              selfCellRef.current = { x, y }
            }}
            view={state.view}
            tiles={state.tiles}
            nowMs={nowMs}
            padRef={padRef}
            /* 종이 치면 서버가 전선으로 옮겨 세운다. 화면도 그때 따라간다 */
            placeAtMs={phaseOpen ? (state.game?.phaseNow?.openedAtMs ?? null) : null}
            reenterCosts={phaseOpen}
            onCross={(to, at) => {
              // 자유 시간의 방 이동에는 시간이 들지 않는다. 문을 지나면
              // 바로 옆방이다 — 마주치라고 있는 시간이라 걸음에 쓰면
              // 아무도 안 움직인다. 값은 페이즈가 열릴 때 한 번 치른다
              // 페이즈 중에는 들어가는 데 토큰이 들고 5분이 걸린다.
              // 자유 시간에는 공짜고 즉시다
              const go = () => (phaseOpen ? act.phaseAct('move', { targetTile: to }) : act.roamTo(to, at))
              // **됐는지 안 됐는지를 돌려준다.** 안 돌려주면 화면이 대답을
              // 기다리는 채로 굳어서, 한 번 거절당한 뒤로는 어느 문도
              // 못 넘는다 — 실제로 그렇게 막혔다
              return go()
                /*
                 * **남의 자물쇠에 막혔고 락픽이 있으면 묻는다.** 미리 재지
                 * 않는다 — 안 보이는 방의 자물쇠는 화면에 안 내려오고,
                 * 막혔는지는 서버가 안다. 예면 따고 한 번 더 걷는다
                 */
                .catch((e: Error) => {
                  if (e.message !== LOCKED_DOOR || countOf(state.view?.myItems, 'lockpick') <= 0) throw e
                  return new Promise<boolean>((answer) => setPickAsk({ to, answer })).then((yes) => {
                    setPickAsk(null)
                    if (!yes) throw e
                    return act.useItem('lockpick', { tileId: to }).then(go)
                  })
                })
                .then((r) => {
                  const left = (r as { tokens?: number }).tokens
                  // 복도에서 들어서면 5분, 방 안에서 곧장 가면 나서는 5분이 더 붙는다 — 서버가 잰 값
                  const mins = (r as { minutes?: number }).minutes ?? MOVE_MINUTES
                  say(
                    phaseOpen
                      ? `${TILE_BY_ID[to].name}(으)로 간다. ${mins} 분 · 토큰 ${left ?? '?'} 개 남았다.`
                      : `${TILE_BY_ID[to].name}(으)로 들어갔다.`,
                  )
                  // 서버가 세운 칸 — 들어선 칸에 누가 있었으면 옆 빈 칸이다
                  const seat = (r as { at?: { x: number; y: number } | null }).at
                  return seat ? { x: seat.x, y: seat.y } : true
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
            onTapPerson={(id, at) => {
              setThing(null)
              setPerson({ id, at })
            }}
            /* 기물이나 종이를 짚었다 — 멀어도 온다. 옆에 차림표를 띄운다 */
            onTapThing={(t, at) => {
              setPerson(null)
              setThing({ t, at })
            }}
            /* 덫에 걸리면 서버가 세운 칸이다. 거기서 못 벗어난다 */
            pinAt={busyKind === '덫' && busyLeftMs > 0 ? (state.view?.mySnaredAt ?? null) : null}
            /* 머리 위에 잠깐 뜨는 말 */
            says={says}
            names={names}
            pops={pops}
            keepAbove={barTop}
            keepBelow={headBottom}
            /* 멈춰 선 자리를 서버가 알아야 「바로 옆 칸」을 판정한다.
               거절은 흘려보낸다 — 걷다 멈춘 자리를 못 적었다고 화면에
               빨간 글씨가 뜰 일은 아니다 */
            /* 서버가 거절한 칸이면 서버가 아는 칸으로 도로 선다 */
            bounce={bounce}
            onBlocked={(why) => showToast(why)}
            onStand={(x, y, via) => {
              setMyCell({ x, y })
              // 거절되면 돌아갈 자리. **보내기 전의** 서버 칸이다
              const was = state.view?.visiblePawns.find((p) => p.playerId === uid)?.at ?? null
              void act
                .standAt(x, y, via)
                .then((r) => {
                  const out = r as { ok?: boolean; code?: string; why?: string; at?: { x: number; y: number } | null }
                  // 누가 먼저 섰거나 물건이 있다 — 짧게 알리고 제자리로.
                  // **제자리는 서버가 돌려준 칸이다.** 방에 막 들어와 보내기 전 칸이
                  // 없던 사람도 서버가 빈 칸에 세워 돌려준다 — 안 돌아가면 남의 칸
                  // 위에 선 채로 남는다
                  const back = out?.at ?? was
                  if (out?.ok === false && (out.code === 'occupied' || out.code === 'blocked' || out.code === 'reenter') && back) {
                    showToast(out.why ?? '거기에는 설 수 없다.')
                    // Walk 는 아직 거절당한 그 칸(x,y)에 서 있을 때만 따른다 —
                    // 대답을 기다리는 사이 이미 걸어서 더 갔으면 지난 일이다
                    setBounce((b) => ({ x: back.x, y: back.y, n: (b?.n ?? 0) + 1, from: { x, y } }))
                    setMyCell({ x: back.x, y: back.y })
                  }
                })
                // 그 밖의 거절(문턱에 멈췄다 등)은 흘려보낸다 — 걷다 멈춘 자리를
                // 못 적었다고 빨간 글씨가 뜰 일은 아니다
                .catch(() => {})
            }}
            /* 게시판. 붙은 장수는 서버가 보내 준다 — 없으면 빈 판이다 */
            boards={BOARDS.map((b) => ({
              x: b.cell.x,
              y: b.cell.y,
              count: state.view?.boardCounts?.[b.id] ?? 0,
            }))}
            /* 바닥에 놓인 내 심부름 물건. 서버가 자리를 보내 줄 때만 있다 —
               남의 물건은 좌표째로 안 온다 */
            things={
              state.view?.myErrand?.thingAt
                ? [{ ...state.view.myErrand.thingAt, icon: state.view.myErrand.icon }]
                : []
            }
            /* 바닥의 종이 — 문제 종이와 비밀 쪽지. 보이는 칸 것만 서버가
               보내 준다. **접힌 것뿐이다** — 펴는 물건이 아니라 줍는 물건이다 */
            papers={floorPapers}
            /* 화분과 씨앗 상자. 정원에 서 있을 때만 서버가 보내 준다 */
            pots={
              (state.view?.potsHere?.length ?? 0) > 0
                ? (state.view?.potsHere ?? []).map((p) => ({
                    ...p.cell,
                    /* 열매는 **작물 색으로 구워 둔 한 장**을 집는다. 색은
                       이름이 보일 때만 오므로, 안 오면 그냥 흙빛 열매다 */
                    art: p.stage === 'fruit' && p.cropId ? `fruit:${p.cropId}` : POT_ART_OF[p.stage],
                  }))
                : []
            }
            /* 거래창이 열려 있는 동안에는 자리를 안 뜬다 */
            /* 거래 탁자에 앉아 있거나, 무언가 하느라 묶여 있으면 못 움직인다 */
            frozen={(deal !== null && deal.status !== 'done' && deal.status !== 'gone') || busyLeftMs > 0}
          />

          {/* 방 위에 얹는 것들. 줄을 따로 내주면 방이 그만큼 작아진다.
              **타이머는 시트가 올라와도 보여야 해서 여기 둔다** —
              시트는 화면의 70%까지만 올라온다 */}
          {/*
            머리 위 표시는 **두 층**이다. 한 줄에 다 넣었더니
            「DAY 1 · 자유 시간 · 홍시 커플 2-3 교실 · 아름답음 · D팀」이
            11px 로 늘어서서 무엇 하나 읽히지 않았다.
              1층 — 날짜 · 시계 · 나
              2층 — 지금 선 방 · 방 종류 · 보이는 인원/정원 · 팀 점수

            팀 점수는 전에 따로 한 층이었다. 셋이 쌓이니 방 위 윗머리를
            검은 판이 통째로 덮었고, 가운데 점수 판만 어둡게 떠서 맵과
            부딪혔다. 방 이름 줄 오른쪽 끝에 붙인다 — 둘 다 「이 판이
            지금 어떤가」라서 한 줄로 읽어도 섞이지 않는다.
          */}
          <header className="sc-pl__head">
            <div className="sc-pl__hud1">
              <span className="sc-pl__day">DAY {game.day}</span>
              <PhaseClock
                open={phaseOpen}
                no={phaseNo}
                endsAtMs={phaseEndsAtMs}
                nowMs={nowMs}
              />
              <span className="sc-pl__me">
                {/* 팀은 완장 색으로 먼저 읽힌다. **글자도 같이 둔다** —
                    색만으로 가르면 색을 못 가리는 사람에게는 팀이 없다 */}
                <i className="sc-pl__band" style={{ background: colorOfTeam(me.team) }} aria-label={`${teamName(me.team)}`}>
                  {teamNo(me.team)}
                </i>
                {seatName(me, game.seats.indexOf(me))}
              </span>
            </div>
            {/* 복도에 서 있으면 복도라고 쓴다. 말줄과 같은 이름을 쓴다 —
                한쪽은 「2-3 교실」, 한쪽은 「복도」면 어느 쪽이 참인지
                알 수 없다. 정원은 안 쓴다. 복도는 아무의 자리도 아니라
                차지할 수도, 넘칠 수도 없다.

                **줄은 늘 선다.** 방 이름이 없을 때(걷는 중)에도 팀 점수는
                떠 있어야 한다. 둘 다 없으면 CSS 가 빈 판을 접는다 */}
            <div className="sc-pl__hud2">
              {inHall ?
                <span className="sc-pl__where">{placeName(standingOn, myCell)}</span>
              : standingOn !== null && (
                <>
                  <span className="sc-pl__where">{TILE_BY_ID[standingOn].name}</span>
                  {KIND_MARK[ROOM_KIND[standingOn]] !== '' && (
                    <span className="sc-pl__kind" aria-hidden>{KIND_MARK[ROOM_KIND[standingOn]]}</span>
                  )}
                  {/* **보이는 사람만 센다.** 잠복한 사람은 서버가 안 보내
                      주므로 여기 없다 — 화면이 받아 놓고 숨기는 것이 아니다.

                      정원은 **페이즈에만** 적는다. 자유 시간에는 몇 명이든
                      들어오므로 「3/6」을 띄우면 없는 한도를 알려 주는 셈이다 */}
                  <span className="sc-pl__crowd">
                    {hereNow.length + 1}
                    {phaseOpen ? `/${capacityOf(standingOn)}` : ' 명'}
                  </span>
                </>
              )}
              {/* 팀마다 차지한 방. **늘 떠 있고**, 페이즈가 닫혀 주인이
                  바뀌면 몇 초 번쩍이며 +1·−1 을 붙인다. 줄 오른쪽 끝이다 */}
              <ScoreBar tiles={state.tiles} myTeam={me.team as TeamId} off={game.lastHours === true} />
            </div>
            {/*
              받아 둔 심부름. **늘 보인다** — 시트로 만들면 열어 봐야
              알고, 심부름은 「지금 뭘 하는 중인가」다. 안 받았으면 줄
              자체가 없으므로 평소에는 자리를 안 먹는다.

              **머리 판의 셋째 층이다.** 방 이름 아래에 붙인다. 흐름에
              두었더니 지도 맨 아래로 내려갔고, 말줄이 그 위를 덮었다 —
              말줄은 지도 위에 얹히는 고정 줄이라 흐름을 비켜 간다.
            */}
            <ErrandStrip view={state.view} act={act} onSaid={setSaid} />
            {/* 본인에게만 옅은 표시. 남에게는 위치 자체가 안 간다.
                **머리 판에 붙인다** — 지도 아래에 두었더니 말줄이 덮었다 */}
            {iAmInvisible && <p className="sc-pl__ghost">오늘 당신은 보이지 않습니다.</p>}
          </header>
          {miniOn && (
            <LiveMiniMap
              selfRef={selfCellRef}
              fallback={myCell ?? state.view?.visiblePawns.find((p) => p.playerId === me.playerId)?.at ?? null}
              tiles={state.tiles}
              pawns={state.view?.visiblePawns ?? []}
              meId={me.playerId}
              onOpen={() => setAtlas(true)}
            />
          )}
        </div>

        {/*
          말줄. **흐름 밖에 선다** — `position:fixed` 로 지도 위에 얹고
          키보드 높이만큼 띄운다(controls.css). 조작부 안에 두었을
          때는 키보드가 뜰 때마다 이 줄이 흐름에서 빠졌다 들어갔다
          하면서 지도가 그만큼 커졌다 작아졌다 했다 — 45px 이 캡처에
          잡혔다. 밖에 두면 지도의 상자는 처음부터 끝까지 그대로고,
          키보드는 그 위를 덮기만 한다.
        */}
        <Say
          hereName={placeName(standingOn, myCell)}
          act={act}
          onSaid={setSaid}
          lines={talkLines}
          pull={talk.pull}
          open={typing}
          onClose={blurNow}
          stuck={talk.stuck}
          self={{ playerId: me.playerId, name: me.name, team: me.team ?? null }}
          mute={iAmInvisible}
        />

        <div className="sc-ct">
          <Toast text={toast} />
          {/* 자유 시간에는 토큰 칸이 아예 없다. 쓸 데가 없는 숫자다 */}
          <ResourceRow
            tokens={phaseOpen ? (state.view?.myTeamTokens ?? null) : null}
            tokenLabel="분단 토큰"
            money={state.view?.myMoney ?? null}
            knowledge={state.view?.teamVault?.knowledge ?? null}
            mates={mates}
            teamColor={colorOfTeam(me.team)}
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
      {/*
        ── 「나」 탭 — 학생증과 생활기록부 ────────────────────
        여기 있는 것은 **전부 내 것**이다. 남에 대한 것(표·중요한 사람)
        은 수첩 탭으로 갔다 — 아침에는 열넷이 한 교실에 서 있어서 그
        목록 하나가 이 탭의 절반을 먹었다.
      */}
      <section className="sc-pl__tab" hidden={tab !== 'me'}>
        {/*
          **볼 때만 세운다.** hidden 인 채로 세워 두면 배경 눈 캔버스가
          폭 0 으로 잡히고, 탭을 열어도 눈이 한 톨도 안 내린다 — 눈은
          창 크기가 바뀔 때만 다시 재기 때문이다.
        */}
        {tab === 'me' && (
        <Me
          me={me}
          day={game.day}
          look={look}
          view={state.view}
          paper={mine.paper}
          paperErr={mine.err}
          paperRetry={mine.reload}
          invisible={iAmInvisible}
          invisibleName={invisibleName}
          hereIds={hereIds}
          hereName={placeName(standingOn, myCell)}
          seats={game.seats}
          snowLevel={state.game?.snow?.level ?? 5}
          slips={
            uid ? (
              <Slips
                view={state.view}
                act={act}
                onSaid={setSaid}
              />
            ) : null
          }
          inbox={state.inbox}
          onGo={goLink}
          act={act}
          onSaid={setSaid}
          onSignOut={() => {
            void logOut()
              .catch(() => undefined)
              .finally(() => location.reload())
          }}
        />
        )}
      </section>

      {/* ── 투표 탭 ───────────────────────────────────────────
          **투표용지 한 장뿐이다.** 목록에서 이름을 누르고 끝나면 표를
          던진 일이 설거지 같아진다 — 접어서 넣는 데 시간이 들어야
          되돌릴 수 없는 일로 느껴진다.

          신뢰·호감표와 털어놓기는 여기서 뺐다. 그쪽은 **마주 선
          사람에게** 하는 일이라 내 것들이 모인 「나」 탭으로 갔다 */}
      <section className="sc-pl__tab sc-pl__stage" hidden={tab !== 'vote'}>
        <Ballot
          me={me}
          seats={game.seats}
          /* 어제의 투명인간. 투표를 열면 game.invisibleId 는 비워지므로 날짜별 기록을 본다 — 서버(castBallot)와 같은 값 */
          invisibleId={game.invisibleByDay?.[game.day] ?? game.invisibleId ?? null}
          day={game.day}
          view={state.view}
          act={act}
          onSaid={setSaid}
          closed={ballotClosed}
          closedText={ballotCounted || ballotDay >= TOTAL_DAYS ? '마감되었다' : '아직 열리지 않았다'}
          closesInMin={ballotClosesInMin}
        />
      </section>

      {/* ── 무전 탭 ───────────────────────────────────────────
          방에 매이지 않는 유일한 말이다. 흩어져서도 팀이 팀으로
          움직이려면 떨어져서 말이 통해야 한다 */}
      <section className="sc-pl__tab sc-pl__radio" hidden={tab !== 'radio'}>
        <Radio
          me={{ ...me, team: myTeam }}
          act={act}
          onSaid={setSaid}
          /* 페이즈 중에는 열린 뒤로 얼마나 지났는지를 적는다 */
          phaseOpenedAtMs={phaseOpen ? (state.game?.phaseNow?.openedAtMs ?? null) : null}
          active={tab === 'radio'}
          onUnread={setRadioNew}
          people={game.seats}
          allOpen={game.allChannelClosed !== true}
          invisible={iAmInvisible}
        />
      </section>

      {/* ── 메모 탭 ───────────────────────────────────────────
          **나만 본다.** 어떤 판정에도 안 쓰고 운영자 대시보드에도
          안 나간다. 전에는 수첩 → 보관함 → 사람들로 두 겹 안이었다.

          남에게 보이는 화면이 아니라서 물건도 다르다 — 문은 구겨진
          투표용지, 투표 탭은 투표함, 여기는 책상에 펴 둔 수첩이다 */}
      <section className="sc-pl__tab sc-pl__scroll sc-nb-root" hidden={tab !== 'note'}>
        <p className="sc-nb__top">메모 · 열셋</p>
        {/* **책상에 붙인 메모지 열셋.** 한 장에 한 사람 — 짐작한 역할과
            한 줄 메모를 손글씨로 적는다. 마지막 답안지가 이것으로 채워진다 */}
        {uid && (
          <Notes
            gameId={gameId}
            meId={uid}
            classmates={game.seats
              .filter((sx) => sx.playerId !== uid)
              .map((sx) => ({ id: sx.playerId, name: sx.name, team: sx.team ?? null }))}
          />
        )}

        {/* 남에게 하는 일. **여기가 남을 적어 두는 자리다** —
            전에는 「나」 탭에 있었는데, 내 것들 사이에 남의 카드
            열셋이 끼어 있었다. 지난 페이즈 기록은 학생증 쪽으로 갔다 */}
        <h3 className="sc-nb__sub">지금 여기</h3>
        <Around
          me={me}
          seats={game.seats}
          day={game.day}
          hereIds={hereIds}
          nearIds={nearIds}
          hereName={placeName(standingOn, myCell)}
          invisibleId={game.invisibleId}
          act={act}
          onSaid={setSaid}
        />
        <button className="sc-nb__open" onClick={() => setArchive(true)}>보관함 열기</button>
      </section>

      {/* ── 탭바 ─────────────────────────────────────────────── */}
      <TabBar
        now={tab}
        onPick={(k) => pickTab(k as Tab)}
        onLocked={(label) => showToast(`${label} 탭은 감독관이 잠가 두었다.`)}
        tabs={[
          { key: 'map', icon: 'tabMap', label: '맵', locked: lockedTabs.has('map') },
          { key: 'me', icon: 'tabMe', label: '나', dot: hasUnseenNotice(gameId, uid ?? '', state.view?.notices), locked: lockedTabs.has('me') },
          { key: 'radio', icon: 'tabRadio', label: '무전', dot: radioNew > 0, locked: lockedTabs.has('radio') },
          { key: 'vote', icon: 'tabVote', label: '투표', locked: lockedTabs.has('vote') },
          { key: 'note', icon: 'tabNote', label: '메모', locked: lockedTabs.has('note') },
        ]}
      />

      {/* ── 전체 맵 ───────────────────────────────────────────
          전체 화면 오버레이. 여기만 두 손가락 확대를 허용한다 */}
      {atlas && (
        <FullMap
          facts={{ here: standingOn, meId: me.playerId, myTeam: myTeam, view: state.view, tiles: state.tiles }}
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
              ? '깃발 · 페이즈 행동'
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
              myCell={myCell}
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
                  lockedBy={lockedBy(far)}
                  onClose={() => setFar(null)}
                />
              )}
              {standingRoom ? (
                /* 생산·공부는 페이즈로 갔다. 자유 시간에 이 방에서
                   할 것은 만나는 일뿐이다 */
                <Actions tileId={standingRoom} where="here" lockedBy={lockedBy(standingRoom)} />
              ) : (
                <p className="sc-pl__none">복도에서는 할 것이 없다.</p>
              )}
            </>
          )}
        </Sheet>
      )}

      {/* 바닥에서 읽은 메모. **종이는 바닥에 그대로다** — 닫으면 끝이다 */}
      {floorRead !== null && (
        <Sheet title="쪽지" onClose={() => setFloorRead(null)}>
          <p className="sc-sl__line sc-fr__line">{floorRead.line}</p>
          <p className="sc-sl__note">바닥에 그대로 두었다.</p>
        </Sheet>
      )}

      {sheet === 'hand' && (
        <Sheet title="가방" onClose={closeSheet}>
          <Hand me={{ ...me, team: myTeam }} view={state.view} act={act} onSaid={setSaid} />
        </Sheet>
      )}

      {/* ── 맵에서 짚은 사람 ────────────────────────────────
          열세 명이 늘어선 목록은 없다. 눈앞에 선 사람 하나다.
          바텀시트가 아니라 **그 사람 옆에 붙는 작은 차림표**다 —
          창이 떠 있는 동안에도 누가 어디 섰는지가 맵에 보여야 한다 */}
      {/* ── 맵에서 짚은 물건 ───────────────────────────────
          사람과 같은 차림표다. **멀어도 뜬다** — 줄은 흐려지고 몇 칸 더
          가야 하는지가 적힌다. 걸어가 주지는 않는다 */}
      {thing && (
        <Meet
          name={thingName(thing.t)}
          team={null}
          sub={thingSub(thing.t)}
          at={thing.at}
          onClose={() => setThing(null)}
          rows={thingRows(thing.t)}
        />
      )}

      {person && (
        <Meet
          name={nameOf(person.id)}
          team={personTeam}
          at={person.at}
          onClose={() => setPerson(null)}
          rows={[
            /*
              **거래는 페이즈 중에도 한다.** 마주 선 둘이 물건을
              주고받는 일은 점령과 같이 일어나도 이상하지 않다.
              값도 안 든다 — 하루 열두 개짜리 거래 토큰을 없앴다
            */
            {
              key: 'deal',
              label: '거래하기',
              why: deal !== null ? '이미 거래 중이다' : !nextTo ? '바로 옆 칸에 서야 한다' : null,
              onPick: () => {
                const who = person.id
                setPerson(null)
                act
                  .askDeal(who)
                  .then(() => say('거래하자고 했다.'))
                  .catch((e) => refuse((e as Error).message))
              },
            },
            /*
              표. **거래와 같은 기준 — 바로 옆 칸이라야 한다.** 같은
              방만으로는 모자라다(캐릭터끼리 안 겹치게 자리를 잡으니
              정확히 같은 칸일 수도 없다). 종류마다 하루 한 장이고, 우리 팀에도
              준다. 서버도 같은 것을 본다(vote.ts 의 cellsTouch)
            */
            ...MEET_VOTES.map((k) => ({
              key: k,
              label: `${VOTE_LABEL[k]} 주기`,
              tone: 'vote' as const,
              why: !nextTo ? '바로 옆 칸에 서야 한다' : null,
              onPick: () => {
                const who = person.id
                setPerson(null)
                act
                  .castVote(who, k)
                  .then(() => say(`${VOTE_LABEL[k]}를 줬다.`))
                  .catch((e) => refuse((e as Error).message))
              },
            })),
            /* 우리 팀 사람에게는 꺼낼 말이 아니다. 아예 줄이 없다 */
            ...(personTeam !== null && personTeam !== me.team
              ? [
                  {
                    key: 'move',
                    label: '이적 제안하기',
                    tone: 'move' as const,
                    why: moveNo !== null ? TRANSFER_NO[moveNo] : null,
                    onPick: () => {
                      const who = person.id
                      setPerson(null)
                      act
                        .askTransfer(who)
                        .then(() => say('우리 분단으로 오겠느냐고 물었다.'))
                        .catch((e) => refuse((e as Error).message))
                    },
                  },
                ]
              : []),
          ]}
        />
      )}

      {/* ── 오락기 ──────────────────────────────────────────
          뒷골목 기계 앞자리에 앉은 사람만 연다. 다른 기계에 누가
          앉았는지는 보이는 사람으로 안다 — 안 보이는 사람은 서버가
          안 보냈으므로 여기에도 없다 */}
      {sheet === 'arcade' && myMachine !== null && (
        <Sheet title="오락기" onClose={closeSheet}>
          {phaseOpen ?
            <FreeTimeOnly what="오락실" />
          : <Arcade
              act={act}
              meId={me.playerId}
              machine={myMachine}
              seated={seatedAt}
              room={arcadeRoom}
              invites={arcadeInvites}
              onDismiss={dismissRoom}
            />
          }
        </Sheet>
      )}
      {/* 부름은 창이 닫혀 있어도 뜬다. 받으면 창이 열린다 */}
      {arcadeInvites[0] && sheet !== 'arcade' && !phaseOpen && (
        <ArcadeAsk
          room={arcadeInvites[0]}
          onAnswer={(yes) => {
            const r = arcadeInvites[0]
            if (yes && ARCADE_BY_ID[r.game].kind === 'live') unlockChip()
            ;(yes ? act.arcadeAnswer(r.id, true) : act.arcadeLeave(r.id))
              .then(() => {
                if (yes) setSheet('arcade')
              })
              .catch((e) => refuse((e as Error).message))
          }}
        />
      )}

      {/* ── 락픽 ────────────────────────────────────────────
          잠긴 문 앞에서 막혔을 때만 뜬다. 거래 신청과 같은 자리다 */}
      {pickAsk && (
        <div className="sc-da sc-da--pick" role="alertdialog" aria-label="자물쇠">
          <p className="sc-da__who">
            <b>{TILE_BY_ID[pickAsk.to].name}</b>
            <span>락픽 {countOf(state.view?.myItems, 'lockpick')} 개</span>
          </p>
          <p className="sc-da__say">{LOCKED_DOOR}</p>
          <p className="sc-da__say">락픽 1 개를 사용해 여시겠습니까?</p>
          <div className="sc-da__row">
            <button onClick={() => pickAsk.answer(false)}>아니요</button>
            <button className="is-on" onClick={() => pickAsk.answer(true)}>
              예
            </button>
          </div>
        </div>
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
      {moveLive && moveAsk.toId === me.playerId && (
        <TransferAsk
          fromName={nameOf(moveAsk.byId)}
          toTeam={moveAsk.byTeam}
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
      {moveLive && moveAsk.byId === me.playerId && (
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
            me={{ ...me, team: myTeam }}
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

      {/*
        **자판기는 시트가 아니다.** 제목 줄 달린 종이 위에 기계를
        얹으면 기계가 아니라 기계 그림이 된다 — 화면을 통째로 쓴다.
      */}
      {/*
        게시판. **복도에 서서 연다** — 방이 아니라 자리라, 시트를
        여는 길도 조작부가 아니라 옆에 선 게시판이다
      */}
      {sheet === 'board' && (
        <Sheet title="게시판" onClose={closeSheet}>
          {phaseOpen ?
            <FreeTimeOnly what="심부름" />
          : <BoardSheet view={state.view} act={act} onSaid={setSaid} onClose={closeSheet} />}
        </Sheet>
      )}

      {/* 화분. 정원 안에서만 열린다 — 씨앗 상자와 여덟 자리가 한 목록이다 */}
      {sheet === 'garden' && (
        <Sheet title="화분" onClose={closeSheet}>
          {phaseOpen && <FreeTimeOnly what="화분" />}
          <GardenSheet
            view={state.view}
            act={act}
            onSaid={setSaid}
            myCell={myCell}
            nearPot={(i) => beside(myCell, POT_CELLS[i])}
            phaseOpen={phaseOpen}
          />
        </Sheet>
      )}

      {/* 덫 제조기. 기술실에서 제조기 옆에 서서 탭하면 열린다 */}
      {sheet === 'maker' && (
        <Sheet title="덫 제조기" onClose={closeSheet}>
          <MakerSheet
            view={state.view}
            act={act}
            onSaid={setSaid}
            myCell={myCell}
            phaseOpen={phaseOpen}
            nowMs={nowMs}
            ownsTech={me.team != null && state.tiles[TECH_TILE]?.ownerTeam === me.team}
          />
        </Sheet>
      )}

      {sheet === 'shop' && phaseOpen && (
        <Sheet title={vendingHere?.name ?? '자판기'} onClose={closeSheet}>
          <FreeTimeOnly what="자판기" />
        </Sheet>
      )}

      {sheet === 'shop' && !phaseOpen && (
        <Vending
          where={vendingHere?.name ?? ''}
          money={state.view?.myMoney ?? 0}
          crops={state.view?.myCrops ?? {}}
          soldOut={state.view?.soldOutItems ?? []}
          act={act}
          onSaid={setSaid}
          onClose={closeSheet}
        />
      )}

      {/* 우리 팀 넷. **자원 줄을 누르면 여기가 열린다** — 작은 네모 넷만
          보고는 누가 누구인지 알 수 없다 */}
      {sheet === 'team' && (
        <Sheet title={`${teamName(me.team)}`} onClose={closeSheet}>
          <ul className="sc-pl__team">
            {mates.map((m) => (
              <li key={m.playerId}>
                <i className="sc-pl__teamDot" style={{ background: m.here ? colorOfTeam(me.team) : 'transparent' }} />
                <span>{nameOf(m.playerId)}</span>
                <span className="sc-pl__teamState">{m.here ? '접속 중' : '자리 비움'}</span>
              </li>
            ))}
          </ul>
          <ul className="sc-pl__teamNums">
            {/* **페이즈 상자는 넷이 나눠 쓴다.** 내 것이 아니라는 게 여기서
                보여야 한다 — 먼저 쓰는 사람이 임자다 */}
            <li><span>페이즈 토큰(분단 공용)</span><span>{state.view?.myTeamTokens ?? '—'}</span></li>
            <li><span>분단 지식</span><span>{state.view?.teamVault?.knowledge ?? '—'}</span></li>
          </ul>
        </Sheet>
      )}

      {sheet === 'more' && (
        <Sheet title="더 보기" onClose={closeSheet}>
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
            {/* 오래된 폰에서 접히고 떨어지는 장면이 끊기면, 안 보는 편이 낫다 */}
            <button
              onClick={() => {
                const next = !plain
                setPlain(next)
                setPlainState(next)
              }}
            >
              {plain ? '연출 켜기' : '연출 줄이기'}
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
            <SoundToggle />
            <button onClick={() => { closeSheet(); setArchive(true) }}>보관함</button>
            {/* 시트는 그대로 두고 위에 덮는다. 다 보고 나면 이 자리로 돌아온다 */}
            <ReplayPrologue />
          </div>
          {/*
            **나가는 문은 한 군데 더 있어야 한다.**
            여태 로그아웃은 「나」 탭 맨 아래에만 있었다. 맵을 보다가
            나가려면 탭을 옮기고 끝까지 내려야 나온다 — 설정이 여기
            있으니 나가는 것도 여기 있는 것이 맞다.
          */}
          <SignOut note={`들어와 있는 계정 · ${seatName(me, game.seats.indexOf(me))}`} />
          {/* **한 장으로 상태를 다 보이게 한다.** 「안 움직여요」만으로는
              어디가 막혔는지 알 수 없어서, 판이 지금 어떤 상태인지를
              그대로 적어 둔다. 숨긴 값은 없다 — 전부 내 화면이 이미
              아는 것들이다 */}
          <details className="sc-pl__why">
            <summary>지금 상태</summary>
            <ul>
              <li><span>날짜</span><span>DAY {game.day}</span></li>
              <li><span>시간</span><span>{phaseOpen ? `${phaseNo} 교시` : '자유 시간'}</span></li>
              <li><span>선 방</span><span>{standingOn ? TILE_BY_ID[standingOn].name : '걷는 중'}</span></li>
              <li><span>내 칸</span><span>{standingRoom ? TILE_BY_ID[standingRoom].name : (placeName(null, myCell) ?? '복도')}</span></li>
              <li>
                <span>옆방</span>
                <span>
                  {standingOn ? (ADJACENCY[standingOn] ?? []).map((n) => TILE_BY_ID[n].name).join(' · ') : '—'}
                </span>
              </li>
              <li><span>도착 대기</span><span>{arriveAtMs == null ? '없다' : `${Math.max(0, Math.ceil((arriveAtMs - nowMs) / 60000))} 분`}</span></li>
              <li><span>분단 토큰</span><span>{state.view?.myTeamTokens ?? '—'}</span></li>
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
          <p className="sc-pl__busyWhat">
            {busyKind === '덫' ? '덫에 걸렸다' : busyKind === '방에서 나가는' ? '방에서 나가는 중' : (busyKind ?? '하는 중')}
          </p>
          <p className="sc-pl__busyLeft">{leftText(busyLeftMs)}</p>
        </div>
      )}

      {said && (
        <p
          className={bad ? 'sc-pl__said is-bad' : 'sc-pl__said'}
          onClick={() => setSaid('')}
        >
          {said}
        </p>
      )}

      {/* 판정 팝업. 운영자가 보낸 날 중 아직 안 닫은 것이 있으면 어느
          탭에서든 뜬다 — 오래된 날부터 한 장씩 */}
      <MissionMailbox inbox={state.inbox} act={act} />
      {/* 모두에게 알린 결과. 내 종이를 다 닫은 뒤에 뜬다 */}
      <BoardMailbox gameId={gameId} boards={game.missionBoards} seats={game.seats} meId={me.playerId} waiting={unseenMails(state.inbox).length > 0} />
      {/* 운영자 공지 · 1위 발표 · 투명인간 발표. 판정 종이를 다 닫은 뒤에 뜬다 */}
      <NoticePop gameId={gameId} uid={me.playerId} notices={state.view?.notices} waiting={unseenMails(state.inbox).length > 0} />
      {/* 앱 안 알림 배너. 무엇을 띄울지는 서버가 이미 골랐다 */}
      <NotifyBanner notes={state.inbox?.notes} onGo={goLink} />
    </div>
  )
}

/** 떠오른 숫자가 머무는 시간. 한 번 읽을 만큼이다. */
const POP_MS = 1100

/**
 * 드나든 만큼을 머리 위로 띄운다.
 *
 * **숫자만 조용히 바뀌면 아무 일도 안 일어난 것과 같다.** 방에 들어설
 * 때 한 닢이 빠지는데, 자원 줄의 8 이 7 로 바뀐 것을 본 사람은 거의
 * 없었다 — 그때 눈은 지도를 보고 있다.
 */
function usePops(money: number | null, knowledge: number | null) {
  const [pops, setPops] = useState<{ key: string; text: string; down: boolean }[]>([])
  const had = useRef({ money, knowledge })
  useEffect(() => {
    const was = had.current
    had.current = { money, knowledge }
    const born: { key: string; text: string; down: boolean }[] = []
    const add = (before: number | null, now: number | null, label: string) => {
      if (before === null || now === null || before === now) return
      const d = now - before
      born.push({ key: `${label}-${Date.now()}-${d}`, text: `${d > 0 ? '+' : ''}${d} ${label}`, down: d < 0 })
    }
    add(was.money, money, '돈')
    add(was.knowledge, knowledge, '지식')
    if (born.length === 0) return
    setPops((old) => [...old, ...born])
    const t = window.setTimeout(() => {
      const gone = new Set(born.map((b) => b.key))
      setPops((old) => old.filter((p) => !gone.has(p.key)))
    }, POP_MS)
    return () => window.clearTimeout(t)
  }, [money, knowledge])
  return pops
}

/** 시계가 붉어지는 지점. 게임 속으로 열 분 남았을 때다. */
const LOW_MS = 10 * 60 * 1000

/**
 * 남은 시간. 게임 속 시계로 잰다. 1초에 한 번만 갱신한다 — 매 프레임
 * 다시 그리면 그것만으로 배터리가 눈에 띄게 준다.
 */
function PhaseClock({
  open,
  no,
  endsAtMs,
  nowMs,
}: {
  open: boolean
  no: number
  endsAtMs: number | null
  /** 게임 속 지금. 실제 시각이 아니다 — 판마다 시계가 따로 돈다 */
  nowMs: number
}) {
  if (!open || endsAtMs == null) {
    // 종이 쳐도 어느 방으로 되돌아가지 않는다 — 모두 복도에서 시작한다.
    // 「종이 치면 ○○」 같은 안내는 틀린 말이라 안 붙인다
    return <span className="sc-pl__clock">자유 시간</span>
  }
  const left = Math.max(0, endsAtMs - nowMs)
  const mm = Math.floor(left / 60000)
  const ss = Math.floor((left % 60000) / 1000)
  // 한 교시는 예순 분이다. 마지막 열 분은 붉게 깜빡여서, 숫자를 읽지
  // 않고 곁눈으로도 「이제 곧 종이 친다」가 보이게 한다
  const low = left <= LOW_MS
  return (
    <span className={'sc-pl__clock is-on' + (low ? ' is-low' : '')}>
      {no} 교시 {mm}:{String(ss).padStart(2, '0')}
    </span>
  )
}

/**
 * 지금 글을 쓰고 있는가.
 *
 * **화면을 끌어당기지 않는다.** 전에는 초점이 가면 0.26초 뒤에
 * `scrollIntoView({block:'center'})` 를 불렀다 — 화면이 훌쩍 올라갔고,
 * 조작부가 사라지며 또 움직였다. 누를 때마다 두 번 뛰었다.
 */
function useTyping(): boolean {
  const [typing, setTyping] = useState(false)
  useEffect(() => {
    const on = (e: FocusEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag !== 'INPUT' && tag !== 'TEXTAREA') return
      setTyping(true)
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

// 키보드 높이는 useKeyboardInset.ts 로 갔다 — 무전 탭도 같은 값을 봐야 한다

// ── 묶기 ────────────────────────────────────────────────────────

export function Play() {
  // 껍데기만 미리 쥔다. 지하철에서 앱을 다시 켜도 흰 화면이 안 뜬다
  useStaticCache()
  const [ready, setReady] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  // 계정을 아직 못 읽었으면 undefined. 없으면 null
  const [me, setMe] = useState<{ nickname: string; avatar: AvatarLook | null; prologueSeen?: boolean } | null | undefined>(undefined)
  const state = useGame(signedIn ? GAME_ID : null)
  const act = useMemo(() => gameActions(GAME_ID), [])
  /*
   * 배경음악. 감독관이 고른 곡(1~4)을 튼다 — 날이 바뀌어도 저절로 안 바뀐다.
   * 감독관이 언제든 틀고 끄고, 각자 「나」 탭에서 끈다
   */
  useBgm(GAME_ID, bgmTrack(state.game?.bgm), state.game?.bgm, Boolean(state.game))

  /**
   * 엔딩 송출 — 지금 어느 화면에 있든 그 위로 뜬다.
   *
   * **한 번 뜨면 「닫기」를 누르기 전에는 안 사라진다.** 재생이 끝나는
   * 순간 서버에 「봤다」고 적히는데(FinalNoteOverlay), 그 값이 실시간
   * 으로 돌아와도 여기서 다시 검사하면 오버레이가 스스로 사라져
   * 버린다 — 닫기는 사람이 누르는 것이지 서버 값이 대신 눌러 주는
   * 것이 아니다. 그래서 「이 atMs 는 이미 띄웠다」를 따로 기억한다.
   */
  const broadcastAtMs = state.game?.endingBroadcast?.atMs ?? null
  const seenAtMs = state.view?.myEndingSeenAtMs ?? null
  const shownForAtMsRef = useRef<number | null>(null)
  const [endingOverlayOn, setEndingOverlayOn] = useState(false)
  useEffect(() => {
    if (broadcastAtMs === null) return
    const alreadySeen = seenAtMs !== null && seenAtMs >= broadcastAtMs
    if (!alreadySeen && shownForAtMsRef.current !== broadcastAtMs) {
      shownForAtMsRef.current = broadcastAtMs
      setEndingOverlayOn(true)
    }
  }, [broadcastAtMs, seenAtMs])

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
      if (!done) setMeError('늦다')
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

  if (!firebaseConfigured) return <p className="sc-pl__wait">접속에 실패했다.</p>
  if (!ready) return null
  if (!signedIn) return <Gate onIn={() => setSignedIn(true)} />
  if (meError !== null) return <Waiting what="내 계정" error={meError} onRetry={loadMe} />
  if (me === undefined) return <Waiting what="내 계정" error={null} onRetry={loadMe} />

  // 가입 다음은 나를 만드는 자리다. 이름이 없으면 아직 안 만든 것이다
  if (!me || !me.nickname) {
    return <Setup first={me ?? { nickname: '', avatar: null }} onDone={loadMe} />
  }

  /*
   * **나를 만든 바로 다음이 프롤로그다.** 한 번만 돈다 — 칠판의 「들어간다」를
   * 눌러야 계정에 「봤다」가 붙는다. 중간에 앱을 닫으면 붙지 않았으니 다음
   * 접속 때 처음부터 다시 돈다.
   */
  if (!me.prologueSeen) {
    return (
      <Prologue
        onDone={() => {
          // 못 적어도 들여보낸다. 다음 접속 때 한 번 더 보게 될 뿐이다
          void markPrologueSeen().catch(() => undefined)
          setMe({ ...me, prologueSeen: true })
        }}
      />
    )
  }

  const phase = state.game?.phase
  const content =
    phase === 'running' || phase === 'finished' ? (
      <Running gameId={GAME_ID} look={me.avatar} />
    ) : (
      <Lobby gameId={GAME_ID} me={me} />
    )

  const myUid = auth?.currentUser?.uid ?? null
  return (
    <>
      {content}
      {/* 답안지 · 채점 결과. 감독관이 띄우면 어느 화면에 있든 그 위로 뜬다 */}
      {state.game && myUid && phase !== 'lobby' && (
        <>
          <AnswerSheet game={state.game} gameId={GAME_ID} uid={myUid} act={act} />
          <AnswerResult game={state.game} gameId={GAME_ID} uid={myUid} act={act} />
        </>
      )}
      {endingOverlayOn && <FinalNoteOverlay act={act} onClose={() => setEndingOverlayOn(false)} />}
    </>
  )
}

import { teamName, teamNo } from '../../../shared/rules/bundan'
import { AnswerResult, AnswerSheet } from './AnswerSheet'
import { bgmTrack, useBgm } from './bgm'