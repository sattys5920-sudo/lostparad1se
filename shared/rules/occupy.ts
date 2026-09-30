// 점령 — 방은 깃발을 많이 꽂은 팀의 것이다.
//
// 한때는 페이즈가 끝날 때 **그 방에 서 있는 머릿수**로 주인을 정했다.
// 이제는 **꽂힌 깃발 수**로 정한다(rules/flag). 깃발은 페이즈 중에만
// 꽂고, 뽑히기 전까지 남는다. 뽑으려면 서로 다른 두 사람이 손대야 한다
// (사람마다 토큰). 로봇은 **방에 놓아야** 깃발 하나로 센다 — 들고 다니는
// 것은 가방 속이라 안 센다. 놓고 거두는 것은 페이즈 중에만, 놓은 사람만.
//
// **페이즈는 한 시간짜리 라이브 판이다.** 관리자가 열면 한 시간이 흐르고,
// 그동안 각자 토큰만큼 움직이고 깃발을 꽂는다. 한 시간이 끝난 순간 방마다
// 깃발과 로봇을 세서 주인이 정해진다.
//
// 전에는 모두가 행동 하나를 몰래 고르고 한꺼번에 까는 방식이었다. 그것도
// 되는 게임이지만, 한 시간을 살아 움직이는 쪽을 골랐다. 판이 넓고 안개가
// 있어서 남이 어디 있는지는 어차피 대부분 안 보인다.
//
// 이 파일은 **순수 함수**다. 문서도 시계도 데이터베이스도 모른다.
// 같은 입력에 늘 같은 결과라, 서버가 돌리든 시험이 돌리든 같다.
import { ROAM_TO, TILE_BY_ID, TILES, canRoamTo, type TileId } from './board'
import { ITEM_BY_KIND, ITEM_FOR, LOCKED_DOOR, countOf, takeItem, type Satchels } from './items'
import { TOTAL_SEATS } from './lobby'
import { PULL_COST, PULL_HITS, canHoldFlags, flagsIn, pullTarget, withPlanted, withPulled, type FlagBoxes, type FlagMap } from './flag'
import type { TeamId, Tier } from './v2'
import { josa } from '../text'

// ── 수치 ────────────────────────────────────────────────────────
//
// 플레이테스트에서 제일 먼저 손댈 값들이라 한곳에 모은다.

/**
 * 한 페이즈가 열려 있는 시간(분). 게임 시계로 잰다.
 *
 * 관리자가 이보다 일찍 닫을 수는 있어도 늦게까지 끌 수는 없다 — 시간이
 * 지나면 아무도 더 못 움직인다. 안 그러면 늦게 닫히는 페이즈에서 토큰이
 * 남은 사람만 계속 유리하다.
 */
export const PHASE_MINUTES = 60

/**
 * 페이즈가 열릴 때 **팀 상자에** 들어오는 토큰.
 *
 * **사람 수를 안 곱한다.** 전에는 1인당 넷씩(세 명짜리 팀은 다섯씩)
 * 주고 인원을 곱해서, 네 명짜리 팀은 16, 세 명짜리는 15를 받았다.
 * 곱하고 나니 한 페이즈에 방을 열여섯 번 드나들 수 있는 셈이라
 * 토큰이 아무것도 조이지 못했고, 인원이 다른 팀을 맞추려고 얹은
 * 보정도 곱셈이 만든 문제를 곱셈으로 덮는 것이었다.
 *
 * **여섯이다.** 팀이 몇이든 한 페이즈에 낼 수 있는 행동은 여섯 번.
 * 인원이 다른 것은 손이 많고 적은 차이로 남고, 팀의 힘은 같다.
 *
 * **남으면 그대로 간다.** 토큰은 거래할 수 있는 물건이라, 페이즈가
 * 닫힐 때 태워 버리면 「토큰을 받고 무엇을 준다」가 성립하지 않는다.
 * 아껴 두었다가 자유 시간에 남에게 넘길 수도 있다.
 */
export const TOKENS_PER_PHASE = 6

/**
 * 분단이 쥘 수 있는 토큰의 한도. **두 페이즈치까지.**
 *
 * 남는 것을 그대로 두면 쉰 페이즈 동안 쌓여서 나중에는 아무 값도
 * 아니게 된다. 한편 한 푼도 못 남기면 거래할 물건이 못 된다.
 *
 * 지급과 마찬가지로 **사람 수를 안 곱한다.**
 */
export const TOKEN_CAP = TOKENS_PER_PHASE * 2

/**
 * 이번 페이즈에 이 팀 상자가 갖게 될 토큰.
 *
 * **인원을 안 본다.** 어느 팀이든 여섯씩 들어온다. 남은 것에 더하되
 * **합이 한도(12)를 넘지 않는다** — 보유할 수 있는 최대가 12 다.
 *
 * 결석 보정 · 투명인간 보정 · 꼴찌 보정은 없다. 받는 길은 이것 하나다.
 */
export function nextWallet(input: { held: number }): number {
  return Math.min(Math.max(0, input.held) + TOKENS_PER_PHASE, TOKEN_CAP)
}

/**
 * **방에** 들어갈 때 드는 토큰. 나갈 때는 안 든다.
 *
 * 값이 붙는 것은 방에 들어서는 일 하나뿐이다. 방 안을 걸어 다니는
 * 것도, 복도도, **계단도** 공짜다 — 셋 다 지나가는 곳이라 지나가는
 * 값을 물리지 않는다. 계단을 물리면 위층 방 하나가 아래층 방 하나의
 * 두 배가 되고, 그러면 아무도 층을 안 넘는다.
 *
 * 그래서 어디서 어디로 가든 값은 토큰 하나다. 조이는 것은 시계다 —
 * 문 하나를 넘는 데 10분(나가는 5분 + 들어서는 5분)이라, 계단 둘을
 * 거치는 길도 값은 하나다.
 */
export const ENTER_COST = 1

/**
 * 방 하나 옮기는 데 10분. **토큰과 별개로 시간이 든다.**
 *
 * 나가는 데 5분, 들어서는 데 5분 — 둘을 합친 값이다. 그동안은 어느
 * 방에도 없다. 값 하나로 두지만 뜻은 편도 한 걸음이 아니라 「방을
 * 나서는 5분 + 다음 방에 닿는 5분」이다.
 */
export const MOVE_MINUTES = 10

// **거래는 값이 안 든다.**
//
// 거는 쪽이 개인 토큰 하나를 내고, 하루에 열두 개를 쥐고 시작했다.
// 말을 거는 데 값을 물리니 아껴 쓰게 되고, 마주쳐도 그냥 지나가는
// 일이 늘었다. 자유 시간은 만나라고 있는 시간인데 만남에 값을
// 물리고 있었던 셈이다.
//
// 값도 한도도 없앤다. 몇 번을 걸든 상대가 안 받으면 그만이고,
// 받아도 탁자에 올릴 것이 없으면 그만이다 — 조이는 것은 이미
// 금고다.

/** 사람 한 명이 들고 다닐 수 있는 로봇. 든 로봇은 판정에도 방 한도에도 안 든다. */
export const MAX_CARRIED_ROBOTS = 2

/*
 * **로봇은 방에도 분단에도 한도가 없다.** 한도는 한 사람이 드는 수
 * (MAX_CARRIED_ROBOTS) 하나뿐이다. 놓는 것은 몇 기든 한 방에 놓는다.
 */

/**
 * (옛 규칙) 한 사람이 한 페이즈에 부술 수 있는 로봇. **지금은 안 쓴다** —
 * 부수기는 드라이버 한 자루에 한 기이고, 드라이버가 하루 열 자루다.
 *
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
/** 연구가 로봇이 되기까지 걸리는 페이즈. */
export const RESEARCH_PHASES = 1

/**
 * 연구 한 번에 드는 **본인 지갑의 지식.** 팀 토큰과 별개로 든다.
 *
 * 토큰은 팀이 나눠 쓰지만 지갑은 각자다. 그래서 로봇을 뽑는 일이
 * 팀의 살림이 아니라 그 사람의 부지런함이다.
 *
 * **지식이 나는 곳은 문제 종이 하나뿐이다**(자유 시간, 한 장에 1).
 * 공부를 없애면서 그렇게 됐다 — 로봇 한 대가 종이 두 장이고, 종이는
 * 운영자가 놓는 만큼만 있다.
 */
export const KNOWLEDGE_PER_RESEARCH = 3
export const KNOWLEDGE_PER_RESEARCH_OWNER = 1

/**
 * 이번 연구에 드는 지식.
 *
 * **연구실을 차지한 팀은 한 점, 남은 세 점이다.** 낸 지식은 사라진다 —
 * 연구실을 쥐는 값은 받는 것이 아니라 덜 내는 것이다. 왜 그렇게
 * 했는지는 act 의 research 갈래에 적어 두었다.
 */
export const researchKnowledge = (ownsLab: boolean): number =>
  ownsLab ? KNOWLEDGE_PER_RESEARCH_OWNER : KNOWLEDGE_PER_RESEARCH

export type RoomKind = 'normal' | 'narrow' | 'lab'

/** 방에 들어갈 수 있는 머릿수. **사람만 센다** — 로봇은 정원에 안 든다. */
export const ROOM_CAPACITY: Record<RoomKind, number> = {
  normal: 6,
  narrow: 2,
  lab: 4,
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
 *   중앙광장  2-3 교실 — 아무도 못 가지는 방이다. 발전소였던 자리다
 */
export const KIND_BY_TIER: Record<Tier, RoomKind> = {
  zone1: 'normal',
  gate: 'narrow',
  // 교차로는 지나다니는 길목이라 넓다. 전에는 여기가 연구실이었는데,
  // 연구실을 따로 한 칸 만들면서 셋 다 평범한 방으로 돌아갔다
  cross: 'normal',
  lab: 'lab',
  core: 'normal',
  // 한때 발전소(연구가 바로 나던 방)였다. 2-3 교실이 되면서 아무도
  // 못 가지는 방이 됐고, 효과가 쓰일 길이 없어 종류째 걷어냈다
  plaza: 'normal',
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
}

/** 팀마다 하나인 페이즈 토큰 상자. */
export type Wallets = Readonly<Partial<Record<TeamId, number>>>

/** 그 팀 상자에 남은 토큰. */
export const walletOf = (state: PhaseState, team: TeamId): number => state.wallets[team] ?? 0

/**
 * 로봇 — **놓아야 깃발 하나로 센다.**
 *
 * 들고 있는 로봇은 가방 속 물건이다. 어느 방 판정에도 안 들어가고, 방의
 * 로봇은 방 한도가 없다. 방에 놓는 순간부터 그 방에서
 * 사라지지 않는 깃발처럼 센다 — 페이즈가 바뀌어도 남는다. 놓은 사람만
 * 도로 거둔다(takeRobot). 남의 팀은 부수기로만 없앤다.
 */
export interface Robot {
  id: string
  team: TeamId
  /** 놓인 방. 들고 있는 동안은 든 사람이 선 방을 따라간다(판정엔 안 든다) */
  tileId: TileId
  /** 누가 들고 있는가. 방에 놓인 로봇은 null. */
  carriedBy: string | null
  /** 누가 놓았는가. **이 사람만 도로 거둔다.** 없으면(옛 판) 같은 팀 누구나 */
  placedBy?: string | null
}

/** 방에 놓인 로봇인가 — 판정 · 방 한도 · 남에게 보이는 것은 이것만이다 */
export const isPlaced = (r: Pick<Robot, 'carriedBy'>): boolean => r.carriedBy === null

/**
 * 이 사람이 이 로봇을 도로 거둘 수 있는가. **주인만** — 만든 사람, 거래로 받았으면 받은
 * 사람이다. 분단은 안 본다(옛 판처럼 놓은 사람이 안 적힌 로봇만 같은 팀 누구나)
 */
export const canCollectRobot = (r: Pick<Robot, 'carriedBy' | 'team' | 'placedBy'>, playerId: string, team: TeamId): boolean =>
  isPlaced(r) && (r.placedBy ? r.placedBy === playerId : r.team === team)

/**
 * 걸어 둔 연구 한 건.
 *
 * **낸 값을 그대로 적어 둔다.** 페이즈가 닫힐 때까지 안 익으면 그대로
 * 사라진다 — 낸 지식은 돌려받지 못한다. 남은 시간을 보고 걸라는
 * 압박이 그대로 규칙이다.
 */
export interface PendingResearch {
  playerId: string
  /** 걸 때 낸 지식. */
  knowledge: number
  /** 어느 연구실에 걸었는가. **완성품이 그 방에 놓인다.** */
  tileId: TileId
  /** 어느 연구 기계인가(rules/trap 의 LAB_MACHINES 번호). 한 대에 한 건이다 */
  machine?: number
}

export interface PhaseState {
  people: readonly Person[]
  robots: readonly Robot[]
  owners: Readonly<Partial<Record<TileId, TeamId | null>>>
  /** 지금 돌고 있는 연구들. 스무 분 뒤에 그 연구실에 완성품이 놓인다. */
  pendingResearch: readonly PendingResearch[]
  /**
   * 방마다 꽂힌 깃발. **페이즈가 끝나면 사라진다** — 주인을 정하고 걷는다.
   * 페이즈가 끝날 때 이것과 로봇으로 주인이 정해진다.
   */
  flags: FlagMap
  /** 팀마다 깃발 상자. 꽂으면 하나씩 빠진다. */
  flagBoxes: FlagBoxes
  /**
   * 방마다 팀마다, 그 깃발에 손댄 사람들. **서로 다른 두 사람이 모이면
   * 하나가 뽑힌다** — 그때 이 목록은 비워진다. 깃발처럼 페이즈가
   * 바뀌어도 남는다.
   */
  flagPullHits: Readonly<Partial<Record<TileId, Readonly<Partial<Record<TeamId, readonly string[]>>>>>>
  /** 이번 페이즈에 로봇을 부순 사람. 한 사람 한 기까지다. */
  smashedBy: readonly string[]
  /** 사람마다 가진 물건. 행동에 딸린 물건은 **쓰는 사람 것에서** 빠진다. */
  satchels: Satchels
  /**
   * 팀이 함께 쓰는 토큰 상자. **한 팀에 하나다.**
   *
   * 예전에는 사람마다 지갑이 따로였다. 그때는 누가 얼마를 쓰든 남에게
   * 지장이 없어서, 팀이라고 부르면서 실은 넷이 따로 놀았다. 이제 한
   * 주머니를 넷이 나눠 쓴다 — 먼저 쓰는 사람이 임자다. 누가 몇 번
   * 움직일지를 말로 정하지 않으면 마지막 사람은 아무것도 못 한다.
   */
  wallets: Wallets
  /**
   * 이번 페이즈에 무엇이든 한 사람.
   *
   * 결석 보정이 이것을 본다 — 한 팀에서 아무도 여기 없으면 그 팀은
   * 한 시간을 통째로 잃은 것이다.
   */
  actedBy: readonly string[]
  /**
   * 지금 잠겨 있는 방과 **잠근 팀.**
   *
   * 언제까지인지는 여기 없다. 순수 함수라 시계를 모르고, 알 필요도
   * 없다 — 서버가 부를 때 살아 있는 것만 담아서 넘긴다.
   */
  locks?: Readonly<Partial<Record<TileId, TeamId>>>
  /**
   * 오늘 지워진 사람. 없으면 null.
   *
   * **사람과 얽히는 일의 대상이 되지 않는다** — 호출이 이 사람을
   * 지나친다. 깃발은 뽑지 못한다. 들고 있는 로봇은 가방 속이라 아무도 못 부순다.
   */
  invisibleId?: string | null
  /**
   * 팀마다의 금고. **키는 팀이다.** 연구가 지식을 여기서 뺀다.
   *
   * 한 번 사람마다의 지갑으로 갈랐다가 도로 합쳤다. 넷이 같이 벌고
   * 같이 쓴다 — 누가 번 돈이든 팀 금고로 들어가고, 넷 중 누구든
   * 꺼내 쓴다. 먼저 쓰는 사람이 임자다.
   */
  vaults: Readonly<Partial<Record<TeamId, Vault>>>
}

/** 팀 금고. 규칙이 보는 것은 지식뿐이다(연구) — 돈은 사람 것이다(PawnDoc.money). */
export interface Vault {
  money: number
  knowledge: number
}

const EMPTY_VAULT: Vault = { money: 0, knowledge: 0 }

/** 그 팀 금고. 없으면 빈 것으로 친다. */
export const vaultOf = (state: PhaseState, team: TeamId): Vault => state.vaults[team] ?? EMPTY_VAULT

export type ActionKind = 'move' | 'research' | 'summon' | 'plant' | 'pull' | 'dropRobot' | 'takeRobot' | 'smashRobot'

/**
 * 행동에 드는 토큰. 이동은 **방 하나에 들어서는 값**이다.
 *
 * 나가는 데도, 복도를 걷는 데도, 계단을 오르내리는 데도 안 든다 —
 * 계단은 칸이 아니라 문이다. 그래서 옆방이든 지하든 옥상이든
 * 어디로 가도 토큰 하나다.
 */
export const ACT_COST: Record<ActionKind, number> = {
  move: ENTER_COST,
  // **연구는 토큰이 안 든다.** 지식만 든다(researchKnowledge)
  research: 0,
  // **호출은 토큰이 아니라 호루라기가 든다**(items). 불어서 부른다
  summon: 0,
  // **깃발은 토큰이 아니라 깃발이 든다.** 팀 상자에서 하나 빠진다
  plant: 0,
  // 뽑기는 손댈 때마다 토큰이 든다. **서로 다른 두 사람**이 손대야 하나가 뽑힌다
  pull: PULL_COST,
  // 들고 있던 것을 내려놓는 것뿐이다. 값을 물리면 아무도 안 둔다
  dropRobot: 0,
  // 놓았던 것을 도로 드는 것도 같다
  takeRobot: 0,
  // **부수기는 토큰이 아니라 드라이버가 든다**(items). 한 기에 한 자루
  smashRobot: 0,
}

/**
 * 행동에 드는 **시간**. 게임 속 분이다.
 *
 * 값만 있고 시간이 없으면, 토큰이 남아 있는 한 한 자리에서 무엇이든
 * 연달아 할 수 있다. 한 시간짜리 페이즈가 「토큰을 몇 개 쥐었나」로만
 * 갈리고 몸이 어디 있었는지는 아무 뜻이 없어진다.
 *
 * 연구는 맡겨 놓고 돌아다닌다 — 대신 찾으러 다시 들어와야 한다.
 * 호출은 부른 쪽과 불린 쪽이 **둘 다** 묶인다.
 * 로봇 부수기는 순식간이다. 값만 든다.
 */
export const ACT_MINUTES: Record<ActionKind, number> = {
  move: MOVE_MINUTES,
  research: 20,
  // 불려 오는 사람이 한 방 걷는 동안 둘 다 묶인다. 걸음과 같은 10분
  summon: MOVE_MINUTES,
  plant: 0,
  pull: 0,
  dropRobot: 0,
  takeRobot: 0,
  smashRobot: 0,
}

export interface Act {
  kind: ActionKind
  /** 이동의 목적지. */
  targetTile?: TileId
  /** 호출의 대상. */
  targetPlayer?: string
  /** 놓기·거두기·부수기의 대상 로봇. */
  targetRobot?: string
  /** 뽑기의 대상 팀. 안 고르면 나 말고 제일 많이 꽂은 팀이다. */
  targetTeam?: TeamId
}

export type LogKind =
  | 'moved'
  | 'summoned'
  | 'flagPlanted'
  | 'flagPullHit'
  | 'flagPulled'
  | 'robotLeft'
  | 'robotTaken'
  | 'robotSmashed'
  | 'researchStarted'
  | 'researchDone'
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

/** 방의 정원을 차지하는 수. **사람만 센다** — 로봇은 따로 헤아린다. */
export function seatsUsed(state: PhaseState, tileId: TileId): number {
  // 걸어오는 중인 사람도 한 자리를 잡아 둔다. 안 그러면 정원 둘짜리
  // 방에 셋이 동시에 출발해서 셋 다 들어간다
  return state.people.filter((p) => p.tileId === tileId || p.toTile === tileId).length
}

/** 그 방에 **놓인** 로봇 수. 들고 있는 것은 안 센다 */
export function robotsIn(state: PhaseState, tileId: TileId): number {
  return state.robots.filter((r) => isPlaced(r) && r.tileId === tileId).length
}

/** 그 팀이 지금 가진 로봇 수 — 놓인 것과 든 것 모두. 한도는 없다. */
export function robotsOfTeam(state: PhaseState, team: TeamId): number {
  return state.robots.filter((r) => r.team === team).length
}

/** 그 사람이 들고 있는 로봇 수. MAX_CARRIED_ROBOTS 가 한도다. */
export function robotsCarriedBy(state: PhaseState, playerId: string): number {
  return state.robots.filter((r) => r.carriedBy === playerId).length
}

// ── 팀 점수와 순위 ──────────────────────────────────────────────
//
// **팀은 방 개수로 이긴다.** 자원도 건물도 표도 팀 점수에 들어가지
// 않는다 — 방 하나가 한 점이고 그게 전부다. 개인은 개인 미션으로
// 따로 평가받는다. 둘은 별개다.
//
// **거저 받는 방은 없다.** 기지를 없앴으므로 스물다섯 방이 전부
// 빈 채로 시작하고, 센 것은 전부 서서 가져온 것이다.

/** 그 팀이 쥐고 있는 방의 수. 이것이 곧 팀 점수다. */
export function roomsOf(owners: Readonly<Partial<Record<TileId, TeamId | null>>>, team: TeamId): number {
  return TILES.filter((t) => owners[t.id] === team).length
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
 * 주인을 정한다. **페이즈가 끝날 때 그 방의 깃발과 로봇 수로만** 정한다.
 *
 *   제일 많은 팀이 하나   그 팀이 차지한다
 *   동점                  주인이 그대로다. 밀어내려면 확실히 더 많아야 한다
 *   아무것도 없다         **주인이 그대로다.** 빈 방이 된 게 아니라
 *                         전 주인이 계속 쥐고 있는 것이다
 *
 * 깃발은 페이즈가 끝나면 걷히므로, 다음 판정까지 남는 것은 놓인 로봇뿐이다.
 */
export function ownerOf(
  weights: Readonly<Partial<Record<TeamId, number>>>,
  before: TeamId | null,
): TeamId | null {
  const rows = Object.entries(weights).filter(([, n]) => (n ?? 0) > 0) as [TeamId, number][]
  // 아무것도 안 남았어도 전 주인이 그대로 쥔다 — 뺏으려면 다른 팀이
  // 깃발이든 로봇이든 더 많이 세워야 한다
  if (rows.length === 0) return before
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
function spent(out: ActResult, playerId: string, kind: ActionKind): ActResult {
  const need = ITEM_FOR[kind]
  if (!out.ok || !need) return out
  // **쓰는 사람 주머니에서 나간다.** 팀 주머니이던 때에는 멀리 나간
  // 사람이 사 온 것을 기지에 앉은 사람이 썼다
  const left = takeItem(out.next.satchels[playerId], need)
  if (!left) return no(`${ITEM_BY_KIND[need].name}${josa(ITEM_BY_KIND[need].name, '이/가')} 없다. 자판기에서 산다.`)
  return { ...out, next: { ...out.next, satchels: { ...out.next.satchels, [playerId]: left } } }
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
  return marked(
    charged(spent(runAct(state, playerId, act), playerId, act.kind), state, playerId),
    playerId,
  )
}

/**
 * 값을 치른다. **상자에서 빼는 자리는 여기 하나뿐이다.**
 *
 * 예전에는 행동 갈래마다 제 손으로 지갑을 깎았다. 갈래가 일곱이라
 * 하나를 빠뜨려도 아무도 모르고, 실제로 빠뜨린 적이 있다. 되는지는
 * 갈래마다 보고, 무는 것은 여기서 한 번만 문다.
 */
function charged(out: ActResult, state: PhaseState, playerId: string): ActResult {
  if (!out.ok || out.spent <= 0) return out
  const team = state.people.find((p) => p.playerId === playerId)?.team
  if (!team) return out
  const left = walletOf(out.next, team) - out.spent
  if (left < 0) return no('분단 토큰이 모자란다.')
  return { ...out, next: { ...out.next, wallets: { ...out.next.wallets, [team]: left } } }
}

/**
 * 이 행동에 드는 팀 토큰.
 *
 * **우리 팀이 차지한 방에 들어갈 때는 안 든다.** 차지한 방을 드나드는
 * 것이 공짜라는 것이 차지한 값이다 — 그래서 점령한 방 사이를 오가며
 * 지키고, 뺏긴 방은 들어가는 데부터 값이 든다.
 */
export function costOf(state: Pick<PhaseState, 'owners'>, team: TeamId, act: Act): number {
  if (act.kind === 'move' && act.targetTile && state.owners[act.targetTile] === team) return 0
  return ACT_COST[act.kind]
}

function runAct(state: PhaseState, playerId: string, act: Act): ActResult {
  const me = state.people.find((p) => p.playerId === playerId)
  if (!me) return no('이 판에 없는 사람이다.')

  const cost = costOf(state, me.team, act)
  if (walletOf(state, me.team) < cost) return no(`분단 토큰이 모자란다. ${cost} 개가 든다.`)

  // 물건이 드는 행동이면 **먼저** 있는지 본다. 거절은 값을 먹지 않는다
  const needItem = ITEM_FOR[act.kind] ?? null
  if (needItem && countOf(state.satchels[playerId], needItem) <= 0) {
    return no(`${ITEM_BY_KIND[needItem].name}${josa(ITEM_BY_KIND[needItem].name, '이/가')} 없다. 자판기에서 산다.`)
  }

  const people = state.people.map((p) => ({ ...p }))
  let robots = state.robots.map((r) => ({ ...r }))
  const byId = new Map(people.map((p) => [p.playerId, p]))
  const mine = byId.get(playerId) as Person

  // 걸어오는 중인 사람도 한 자리를 잡아 둔다. **로봇은 정원에 안 든다**
  const seats = (tileId: TileId) => people.filter((p) => p.tileId === tileId || p.toTile === tileId).length
  const carriedOf = (id: string) => robots.filter((r) => r.carriedBy === id)

  /**
   * 사람 하나를 문 밖으로 내보낸다. **바로 도착하지 않는다.**
   *
   * 걷는 데 10분(MOVE_MINUTES) — 나가는 5분과 들어서는 5분을 합친
   * 값이다. 그동안은 어느 방에도 없고, 들고 있는 로봇도 가방 속에
   * 같이 간다. 도착은 서버의 시계가 시킨다 — 이 함수는 「떠났다」까지만
   * 안다.
   *
   * 계단을 몇 번 오르내리든 이 10분 안이다. 계단은 문이지 칸이 아니다.
   */
  function step(p: Person, to: TileId): string | null {
    if (p.tileId === null) return '이미 걷는 중이다.'
    // **복도로 닿으면 간다.** 자유 시간과 같은 문을 쓴다 — 다른 것은
    // 값뿐이다. 층을 넘으려면 계단을 한 번 들르니 문이 둘, 토큰도 둘
    if (!canRoamTo(p.tileId, to)) return '거기까지는 복도가 안 이어진다.'
    // **자물쇠는 걸음을 막는다.** 부르는 것도 걸음이라, 잠긴 방으로는
    // 불려 들어가지도 않는다 — 막는 자리를 여기 하나로 둔 값이다
    const lockedBy = state.locks?.[to] ?? null
    if (lockedBy !== null && lockedBy !== p.team) return LOCKED_DOOR
    const room = capacityOf(to)
    if (seats(to) + 1 > room) return `${TILE_BY_ID[to].name}이(가) 꽉 찼다. 정원 ${room}.`
    p.tileId = null
    p.toTile = to
    // **들고 있는 로봇은 가방 속이라 같이 간다.** 판정에도 방 한도에도 안
    // 들어서, 저쪽 방에 로봇이 차 있어도 떨구고 갈 일이 없다
    for (const r of carriedOf(p.playerId)) r.tileId = to
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
      // 같은 팀 한 명을 내 쪽으로 한 걸음 끌어온다. 부르는 것도 걸음이라
      // 끌려오는 사람은 걷는 동안(MOVE_MINUTES, 10분) 어느 방에도 없다
      if (mine.tileId === null) return no('걷는 중이다. 도착해야 할 수 있다.')
      const target = act.targetPlayer ? byId.get(act.targetPlayer) : undefined
      if (!target) return no('그런 사람이 없다.')
      if (target.team !== mine.team) return no('같은 분단만 부를 수 있다.')
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

    case 'plant': {
      if (mine.tileId === null) return no('걷는 중이다. 도착해야 할 수 있다.')
      if (!canHoldFlags(mine.tileId)) return no(`${TILE_BY_ID[mine.tileId].name}에는 깃발을 못 꽂는다.`)
      // 꽂는 건 혼자 하는 일이다 — 지워진 사람도 꽂을 수 있다
      const box = state.flagBoxes[mine.team] ?? 0
      if (box <= 0) return no('분단 깃발이 없다. 페이즈마다 새로 채워지고, 자판기에서도 산다.')
      return {
        ok: true,
        spent: cost,
        log: { kind: 'flagPlanted', playerId, tileId: mine.tileId, team: mine.team },
        next: {
          ...state,
          people,
          robots,
          flags: withPlanted(state.flags, mine.tileId, mine.team),
          flagBoxes: { ...state.flagBoxes, [mine.team]: box - 1 },
        },
      }
    }

    case 'pull': {
      if (mine.tileId === null) return no('걷는 중이다. 도착해야 할 수 있다.')
      if (state.invisibleId === playerId) return no('보이지 않는 동안에는 깃발을 못 뽑는다.')
      /*
       * **서로 다른 두 사람이 손대야 하나가 뽑힌다.** 같은 팀일 필요는
       * 없다 — 깃발 주인 팀 사람이 손대도 되고(배신), 다른 팀 둘이
       * 힘을 합쳐도 된다. 같은 사람이 두 번 손대는 것으로는 안 된다.
       * 사람마다 손댈 때마다 토큰이 든다. 횟수 한도는 없다.
       */
      const here = mine.tileId
      const whose = act.targetTeam ?? pullTarget(state.flags, here, mine.team)
      if (!whose || flagsIn(state.flags, here, whose) <= 0) return no('이 방에 뽑을 깃발이 없다.')
      const hitBy = state.flagPullHits[here]?.[whose] ?? []
      if (hitBy.includes(playerId)) return no('이미 이 깃발에 손을 댔다. 다른 사람이 마저 손대야 뽑힌다.')
      const nowHits = [...hitBy, playerId]
      if (nowHits.length < PULL_HITS) {
        const room = { ...(state.flagPullHits[here] ?? {}), [whose]: nowHits }
        return {
          ok: true,
          spent: cost,
          log: { kind: 'flagPullHit', playerId, tileId: here, team: whose },
          next: { ...state, people, robots, flagPullHits: { ...state.flagPullHits, [here]: room } },
        }
      }
      const after = withPulled(state.flags, here, whose) as FlagMap
      const room = { ...(state.flagPullHits[here] ?? {}) }
      delete room[whose]
      return {
        ok: true,
        spent: cost,
        log: { kind: 'flagPulled', playerId, tileId: here, team: whose },
        next: { ...state, people, robots, flags: after, flagPullHits: { ...state.flagPullHits, [here]: room } },
      }
    }

    case 'dropRobot': {
      // **놓는 순간부터 이 방의 깃발 하나다.** 혼자 하는 일이라 지워진 사람도 놓는다
      if (mine.tileId === null) return no('걷는 중이다. 도착해야 할 수 있다.')
      // 깃발을 못 꽂는 방(2-3 교실)에는 로봇도 안 놓는다 — 놓아 봐야 판정에서 안 센다
      if (!canHoldFlags(mine.tileId)) return no(`${TILE_BY_ID[mine.tileId].name}에는 로봇을 못 놓는다.`)
      const held = carriedOf(playerId)
      if (held.length === 0) return no('들고 있는 로봇이 없다.')
      // 고른 것이 있으면 그것, 없으면 아무거나 하나. 남의 것을 고를 수는 없다
      const bot = act.targetRobot ? held.find((r) => r.id === act.targetRobot) : held[0]
      if (!bot) return no('그 로봇은 들고 있지 않다.')
      bot.carriedBy = null
      bot.placedBy = playerId
      bot.team = mine.team
      bot.tileId = mine.tileId
      log = { kind: 'robotLeft', playerId, tileId: mine.tileId, targetRobot: bot.id }
      break
    }

    case 'takeRobot': {
      // **놓은 사람만 도로 거둔다.** 같은 팀도 못 거둔다 — 남의 팀은 부숴야 없어진다
      if (mine.tileId === null) return no('걷는 중이다. 도착해야 할 수 있다.')
      if (carriedOf(playerId).length >= MAX_CARRIED_ROBOTS) return no(`로봇은 ${MAX_CARRIED_ROBOTS} 기까지 든다.`)
      const here = robots.filter((r) => isPlaced(r) && r.tileId === mine.tileId)
      const bot = act.targetRobot
        ? here.find((r) => r.id === act.targetRobot)
        : here.find((r) => canCollectRobot(r, playerId, mine.team))
      if (!bot) return no(act.targetRobot ? '그 로봇이 여기 없다.' : '이 방에 거둘 로봇이 없다.')
      if (!canCollectRobot(bot, playerId, mine.team)) return no('놓은 사람만 거둔다.')
      bot.carriedBy = playerId
      bot.placedBy = null
      // 손에 든 로봇은 든 사람 분단 것이다 — 이적한 주인이 거두면 새 분단 로봇이 된다
      bot.team = mine.team
      log = { kind: 'robotTaken', playerId, tileId: mine.tileId, targetRobot: bot.id }
      break
    }

    case 'smashRobot': {
      if (mine.tileId === null) return no('걷는 중이다. 도착해야 할 수 있다.')
      // **상대가 보고 있어도 부순다.** 사람마다 몇 기라는 한도는 없다 —
      // 드라이버가 한 기에 한 자루이고, 드라이버가 학교 전체 하루 열 자루다
      // **놓인 것만 부순다.** 남이 들고 있는 로봇은 가방 속이다
      const bot = robots.find(
        (r) => r.id === act.targetRobot && isPlaced(r) && r.tileId === mine.tileId && r.team !== mine.team,
      )
      if (!bot) return no('그 로봇이 여기 없다.')
      robots = robots.filter((r) => r.id !== bot.id)
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
      // 값은 **이 연구실을 누가 쥐고 있느냐**로 갈린다
      const landlord = state.owners[mine.tileId] ?? null
      const ownsLab = landlord === mine.team
      // **지식이 모자라면 고를 수 없다.** 토큰도 안 든다
      const need = researchKnowledge(ownsLab)
      const purse = vaultOf(state, mine.team)
      if (purse.knowledge < need) return no(`지식이 모자란다. ${need} 점이 든다.`)
      // 걸 때 바로 뺀다. 완성될 때 빼면 그사이에 같은 금고로 셋이
      // 더 걸어서 없는 지식으로 넷이 연구한 판이 된다
      /*
       * **낸 지식은 사라진다.** 주인 팀에게 가지 않는다.
       *
       * 한때 남의 연구실 값이 그 팀 금고로 넘어갔다. 금고가
       * 없어지면서 받을 사람을 골라야 했는데, 누구를 고르든
       * 어색했다 — 넷에게 나누면 두 점이 0 넷이 되고, 한 명에게
       * 몰면 그 한 명만 부자가 된다.
       *
       * 그래서 안 준다. **연구실을 쥐는 값은 받는 것이 아니라 덜
       * 내는 것이다**(researchKnowledge 가 1과 3을 가른다). 자판기와
       * 같은 규칙이고, 판에서 자원이 빠져나가는 두 번째 구멍이다.
       */
      const paid: Partial<Record<TeamId, Vault>> = {
        ...state.vaults,
        [mine.team]: { ...purse, knowledge: purse.knowledge - need },
      }
      const queued: PendingResearch = { playerId, knowledge: need, tileId: mine.tileId }

      /*
       * **늘 줄을 선다.** 발전소를 쥐면 그 자리에서 로봇이 나던 것을
       * 없앴다 — 누구든 스무 분을 기다리고, 그동안 연구실에 와 있어야 한다
       */
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
  }

  return { ok: true, spent: cost, log, next: { ...state, people, robots } }
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

  const owners: Partial<Record<TileId, TeamId | null>> = { ...state.owners }
  for (const t of TILES) {
    /*
     * **2-3 교실은 아무도 못 가진다.**
     *
     * 열넷이 아침마다 모이는 방이다. 거기 서 있는 것만으로 땅이 되면
     * 인원이 많은 팀이 가만히 앉아 한 방을 벌고, 아침에 모이는 일이
     * 모이는 일이 아니라 점령이 된다. 중립으로 둔다 — 서 있는 것도,
     * 거기서 만나는 것도 막지 않는다. 주인만 안 생긴다.
     */
    if (t.tier === 'plaza') {
      owners[t.id] = null
      continue
    }
    /*
     * **깃발과 로봇만 센다.** 서 있는 사람은 이제 세지 않는다 — 누가
     * 지키고 서 있어도 남이 깃발을 더 꽂으면 넘어간다.
     *
     * 로봇은 옮길 수 있는 깃발이다. **놓아야 센다** — 들고 다니는 것은
     * 가방 속 물건이라 어느 방에도 안 든다.
     */
    const w: Partial<Record<TeamId, number>> = { ...(state.flags[t.id] ?? {}) }
    for (const r of state.robots) {
      if (!isPlaced(r) || r.tileId !== t.id) continue
      w[r.team] = (w[r.team] ?? 0) + 1
    }
    const before = state.owners[t.id] ?? null
    const after = ownerOf(w, before)
    owners[t.id] = after
    if (after !== before && after) log.push({ kind: 'captured', tileId: t.id, team: after })
  }

  /*
   * **연구는 여기서 처리하지 않는다.**
   *
   * 전에는 걸어 둔 연구가 페이즈가 닫힐 때 한꺼번에 로봇이 됐다. 이제는
   * 건 지 스무 분 뒤에 **그 연구실에** 완성품이 놓이고, 그때 거기 서
   * 있던 본인이 받는다. 못 받으면 주인 없는 물건이 되어 먼저 온 사람이
   * 가진다 — 누구든.
   *
   * 그래서 시각을 보는 일이고, 시각은 서버의 몫이다. 여기서는 **아직
   * 안 익은 것을 버리기만** 한다. 낸 값은 안 돌려준다 — 건 순간 치른
   * 값이라, 남은 시간을 보고 걸라는 압박이 그대로 규칙이 된다.
   */
  const robots = [...state.robots]
  const vaults: Partial<Record<TeamId, Vault>> = { ...state.vaults }

  const wallets: Partial<Record<TeamId, number>> = { ...state.wallets }

  return {
    next: {
      people: state.people,
      wallets,
      robots,
      vaults,
      owners,
      pendingResearch: [],
      // **깃발은 페이즈가 끝나면 사라진다.** 주인은 방금 정했으니 그걸로
      // 끝이다. 다음 페이즈는 깃발 없이 — 놓인 로봇만 남은 채로 — 시작한다
      flags: {},
      flagBoxes: state.flagBoxes,
      // 뽑다 만 흔적도 같이 사라진다. 뽑을 깃발이 없다
      flagPullHits: {},
      smashedBy: [],
      actedBy: [],
      // 물건은 페이즈를 넘어 남는다. 산 것을 못 쓰고 잃으면 아무도 안 산다
      satchels: state.satchels,
      ...(state.locks ? { locks: state.locks } : {}),
    },
    log,
  }
}

/**
 * from 에서 to 쪽으로 한 걸음. 최단 경로의 첫 칸이다.
 *
 * **이동과 같은 그물을 본다**(ROAM_TO). 복도로 곧장 닿으면 한 걸음이
 * 곧 목적지고, 층이 다르면 계단이 첫 걸음이다. 이웃만 보던 때에는
 * 호출이 복도 저편의 사람을 한 칸씩밖에 못 당겨서, 같은 토큰을 내고도
 * 제 발로 걷는 것보다 못했다.
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
    for (const next of ROAM_TO[at] ?? []) {
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
