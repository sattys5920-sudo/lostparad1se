// 점수와 21:00 정산.
//
//   **가진 방 개수.** 방은 모두 1점이다(board.ROOM_POINT).
//
// 연결 · 핵심 방 · 남은 자원 · 연구 단계가 더해지던 것을 전부 걷어냈다.
// 어느 방을 쥐든 한 방은 한 방이고, 팀 금고(돈·지식)는 팀 점수에
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
  /**
   * 순위. **동점은 공동이다**(1·2·2·4). 방 수가 같으면 같은 등수 —
   * 무엇으로도 가르지 않는다. 지식이나 돈으로 가르면 개인 지갑이 팀
   * 순위에 끼어들고, 이름 순으로 가르면 「우리 팀이 1위가 아니다」가
   * 팀이 실제로 얼마나 잘했는지와 무관하게 갈린다.
   */
  rank: number
  /** rank 와 같다. 옛 이름이라 남겨 둔다 — 판정 코드가 이 이름으로 읽는다 */
  tiedRank: number
}

/**
 * 방 수로 줄을 세운다. **동점은 공동 순위다.** 줄 순서만 팀 이름 순으로
 * 두는데, 이것은 화면에 늘어놓는 차례일 뿐 등수가 아니다.
 */
export function rankTeams(scores: readonly ScoreBreakdown[]): Ranked[] {
  const sorted = [...scores].sort((a, b) => b.total - a.total || a.team.localeCompare(b.team))
  let tied = 0
  let seen = 0
  let last: number | null = null
  return sorted.map((s) => {
    seen += 1
    if (s.total !== last) {
      tied = seen
      last = s.total
    }
    return { ...s, rank: tied, tiedRank: tied }
  })
}

// ── 21:00 정산 ──────────────────────────────────────────────────

export interface SettlementResult {
  ranked: Ranked[]
  /** 다음 정산까지 눈에 띄는 팀. **공동 1위면 모두다** */
  spotlighted: TeamId[]
  /**
   * 다음 페이즈에 토큰을 더 받는 팀. **공동 꼴찌면 모두다.** 넷이 다
   * 같으면 꼴찌가 없다 — 아무도 안 받는다
   */
  comeback: TeamId[]
}

export function settle(scores: readonly ScoreBreakdown[]): SettlementResult {
  const ranked = rankTeams(scores)
  const worst = Math.max(...ranked.map((r) => r.rank))
  return {
    ranked,
    spotlighted: ranked.filter((r) => r.rank === 1).map((r) => r.team),
    comeback: worst === 1 ? [] : ranked.filter((r) => r.rank === worst).map((r) => r.team),
  }
}
