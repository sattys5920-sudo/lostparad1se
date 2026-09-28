// 점수와 21:00 정산.
//
//   **가진 방 개수.** 방은 모두 1점이다(board.ROOM_POINT).
//
// 연결 · 핵심 방 · 남은 자원 · 연구 단계가 더해지던 것을 전부 걷어냈다.
// 어느 방을 쥐든 한 방은 한 방이고, 개인 지갑(돈·지식)은 팀 점수에
// 안 들어간다 — 개인 점수는 팀 점수에 영향을 주지 않는다.
//
// **감춰 둔 몫이 없다.** 정산에서 보이는 수가 곧 끝에 세는 수다.
import type { TeamId } from './v2'
import { TILE_BY_ID } from './board'
import type { TileState } from './resources'

export interface ScoreInput {
  tiles: readonly TileState[]
  team: TeamId
}

/** 가진 방의 점수 합. 방은 모두 1점이라 곧 가진 방 개수다. */
export function territoryScore(input: ScoreInput): number {
  let total = 0
  for (const t of input.tiles) if (t.ownerTeam === input.team) total += TILE_BY_ID[t.tileId].value
  return total
}

export interface ScoreBreakdown {
  team: TeamId
  territory: number
  total: number
}

/** 점수. **이게 전부다** — 가진 방 */
export function publicScore(input: ScoreInput): ScoreBreakdown {
  const territory = territoryScore(input)
  return { team: input.team, territory, total: territory }
}

// ── 순위 ────────────────────────────────────────────────────────

export interface Ranked extends ScoreBreakdown {
  rank: number
  /**
   * 점수만 보고 매긴 순위. **동점은 같은 수를 갖는다**(1·2·2·4).
   *
   * rank 는 화면에 줄을 세우려고 끝까지 가르는 수고, 이쪽은 「정말
   * 1위인가」를 묻는 수다. 둘이 같은 방 수인데 이름 순으로 갈라 놓고
   * 「너는 2위다」라고 하면, 개인 미션의 「우리 팀이 1위가 아니다」가
   * 팀이 실제로 얼마나 잘했는지와 무관하게 갈린다.
   */
  tiedRank: number
}

/**
 * 방 수로 줄을 세운다. **동점은 가르지 않는다**(tiedRank) — 화면에 줄을
 * 세우는 rank 만 팀 이름 순으로 가른다. 지식이나 돈으로 가르면 개인
 * 지갑이 팀 순위에 끼어든다.
 */
export function rankTeams(scores: readonly ScoreBreakdown[]): Ranked[] {
  const sorted = [...scores].sort((a, b) => b.total - a.total || a.team.localeCompare(b.team))
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

export function settle(scores: readonly ScoreBreakdown[]): SettlementResult {
  const ranked = rankTeams(scores)
  return {
    ranked,
    spotlighted: ranked[0].team,
    comeback: ranked[ranked.length - 1].team,
  }
}
