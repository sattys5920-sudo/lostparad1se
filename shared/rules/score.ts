// 점수와 21:00 정산.
//
//   영역 + 연결 + 핵심 + 자원 + 발전
//
// **감춰 둔 몫이 없다.** 전에는 팀마다 비밀 목표 세 장이 있어서 정산에
// 보이는 수와 끝에 세는 수가 달랐다 — 1위와 2위 차이가 6점 안쪽이면
// 아직 아무것도 안 정해진 것이었다. 그 층을 걷어냈으므로 이제는
// 정산에서 보이는 수가 곧 끝에 세는 수다.
import {
  RESOURCES,
  SCORE_PER_CORE,
  SCORE_RESEARCH_MULTIPLIER,
  SCORE_RESOURCE_DIVISOR,
  type Resource,
  type TeamId,
} from './v2'
import { TILE_BY_ID, connectedSize } from './board'
import { tileValue, type Fragment } from './fragments'
import type { TileState } from './resources'

/** 한 팀의 지금 모습. 점수를 내는 데 필요한 전부. */
export interface TeamState {
  team: TeamId
  resources: Record<Resource, number>
  researchTier: number
}

export interface ScoreInput {
  tiles: readonly TileState[]
  fragments: readonly Fragment[]
  team: TeamState
}

// ── 항목별 ──────────────────────────────────────────────────────

/** 우리 칸. **빼는 것은 없다** — 기지가 없어져서 거저 받는 방도 없다 */
const ours = (tiles: readonly TileState[], team: TeamId) => tiles.filter((t) => t.ownerTeam === team)

/** 가진 칸의 가치 합. A의 기록 보너스를 포함한다. */
export function territoryScore(input: ScoreInput): number {
  let total = 0
  for (const t of ours(input.tiles, input.team.team)) {
    total += tileValue(t.tileId, input.fragments)
  }
  return total
}

/** 붙어 있는 우리 칸 덩어리 중 제일 큰 것. 흩어진 땅은 0이다. */
export function connectionScore(input: ScoreInput): number {
  const owner = new Map(input.tiles.map((t) => [t.tileId, t.ownerTeam]))
  return connectedSize(input.team.team, (id) => owner.get(id) ?? null)
}

/**
 * 핵심 한 칸당 3.
 *
 * **2-3 교실 몫은 없앴다.** 아무도 가질 수 없는 방이 됐으므로 그
 * 점수는 영영 아무에게도 안 간다 — 남겨 두면 언젠가 누가 「왜 안
 * 들어오지」 하고 들여다본다.
 */
export function coreScore(input: ScoreInput): number {
  let total = 0
  for (const t of ours(input.tiles, input.team.team)) {
    if (TILE_BY_ID[t.tileId].tier === 'core') total += SCORE_PER_CORE
  }
  return total
}

/** 남은 자원을 전부 더해 5로 나눈다(버림). */
export function resourceScore(input: ScoreInput): number {
  const sum = RESOURCES.reduce((a, r) => a + (input.team.resources[r] ?? 0), 0)
  return Math.floor(sum / SCORE_RESOURCE_DIVISOR)
}

/**
 * 연구 단계 × 2.
 *
 * **건물 단계는 빠졌다.** 건물을 걷어냈으니 발전은 연구뿐이다 —
 * 이름은 그대로 둔다. 점수판의 한 줄이고, 바꾸면 지난 판의 기록과
 * 말이 안 맞는다
 */
export function developmentScore(input: ScoreInput): number {
  return input.team.researchTier * SCORE_RESEARCH_MULTIPLIER
}

// ── 합계 ────────────────────────────────────────────────────────

export interface ScoreBreakdown {
  team: TeamId
  territory: number
  connection: number
  core: number
  resource: number
  development: number
  total: number
}

/**
 * 점수. **이게 전부다.**
 *
 * 전에는 여기에 팀 비밀 목표 점수가 따로 붙는 finalScore 가 있었다.
 * 비밀 목표를 걷어내면서 공개 점수와 최종 점수가 같아졌다 — 정산에서
 * 보이는 수가 곧 끝에 세는 수다.
 */
export function publicScore(input: ScoreInput): ScoreBreakdown {
  const parts = {
    team: input.team.team,
    territory: territoryScore(input),
    connection: connectionScore(input),
    core: coreScore(input),
    resource: resourceScore(input),
    development: developmentScore(input),
  }
  return { ...parts, total: parts.territory + parts.connection + parts.core + parts.resource + parts.development }
}

// ── 순위 ────────────────────────────────────────────────────────

export interface Ranked extends ScoreBreakdown {
  rank: number
  /**
   * 점수만 보고 매긴 순위. **동점은 같은 수를 갖는다**(1·2·2·4).
   *
   * rank 는 화면에 줄을 세우려고 끝까지 가르는 수고, 이쪽은 「정말
   * 1위인가」를 묻는 수다. 둘이 같은 점수인데 지식으로 갈라 놓고
   * 「너는 2위다」라고 하면, 개인 미션의 「우리 팀이 1위가 아니다」가
   * 팀이 실제로 얼마나 잘했는지와 무관하게 갈린다.
   */
  tiedRank: number
}

/**
 * 동점이면 지식이 많은 팀, 그래도 같으면 핵심을 많이 가진 팀이 앞이다.
 * 그마저 같으면 팀 이름 순으로 둔다 — 어딘가에서는 갈라야 한다.
 *
 * 가른 수(rank)와 안 가른 수(tiedRank)를 함께 돌려준다. 방 개수 순위
 * (occupy.ts teamRanks)가 이미 안 가르는 쪽이라, 점수 순위만 늘 갈라
 * 있었다. 판정이 어느 쪽을 볼지는 판정이 고른다.
 */
export function rankTeams(
  scores: readonly ScoreBreakdown[],
  knowledgeOf: (team: TeamId) => number,
): Ranked[] {
  const sorted = [...scores].sort(
    (a, b) =>
      b.total - a.total ||
      knowledgeOf(b.team) - knowledgeOf(a.team) ||
      b.core - a.core ||
      a.team.localeCompare(b.team),
  )
  let tied = 0
  let seen = 0
  let last: number | null = null
  return sorted.map((s, i) => {
    seen += 1
    if (s.total !== last) {
      tied = seen
      last = s.total
    }
    return { ...s, rank: i + 1, tiedRank: tied }
  })
}

// ── 21:00 정산 ──────────────────────────────────────────────────

/**
 * 정산은 이 순서다. 순서를 바꾸면 답이 달라진다.
 *
 *   1. 생산이 들어온다 — 건물을 걷어낸 뒤로는 들어오는 것이 없다.
 *      자리는 남겨 둔다. 다른 수입이 생기면 여기다
 *   2. 그날 받은 표를 센다
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
  knowledgeOf: (team: TeamId) => number,
): SettlementResult {
  const ranked = rankTeams(scores, knowledgeOf)
  return {
    ranked,
    spotlighted: ranked[0].team,
    comeback: ranked[ranked.length - 1].team,
  }
}
