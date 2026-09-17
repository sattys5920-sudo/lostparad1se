// 점수와 정산.
import { describe, expect, it } from 'vitest'
import {
  connectionScore,
  coreScore,
  developmentScore,
  publicScore,
  rankTeams,
  resourceScore,
  settle,
  territoryScore,
  type ScoreInput,
  type TeamState,
} from './score'
import { startingTiles, TILE_BY_ID, TILE_IDS } from './board'
import type { TileState } from './resources'
import type { TeamId } from './v2'

const team = (over: Partial<TeamState> = {}): TeamState => ({
  team: 'A',
  resources: { money: 0, knowledge: 0 },
  researchTier: 0,
  ...over,
})

/** 판 전체. owned에 적은 칸만 그 팀 것이다. */
function board(owned: Partial<Record<TeamId, string[]>>): TileState[] {
  const who = new Map<string, TeamId>()
  for (const [t, ids] of Object.entries(owned) as [TeamId, string[]][]) {
    for (const id of ids) who.set(id, t)
  }
  return TILE_IDS.map((tileId) => ({
    tileId,
    ownerTeam: who.get(tileId) ?? TILE_BY_ID[tileId].homeOf,
  }))
}

const input = (over: Partial<ScoreInput> = {}): ScoreInput => ({
  tiles: board({ A: [...startingTiles('A')] }),
  fragments: [],
  team: team(),
  ...over,
})

describe('영역', () => {
  it('가진 칸의 가치를 더한다 — 기지는 빼고', () => {
    // A(교무실)가 시작할 때 쥐는 것은 급식실 4 · 가사실 1
    expect(territoryScore(input())).toBe(5)
  })

  it('A의 기록 보너스가 붙는다', () => {
    const out = territoryScore(input({ fragments: [{ day: 1, spotTile: 'cafeteria' }] }))
    expect(out).toBe(5 + 2)
  })
})

describe('연결', () => {
  it('기지에서 이어진 칸만 센다', () => {
    expect(connectionScore(input())).toBe(2)
  })

  it('떨어진 땅은 한 점도 아니다', () => {
    // 음악실은 2층이다. 계단을 안 쥐었으니 이어지지 않는다
    const tiles = board({ A: [...startingTiles('A'), 'musicRoom'] })
    expect(connectionScore(input({ tiles }))).toBe(2)
  })

  it('이어 붙이면 늘어난다', () => {
    const tiles = board({ A: [...startingTiles('A'), 'annex'] })
    expect(connectionScore(input({ tiles }))).toBe(3)
  })
})

describe('핵심', () => {
  it('핵심 3, 중앙광장 5', () => {
    const tiles = board({ A: ['playground', 'centralPlaza'] })
    expect(coreScore(input({ tiles }))).toBe(8)
  })

  it('없으면 0이다', () => {
    expect(coreScore(input())).toBe(0)
  })
})

describe('자원과 발전', () => {
  it('자원은 다 더해 5로 나누고 버린다', () => {
    expect(resourceScore(input({ team: team({ resources: { money: 7, knowledge: 7 } }) }))).toBe(2)
    expect(resourceScore(input({ team: team({ resources: { money: 4, knowledge: 0 } }) }))).toBe(0)
  })

  // 건물을 걷어내면서 발전에 더할 것은 연구뿐이 되었다
  it('발전은 연구 단계의 두 배다', () => {
    const tiles = board({ A: [...startingTiles('A')] })
    expect(developmentScore(input({ tiles, team: team({ researchTier: 3 }) }))).toBe(6)
  })
})

describe('점수', () => {
  /**
   * 팀 비밀 목표를 걷어냈다. 정산에서 보이는 수가 곧 끝에 세는
   * 수다 — 뒤에 따로 붙는 것이 없다.
   */
  it('합계가 항목의 합과 같다', () => {
    const out = publicScore(input({ team: team() }))
    expect(out.total).toBe(out.territory + out.connection + out.core + out.resource + out.development)
  })
})

describe('순위', () => {
  const row = (team: TeamId, total: number, core = 0) => ({
    team, territory: total, connection: 0, core, resource: 0, development: 0, goals: 0, total,
  })

  it('점수가 높은 팀이 앞이다', () => {
    const out = rankTeams([row('A', 10), row('B', 20)], () => 0)
    expect(out[0].team).toBe('B')
    expect(out[0].rank).toBe(1)
  })

  it('동점이면 영향력이 많은 팀이다', () => {
    const out = rankTeams([row('A', 10), row('B', 10)], (t) => (t === 'A' ? 5 : 1))
    expect(out[0].team).toBe('A')
  })

  it('영향력도 같으면 핵심이 많은 팀이다', () => {
    const out = rankTeams([row('A', 10, 0), row('B', 10, 3)], () => 2)
    expect(out[0].team).toBe('B')
  })
})

describe('정산', () => {
  it('1위는 주목, 꼴찌는 만회다', () => {
    const rows = (['A', 'B', 'C', 'D'] as TeamId[]).map((t, i) => ({
      team: t, territory: 0, connection: 0, core: 0, resource: 0, development: 0, goals: 0,
      total: [30, 20, 10, 5][i],
    }))
    const out = settle(rows, () => 0)
    expect(out.spotlighted).toBe('A')
    expect(out.comeback).toBe('D')
    expect(out.ranked.map((r) => r.rank)).toEqual([1, 2, 3, 4])
  })
})
