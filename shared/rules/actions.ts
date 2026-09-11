// 행동 여섯 가지 — 서 있어야 할 곳과 내는 것.
//
// 토큰은 여기서 빼지 않는다(tokens.ts). 이 파일은 「지금 이 행동을 걸 수
// 있는가」와 「무엇이 나가고 무엇이 들어오는가」만 답한다. 서버가 둘을
// 한 트랜잭션으로 묶는다.
//
// 어느 행동이든 발이 묶인 말은 아무것도 못 한다. 판정에는 세지만
// 움직이지도 행동하지도 못한다.
import {
  FLAG_TOKEN_COST,
  PRODUCE_MONEY,
  RESEARCH_BASE_KNOWLEDGE,
  SABOTAGE_INFLUENCE,
  SCOUT_GAIN,
  SCOUT_RESOURCES,
  type Resource,
  type SabotageKind,
  type TeamId,
} from './v2'
import { ADJACENCY, TILE_BY_ID, type TileId } from './board'
import { canPay, type Bag, type TileState } from './buildings'

export type ActionKind = 'flag' | 'build' | 'research' | 'scout' | 'sabotage' | 'produce'

/** 어디에 서 있어야 하는가. */
export type Stand = 'thatTile' | 'ourTile' | 'ourZone' | 'notOurTile' | 'enemyTile'

export const ACTION_STAND: Record<ActionKind, Stand> = {
  flag: 'thatTile',
  build: 'ourTile',
  research: 'ourZone',
  scout: 'notOurTile',
  sabotage: 'enemyTile',
  produce: 'ourZone',
}

/** 토큰 한 개가 드는 행동. 이동·표·교역·카드에는 들지 않는다. */
export const ACTION_TOKEN_COST: Record<ActionKind, number> = {
  flag: FLAG_TOKEN_COST,
  build: 1,
  research: 1,
  scout: 1,
  sabotage: 1,
  produce: 1,
}

export interface StandInput {
  kind: ActionKind
  /** 행동을 거는 사람이 선 칸. 걷는 중이면 null. */
  standingOn: TileId | null
  /** 행동의 대상 칸. */
  targetTile: TileId
  team: TeamId
  ownerOf: (tileId: TileId) => TeamId | null
}

export type StandRefusal = 'walking' | 'notThere' | 'notOurTile' | 'notOurZone' | 'ourTile' | 'notEnemyTile'

/**
 * 서 있는 자리가 맞는가.
 *
 * 「우리 영역 안」은 우리 칸 위이거나 우리 칸에 맞닿은 곳이 아니라,
 * 우리 칸 위를 말한다 — 연구와 생산은 우리 땅에서만 한다.
 */
export function checkStand(input: StandInput): { ok: boolean; reason: StandRefusal | null } {
  if (input.standingOn === null) return { ok: false, reason: 'walking' }
  const stand = ACTION_STAND[input.kind]
  const here = input.ownerOf(input.standingOn)

  if (stand === 'thatTile') {
    return input.standingOn === input.targetTile ? { ok: true, reason: null } : { ok: false, reason: 'notThere' }
  }
  if (stand === 'ourTile') {
    if (input.standingOn !== input.targetTile) return { ok: false, reason: 'notThere' }
    return here === input.team ? { ok: true, reason: null } : { ok: false, reason: 'notOurTile' }
  }
  if (stand === 'ourZone') {
    return here === input.team ? { ok: true, reason: null } : { ok: false, reason: 'notOurZone' }
  }
  if (stand === 'notOurTile') {
    if (input.standingOn !== input.targetTile) return { ok: false, reason: 'notThere' }
    return here === input.team ? { ok: false, reason: 'ourTile' } : { ok: true, reason: null }
  }
  // enemyTile
  if (input.standingOn !== input.targetTile) return { ok: false, reason: 'notThere' }
  return here !== null && here !== input.team
    ? { ok: true, reason: null }
    : { ok: false, reason: 'notEnemyTile' }
}

// ── 깃발을 꽂을 수 있는 칸인가 ──────────────────────────────────

export type PlantRefusal =
  | 'baseTile'
  | 'notTouchingUs'
  | 'flagHere'
  | 'coreClosed'
  | 'blockaded'

export interface PlantInput {
  tileId: TileId
  team: TeamId
  ownerOf: (tileId: TileId) => TeamId | null
  /** 이미 깃발이 꽂힌 칸인가. 가짜 깃발도 자리를 차지한다. */
  hasFlag: boolean
  /** 핵심·중앙광장이 A의 기록으로 열렸는가. */
  coreOpen: boolean
  /** 봉쇄 카드가 걸려 있는가. */
  blockaded?: boolean
}

/**
 * 깃발 네 조건 중 칸에 관한 것. 서 있는지와 토큰은 따로 본다.
 *
 * 기지에는 누구도 꽂을 수 없다. 핵심과 중앙광장은 A의 기록이 연 뒤에만.
 */
export function canPlantFlag(input: PlantInput): { ok: boolean; reason: PlantRefusal | null } {
  const tier = TILE_BY_ID[input.tileId].tier
  if (tier === 'base') return { ok: false, reason: 'baseTile' }
  if ((tier === 'core' || tier === 'plaza') && !input.coreOpen) {
    return { ok: false, reason: 'coreClosed' }
  }
  if (input.hasFlag) return { ok: false, reason: 'flagHere' }
  if (input.blockaded) return { ok: false, reason: 'blockaded' }
  // 우리 영역과 맞닿아 있어야 한다
  const touches = ADJACENCY[input.tileId].some((n) => input.ownerOf(n) === input.team)
  if (!touches) return { ok: false, reason: 'notTouchingUs' }
  return { ok: true, reason: null }
}

// ── 연구 ────────────────────────────────────────────────────────

/** 다음 단계로 올리는 데 드는 지식. 단계가 오를수록 비싸진다. */
export function researchCost(currentTier: number): Bag {
  return { knowledge: RESEARCH_BASE_KNOWLEDGE + Math.max(0, currentTier) }
}

// ── 탐색 ────────────────────────────────────────────────────────

/**
 * 돈이냐 지식이냐는 무작위다. 씨앗을 받아 서버가 정한다 — 눌러 보고
 * 마음에 안 들면 다시 누르는 일이 없게, 같은 칸·같은 날은 같은 답이다.
 */
export function scoutYield(roll: number): Bag {
  const pick = SCOUT_RESOURCES[Math.floor(Math.max(0, Math.min(0.999999, roll)) * SCOUT_RESOURCES.length)]
  return { [pick]: SCOUT_GAIN }
}

/** 같은 칸은 팀당 하루 한 번. 오늘 이 팀이 이 칸을 이미 뒤졌는가. */
export function scoutAlreadyToday(
  done: readonly { team: TeamId; tileId: TileId }[],
  team: TeamId,
  tileId: TileId,
): boolean {
  return done.some((d) => d.team === team && d.tileId === tileId)
}

// ── 생산 ────────────────────────────────────────────────────────

export const PRODUCE_YIELD: Bag = { money: PRODUCE_MONEY }

// ── 견제 ────────────────────────────────────────────────────────

export const SABOTAGE_COST: Bag = { influence: SABOTAGE_INFLUENCE }

export interface SabotageInput {
  kind: SabotageKind
  targetTeam: TeamId
  team: TeamId
  resources: Record<Resource, number>
  /** 카드로 걸면 자리에 들어가지 않아도 되고 영향력도 들지 않는다. */
  byCard?: boolean
}

export type SabotageRefusal = 'ownTeam' | 'cannotAfford'

export function checkSabotage(input: SabotageInput): { ok: boolean; cost: Bag; reason: SabotageRefusal | null } {
  if (input.targetTeam === input.team) return { ok: false, cost: {}, reason: 'ownTeam' }
  const cost = input.byCard ? {} : SABOTAGE_COST
  if (!canPay(input.resources, cost)) return { ok: false, cost, reason: 'cannotAfford' }
  return { ok: true, cost, reason: null }
}

// ── 한데 묶어 보기 ──────────────────────────────────────────────

export interface ActionGate {
  /** 발이 묶여 있는가. */
  bound: boolean
  /** 잠들어 있어도 행동은 못 한다 — 앱이 닫혀 있다는 뜻이다. */
  asleep: boolean
}

export type GateRefusal = 'bound' | 'asleep'

export function checkGate(gate: ActionGate): { ok: boolean; reason: GateRefusal | null } {
  if (gate.bound) return { ok: false, reason: 'bound' }
  if (gate.asleep) return { ok: false, reason: 'asleep' }
  return { ok: true, reason: null }
}

/** 그 칸이 우리 것인지 보는 짧은 도우미. 시험과 서버가 같이 쓴다. */
export function ownerLookup(tiles: readonly TileState[]): (tileId: TileId) => TeamId | null {
  const map = new Map(tiles.map((t) => [t.tileId, t.ownerTeam]))
  return (tileId) => map.get(tileId) ?? null
}
