// 점령 — 방은 사람이 많은 팀의 것이다.
//
// 깃발을 꽂아 시간을 채우던 방식을 걷어내고, **그 방에 서 있는 머릿수**로
// 주인을 정한다. 뺏으려면 몰려가야 하고, 지키려면 남아 있어야 한다.
//
// **페이즈는 한 시간짜리 라이브 판이다.** 관리자가 열면 한 시간이 흐르고,
// 그동안 각자 토큰만큼 움직이고 행동한다. 토큰을 다 쓰면 그 자리에 서
// 있는 수밖에 없다. 한 시간이 끝난 순간 각 방에 서 있는 머릿수로 주인이
// 정해진다 — 그래서 「어디에서 끝낼 것인가」가 유일한 질문이다.
//
// 전에는 모두가 행동 하나를 몰래 고르고 한꺼번에 까는 방식이었다. 그것도
// 되는 게임이지만, 한 시간을 살아 움직이는 쪽을 골랐다. 판이 넓고 안개가
// 있어서 남이 어디 있는지는 어차피 대부분 안 보인다.
//
// 이 파일은 **순수 함수**다. 문서도 시계도 데이터베이스도 모른다.
// 같은 입력에 늘 같은 결과라, 서버가 돌리든 시험이 돌리든 같다.
import { ADJACENCY, TILE_BY_ID, TILES, type TileId } from './board'
import { ITEM_BY_KIND, ITEM_FOR, countOf, takeItem, type Satchels } from './items'
import { TOTAL_SEATS } from './lobby'
import { CAPTAIN_HEAD_COUNT, FULL_TEAM_SIZE, type TeamId, type Tier } from './v2'

// ── 수치 ────────────────────────────────────────────────────────
//
// 플레이테스트에서 제일 먼저 손댈 값들이라 한곳에 모은다.

/** 하루에 여는 페이즈 수. */
export const PHASES_PER_DAY = 10

/**
 * 한 페이즈가 열려 있는 시간(분). 게임 시계로 잰다.
 *
 * 관리자가 이보다 일찍 닫을 수는 있어도 늦게까지 끌 수는 없다 — 시간이
 * 지나면 아무도 더 못 움직인다. 안 그러면 늦게 닫히는 페이즈에서 토큰이
 * 남은 사람만 계속 유리하다.
 */
export const PHASE_MINUTES = 60

/**
 * 페이즈가 열릴 때 한 사람에게 주는 토큰.
 *
 * **남으면 그대로 간다.** 토큰은 거래할 수 있는 물건이라, 페이즈가
 * 닫힐 때 태워 버리면 「토큰을 받고 무엇을 준다」가 성립하지 않는다.
 * 아껴 두었다가 자유 시간에 남에게 넘길 수도 있다.
 */
export const TOKENS_PER_PHASE = 4

/**
 * 머릿수가 모자란 팀이 한 사람당 더 받는 몫.
 *
 * 세 명짜리 팀은 1인당 5를 받아 팀 총합 15, 네 명짜리 팀은 4씩 16이
 * 된다. 사람 수만큼 손이 모자란 것은 어차피 그대로고, 여기서 맞추는
 * 것은 **팀이 한 페이즈에 낼 수 있는 행동의 총량**이다.
 *
 * 인원은 페이즈가 열리는 순간에 센다. 이적이 걸려 있으면 그날 아침에
 * 이미 발효돼 있으므로, 옮겨 간 사람은 새 팀 인원수로 받는다.
 */
export const SHORT_TEAM_BONUS = 1

/** 그 인원의 팀에서 한 사람이 받는 토큰. */
export function grantFor(teamSize: number): number {
  return teamSize < FULL_TEAM_SIZE ? TOKENS_PER_PHASE + SHORT_TEAM_BONUS : TOKENS_PER_PHASE
}

/**
 * 들고 다닐 수 있는 토큰의 한도.
 *
 * 남는 것을 그대로 두면 쉰 페이즈 동안 쌓여서 나중에는 아무 값도
 * 아니게 된다. 한편 한 푼도 못 남기면 거래할 물건이 못 된다.
 * **두 페이즈치까지** — 플레이테스트에서 제일 먼저 볼 값이다.
 */
export const TOKEN_CAP = 8

/**
 * 결석 보정 — 직전 페이즈에 **한 명도 움직이지 않은 팀**에게.
 *
 * 아무도 안 들어온 팀은 토큰만 쌓인 채 한 시간을 통째로 잃는다. 다음
 * 페이즈에 그 팀원들이 안 쓴 토큰의 절반(내림)을 얹어 준다 — 못 한
 * 일을 돌려주지는 못해도, 접속한 날 조금 더 움직일 수는 있게 한다.
 *
 * **이때만 한도를 넘는다.** 넘긴 것은 그다음 지급에서 한도까지 깎인다 —
 * 안 그러면 계속 결석해서 쌓아 두는 쪽이 이득이 된다.
 */
export const ABSENCE_REFUND_NUMERATOR = 1
export const ABSENCE_REFUND_DENOMINATOR = 2

/** 결석한 팀이 다음 페이즈에 더 받는 몫. 안 쓴 토큰의 절반을 내림. */
export function absenceRefund(unusedTokens: number): number {
  return Math.floor((unusedTokens * ABSENCE_REFUND_NUMERATOR) / ABSENCE_REFUND_DENOMINATOR)
}

/**
 * 이번 페이즈에 이 사람이 갖게 될 토큰.
 *
 * 순서가 중요하다 — **먼저 한도까지 깎고, 그 뒤에 지급과 보정을 얹는다.**
 * 결석 보정으로 한도를 넘긴 사람은 여기서 정리된다. 얹은 다음에 깎으면
 * 보정이 그 자리에서 사라져 아무 뜻이 없어진다.
 */
export function nextTokens(input: {
  held: number
  teamSize: number
  /** 이 사람 몫의 결석 보정. 없으면 0. */
  refund?: number
}): number {
  const trimmed = Math.min(input.held, TOKEN_CAP)
  return trimmed + grantFor(input.teamSize) + (input.refund ?? 0)
}

/**
 * 다른 방에 **들어갈 때** 드는 토큰. 나갈 때는 안 든다.
 *
 * 방 안을 걸어 다니는 것은 공짜다. 값이 붙는 것은 문을 넘는 일 하나뿐이다.
 */
export const ENTER_COST = 1

/**
 * 나가는 데 5분, 들어가는 데 5분. **토큰과 별개로 시간이 든다.**
 *
 * 그래서 한 방 옮기는 데 열 시간분이 아니라 10분이 통째로 사라지고,
 * 그동안은 어느 방에도 없다 — 그때 페이즈가 닫히면 아무 데도 못 센다.
 * 토큰이 남아도 시계가 안 남으면 못 움직이는 것이 이 게임의 조임쇠다.
 */
export const EXIT_MINUTES = 5
export const ENTER_MINUTES = 5
export const MOVE_MINUTES = EXIT_MINUTES + ENTER_MINUTES

/** 마주 선 사람과 거래 한 번. 거래할 수 있는 것은 토큰·재화·데리고 있는 로봇이다. */
export const TRADE_COST = 1

/** 사람 한 명이 데리고 다닐 수 있는 로봇. */
export const MAX_CARRIED_ROBOTS = 2

/**
 * 한 방에 설 수 있는 로봇. **정원과는 별도로 센다.**
 *
 * 전에는 로봇이 사람과 같은 자리를 차지했다. 그래서 정원 둘짜리 관문에
 * 로봇 두 기를 세워 두면 아무도 못 들어갔고, 부수려면 들어가야 하는데
 * 들어갈 수가 없으니 그 방은 영영 그 팀 것이었다. 문을 막는 것이
 * 점령보다 싸면 아무도 점령을 안 한다.
 *
 * 이제 정원은 사람만 센다. 로봇은 방마다 따로 이 수까지다.
 */
export const ROBOTS_PER_ROOM = 2

/**
 * 한 팀이 동시에 가질 수 있는 로봇.
 *
 * 연구를 막을 것이 없으면 지식이 도는 팀이 로봇을 무한히 찍어낸다.
 * 로봇은 머릿수로 세어지므로 그 순간 점령이 사람의 일이 아니게 된다.
 */
export const ROBOTS_PER_TEAM = 6

/**
 * 한 사람이 한 페이즈에 부술 수 있는 로봇.
 *
 * 전에는 「그 방에 상대 팀 사람이 없어야」 부술 수 있었다. 그래서
 * 로봇만 남은 방이 교착됐다 — 부수러 가려면 아무도 없을 때 가야 하고,
 * 방을 뺏으려면 사람을 몰고 가야 하는데 둘을 동시에 할 수가 없었다.
 *
 * 그 조건을 없애고 대신 사람마다 한 기로 묶는다. 로봇 두 기가 선 방을
 * 뺏으려면 **여럿이 같이 가서 나눠 부숴야 한다** — 혼자서는 안 된다는
 * 것이 요점이고, 그것이 원래 점령전이 시키려던 일이다.
 */
export const SMASHES_PER_PHASE = 1
/** 위장한 사람이 남에게 보이는 머릿수. 판정은 이 값을 쓰지 않는다. */
export const DISGUISE_SHOWN_AS = 2
/** 연구가 로봇이 되기까지 걸리는 페이즈. 발전소를 쥐면 그 자리에서 된다. */
export const RESEARCH_PHASES = 1
export const RESEARCH_PHASES_WITH_PLANT = 0

/**
 * 연구 한 번에 드는 **팀 금고의 지식.** 토큰과 별개로 든다.
 *
 * 토큰은 사람마다 나오지만 지식은 팀이 함께 번다 — 문제 종이를 풀어야
 * 는다. 그래서 로봇을 뽑는 일이 개인의 부지런함이 아니라 팀의 살림이
 * 된다. 발전소를 쥐면 한 점 싸진다.
 */
export const KNOWLEDGE_PER_RESEARCH = 2
export const KNOWLEDGE_PER_RESEARCH_OWNER = 1

/**
 * 이번 연구에 드는 지식.
 *
 * **연구실을 차지한 팀은 한 점, 남은 두 점이다.** 그리고 남이 낸 두
 * 점은 사라지지 않고 **연구실 주인 팀의 금고로 들어간다** — 연구실을
 * 쥔다는 것은 남의 연구로 먹고산다는 뜻이다. 아무도 안 쥐고 있으면
 * 받을 팀이 없어 그냥 사라진다.
 */
export const researchKnowledge = (ownsLab: boolean): number =>
  ownsLab ? KNOWLEDGE_PER_RESEARCH_OWNER : KNOWLEDGE_PER_RESEARCH

export type RoomKind = 'normal' | 'narrow' | 'lab' | 'plant'

/** 방에 들어갈 수 있는 머릿수. 로봇도 한 자리를 차지한다. */
export const ROOM_CAPACITY: Record<RoomKind, number> = {
  normal: 6,
  narrow: 2,
  lab: 4,
  plant: 4,
}

/**
 * 방 종류. **회전 대칭인 묶음째로** 준다.
 *
 * 이 판은 90도 돌리면 겹친다(board.ts). 그래서 한 묶음을 통째로 같은
 * 종류로 두면 네 팀의 기지에서 각 종류까지의 거리가 저절로 같아진다.
 * 한두 칸만 골라 바꾸면 반드시 어느 팀이 가까워진다.
 *
 *   관문 넷   좁은 방 — 길목이라 머릿수로 밀어붙일 수 없다
 *   교차로 넷 연구실 — 팀마다 하나씩, 기지에서 같은 거리
 *   중앙광장  발전소 — 한 곳뿐이고 네 기지에서 정확히 같은 거리다
 */
export const KIND_BY_TIER: Record<Tier, RoomKind> = {
  base: 'normal',
  zone1: 'normal',
  gate: 'narrow',
  // 교차로는 지나다니는 길목이라 넓다. 전에는 여기가 연구실이었는데,
  // 연구실을 따로 한 칸 만들면서 셋 다 평범한 방으로 돌아갔다
  cross: 'normal',
  lab: 'lab',
  core: 'normal',
  plaza: 'plant',
  // 계단은 좁다. 둘이 서면 길이 막힌다
  stair: 'narrow',
}

export const ROOM_KIND: Readonly<Record<TileId, RoomKind>> = Object.fromEntries(
  TILES.map((t) => [t.id, KIND_BY_TIER[t.tier]]),
) as Record<TileId, RoomKind>

/**
 * 인원 제한이 없는 방.
 *
 * 2-3 교실은 아침마다 열넷이 한꺼번에 서는 자리다. 여기에 정원을
 * 두면 늦게 들어온 사람이 자기 반에 못 들어간다 — 제한을 없애는
 * 대신 열네 자리(TOTAL_SEATS)로 둔다. 무한대로 두면 화면과 서버가
 * 주고받을 때마다 숫자가 아닌 값이 섞인다.
 */
export const OPEN_TILES: ReadonlySet<TileId> = new Set(['centralPlaza'])

export const capacityOf = (id: TileId): number =>
  OPEN_TILES.has(id) ? TOTAL_SEATS : ROOM_CAPACITY[ROOM_KIND[id]]

// ── 판 위의 것들 ────────────────────────────────────────────────

export interface Person {
  playerId: string
  team: TeamId
  /**
   * 지금 선 방. **걷는 중이면 null 이다.**
   *
   * 문을 넘는 10분 동안은 어느 방에도 없다. 그때 페이즈가 닫히면
   * 어느 방에도 안 세어진다 — 마지막 순간의 이동은 도박이다.
   */
  tileId: TileId | null
  /** 걷는 중이라면 가는 곳. 서 있으면 null. */
  toTile?: TileId | null
  /** 세 명뿐인 팀의 주장. 점령 판정에서 둘로 센다. */
  captain: boolean
  /** 들고 있는 토큰. 페이즈마다 받고, 남으면 그대로 간다 — 거래할 수 있다. */
  tokens: number
}

export interface Robot {
  id: string
  team: TeamId
  /** 데리고 다니는 중이면 주인이 선 방과 같다. */
  tileId: TileId
  /** 누가 데리고 있는가. 두고 간 로봇은 null. */
  carriedBy: string | null
}

/**
 * 걸어 둔 연구 한 건.
 *
 * **낸 값을 그대로 적어 둔다.** 불발되면 돌려줘야 하는데, 그사이
 * 연구실 주인이 바뀌면 지금 값으로는 얼마를 누구에게 돌려줄지 알
 * 수가 없다 — 남의 일로 손해를 보거나 이득을 본다.
 */
export interface PendingResearch {
  playerId: string
  /** 걸 때 낸 지식. */
  knowledge: number
  /** 그 지식을 받은 팀. 우리 연구실이었으면 아무도 안 받았다. */
  paidTo: TeamId | null
}

export interface PhaseState {
  people: readonly Person[]
  robots: readonly Robot[]
  owners: Readonly<Partial<Record<TileId, TeamId | null>>>
  /** 지난 페이즈에 연구를 건 사람들. 이번 페이즈 끝에 로봇이 된다. */
  pendingResearch: readonly PendingResearch[]
  /** 이번 페이즈에 방해당한 사람·로봇. 점령 판정에서 0으로 센다. */
  zeroedPeople: readonly string[]
  zeroedRobots: readonly string[]
  /** 이번 페이즈에 위장한 사람. 남에게 보이는 숫자만 바뀐다. */
  disguised: readonly string[]
  /** 이번 페이즈에 로봇을 부순 사람. 한 사람 한 기까지다. */
  smashedBy: readonly string[]
  /** 팀이 함께 가진 물건. 방해와 위장이 여기서 하나씩 빠진다. */
  satchels: Satchels
  /**
   * 이번 페이즈에 무엇이든 한 사람.
   *
   * 결석 보정이 이것을 본다 — 한 팀에서 아무도 여기 없으면 그 팀은
   * 한 시간을 통째로 잃은 것이다.
   */
  actedBy: readonly string[]
  /**
   * 오늘 지워진 사람. 없으면 null.
   *
   * **사람과 얽히는 일의 대상이 되지 않는다** — 호출도 방해도 이 사람을
   * 지나친다. 점령 판정에서도 0명이다. 대신 데리고 있는 짝은 부술 수 있다.
   */
  invisibleId?: string | null
  /**
   * 팀마다의 금고. **연구가 지식을 여기서 뺀다.**
   *
   * 순수 함수로 두려면 금고도 상태의 일부여야 한다. 서버가 팀 문서에서
   * 읽어 넣고, 바뀐 것을 도로 적는다.
   */
  vaults: Readonly<Partial<Record<TeamId, Vault>>>
}

/** 팀 금고. 돈과 지식 둘뿐이다. */
export interface Vault {
  money: number
  knowledge: number
}

const EMPTY_VAULT: Vault = { money: 0, knowledge: 0 }

/** 그 팀 금고. 없으면 빈 것으로 친다. */
export const vaultOf = (state: PhaseState, team: TeamId): Vault => state.vaults[team] ?? EMPTY_VAULT

export type ActionKind = 'move' | 'research' | 'summon' | 'disturb' | 'disguise' | 'dropRobot' | 'smashRobot'

/** 행동에 드는 토큰. 이동은 **들어가는 값**이다 — 나가는 데는 안 든다. */
export const ACT_COST: Record<ActionKind, number> = {
  move: ENTER_COST,
  research: 2,
  summon: 1,
  // **방해와 위장은 토큰이 아니라 물건이 든다.** 물건은 상점에서만 난다
  disturb: 0,
  disguise: 0,
  // 들고 있던 것을 내려놓는 것뿐이다. 값을 물리면 아무도 안 둔다
  dropRobot: 0,
  smashRobot: 1,
}

export interface Act {
  kind: ActionKind
  /** 이동의 목적지. */
  targetTile?: TileId
  /** 호출·방해의 대상이 사람일 때. */
  targetPlayer?: string
  /** 방해·부수기의 대상이 로봇일 때. */
  targetRobot?: string
}

export type LogKind =
  | 'moved'
  | 'summoned'
  | 'disturbed'
  | 'disguised'
  | 'robotLeft'
  | 'robotSmashed'
  | 'researchStarted'
  | 'researchDone'
  | 'researchFizzled'
  | 'captured'

export interface LogLine {
  kind: LogKind
  playerId?: string
  tileId?: TileId
  team?: TeamId
  targetPlayer?: string
  targetRobot?: string
}

// ── 머릿수 ──────────────────────────────────────────────────────

/** 점령 판정에서 이 사람이 몇으로 세는가. 주장은 둘이다. */
export const headOf = (p: Person): number => (p.captain ? CAPTAIN_HEAD_COUNT : 1)

/** 머릿수가 모자란 팀인가. 주장을 두는 쪽이다. **명단을 세서 판단한다.** */
export const isShortHanded = (teamSize: number): boolean => teamSize < FULL_TEAM_SIZE

/** 방의 정원을 차지하는 수. **사람만 센다** — 로봇은 따로 헤아린다. */
export function seatsUsed(state: PhaseState, tileId: TileId): number {
  // 걸어오는 중인 사람도 한 자리를 잡아 둔다. 안 그러면 정원 둘짜리
  // 방에 셋이 동시에 출발해서 셋 다 들어간다
  return state.people.filter((p) => p.tileId === tileId || p.toTile === tileId).length
}

/** 그 방에 서 있는 로봇 수. 정원과 별개로 ROBOTS_PER_ROOM 까지다. */
export function robotsIn(state: PhaseState, tileId: TileId): number {
  return state.robots.filter((r) => r.tileId === tileId).length
}

/** 그 팀이 지금 가진 로봇 수. ROBOTS_PER_TEAM 이 한도다. */
export function robotsOfTeam(state: PhaseState, team: TeamId): number {
  return state.robots.filter((r) => r.team === team).length
}

/**
 * 지금 저 방으로 옮기면 두고 가게 되는 로봇.
 *
 * **화면이 누르기 전에 경고하려고 부른다.** 수를 화면에 다시 적으면
 * 규칙을 고칠 때 경고만 옛말이 된다 — 같은 함수가 답해야 한다.
 */
export function robotsLeftBehind(state: PhaseState, playerId: string, to: TileId): number {
  return leftBehindCount(state.robots.filter((r) => r.carriedBy === playerId).length, robotsIn(state, to))
}

/** 위와 같은 셈을 수만으로. 화면이 안개 너머를 못 볼 때 쓴다. */
export function leftBehindCount(carried: number, botsAtDest: number): number {
  return Math.max(0, carried - Math.max(0, ROBOTS_PER_ROOM - botsAtDest))
}

// ── 팀 점수와 순위 ──────────────────────────────────────────────
//
// **팀은 방 개수로 이긴다.** 자원도 건물도 표도 팀 점수에 들어가지
// 않는다 — 방 하나가 한 점이고 그게 전부다. 개인은 개인 미션으로
// 따로 평가받는다. 둘은 별개다.
//
// 기지는 세지 않는다. 시작할 때 거저 받는 것이라 세면 아무것도
// 안 한 팀이 점수를 갖게 된다.

/** 그 팀이 쥐고 있는 방의 수. 이것이 곧 팀 점수다. */
export function roomsOf(owners: Readonly<Partial<Record<TileId, TeamId | null>>>, team: TeamId): number {
  return TILES.filter((t) => t.homeOf === null && owners[t.id] === team).length
}

/**
 * 팀마다의 순위. **동순위는 같은 수를 갖는다**(1·2·2·4).
 *
 * 이적이 이 수를 본다. 「받는 팀이 보내는 팀보다 순위가 낮아야」를
 * 판정하려면 같은 자리에 둘이 서 있는 경우가 구별돼야 한다 —
 * 동순위면 이적이 막히므로, 억지로 순서를 매기면 안 되는 이적이 열린다.
 */
export function teamRanks(
  owners: Readonly<Partial<Record<TileId, TeamId | null>>>,
  teams: readonly TeamId[],
): Record<TeamId, number> {
  const rooms = teams.map((t) => [t, roomsOf(owners, t)] as const)
  const sorted = [...rooms].sort((a, b) => b[1] - a[1])
  const out = {} as Record<TeamId, number>
  let rank = 0
  let seen = 0
  let last: number | null = null
  for (const [team, n] of sorted) {
    seen += 1
    if (n !== last) {
      rank = seen
      last = n
    }
    out[team] = rank
  }
  return out
}

/**
 * 주인을 정한다. **페이즈가 끝날 때 그 방에 남아 있는 머릿수로만** 정한다.
 *
 *   제일 많은 팀이 하나   그 팀이 차지한다
 *   동점                  주인이 그대로다. 밀어내려면 확실히 더 많아야 한다
 *   아무도 없다           **주인이 없어진다**
 *
 * 그래서 땅은 매 페이즈 새로 그려진다. 한 번 차지해 두고 다시 안 가면
 * 잃는다 — 페이즈가 땅을 두고 다투는 시간이 되는 것이 이 한 줄이다.
 */
export function ownerOf(
  weights: Readonly<Partial<Record<TeamId, number>>>,
  before: TeamId | null,
): TeamId | null {
  const rows = Object.entries(weights).filter(([, n]) => (n ?? 0) > 0) as [TeamId, number][]
  // **아무도 안 섰으면 주인이 없어진다.** 전에는 전 주인이 그대로
  // 남았다 — 한 번 꽂아 두면 다시 갈 일이 없어서, 땅이 쌓이기만 하고
  // 페이즈가 땅을 두고 다투는 시간이 아니게 됐다
  if (rows.length === 0) return null
  const top = Math.max(...rows.map(([, n]) => n))
  const leaders = rows.filter(([, n]) => n === top)
  // 동점이면 아무도 못 뺏는다. 서 있던 쪽이 지킨 것이다
  return leaders.length === 1 ? leaders[0][0] : before
}

// ── 행동 하나 ───────────────────────────────────────────────────

export type ActResult =
  | { ok: true; next: PhaseState; log: LogLine; spent: number }
  | { ok: false; why: string }

const no = (why: string): ActResult => ({ ok: false, why })

/** 움직인 사람으로 적어 둔다. 결석 보정이 이 목록을 본다. */
function marked(out: ActResult, playerId: string): ActResult {
  if (!out.ok || out.next.actedBy.includes(playerId)) return out
  return { ...out, next: { ...out.next, actedBy: [...out.next.actedBy, playerId] } }
}

/** 물건 하나를 꺼내 쓴다. 되지 않은 행동은 아무것도 꺼내지 않는다. */
function spent(out: ActResult, state: PhaseState, playerId: string, kind: ActionKind): ActResult {
  const need = ITEM_FOR[kind]
  if (!out.ok || !need) return out
  const team = state.people.find((p) => p.playerId === playerId)?.team
  if (!team) return out
  const left = takeItem(out.next.satchels[team], need)
  if (!left) return no(`${ITEM_BY_KIND[need].name}이(가) 없다. 상점에서 산다.`)
  return { ...out, next: { ...out.next, satchels: { ...out.next.satchels, [team]: left } } }
}

/**
 * 행동 하나를 지금 당장 처리한다.
 *
 * 라이브라서 순서가 곧 먼저 한 사람 순이다. 꽉 찬 방에 둘이 들어가려 하면
 * 먼저 누른 쪽만 들어간다 — 동시 제출 때처럼 낸 시각을 따로 견줄 필요가 없다.
 *
 * **토큰이 모자라면 아무 일도 일어나지 않는다.** 먼저 되는지 보고, 되는
 * 경우에만 깎는다. 반쯤 되고 토큰만 빠지는 일은 없어야 한다.
 */
export function doAct(state: PhaseState, playerId: string, act: Act): ActResult {
  return marked(spent(runAct(state, playerId, act), state, playerId, act.kind), playerId)
}

function runAct(state: PhaseState, playerId: string, act: Act): ActResult {
  const me = state.people.find((p) => p.playerId === playerId)
  if (!me) return no('이 판에 없는 사람이다.')

  const cost = ACT_COST[act.kind]
  if (me.tokens < cost) return no(`토큰이 모자란다. ${cost}개가 든다.`)

  // 물건이 드는 행동이면 **먼저** 있는지 본다. 거절은 값을 먹지 않는다
  const needItem = ITEM_FOR[act.kind] ?? null
  if (needItem && countOf(state.satchels[me.team], needItem) <= 0) {
    return no(`${ITEM_BY_KIND[needItem].name}이(가) 없다. 상점에서 산다.`)
  }

  const people = state.people.map((p) => ({ ...p }))
  let robots = state.robots.map((r) => ({ ...r }))
  const byId = new Map(people.map((p) => [p.playerId, p]))
  const mine = byId.get(playerId) as Person

  // 걸어오는 중인 사람도 한 자리를 잡아 둔다. **로봇은 정원에 안 든다**
  const seats = (tileId: TileId) => people.filter((p) => p.tileId === tileId || p.toTile === tileId).length
  const botsAt = (tileId: TileId) => robots.filter((r) => r.tileId === tileId).length
  const carriedOf = (id: string) => robots.filter((r) => r.carriedBy === id)

  /**
   * 사람 하나를 문 밖으로 내보낸다. **바로 도착하지 않는다.**
   *
   * 나가는 데 5분, 들어가는 데 5분. 그동안은 어느 방에도 없고, 데리고
   * 있는 로봇도 함께 사라진다. 도착은 서버의 시계가 시킨다 — 이 함수는
   * 「떠났다」까지만 안다.
   */
  function step(p: Person, to: TileId): string | null {
    if (p.tileId === null) return '이미 걷는 중이다.'
    if (!ADJACENCY[p.tileId]?.includes(to)) return '옆방이 아니다.'
    const room = capacityOf(to)
    if (seats(to) + 1 > room) return `${TILE_BY_ID[to].name}이(가) 꽉 찼다. 정원 ${room}.`
    const from = p.tileId
    const carried = carriedOf(p.playerId)
    // 저쪽 방에 로봇 자리가 모자라면 **사람은 간다.** 넘치는 로봇만
    // 떠난 방에 남는다 — 로봇 때문에 사람이 못 가면 로봇으로 문을
    // 막는 짓이 다시 생긴다. 화면은 누르기 전에 robotsLeftBehind()로 경고한다
    const spare = Math.max(0, ROBOTS_PER_ROOM - botsAt(to))
    p.tileId = null
    p.toTile = to
    for (const [i, r] of carried.entries()) {
      if (i < spare) {
        // 데리고 가는 로봇은 미리 그 방에 놓는다. 판정에는 사람이
        // 도착해야 끼지만, 자리는 지금부터 잡아야 남이 새치기하지 못한다
        r.tileId = to
      } else {
        r.tileId = from
        r.carriedBy = null
      }
    }
    return null
  }

  let log: LogLine

  switch (act.kind) {
    case 'move': {
      const to = act.targetTile
      if (!to || !TILE_BY_ID[to]) return no('그런 방은 없다.')
      const bad = step(mine, to)
      if (bad) return no(bad)
      log = { kind: 'moved', playerId, tileId: to, team: mine.team }
      break
    }

    case 'summon': {
      // 같은 팀 한 명을 내 쪽으로 한 칸 끌어온다. 부르는 것도 걸음이라
      // 끌려오는 사람은 10분 동안 어느 방에도 없다
      if (mine.tileId === null) return no('걷는 중이다. 도착해야 할 수 있다.')
      const target = act.targetPlayer ? byId.get(act.targetPlayer) : undefined
      if (!target) return no('그런 사람이 없다.')
      if (target.team !== mine.team) return no('같은 팀만 부를 수 있다.')
      // 보이지 않는 사람은 부를 수 없다. 부르는 쪽도 못 부른다
      if (state.invisibleId === playerId) return no('보이지 않는 동안에는 부를 수 없다.')
      if (state.invisibleId === target.playerId) return no('그런 사람이 없다.')
      if (target.tileId === null) return no('그 사람은 걷는 중이다.')
      if (target.tileId === mine.tileId) return no('이미 같은 방에 있다.')
      const next = stepToward(target.tileId, mine.tileId)
      if (!next) return no('길이 없다.')
      const bad = step(target, next)
      if (bad) return no(bad)
      log = { kind: 'summoned', playerId, targetPlayer: target.playerId, tileId: next }
      break
    }

    case 'disturb': {
      if (mine.tileId === null) return no('걷는 중이다. 도착해야 할 수 있다.')
      // 같은 방의 상대 하나를 이번 페이즈 점령 판정에서 0으로 만든다.
      // 쫓아내지는 못한다 — 사람은 그대로 서 있고 숫자만 빠진다
      if (act.targetPlayer) {
        const t = byId.get(act.targetPlayer)
        if (!t || t.tileId !== mine.tileId || t.team === mine.team) return no('그 사람이 같은 방에 없다.')
        // 없는 사람은 방해할 수 없다. 이미 없는 것으로 세어진다
        if (state.invisibleId === t.playerId) return no('그 사람이 같은 방에 없다.')
        if (state.zeroedPeople.includes(t.playerId)) return no('이미 방해받고 있다.')
        log = { kind: 'disturbed', playerId, targetPlayer: t.playerId, tileId: mine.tileId }
        return {
          ok: true,
          spent: cost,
          log,
          next: {
            ...state,
            people: people.map((p) => (p.playerId === playerId ? { ...p, tokens: p.tokens - cost } : p)),
            zeroedPeople: [...state.zeroedPeople, t.playerId],
          },
        }
      }
      if (act.targetRobot) {
        const bot = robots.find((r) => r.id === act.targetRobot && r.tileId === mine.tileId && r.team !== mine.team)
        if (!bot) return no('그 로봇이 같은 방에 없다.')
        if (state.zeroedRobots.includes(bot.id)) return no('이미 방해받고 있다.')
        log = { kind: 'disturbed', playerId, targetRobot: bot.id, tileId: mine.tileId }
        return {
          ok: true,
          spent: cost,
          log,
          next: {
            ...state,
            people: people.map((p) => (p.playerId === playerId ? { ...p, tokens: p.tokens - cost } : p)),
            zeroedRobots: [...state.zeroedRobots, bot.id],
          },
        }
      }
      return no('대상을 골라야 한다.')
    }

    case 'disguise': {
      if (state.disguised.includes(playerId)) return no('이미 위장하고 있다.')
      mine.tokens -= cost
      return {
        ok: true,
        spent: cost,
        log: { kind: 'disguised', playerId },
        next: { ...state, people, robots, disguised: [...state.disguised, playerId] },
      }
    }

    case 'dropRobot': {
      if (mine.tileId === null) return no('걷는 중이다. 도착해야 할 수 있다.')
      const held = carriedOf(playerId)
      if (held.length === 0) return no('데리고 있는 로봇이 없다.')
      // 데리고 있는 것도 이 방에 서 있는 것으로 세어진다. 손을 놓는
      // 것뿐이라 수가 늘지는 않지만, 남의 로봇으로 이미 찼으면 못 둔다
      if (botsAt(mine.tileId) - held.length + 1 > ROBOTS_PER_ROOM) {
        return no(`이 방에 로봇이 ${ROBOTS_PER_ROOM}기까지다.`)
      }
      held[0].carriedBy = null
      log = { kind: 'robotLeft', playerId, tileId: mine.tileId, targetRobot: held[0].id }
      break
    }

    case 'smashRobot': {
      if (mine.tileId === null) return no('걷는 중이다. 도착해야 할 수 있다.')
      // **상대가 보고 있어도 부순다.** 남의 눈을 피해야 한다는 조건을
      // 없앤 대신, 한 사람은 한 페이즈에 한 기까지다
      const done = state.smashedBy.filter((id) => id === playerId).length
      if (done >= SMASHES_PER_PHASE) return no('이번 페이즈에는 이미 부쉈다.')
      const bot = robots.find((r) => r.id === act.targetRobot && r.tileId === mine.tileId && r.team !== mine.team)
      if (!bot) return no('그 로봇이 여기 없다.')
      robots = robots.filter((r) => r.id !== bot.id)
      mine.tokens -= cost
      return {
        ok: true,
        spent: cost,
        log: { kind: 'robotSmashed', playerId, tileId: mine.tileId, targetRobot: bot.id },
        next: { ...state, people, robots, smashedBy: [...state.smashedBy, playerId] },
      }
    }

    case 'research': {
      if (mine.tileId === null) return no('걷는 중이다. 도착해야 할 수 있다.')
      if (ROOM_KIND[mine.tileId] !== 'lab') return no('연구실에서만 연구할 수 있다.')
      if (state.pendingResearch.some((r) => r.playerId === playerId)) {
        return no('이미 연구를 걸어 두었다.')
      }
      // 걸어 둔 연구도 자리를 잡아 둔다. 안 그러면 넷이 한꺼번에 걸고
      // 넷 다 완성되어 한도를 넘는다
      const coming = state.pendingResearch.filter(
        (r) => state.people.find((q) => q.playerId === r.playerId)?.team === mine.team,
      )
      if (robotsOfTeam(state, mine.team) + coming.length >= ROBOTS_PER_TEAM) {
        return no(`로봇은 팀당 ${ROBOTS_PER_TEAM}기까지다.`)
      }
      // 발전소를 쥔 팀은 그 자리에서 로봇이 나온다. 값과는 상관없다
      const hasPlant = TILES.some((t) => ROOM_KIND[t.id] === 'plant' && state.owners[t.id] === mine.team)
      // 값은 **이 연구실을 누가 쥐고 있느냐**로 갈린다
      const landlord = state.owners[mine.tileId] ?? null
      const ownsLab = landlord === mine.team
      // **지식이 모자라면 고를 수 없다.** 토큰도 안 든다
      const need = researchKnowledge(ownsLab)
      const purse = vaultOf(state, mine.team)
      if (purse.knowledge < need) return no(`지식이 모자란다. ${need}점이 든다.`)
      // 걸 때 바로 뺀다. 완성될 때 빼면 그사이에 같은 금고로 셋이
      // 더 걸어서 없는 지식으로 넷이 연구한 판이 된다
      const paidTo = ownsLab ? null : landlord
      let paid: Partial<Record<TeamId, Vault>> = {
        ...state.vaults,
        [mine.team]: { ...purse, knowledge: purse.knowledge - need },
      }
      // 남의 연구실이면 낸 값이 주인 팀 금고로 들어간다
      if (paidTo) {
        const his = paid[paidTo] ?? EMPTY_VAULT
        paid = { ...paid, [paidTo]: { ...his, knowledge: his.knowledge + need } }
      }
      const queued: PendingResearch = { playerId, knowledge: need, paidTo }

      if (!hasPlant) {
        mine.tokens -= cost
        return {
          ok: true,
          spent: cost,
          log: { kind: 'researchStarted', playerId, tileId: mine.tileId },
          next: {
            ...state,
            people,
            robots,
            vaults: paid,
            pendingResearch: [...state.pendingResearch, queued],
          },
        }
      }
      if (botsAt(mine.tileId) + 1 > ROBOTS_PER_ROOM) return no(`이 방에 로봇이 ${ROBOTS_PER_ROOM}기까지다.`)
      robots = [...robots, born(mine, robots, `now-${playerId}-${state.robots.length}`, mine.tileId)]
      mine.tokens -= cost
      return {
        ok: true,
        spent: cost,
        log: { kind: 'researchDone', playerId, tileId: mine.tileId },
        next: { ...state, people, robots, vaults: paid },
      }
    }
  }

  mine.tokens -= cost
  return { ok: true, spent: cost, log, next: { ...state, people, robots } }
}

/** 새로 나온 로봇 하나. 두 기까지만 데리고 다닌다 — 넘치면 그 자리에 선다. */
function born(owner: Person, robots: readonly Robot[], id: string, at: TileId): Robot {
  const carried = robots.filter((r) => r.carriedBy === owner.playerId).length
  return {
    id: `bot-${id}`,
    team: owner.team,
    tileId: at,
    carriedBy: carried < MAX_CARRIED_ROBOTS ? owner.playerId : null,
  }
}

/**
 * 걷던 사람이 도착했다. 서버의 시계가 부른다.
 *
 * 자리를 다시 보지 않는다 — 떠날 때 이미 잡아 두었다. 여기서 또 보면
 * 「출발은 됐는데 도착을 못 하는」 사람이 생긴다.
 */
export function arrive(state: PhaseState, playerId: string): PhaseState {
  const people = state.people.map((p) =>
    p.playerId === playerId && p.toTile ? { ...p, tileId: p.toTile, toTile: null } : p,
  )
  return { ...state, people }
}

// ── 페이즈 닫기 ─────────────────────────────────────────────────

export interface SettleResult {
  next: PhaseState
  log: readonly LogLine[]
}

/**
 * 한 시간이 끝났다. **서 있는 자리로 주인을 정한다.**
 *
 * 행동은 이미 그때그때 처리됐다. 여기서 하는 일은 두 가지뿐이다 —
 * 머릿수를 세는 것과, 지난 페이즈에 걸어 둔 연구를 로봇으로 만드는 것.
 *
 * 연구로 새로 난 로봇은 **이번 판정에 끼어들지 않는다.** 페이즈가 끝나는
 * 순간에 머릿수가 하나 느는 것은 아무도 대응할 수 없다.
 */
export function settle(state: PhaseState): SettleResult {
  const log: LogLine[] = []
  const zeroedPeople = new Set(state.zeroedPeople)
  const zeroedRobots = new Set(state.zeroedRobots)

  const owners: Partial<Record<TileId, TeamId | null>> = { ...state.owners }
  for (const t of TILES) {
    // **기지는 판정하지 않는다.** 제 팀 것으로 못 박혀 있다 — 아무도
    // 안 서 있다고 기지를 잃으면 시작 땅도 연결 점수도 근거가 없어진다
    if (t.homeOf) {
      owners[t.id] = t.homeOf
      continue
    }
    // **계단은 아무도 못 가진다.** 지나다니는 자리지 차지하는 자리가 아니다
    if (t.tier === 'stair') {
      owners[t.id] = null
      continue
    }
    const w: Partial<Record<TeamId, number>> = {}
    for (const p of state.people) {
      // 걷는 중인 사람은 어느 방에도 없다. 마지막 순간의 이동은 도박이다
      if (p.tileId !== t.id || zeroedPeople.has(p.playerId)) continue
      // 투명인간은 서 있어도 0명이다
      if (state.invisibleId === p.playerId) continue
      w[p.team] = (w[p.team] ?? 0) + headOf(p)
    }
    for (const r of state.robots) {
      if (r.tileId !== t.id || zeroedRobots.has(r.id)) continue
      w[r.team] = (w[r.team] ?? 0) + 1
    }
    const before = state.owners[t.id] ?? null
    const after = ownerOf(w, before)
    owners[t.id] = after
    if (after !== before && after) log.push({ kind: 'captured', tileId: t.id, team: after })
  }

  // 지난 페이즈의 연구가 이제 로봇이 된다
  let robots = [...state.robots]
  const botsAt = (tileId: TileId) => robots.filter((r) => r.tileId === tileId).length
  const botsOf = (team: TeamId) => robots.filter((r) => r.team === team).length
  /** 불발된 연구에 돌려주는 토큰. 사람별로 모았다가 한 번에 얹는다. */
  const refund = new Map<string, number>()
  /** 불발이면 지식도 같이 돌려준다. 걸 때 뺐으므로 도로 넣어야 한다. */
  const vaults: Partial<Record<TeamId, Vault>> = { ...state.vaults }
  let made = 0
  for (const r of state.pendingResearch) {
    const id = r.playerId
    const p = state.people.find((q) => q.playerId === id)
    // 연구를 건 사람이 걷는 중이면 로봇이 설 자리가 없다. 다음으로 미룬다
    if (!p || p.tileId === null) continue
    // **한도에 걸리면 불발이고 값을 돌려준다.** 같은 팀 사람이 먼저
    // 완성해서 막힌 것이라 이 사람의 잘못이 아니다. 자리가 없는 것과
    // 달라서 다음으로 미루지도 않는다 — 한도는 다음 페이즈에도 그대로다
    if (botsOf(p.team) >= ROBOTS_PER_TEAM || botsAt(p.tileId) + 1 > ROBOTS_PER_ROOM) {
      refund.set(id, (refund.get(id) ?? 0) + ACT_COST.research)
      // 지식도 **걸 때 적어 둔 액수 그대로** 돌린다. 지금 값으로 세면
      // 그사이 연구실 주인이 바뀐 만큼 남의 일로 손해를 본다.
      // 주인에게 냈던 것이면 주인 금고에서 도로 빼서 돌려준다
      const back = vaults[p.team] ?? EMPTY_VAULT
      vaults[p.team] = { ...back, knowledge: back.knowledge + r.knowledge }
      if (r.paidTo) {
        const his = vaults[r.paidTo] ?? EMPTY_VAULT
        vaults[r.paidTo] = { ...his, knowledge: Math.max(0, his.knowledge - r.knowledge) }
      }
      log.push({ kind: 'researchFizzled', playerId: id, tileId: p.tileId })
      continue
    }
    made += 1
    robots = [...robots, born(p, robots, `${id}-${made}`, p.tileId)]
    log.push({ kind: 'researchDone', playerId: id, tileId: p.tileId })
  }

  const people =
    refund.size === 0
      ? state.people
      : state.people.map((p) => (refund.has(p.playerId) ? { ...p, tokens: p.tokens + (refund.get(p.playerId) as number) } : p))

  return {
    next: {
      people,
      robots,
      vaults,
      owners,
      pendingResearch: [],
      zeroedPeople: [],
      zeroedRobots: [],
      disguised: [],
      smashedBy: [],
      actedBy: [],
      // 물건은 페이즈를 넘어 남는다. 산 것을 못 쓰고 잃으면 아무도 안 산다
      satchels: state.satchels,
    },
    log,
  }
}

/**
 * 결석 보정 — 한 명도 움직이지 않은 팀의 사람마다 돌려줄 토큰.
 *
 * **팀 단위로 본다.** 한 사람만 접속해서 움직였으면 그 팀은 결석이
 * 아니다 — 남은 사람이 대신 움직일 수 있었다는 뜻이라서, 개인의
 * 사정까지 메워 주면 안 들어오는 편이 이득이 된다.
 */
export function absenceRefunds(state: PhaseState, teams: readonly TeamId[]): Record<string, number> {
  const acted = new Set(state.actedBy)
  const out: Record<string, number> = {}
  for (const team of teams) {
    const members = state.people.filter((p) => p.team === team)
    if (members.length === 0) continue
    if (members.some((p) => acted.has(p.playerId))) continue
    for (const p of members) {
      const back = absenceRefund(p.tokens)
      if (back > 0) out[p.playerId] = back
    }
  }
  return out
}

/**
 * from 에서 to 쪽으로 한 칸. 최단 경로의 첫 걸음이다.
 *
 * 너비 우선으로 찾는다 — 판이 스물다섯 칸뿐이라 미리 표를 만들 이유가 없고,
 * 표를 만들면 판을 고칠 때 같이 고쳐야 하는 것이 하나 더 는다.
 */
export function stepToward(from: TileId, to: TileId): TileId | null {
  if (from === to) return null
  const prev = new Map<TileId, TileId>()
  const seen = new Set<TileId>([from])
  const queue: TileId[] = [from]
  while (queue.length > 0) {
    const at = queue.shift() as TileId
    for (const next of ADJACENCY[at] ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      prev.set(next, at)
      if (next === to) {
        let cur = to
        while (prev.get(cur) !== from) cur = prev.get(cur) as TileId
        return cur
      }
      queue.push(next)
    }
  }
  return null
}

/**
 * 남에게 보이는 머릿수. **위장은 여기서만 산다.**
 *
 * 판정은 이 값을 쓰지 않는다. 같은 팀에게는 진짜 숫자가 간다.
 */
export function shownCount(
  state: PhaseState,
  tileId: TileId,
  viewerTeam: TeamId,
  disguised: readonly string[],
): number {
  const wearing = new Set(disguised)
  let n = 0
  for (const p of state.people) {
    // 걷는 중인 사람은 안 보인다
    if (p.tileId === null || p.tileId !== tileId) continue
    n += p.team !== viewerTeam && wearing.has(p.playerId) ? DISGUISE_SHOWN_AS : 1
  }
  n += state.robots.filter((r) => r.tileId === tileId).length
  return n
}
