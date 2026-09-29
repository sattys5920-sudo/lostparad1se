// 판 하나를 구독한다.
//
// 화면은 **읽기만** 한다. 무엇을 하려면 서버 함수를 부르고, 결과는
// 구독 중인 문서가 바뀌면서 돌아온다. 화면이 먼저 그려 놓고 나중에
// 맞추는 식(낙관적 갱신)을 쓰지 않는다 — 서버가 거절했는데 화면에는
// 된 것처럼 남아 있으면 그게 제일 나쁘다.
//
// 읽는 곳은 넷뿐이다.
//
//   games/{id}              날·눈발·투명인간처럼 모두가 아는 것
//   games/{id}/views/{uid}  **내 몫.** 안개를 거쳐 깎인 것
//   games/{id}/teams/{t}    자원과 순위
//   games/{id}/tiles/{t}    칸 주인
//
// 말의 위치도, 남의 손패도, 표도 여기 없다. 규칙이 막아서가 아니라
// 서버가 애초에 담지 않아서다.
import type { Day4Choice } from '../../../shared/rules/choices'
import { useEffect, useMemo, useState } from 'react'
import { collection, doc, onSnapshot } from 'firebase/firestore'

import type { InboxDoc } from '../../../shared/missions/mail'

import { auth, callServer, db } from '../../firebase'
import { applyProbe, isStale } from './skew'
import type { DevClock } from '../../../shared/rules/clock'
import type { GameDoc, PlayerViewDoc, TeamDoc, TileDoc } from '../../../shared/model'
import type { TeamId } from '../../../shared/rules/v2'
import type { TileId } from '../../../shared/rules/board'

export interface GameState {
  /** 아직 아무것도 못 읽었으면 true. */
  loading: boolean
  game: GameDoc | null
  /** 내 몫. 로그인 전이거나 판에 없으면 null. */
  view: PlayerViewDoc | null
  /** 우편함 — 운영자가 보낸 내 미션 판정. 본인만 읽는다 */
  inbox: InboxDoc | null
  teams: Partial<Record<TeamId, TeamDoc>>
  tiles: Partial<Record<TileId, TileDoc>>
  /** 페이즈가 끝날 때마다 한 줄씩. 무슨 일이 있었는지 여기 남는다. */
  phaseLog: { no: number; day: number; lines: PhaseLogLine[] }[]
  error: string | null
}

export interface PhaseLogLine {
  kind: string
  playerId?: string
  tileId?: TileId
  team?: TeamId
  targetPlayer?: string
  targetRobot?: string
  why?: string
}

const EMPTY: GameState = { loading: true, game: null, view: null, inbox: null, teams: {}, tiles: {}, phaseLog: [], error: null }

/**
 * 판을 구독한다.
 *
 * uid가 없으면 내 몫은 안 붙는다 — 규칙이 거절할 요청을 보내 봐야
 * 콘솔만 빨개진다.
 */
/**
 * 판 문서 스냅샷 하나를 받아 들고 있을 값을 정한다.
 *
 * **캐시가 흘린 빈 답을 「없어졌다」로 받지 않는다.**
 *
 * 연결이 끊겼다 붙는 사이 Firestore 는 로컬 캐시에서 한 번 답한다.
 * 그 캐시에 판 문서가 없으면 빈 스냅샷이 오고, 그것을 그대로 받으면
 * 화면이 「판이 없다」로 갔다가 다음 스냅샷에 돌아온다 — 그 한 번에
 * Running 이 새로 서고 아침 시퀀스가 처음부터 다시 돈다. 지하철에서
 * 몇 분마다 번쩍거리며 튕긴 것이 이것이다.
 *
 * **서버가 없다고 한 것만 없는 것이다.** 아직 아무것도 못 받았으면
 * 캐시가 없다고 해도 그대로 받는다 — 판이 정말 없을 수도 있으니
 * 「불러오는 중」에 영영 묶어 두면 안 된다.
 *
 * 화면 밖으로 떼어 둔 것은 시험을 붙이려고다. 끊겼다 붙는 순간은
 * 브라우저로 만들기 어렵지만, 판단 자체는 여기서 다 볼 수 있다.
 */
export function nextGame(
  had: GameDoc | null,
  snap: { exists: boolean; fromCache: boolean; data: GameDoc | undefined },
): GameDoc | null {
  if (!snap.exists && snap.fromCache && had) return had
  return snap.data ?? null
}

export function useGame(gameId: string | null): GameState {
  const [state, setState] = useState<GameState>(EMPTY)
  const uid = auth?.currentUser?.uid ?? null

  useEffect(() => {
    if (!db || !gameId) {
      setState({ ...EMPTY, loading: false })
      return
    }
    const base = doc(db, 'games', gameId)
    const stop: (() => void)[] = []
    const fail = (e: unknown) => setState((s) => ({ ...s, loading: false, error: (e as Error).message }))

    /*
     * **기기 시계 보정.** 들어올 때 한 번, 화면이 다시 켜질 때(잠금 해제·
     * 탭 복귀) 오래됐으면 다시 서버 시각을 묻는다. 그 차이를 skew.ts 가
     * 들고 있고 useGameNow 가 모든 타이머에 더한다. 실패해도 조용하다 —
     * 보정 없이 기기 시각으로 간다
     */
    let latestClock: DevClock | undefined
    const probe = async () => {
      if (!uid) return
      const sent = Date.now()
      try {
        const out = await callServer<{ nowMs: number }>('clockNow', { gameId })
        applyProbe(out.nowMs, latestClock, sent, Date.now())
      } catch {
        /* 다음에 다시 */
      }
    }
    const onShow = () => {
      if (document.visibilityState === 'visible' && isStale()) void probe()
    }
    document.addEventListener('visibilitychange', onShow)
    stop.push(() => document.removeEventListener('visibilitychange', onShow))

    stop.push(
      onSnapshot(
        base,
        (snap) =>
          setState((s) => ({
            ...s,
            loading: false,
            game: nextGame(s.game, {
              exists: snap.exists(),
              fromCache: snap.metadata.fromCache,
              data: snap.data() as GameDoc | undefined,
            }),
          })),
        fail,
      ),
    )
    stop.push(
      onSnapshot(base, (snap) => {
        const g = snap.data() as GameDoc | undefined
        if (!g || snap.metadata.fromCache) return
        latestClock = g.clock
        if (isStale()) void probe()
      }),
    )
    // 팀 문서는 **우리 팀 것 하나만** 본다.
    //
    // 전에는 네 팀을 통째로 구독했다. 금고와 오늘의 주장이 여기 있어서,
    // 그 구독 하나로 남의 돈·지식·주장이 다 보였다. 규칙에서 남의 팀
    // 문서를 닫았으므로 목록 읽기는 이제 거절당한다 — 내 것만 청한다.
    if (uid) {
      let stopTeam: (() => void) | null = null
      let watching: TeamId | null = null
      stop.push(
        onSnapshot(base, (snap) => {
          const g = snap.data() as GameDoc | undefined
          const mine = g?.seats.find((x) => x.playerId === uid)?.team ?? null
          // 시작 전에는 팀 문서가 아직 없다. 자리에는 앉았어도 말이
          // 없으니, 규칙이 소속을 확인할 길이 없어 거절한다 — 청하지
          // 않는다. 시작하면 이 구독이 다시 깨어나 그때 청한다
          if (!mine || !g?.startedAtMs || mine === watching) return
          watching = mine
          stopTeam?.()
          stopTeam = onSnapshot(
            doc(base, 'teams', mine),
            (d) => setState((s) => ({ ...s, teams: { [mine]: d.data() as TeamDoc } })),
            fail,
          )
        }, fail),
      )
      stop.push(() => stopTeam?.())
    }
    stop.push(
      onSnapshot(
        collection(base, 'tiles'),
        (snap) => {
          // 빈 캐시 답에 방 임자를 지우면 지도 색이 통째로 깜빡인다
          if (snap.empty && snap.metadata.fromCache) return
          const tiles: Partial<Record<TileId, TileDoc>> = {}
          snap.forEach((d) => (tiles[d.id as TileId] = d.data() as TileDoc))
          setState((s) => ({ ...s, tiles }))
        },
        fail,
      ),
    )
    stop.push(
      onSnapshot(
        collection(base, 'phaseLog'),
        (snap) => {
          if (snap.empty && snap.metadata.fromCache) return
          const rows = snap.docs
            .map((d) => d.data() as { no: number; day: number; lines: PhaseLogLine[] })
            .sort((a, b) => a.no - b.no)
          setState((s) => ({ ...s, phaseLog: rows }))
        },
        fail,
      ),
    )
    if (uid) {
      stop.push(
        onSnapshot(
          doc(base, 'views', uid),
          (snap) => {
            // 내 몫이 잠깐 비면 보이는 사람이 통째로 사라졌다 나타난다
            if (!snap.exists() && snap.metadata.fromCache) return
            setState((s) => ({ ...s, view: (snap.data() as PlayerViewDoc) ?? null }))
          },
          fail,
        ),
      )
      stop.push(
        onSnapshot(
          doc(base, 'inbox', uid),
          (snap) => setState((s) => ({ ...s, inbox: (snap.data() as InboxDoc | undefined) ?? null })),
          // 우편함이 막혀도 판은 돈다 — 화면 전체를 오류로 바꾸지 않는다
          () => undefined,
        ),
      )
    }
    return () => stop.forEach((f) => f())
  }, [gameId, uid])

  return state
}

// ── 서버에 시키는 것들 ──────────────────────────────────────────
//
// 이름을 규칙 용어 그대로 둔다. 화면에서 부르는 말과 서버 함수 이름이
// 다르면 어디가 거절했는지 찾기 어려워진다.

export function gameActions(gameId: string) {
  const g = { gameId }
  return {
    /** 밀린 일을 따라잡는다. 화면이 열릴 때와 오래 있다가 돌아올 때. */
    tick: () => callServer('tick', g),

    // ── 운영자만 ────────────────────────────────────────────────
    // 화면에서 막지 않는다. 운영자가 아니면 서버가 거절한다.
    createGame: (seed?: string) => callServer('createGame', { ...g, ...(seed ? { seed } : {}) }),
    /**
     * 판을 첫날로 되돌린다. **앉은 자리는 남는다.**
     *
     * 돌아온 곳은 로비다 — 「닷새 시작」을 다시 눌러야 돈다.
     */
    resetGame: () => callServer('resetGame', g),
    /**
     * 명단의 얼굴만 계정에서 다시 읽는다.
     *
     * 앉을 때 찍어 둔 얼굴이 비어 있으면 그 사람은 점으로 뜬다.
     * 돌고 있는 판을 되돌리지 않고 고치는 자리다.
     */
    refreshFaces: () => callServer('refreshFaces', g),
    /**
     * 주인 없는 자리를 비운다. **아직 시작 안 한 판에서만.**
     *
     * 계정을 지워도 명단은 남는다. 로비에서는 그 자리가 그냥 막힌
     * 자리가 되어, 새로 가입한 사람이 「자리가 없다」를 듣는다.
     */
    sweepSeats: () => callServer('sweepSeats', g),
    /**
     * 달력 한 칸을 손으로 넘긴다.
     *
     * 시계가 날을 바꾸지 않는다. 정산도 끝나는 것도 여기서 민다 —
     * 세워 둔 사이에 닷새가 지나가 엔딩만 남는 일을 막는다.
     */
    pushDay: () => callServer('pushDay', g),
    /** 다음에 무엇을 넘기게 되는가. 누르기 전에 보여 준다. */
    peekDay: () => callServer('peekDay', g),
    /** 내 학생증과 생활기록부. **서버가 내 몫만 깎아서 준다** */
    myPaper: () => callServer('myPaper', g),
    // ── 알림 ──
    notifyConfig: () => callServer('notifyConfig', {}),
    setNotifySettings: (settings: unknown) => callServer('setNotifySettings', { ...g, settings }),
    pushSubscribe: (sub: unknown) => callServer('pushSubscribe', { ...g, sub }),
    pushUnsubscribe: (endpoint: string) => callServer('pushUnsubscribe', { ...g, endpoint }),
    readNotes: () => callServer('readNotes', g),
    /** 판정 팝업을 닫았다 */
    seenMissionDay: (day: number) => callServer('seenMissionDay', { ...g, day }),
    // ── 페이즈 ──────────────────────────────────────────────────
    /** 자유 시간에 옆방으로. 즉시 간다. 전선은 안 움직인다. */
    roamTo: (tileId: TileId, at?: { x: number; y: number }) => callServer('roamTo', { ...g, tileId, ...(at ? { at } : {}) }),
    /**
     * 방 안 어디에 섰는지 적는다. **걸음을 멈출 때 한 번만.**
     *
     * 거래가 이것을 본다 — 같은 방이 아니라 바로 옆 칸이라야 한다.
     */
    standAt: (x: number, y: number, via: { x: number; y: number }[] = []) =>
      callServer('standAt', { ...g, x, y, ...(via.length > 0 ? { via } : {}) }),
    /** 이번 페이즈에 할 일. 닫히기 전까지는 바꿀 수 있다. */
    phaseAct: (
      kind: string,
      t: { targetTile?: TileId; targetPlayer?: string; targetRobot?: string; targetTeam?: string; machine?: number } = {},
    ) => callServer('phaseAct', { ...g, kind, ...t }),
    phaseNow: () => callServer('phaseNow', g),
    takeSlip: (slipId: string) => callServer('takeSlip', { ...g, slipId }),
    readSlip: (slipId: string) => callServer('readSlip', { ...g, slipId }),
    dropSlip: (slipId: string) => callServer('dropSlip', { ...g, slipId }),
    tearSlip: (slipId: string) => callServer('tearSlip', { ...g, slipId }),
    // ── 심부름 ────────────────────────────────────────────
    /** 게시판 앞에서 한 장 받는다. 한 번에 하나뿐이다. */
    takeErrand: (errandId: string) => callServer('takeErrand', { ...g, errandId }),
    /** 출발 방에서 내 물건을 집는다. */
    pickUpThing: () => callServer('pickUpThing', g),
    /** 도착 방에 놓는다. **먼저 놓은 사람이 가진다.** */
    dropThing: () => callServer('dropThing', g),
    // ── 화분 ──────────────────────────────────────────────
    /** 열매를 딴다. **심은 것이 운영자든 누구든 앞에 선 사람이 딴다** */
    harvestPot: (pot: number) => callServer('harvestPot', { ...g, pot }),
    /** 시든 것을 치운다. */
    clearPot: (pot: number) => callServer('clearPot', { ...g, pot }),
    /** 매입구에 작물 하나를 넣는다. **값은 표대로다** */
    sellCrop: (cropId: string) => callServer('sellCrop', { ...g, cropId }),
    /** 운영자 — 화분 여덟의 지금 모습. 흙 속까지 보인다 */
    hostGarden: () => callServer('hostGarden', g),
    /** 운영자 — 빈 화분에 심는다. 작물을 고르지 않으면 서버가 뽑는다 */
    hostPlant: (pot: number, cropId?: string) => callServer('hostPlant', { ...g, pot, cropId }),
    /** 운영자 — 화분을 비운다. 시들지 않았어도 뽑는다 */
    hostPullPot: (pot: number) => callServer('hostPullPot', { ...g, pot }),

    /** 그만둔다. 남은 사람은 계속한다. */
    giveUpErrand: () => callServer('giveUpErrand', g),
    /** 운영자 — 풀과 판 위의 상황. */
    hostErrands: () => callServer('hostErrands', g),
    hostPostErrand: (specId: string, boardId: string, to: TileId) =>
      callServer('hostPostErrand', { ...g, specId, boardId, to }),

    /**
     * 손으로 쓰는 물건 하나를 쓴다 — 자물쇠 · 빈 종이 · 지우개 · 테이프.
     *
     * 문이 하나다. 무엇이 일어나는지는 서버가 정하고, 화면은 무엇을
     * 적어 냈는지만 보낸다.
     */
    useItem: (kind: string, more: { text?: string; scrapId?: string } = {}) =>
      callServer('useItem', { ...g, kind, ...more }),
    /** 문제 종이를 펼친다. **그 방 사람 전원에게 보이게 된다.** */
    /** 문제 종이를 줍는다. **손패에 들어온다** — 옆 칸에 서야 한다 */
    takeQuiz: (paperId: string) => callServer('takeQuiz', { ...g, paperId }),
    /** 기술실 제조기에 덫을 맡긴다. 내 돈 3코인, 페이즈에만 */
    commissionTrap: (maker: number) => callServer('commissionTrap', { ...g, maker }),
    /** 다 된 덫을 찾는다. 맡긴 페이즈 동안은 맡긴 사람만, 그 뒤로는 누구든 */
    takeTrap: (maker: number) => callServer('takeTrap', { ...g, maker }),
    /** 답을 낸다. 채점은 서버가 한다 — 화면은 정답을 모른다. */
    answerQuiz: (paperId: string, given: string) => callServer('answerQuiz', { ...g, paperId, given }),
    /** 오늘의 투명인간 투표. 한 명을 적는다 — 기권은 없다. */
    castBallot: (targetId: string) => callServer('castBallot', { ...g, targetId }),
    /** 운영자가 오늘의 투명인간을 푼다. 사유를 남긴다. */
    clearInvisible: (reason: string) => callServer('clearInvisible', { ...g, reason }),
    /** 문제 은행을 본다. **운영자만** — 정답과 해설이 여기서만 나온다. */
    hostQuizList: () => callServer('hostQuizList', g),
    /** 비밀 쪽지 판. 사람마다 나간 장수와 바닥에 남은 자리. **운영자만.** */
    /** 쪽지 56장 배포판. 운영자만 — 문안 전문이 온다 */
    hostSlipBoard: () => callServer('hostSlipBoard', g),
    hostPapers: () => callServer('hostPapers', g),
    hostRadioOverview: () => callServer('hostRadioOverview', g),
    /** 투명인간 투표를 연다 · 닫는다(닫으면 그 자리에서 센다) */
    hostOpenBallot: () => callServer('hostOpenBallot', g),
    hostCloseBallot: () => callServer('hostCloseBallot', g),
    /** 개발용 시계 — 이 시각부터 이 배속으로 */
    setDevClock: (anchorGameMs: number, speed: number) => callServer('setDevClock', { ...g, anchorGameMs, speed }),
    /** 전원 채널을 여닫는다 */
    hostSetAllChannel: (open: boolean) => callServer('hostSetAllChannel', { ...g, open }),
    /** 운영자 지도 — 열넷의 자리와 하는 일. 문안 · 역할은 없다 */
    hostLiveMap: () => callServer('hostLiveMap', g),
    /** 운영자 — 방에서 오간 말. room 은 방 아이디 · 'hall' · 'all'. summary 면 방마다 줄 수 */
    hostRoomChat: (room: string | null, sinceMs = 0, summary = false) =>
      callServer('hostRoomChat', { ...g, room, sinceMs, summary }),
    /** 알림 보낸 기록 — 최근 200줄 · 실패 수 */
    hostNotifyLog: () => callServer('hostNotifyLog', g),
    /** QA — 시각순 로그. sinceMs 뒤만 · kinds 만 · limit 을 넘으면 최근 */
    hostEventLog: (o: { sinceMs?: number; untilMs?: number; kinds?: string[]; limit?: number } = {}) => callServer('hostEventLog', { ...g, ...o }),
    /** QA — 불변식을 지금 검사하고 쌓인 기록과 함께 돌려준다 */
    hostInvariants: () => callServer('hostInvariants', g),
    /** 사람마다 받은 표 — 종류별 합계. 누가 줬는지는 안 온다 */
    hostVotes: () => callServer('hostVotes', g),
    /** 투명인간 투표 — 그날(기본은 오늘) 누가 누구를 적었는지 그대로. 운영자만 */
    hostBallots: (day?: number) => callServer('hostBallots', { ...g, ...(day !== undefined ? { day } : {}) }),
    /** 날짜별 개인 미션 판정. 날을 안 주면 가장 최근 날 */
    hostMissionDay: (day?: number) => callServer('hostMissionDay', { ...g, ...(day ? { day } : {}) }),
    /** 한 사람의 그날 결과를 뒤집는다. null 이면 뒤집기를 거둔다. 까닭은 꼭 */
    hostMissionOverride: (day: number, playerId: string, status: 'met' | 'failed' | null, reason: string) =>
      callServer('hostMissionOverride', { ...g, day, playerId, status, reason }),
    /** 그날 판정을 보낸다. playerIds 를 안 주면 전부 */
    hostMissionSend: (day: number, playerIds?: string[]) =>
      callServer('hostMissionSend', { ...g, day, ...(playerIds ? { playerIds } : {}) }),
    /** 짝사랑의 오늘 대상 — 후보와 지금 값 */
    hostCrushTarget: () => callServer('hostCrushTarget', g),
    /** 짝사랑의 오늘 대상을 정한다. targetId 를 안 주면 거둔다 */
    hostSetCrushTarget: (targetId?: string | null) => callServer('hostSetCrushTarget', { ...g, targetId }),
    hostRadioLines: (channel: string, sinceMs = 0) => callServer('hostRadioLines', { ...g, channel, sinceMs }),
    /** 한 장을 고른 방에 뿌린다. 2짝을 DAY 3 전에 뿌리려면 confirmEarly */
    hostScatterSlip: (noteId: string, tileId: string, confirmEarly = false) =>
      callServer('hostScatterSlip', { ...g, noteId, tileId, confirmEarly }),
    /** 대기 중인 것에서 n장을 골라 빈 방에 흩는다 */
    hostScatterRandom: (n: number) => callServer('hostScatterRandom', { ...g, n }),
    /** 아직 아무도 안 주운 쪽지를 거둔다. 그 사람 몫 한 자리가 다시 빈다. */
    hostPullSlip: (slipId: string) => callServer('hostPullSlip', { ...g, slipId }),
    hostQuizUpsert: (quiz: unknown, id?: string) => callServer('hostQuizUpsert', { ...g, id, quiz }),
    hostQuizRemove: (id: string) => callServer('hostQuizRemove', { ...g, id }),
    /**
     * 바닥에 한 장 놓는다. **운영자만** — 서버가 토큰을 본다.
     *
     * 메모는 **방**(tileId), 문제와 비밀 쪽지는 **칸**(x·y)이다. 칸인
     * 것은 복도에 놓기 위해서다 — 복도는 어느 방에도 안 속한다.
     */
    hostDrop: (drop: {
      tileId?: string
      x?: number
      y?: number
      kind: 'quiz' | 'memo' | 'slip'
      text?: string
      /** 비밀 쪽지일 때. 누구의 비밀인가 */
      subjectId?: string
      /** 은행에 있는 문제를 놓을 때. 새로 적을 때는 quiz 를 준다 */
      quizId?: string
      quiz?: { kind: 'choice' | 'short'; prompt: string; choices?: string[]; answers?: string[]; explain?: string }
    }) => callServer('hostDrop', { ...g, ...drop }),
    openPhase: () => callServer('openPhase', g),
    closePhase: () => callServer('closePhase', g),

    /** 닷새가 시작된다. 시각을 안 주면 지금부터다. */
    /** 팀과 개인 미션을 한꺼번에 나눈다. 운영자만, 한 번만. */
    assignAll: () => callServer('assignAll', { ...g }),
    // 시각을 안 보낸다 — 서버가 판의 시계(개발용 배속 포함)로 적는다. 기기 시계를 보내면 배속 판에서 시작 시각이 어긋난다
    startGame: (startAtMs?: number) => callServer('startGame', { ...g, ...(startAtMs ? { startAtMs } : {}) }),
    /** QA용으로 자리를 채운다. 로비에서만 먹는다. */
    seedPlayers: (password: string, leaveSeats = 1) =>
      callServer('seedPlayers', { ...g, password, leaveSeats }),
    /** 시험용. 핵심 칸을 미리 다 연다 — 닷새를 기다리지 않고 본다 */


    buyShopItem: (itemId: string) => callServer('buyShopItem', { ...g, itemId }),

    // ── 거래 ────────────────────────────────────────────────────
    // 마주 앉아 양쪽이 각자 물건을 올린다. 값은 성립할 때 청한 쪽이 낸다.
    /** 거래를 걸자고 청한다. 열다섯 초 안에 답이 없으면 사라진다. */
    askDeal: (toPlayerId: string) => callServer('askDeal', { ...g, toPlayerId }),
    answerDeal: (dealId: string, accept: boolean) => callServer('answerDeal', { ...g, dealId, accept }),
    /** 탁자에 올린 것 전부를 한 번에 적는다. 바뀌면 양쪽 준비가 풀린다. */
    stakeDeal: (dealId: string, stake: unknown) => callServer('stakeDeal', { ...g, dealId, stake }),
    readyDeal: (dealId: string, ready: boolean) => callServer('readyDeal', { ...g, dealId, ready }),
    cancelDeal: (dealId: string) => callServer('cancelDeal', { ...g, dealId }),
    settleDeal: (dealId: string) => callServer('settleDeal', { ...g, dealId }),
    /** 지금 내가 끼어 있는 거래. 시든 것을 접고 나서 답한다. */
    dealNow: () => callServer('dealNow', g),

    // ── 이적 ────────────────────────────────────────────────────
    // 마주 서서 「우리 팀으로 오겠느냐」고 묻는다. 불린 쪽이 답하고,
    // 수락해도 다음 페이즈가 열릴 때까지는 아직 옛 팀 사람이다.
    askTransfer: (toPlayerId: string) => callServer('askTransfer', { ...g, toPlayerId }),
    answerTransfer: (askId: string, accept: boolean) =>
      callServer('answerTransfer', { ...g, askId, accept }),


    // ── 오락기 ──────────────────────────────────────────────────
    // 답은 서버가 쥔다. 화면은 물어보고 받은 것을 그리기만 한다
    arcadeOpen: (game: string) => callServer('arcadeOpen', { ...g, game }),
    arcadeInvite: (roomId: string, playerId: string) => callServer('arcadeInvite', { ...g, roomId, playerId }),
    arcadeAnswer: (roomId: string, accept: boolean) => callServer('arcadeAnswer', { ...g, roomId, accept }),
    arcadeBegin: (roomId: string) => callServer('arcadeBegin', { ...g, roomId }),
    arcadeLeave: (roomId: string) => callServer('arcadeLeave', { ...g, roomId }),
    arcadeMove: (roomId: string, n: number) => callServer('arcadeMove', { ...g, roomId, n }),
    arcadePick: (roomId: string, pick: string) => callServer('arcadePick', { ...g, roomId, pick }),
    arcadeSubmit: (roomId: string, log: unknown) => callServer('arcadeSubmit', { ...g, roomId, log }),
    arcadePlay: (roomId: string, move: { round?: number; shot?: number | 'early' | null; t?: number; taps?: { t: number; pad: number }[] } = {}) =>
      callServer('arcadePlay', { ...g, roomId, move }),
    arcadeTick: (roomId: string) => callServer('arcadeTick', { ...g, roomId }),
    arcadeClock: () => callServer('arcadeClock', {}),

    castVote: (targetId: string, kind: 'trust' | 'liking' | 'suspicion') =>
      callServer('castVote', { ...g, targetId, kind }),
    /** 털어놓기. 1:1이면 들을 사람을 골라야 한다. */

    chooseImportant: (targetId: string) => callServer('chooseImportant', { ...g, targetId }),
    chooseDay4: (choice: Day4Choice) => callServer('chooseDay4', { ...g, choice }),

    /** 한 줄 친다. 내가 선 방에 남는다. 어떤 판정에도 쓰이지 않는다. */
    say: (text: string) => callServer('say', { ...g, text }),
    /** 내가 선 방에서 내가 들어온 뒤에 나온 줄들. */
    chatLines: (sinceMs: number) => callServer('chatLines', { ...g, sinceMs }),
    // ── 무전 ────────────────────────────────────────────────────
    // 방에 매이지 않는다. 같은 팀에게만 가고, 걷는 중에도 된다.
    radio: (text: string, channel: 'team' | 'all' = 'team') => callServer('radio', { ...g, text, channel }),
    radioLines: (sinceMs = 0, channel: 'team' | 'all' = 'team') => callServer('radioLines', { ...g, sinceMs, channel }),

    // ── 완성품 ──────────────────────────────────────────────────
    /** 연구실에 놓인 것을 가져간다. 연구한 페이즈 동안은 연구한 사람만, 그 뒤로는 누구든 */
    takeMade: (madeId: string) => callServer('takeMade', { ...g, madeId }),

    /** 아침 시퀀스를 어디까지 봤는지 적는다. */
    markMorning: (read: number[], skipped: number[]) => callServer('markMorning', { ...g, read, skipped }),
    /** A의 기록 한 조각. 공개 시각 전에는 서버가 거절한다. */
    fragment: (day: number) => callServer('fragmentOfDay', { ...g, day }),
    releasedFragments: () => callServer('releasedFragments', g),
    snow: () => callServer('snowNow', g),
    /** 운영자: 엔딩을 송출한다. mode 'all'은 전원, 'unseen'은 못 본 사람만 */
    hostBroadcastEnding: (mode: 'all' | 'unseen') => callServer('hostBroadcastEnding', { ...g, mode }),
    /** 운영자: 지금 송출 상태와 본 인원. 종례가 끝난 뒤에만 뜻이 있다 */
    hostEndingStatus: () => callServer('hostEndingStatus', g),
    /** 엔딩을 봤다고 적는다. 재생이 끝나는 순간 화면이 부른다 */
    markEndingSeen: () => callServer('markEndingSeen', g),
    /** A의 마지막 쪽지 문장. 종례가 끝난 뒤에만 온다 */
    finalNoteText: () => callServer('finalNoteText', g),
  }
}

export type GameActions = ReturnType<typeof gameActions>

/** 화면이 「지금 몇 일차인가」를 자주 묻는다. */
export function useDay(state: GameState): number {
  return useMemo(() => state.game?.day ?? 0, [state.game?.day])
}
