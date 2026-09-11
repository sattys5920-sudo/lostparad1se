// 영역전 v2 — Firestore에 무엇이 어떤 모양으로 놓이는가.
//
// 서버(Cloud Functions)와 화면이 같은 타입을 쓴다.
//
// 가장 중요한 규칙: **숨겨야 하는 것은 클라이언트가 읽을 수 있는 자리에
// 두지 않는다.** 받은 뒤 화면에서 숨기는 방식은 개발자도구로 뚫린다.
// 그래서 문서를 처음부터 두 갈래로 나눈다.
//
//   games/{gameId}/...              누구나 읽어도 되는 것
//   games/{gameId}/secret/...       서버만 읽고 쓴다 (규칙이 전면 차단)
//   games/{gameId}/views/{playerId} 그 사람 몫으로 서버가 깎아 둔 것
//
// 안개·익명 표·비밀 목표·손패·등교 예약·가짜 깃발 여부·잠복은 전부
// secret에 있고, 각자에게 보여도 되는 만큼만 views에 복사된다.
import type {
  BuildingKind,
  CardKind,
  GoalKind,
  Resource,
  RoleTitle,
  SabotageKind,
  TeamId,
  VoteKind,
} from './rules/v2'
import type { TileId } from './rules/board'

/** 밀리초 타임스탬프. 게임 속 시각이다(개발용 시계가 걸려 있으면 그 시각). */
export type GameMs = number

// ── 공개: 판 전체 ───────────────────────────────────────────────

export type GamePhase = 'lobby' | 'running' | 'finished'

/** games/{gameId} */
export interface GameDoc {
  phase: GamePhase
  /** 게임이 시작된 게임 속 시각. */
  startedAtMs: GameMs | null
  /** 개발용 시계. anchorRealMs가 0이면 실제 시각 그대로. */
  clock: { anchorRealMs: number; anchorGameMs: number; speed: number }
  /** 따라잡기가 여기까지 처리했다. 이 뒤로 밀린 일을 순서대로 민다. */
  caughtUpToMs: GameMs
  day: number
  /** A의 기록이 열어 준 칸. */
  openedTiles: TileId[]
  /** 기록이 지목해 가치가 오른 칸. */
  boostedTiles: TileId[]
  /** 21:00 정산에서 1위(주목)·꼴찌(만회)로 지정된 팀. 동점이면 여럿. */
  spotlightTeams: TeamId[]
  comebackTeams: TeamId[]
  /** DAY 5 15:00부터 true. 점수판이 가려지고 깃발이 절반이 된다. */
  lastHours: boolean
}

/** games/{gameId}/tiles/{tileId} — 주인은 숨길 것이 없다. */
export interface TileDoc {
  ownerTeam: TeamId | null
  buildings: { kind: BuildingKind; level: number }[]
  /** 보강 카드로 붙은 임시 방어. 실제 시계 기준. */
  reinforcedUntilRealMs?: number
  reinforcedBy?: number
  /** 봉쇄 카드. 게임 시계 기준. */
  blockedUntilMs?: GameMs
}

/**
 * games/{gameId}/flags/{tileId} — 깃발은 시끄럽다. 안개와 상관없이 모두 본다.
 *
 * 가짜 깃발도 **진짜와 똑같은 모양으로** 여기 놓인다. 가짜라는 사실은
 * secret에만 있어서, 다른 팀은 네트워크 응답으로도 구분할 수 없다.
 */
export interface FlagDoc {
  tileId: TileId
  team: TeamId
  planterId: string
  startedAtMs: GameMs
  /** 보정까지 끝난 소요 시간(게임 초). */
  durationSec: number
  /** 봉쇄로 멈춰 있던 동안 쌓인 초. 완료 시각을 뒤로 민다. */
  pausedSec: number
  /** 봉쇄로 지금 멈춰 있다면 그 시각. */
  pausedAtMs?: GameMs
  /** 완료 예정 시각. 화면의 게이지가 이걸 쓴다. */
  dueAtMs: GameMs
}

/** games/{gameId}/teams/{teamId} — 자원과 순위는 공개다. */
export interface TeamDoc {
  resources: Record<Resource, number>
  /** 팀 공용 행동 토큰. */
  tokens: number
  researchTier: number
  /** 손패는 장수만 공개한다. 내용은 secret에 있다. */
  handCount: number
  /** 3인 팀의 오늘 주장. */
  captainId: string | null
  /** 21:00에 공개된 점수(비밀 목표 제외). 마지막 여섯 시간에는 null. */
  publicScore: number | null
  /** 동맹 상대. 한 팀과만. */
  allyTeam: TeamId | null
  /** 먼저 깨서 새 동맹을 못 맺는 시각(실제 시계). */
  allianceLockUntilRealMs?: number
}

/**
 * games/{gameId}/pawns/{playerId} — 말의 위치.
 *
 * 이 모음은 **클라이언트가 직접 읽지 못한다.** 안개 때문이다.
 * 각자에게는 views/{playerId}에 걸러진 사본만 간다.
 */
export interface PawnDoc {
  playerId: string
  team: TeamId
  title: RoleTitle
  /** 지금 선 칸. 걷는 중이면 null — 걷는 말은 어느 칸 판정에도 세지 않는다. */
  tileId: TileId | null
  /** 걷는 중이라면 남은 경로와 다음 칸 도착 시각. */
  path: TileId[]
  arriveAtMs: GameMs | null
  /** 앱을 닫아도 말은 남는다. 잠든 말도 판정에서 센다. */
  asleep: boolean
  /** 발 묶기 — 움직이지도 행동하지도 못한다. 판정에서는 센다. */
  boundUntilMs?: GameMs
  /** 잠복 — 누구에게도 보이지 않는다. 판정에서는 센다. */
  hiddenUntilMs?: GameMs
  /** 오늘 쓴 토큰. 08:00에 0으로. */
  tokensUsedToday: number
  /** 오늘 표를 던졌는가. */
  votedToday: boolean
  /** 정보부장이 오늘 보낸 사람을 들여다본 횟수. */
  peeksToday: number
}

// ── 숨김: 서버만 ────────────────────────────────────────────────
// 규칙에서 클라이언트 읽기를 전면 차단한다.

/** games/{gameId}/secret/votes/items/{voteId} — 보낸 사람이 여기 있다. */
export interface VoteDoc {
  day: number
  voterId: string
  voterTeam: TeamId
  targetId: string
  targetTeam: TeamId
  kind: VoteKind
  castAtMs: GameMs
  /** 21:00 정산에 반영됐는가. */
  settled: boolean
}

/** games/{gameId}/secret/hands/items/{cardId} — 카드 내용. */
export interface CardDoc {
  team: TeamId
  kind: CardKind
  drawnAtMs: GameMs
  /** 라이벌 카드처럼 대상이 붙는 카드. */
  targetTeam?: TeamId
}

/** games/{gameId}/secret/goals/items/{goalId} — 비밀 목표. */
export interface GoalDoc {
  team: TeamId
  kind: GoalKind
  /** 라이벌 카드는 받을 때 대상 팀이 무작위로 정해진다(자기 팀 제외). */
  rivalTeam?: TeamId
  /** DAY 3에 반 전체에 공개했는가. */
  revealed: boolean
}

/** games/{gameId}/secret/plans/items/{playerId} — 등교 예약. */
export interface CommutePlanDoc {
  playerId: string
  path: TileId[]
  /** 도착하면 깃발을 꽂을까. 토큰·조건이 모자라면 취소된다. */
  plantFlag: boolean
  setAtMs: GameMs
}

/** games/{gameId}/secret/flagTruth/items/{tileId} — 가짜 깃발 여부. */
export interface FlagTruthDoc {
  tileId: TileId
  fake: boolean
}

// ── 각자 몫 ─────────────────────────────────────────────────────

/**
 * games/{gameId}/views/{playerId}
 *
 * 서버가 그 사람이 봐도 되는 만큼만 깎아 둔 것. 안개 밖의 말은 아예
 * 들어 있지 않다 — 지워서 보내는 게 아니라 처음부터 담지 않는다.
 */
export interface PlayerViewDoc {
  updatedAtMs: GameMs
  /** 지금 보이는 다른 말들. */
  visiblePawns: {
    playerId: string
    team: TeamId
    tileId: TileId
    asleep: boolean
  }[]
  /** 안개가 걷힌 칸. 나머지는 어둡게 덮는다. */
  visibleTiles: TileId[]
  /** 우리 팀 손패. 내용까지 보인다. */
  hand: { id: string; kind: CardKind; targetTeam?: TeamId }[]
  /** 우리 팀 비밀 목표. */
  goals: { id: string; kind: GoalKind; rivalTeam?: TeamId; revealed: boolean }[]
  /** 내 등교 예약. */
  commutePlan: { path: TileId[]; plantFlag: boolean } | null
  /** 우리가 꽂은 깃발 중 가짜인 것. 우리 팀만 안다. */
  fakeFlagTiles: TileId[]
  /** 정보부장이 들여다본 결과. */
  peeked: { voteKind: VoteKind; voterNickname: string }[]
}

// ── 채팅 ────────────────────────────────────────────────────────

/**
 * games/{gameId}/chats/{room}/messages/{id}
 *
 * 손으로 친 말과 게임이 남긴 기록을 한 줄에 섞지 않는다.
 *
 *   say     사람이 친 말. **어떤 판정에도 쓰이지 않는다.**
 *   reveal  털어놓기. 시스템 카드로 뜨고 「공인된 고백」이라 적힌다
 *   alert   우리 칸에 깃발이 꽂혔다 같은 자동 경보
 *
 * "나 털어놓을게"라고 채팅에 쓰는 것과 실제로 털어놓는 것은 완전히
 * 다른 일이다. 게임은 후자만 센다.
 */
export type ChatKind = 'say' | 'reveal' | 'alert'

export interface ChatDoc {
  kind: ChatKind
  atMs: GameMs
  /** say·reveal은 말한 사람. alert는 없다. */
  playerId?: string
  nickname?: string
  team?: TeamId
  /** say의 본문, 또는 털어놓기에 덧붙인 말. */
  text: string
  /** reveal일 때만 — 역할의 숨긴 사실 문장 그대로. */
  secretText?: string
  /** reveal일 때만 — 1:1인가 전체인가. */
  scope?: 'private' | 'class'
}

// ── 기록 ────────────────────────────────────────────────────────

/**
 * games/{gameId}/events/{eventId} — 추가만 한다.
 *
 * 따라잡기의 근거이자 비밀 목표 판정의 근거다. 칸을 뺏긴 적,
 * 남의 칸 깃발 성공 횟수, 동맹을 먼저 깼는지, 신뢰표를 준 팀,
 * 비밀을 털어놓았는지 — 전부 여기서 센다.
 */
export type EventKind =
  | 'gameStart' | 'dayStart' | 'settlement' | 'gameEnd'
  | 'move' | 'arrive'
  | 'flagPlanted' | 'flagSucceeded' | 'flagFailed' | 'tileCaptured' | 'tileLost'
  | 'build' | 'upgrade' | 'research' | 'scout' | 'produce' | 'sabotage'
  | 'vote' | 'rumor' | 'reveal' | 'leverageGained' | 'leverageSpent'
  | 'cardDrawn' | 'cardPlayed'
  | 'tradeProposed' | 'tradeAccepted' | 'tradeDeclined'
  | 'allianceFormed' | 'allianceBroken' | 'allianceCleared'
  | 'goalRevealed' | 'spotlight' | 'comeback'

export interface EventDoc {
  atMs: GameMs
  day: number
  kind: EventKind
  team?: TeamId
  playerId?: string
  tileId?: TileId
  /** 자세한 것은 여기. 판정에 쓰는 값은 반드시 필드로 남긴다. */
  detail?: Record<string, unknown>
}

/**
 * games/{gameId}/schedule/{id} — 예정 이벤트.
 *
 * 상시 켜진 서버를 전제하지 않는다. 요청이 들어오면 밀린 것을 시각
 * 순으로 따라잡는다. 정시 이벤트는 Cloud Scheduler가 있으면 제때
 * 돌고, 없어도 다음 요청에 함께 처리된다.
 */
export type ScheduleKind = 'arrive' | 'flag' | 'dayStart' | 'tokenGrant' | 'settlement' | 'lastHours' | 'gameEnd'

export interface ScheduleDoc {
  dueAtMs: GameMs
  /** 같은 시각이면 이 값이 작은 것부터. */
  ord: number
  kind: ScheduleKind
  payload: Record<string, unknown>
  doneAtMs: GameMs | null
}

/** 같은 시각에 겹치면 이동 도착 → 깃발 판정 → 정시 이벤트 순이다. */
export const SCHEDULE_ORD: Record<ScheduleKind, number> = {
  arrive: 10,
  flag: 20,
  dayStart: 30,
  tokenGrant: 30,
  settlement: 30,
  lastHours: 30,
  gameEnd: 30,
}

// ── 견제·약점처럼 기한이 붙는 것 ────────────────────────────────

/** games/{gameId}/sabotages/{id} — 걸린 견제. 공개다. */
export interface SabotageDoc {
  kind: SabotageKind
  fromTeam: TeamId
  targetTeam: TeamId
  /** 실제 시계 기준 만료. productionDown은 대신 다음 정산 한 번만 먹는다. */
  expiresRealMs: number | null
  consumed: boolean
}

/** games/{gameId}/secret/leverage/items/{id} — 누가 누구의 약점을 쥐었는가. */
export interface LeverageDoc {
  holderId: string
  aboutId: string
  gainedAtMs: GameMs
  spentAs: 'bind' | 'extort' | null
}
