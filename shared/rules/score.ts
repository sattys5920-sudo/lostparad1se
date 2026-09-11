// 점수와 21:00 정산.
//
//   영역 + 연결 + 핵심 + 자원 + 발전 + 비밀 목표
//
// 정산 때 공개되는 점수에는 비밀 목표가 빠져 있다. 1위와 2위 차이가
// 6점 안쪽이면 아직 아무것도 정해지지 않은 것이다 — 그래서 공개 점수와
// 최종 점수를 다른 함수로 갈라 둔다. 섞이면 목표가 새어 나간다.
import {
  BUILDING_BY_KIND,
  GOAL_BY_KIND,
  GOAL_THRESHOLD,
  RESOURCES,
  SCORE_PER_CORE,
  SCORE_PLAZA,
  SCORE_RESEARCH_MULTIPLIER,
  SCORE_RESOURCE_DIVISOR,
  TEAM_IDS,
  type GoalKind,
  type Resource,
  type TeamId,
} from './v2'
import { BASE_OF, TILE_BY_ID, areNeighborTeams, connectedSize, type TileId } from './board'
import { tileValue, type Fragment } from './fragments'
import type { TileState } from './buildings'

/** 한 팀의 지금 모습. 점수를 내는 데 필요한 전부. */
export interface TeamState {
  team: TeamId
  resources: Record<Resource, number>
  researchTier: number
  allyTeam: TeamId | null
  /** 받은 비밀 목표. 내용은 우리 팀만 안다. */
  goals: readonly { kind: GoalKind; rivalTeam?: TeamId }[]
  /** 닷새 동안 칸을 뺏긴 적이 있는가. */
  lostTile: boolean
  /** 남의 칸 깃발을 성공한 횟수. */
  raidSuccesses: number
  /** 동맹을 먼저 깬 적이 있는가. */
  brokeAlliance: boolean
  /** 신뢰표를 준 적 있는 팀들. 「모두의 신뢰」가 쓴다. */
  trustFrom: readonly TeamId[]
  /** 우리 팀 누군가 털어놓았는가. */
  revealed: boolean
}

export interface ScoreInput {
  tiles: readonly TileState[]
  fragments: readonly Fragment[]
  team: TeamState
}

// ── 항목별 ──────────────────────────────────────────────────────

const oursExcludingBase = (tiles: readonly TileState[], team: TeamId) =>
  tiles.filter((t) => t.ownerTeam === team && TILE_BY_ID[t.tileId].tier !== 'base')

/** 가진 칸의 가치 합. 건물 보너스와 A의 기록 보너스를 포함한다. */
export function territoryScore(input: ScoreInput): number {
  let total = 0
  for (const t of oursExcludingBase(input.tiles, input.team.team)) {
    total += tileValue(t.tileId, input.fragments)
    for (const b of t.buildings) total += BUILDING_BY_KIND[b.kind].value
  }
  return total
}

/** 기지에서 우리 칸만 밟고 갈 수 있는 칸의 수. 떨어진 땅은 0이다. */
export function connectionScore(input: ScoreInput): number {
  const owner = new Map(input.tiles.map((t) => [t.tileId, t.ownerTeam]))
  return connectedSize(input.team.team, (id) => owner.get(id) ?? null)
}

/** 핵심 한 칸당 3, 중앙광장 5. */
export function coreScore(input: ScoreInput): number {
  let total = 0
  for (const t of oursExcludingBase(input.tiles, input.team.team)) {
    const tier = TILE_BY_ID[t.tileId].tier
    if (tier === 'core') total += SCORE_PER_CORE
    if (tier === 'plaza') total += SCORE_PLAZA
  }
  return total
}

/** 남은 자원을 전부 더해 5로 나눈다(버림). */
export function resourceScore(input: ScoreInput): number {
  const sum = RESOURCES.reduce((a, r) => a + (input.team.resources[r] ?? 0), 0)
  return Math.floor(sum / SCORE_RESOURCE_DIVISOR)
}

/** 건물 단계의 합 + 연구 단계 × 2. */
export function developmentScore(input: ScoreInput): number {
  let levels = 0
  for (const t of oursExcludingBase(input.tiles, input.team.team)) {
    for (const b of t.buildings) levels += b.level
  }
  return levels + input.team.researchTier * SCORE_RESEARCH_MULTIPLIER
}

// ── 비밀 목표 ───────────────────────────────────────────────────

function tilesOfTier(input: ScoreInput, tier: string): number {
  return oursExcludingBase(input.tiles, input.team.team).filter(
    (t) => TILE_BY_ID[t.tileId].tier === tier,
  ).length
}

function hasBuilding(input: ScoreInput, kind: 'broadcast' | 'hideout'): boolean {
  return oursExcludingBase(input.tiles, input.team.team).some((t) =>
    t.buildings.some((b) => b.kind === kind),
  )
}

/**
 * 목표 하나를 달성했는가. 전부 「게임이 끝날 때」 판정이다.
 *
 * 라이벌만 다른 팀 점수를 봐야 해서 영역 점수를 따로 받는다.
 */
export function goalAchieved(
  goal: { kind: GoalKind; rivalTeam?: TeamId },
  input: ScoreInput,
  territoryOf: (team: TeamId) => number = () => 0,
): boolean {
  const t = input.team
  switch (goal.kind) {
    case 'gateGuard':
      return tilesOfTier(input, 'gate') >= GOAL_THRESHOLD.gateTiles
    case 'theMiddle':
      return tilesOfTier(input, 'plaza') >= 1
    case 'twoHearts':
      return tilesOfTier(input, 'core') >= GOAL_THRESHOLD.coreTiles
    case 'crossroadLord':
      return tilesOfTier(input, 'cross') >= GOAL_THRESHOLD.crossTiles
    case 'unbrokenPath':
      return connectionScore(input) >= GOAL_THRESHOLD.connection
    case 'fortress':
      return !t.lostTile
    case 'raider':
      return t.raidSuccesses >= GOAL_THRESHOLD.raidSuccesses
    case 'distantFriend':
      return t.allyTeam !== null && !areNeighborTeams(t.team, t.allyTeam)
    case 'noBetrayal':
      return !t.brokeAlliance && t.allyTeam !== null
    case 'everyonesTrust':
      return TEAM_IDS.filter((x) => x !== t.team).every((x) => t.trustFrom.includes(x))
    case 'tightLipped':
      return !t.revealed
    case 'scholars':
      return t.researchTier >= GOAL_THRESHOLD.researchTier
    case 'architect':
      return (
        oursExcludingBase(input.tiles, t.team).reduce(
          (a, x) => a + x.buildings.filter((b) => b.level >= 2).length,
          0,
        ) >= GOAL_THRESHOLD.level2Buildings
      )
    case 'broadcastClub':
      return hasBuilding(input, 'broadcast') && hasBuilding(input, 'hideout')
    case 'moneyed':
      return (t.resources.money ?? 0) >= GOAL_THRESHOLD.money
    case 'rival':
      return goal.rivalTeam !== undefined && territoryOf(t.team) > territoryOf(goal.rivalTeam)
  }
}

/** 달성한 목표의 점수 합. */
export function goalScore(
  input: ScoreInput,
  territoryOf: (team: TeamId) => number = () => 0,
): number {
  return input.team.goals
    .filter((g) => goalAchieved(g, input, territoryOf))
    .reduce((a, g) => a + GOAL_BY_KIND[g.kind].points, 0)
}

// ── 합계 ────────────────────────────────────────────────────────

export interface ScoreBreakdown {
  team: TeamId
  territory: number
  connection: number
  core: number
  resource: number
  development: number
  /** 비밀 목표. 공개 점수에서는 언제나 0이다. */
  goals: number
  total: number
}

/** 정산 때 모두에게 보이는 점수. 비밀 목표가 빠져 있다. */
export function publicScore(input: ScoreInput): ScoreBreakdown {
  const parts = {
    team: input.team.team,
    territory: territoryScore(input),
    connection: connectionScore(input),
    core: coreScore(input),
    resource: resourceScore(input),
    development: developmentScore(input),
    goals: 0,
  }
  return { ...parts, total: parts.territory + parts.connection + parts.core + parts.resource + parts.development }
}

/** 종례에서 나오는 점수. 비밀 목표가 들어간다. */
export function finalScore(
  input: ScoreInput,
  territoryOf: (team: TeamId) => number = () => 0,
): ScoreBreakdown {
  const open = publicScore(input)
  const goals = goalScore(input, territoryOf)
  return { ...open, goals, total: open.total + goals }
}

// ── 순위 ────────────────────────────────────────────────────────

export interface Ranked extends ScoreBreakdown {
  rank: number
}

/**
 * 동점이면 영향력이 많은 팀, 그래도 같으면 핵심을 많이 가진 팀이 앞이다.
 * 그마저 같으면 팀 이름 순으로 둔다 — 어딘가에서는 갈라야 한다.
 */
export function rankTeams(
  scores: readonly ScoreBreakdown[],
  influenceOf: (team: TeamId) => number,
): Ranked[] {
  const sorted = [...scores].sort(
    (a, b) =>
      b.total - a.total ||
      influenceOf(b.team) - influenceOf(a.team) ||
      b.core - a.core ||
      a.team.localeCompare(b.team),
  )
  return sorted.map((s, i) => ({ ...s, rank: i + 1 }))
}

// ── 21:00 정산 ──────────────────────────────────────────────────

/**
 * 정산은 이 순서다. 순서를 바꾸면 답이 달라진다.
 *
 *   1. 건물 생산이 들어온다
 *   2. 받은 표가 영향력에 반영된다
 *   3. 그 결과로 점수와 순위가 정해진다
 *   4. 1위는 주목, 꼴찌는 만회
 *
 * 표를 점수 뒤에 반영하면 자원 점수와 동점 판정이 하루 뒤처진다.
 */
export const SETTLEMENT_ORDER = ['production', 'votes', 'score', 'spotlight'] as const
export type SettlementStep = (typeof SETTLEMENT_ORDER)[number]

export interface SettlementResult {
  ranked: Ranked[]
  /** 다음 정산까지 눈에 띄는 팀. */
  spotlighted: TeamId
  /** 다음 08:00에 토큰을 더 받는 팀. */
  comeback: TeamId
}

export function settle(
  scores: readonly ScoreBreakdown[],
  influenceOf: (team: TeamId) => number,
): SettlementResult {
  const ranked = rankTeams(scores, influenceOf)
  return {
    ranked,
    spotlighted: ranked[0].team,
    comeback: ranked[ranked.length - 1].team,
  }
}

/** 기지는 언제나 그 팀 것이다. 점수에는 들어가지 않지만 연결의 출발점이다. */
export const BASE_TILE_OF: Record<TeamId, TileId> = BASE_OF
