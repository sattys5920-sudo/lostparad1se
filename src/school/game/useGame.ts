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
//   games/{id}/tiles/{t}    칸 주인과 건물
//
// 말의 위치도, 남의 손패도, 표도 여기 없다. 규칙이 막아서가 아니라
// 서버가 애초에 담지 않아서다.
import { useEffect, useMemo, useState } from 'react'
import { collection, doc, onSnapshot } from 'firebase/firestore'

import { auth, callServer, db } from '../../firebase'
import type { GameDoc, PlayerViewDoc, TeamDoc, TileDoc } from '../../../shared/model'
import type { TeamId } from '../../../shared/rules/v2'
import type { TileId } from '../../../shared/rules/board'

export interface GameState {
  /** 아직 아무것도 못 읽었으면 true. */
  loading: boolean
  game: GameDoc | null
  /** 내 몫. 로그인 전이거나 판에 없으면 null. */
  view: PlayerViewDoc | null
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

const EMPTY: GameState = { loading: true, game: null, view: null, teams: {}, tiles: {}, phaseLog: [], error: null }

/**
 * 판을 구독한다.
 *
 * uid가 없으면 내 몫은 안 붙는다 — 규칙이 거절할 요청을 보내 봐야
 * 콘솔만 빨개진다.
 */
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

    stop.push(
      onSnapshot(
        base,
        (snap) => setState((s) => ({ ...s, loading: false, game: (snap.data() as GameDoc) ?? null })),
        fail,
      ),
    )
    stop.push(
      onSnapshot(
        collection(base, 'teams'),
        (snap) => {
          const teams: Partial<Record<TeamId, TeamDoc>> = {}
          snap.forEach((d) => (teams[d.id as TeamId] = d.data() as TeamDoc))
          setState((s) => ({ ...s, teams }))
        },
        fail,
      ),
    )
    stop.push(
      onSnapshot(
        collection(base, 'tiles'),
        (snap) => {
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
          (snap) => setState((s) => ({ ...s, view: (snap.data() as PlayerViewDoc) ?? null })),
          fail,
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
    // ── 페이즈 ──────────────────────────────────────────────────
    /** 자유 시간에 옆방으로. 즉시 간다. 전선은 안 움직인다. */
    roamTo: (tileId: TileId) => callServer('roamTo', { ...g, tileId }),
    /** 이번 페이즈에 할 일. 닫히기 전까지는 바꿀 수 있다. */
    submitAction: (
      kind: string,
      t: { targetTile?: TileId; targetPlayer?: string; targetRobot?: string } = {},
    ) => callServer('submitAction', { ...g, kind, ...t }),
    /** 몇 명이 냈는가. 무엇을 냈는지는 안 온다. */
    phaseReady: () => callServer('phaseReady', g),
    openPhase: () => callServer('openPhase', g),
    closePhase: () => callServer('closePhase', g),

    /** 닷새가 시작된다. 시각을 안 주면 지금부터다. */
    startGame: (startAtMs?: number) => callServer('startGame', { ...g, startAtMs: startAtMs ?? Date.now() }),
    /** QA용으로 자리를 채운다. 로비에서만 먹는다. */
    seedPlayers: (password: string, leaveSeats = 1) =>
      callServer('seedPlayers', { ...g, password, leaveSeats }),

    moveTo: (tileId: TileId) => callServer('moveTo', { ...g, tileId }),
    planCommute: (tileId: TileId | null, plantFlag = false) =>
      callServer('planCommute', { ...g, tileId, plantFlag }),
    plantFlag: (tileId: TileId) => callServer('plantFlag', { ...g, tileId }),

    build: (tileId: TileId, kind: string) => callServer('buildOn', { ...g, tileId, kind }),
    upgrade: (tileId: TileId, kind: string) => callServer('upgradeOn', { ...g, tileId, kind }),
    research: (tileId: TileId) => callServer('research', { ...g, tileId }),
    scout: (tileId: TileId) => callServer('scout', { ...g, tileId }),
    produce: (tileId: TileId) => callServer('produce', { ...g, tileId }),
    sabotage: (tileId: TileId, kind: string) => callServer('sabotage', { ...g, tileId, kind }),

    offerTrade: (toTeam: TeamId, give: Record<string, number>, want: Record<string, number>, note = '') =>
      callServer('offerTrade', { ...g, toTeam, give, want, note }),
    respondTrade: (tradeId: string, accept: boolean) => callServer('respondTrade', { ...g, tradeId, accept }),
    proposeAlliance: (withTeam: TeamId) => callServer('proposeAlliance', { ...g, withTeam }),
    respondAlliance: (proposalId: string, accept: boolean) =>
      callServer('respondAlliance', { ...g, proposalId, accept }),
    breakAlliance: () => callServer('breakAllianceNow', g),

    playCard: (kind: string, target: { targetTeam?: TeamId; targetTile?: TileId; targetPawn?: string } = {}) =>
      callServer('playOne', { ...g, kind, ...target }),

    castVote: (targetId: string, kind: 'trust' | 'liking' | 'suspicion') =>
      callServer('castVote', { ...g, targetId, kind }),
    /** 털어놓기. 1:1이면 들을 사람을 골라야 한다. */
    reveal: (scope: 'class' | 'private', listenerIds: string[] = []) =>
      callServer('revealSecret', { ...g, scope, listenerIds }),

    chooseImportant: (targetId: string) => callServer('chooseImportant', { ...g, targetId }),
    chooseDay4: (choice: 'team' | 'self' | 'bond') => callServer('chooseDay4', { ...g, choice }),

    /** 한 줄 친다. 내가 선 방에 남는다. 어떤 판정에도 쓰이지 않는다. */
    say: (text: string) => callServer('say', { ...g, text }),
    /** 내가 선 방에서 내가 들어온 뒤에 나온 줄들. */
    chatLines: (sinceMs: number) => callServer('chatLines', { ...g, sinceMs }),

    /** 아침 시퀀스를 어디까지 봤는지 적는다. */
    markMorning: (read: number[], skipped: number[]) => callServer('markMorning', { ...g, read, skipped }),
    /** A의 기록 한 조각. 공개 시각 전에는 서버가 거절한다. */
    fragment: (day: number) => callServer('fragmentOfDay', { ...g, day }),
    releasedFragments: () => callServer('releasedFragments', g),
    snow: () => callServer('snowNow', g),
    /** 종례가 끝난 뒤에만. */
    ending: () => callServer('endingData', g),
  }
}

export type GameActions = ReturnType<typeof gameActions>

/** 화면이 「지금 몇 일차인가」를 자주 묻는다. */
export function useDay(state: GameState): number {
  return useMemo(() => state.game?.day ?? 0, [state.game?.day])
}
