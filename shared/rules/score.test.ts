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
import { TILE_IDS } from './board'
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
  return TILE_IDS.map((tileId) => ({ tileId, ownerTeam: who.get(tileId) ?? null }))
}

/**
 * 시험에 쓰는 세 칸. **붙어 있다** — 교무실 4 · 급식실 4 · 가사실 1.
 *
 * 기지가 없어져서 「시작할 때 쥔 칸」이 없다. 전에는 그걸 썼는데,
 * 이제는 시험이 직접 붙어 있는 덩어리를 하나 적어 둔다.
 */
const MINE = ['baseA', 'cafeteria', 'hallway']

const input = (over: Partial<ScoreInput> = {}): ScoreInput => ({
  tiles: board({ A: [...MINE] }),
  fragments: [],
  team: team(),
  ...over,
})

describe('영역', () => {
  it('가진 칸의 가치를 더한다 — **빼는 칸은 없다**', () => {
    // 교무실 4 · 급식실 4 · 가사실 1. 기지가 없으니 거저 받은 칸도 없다
    expect(territoryScore(input())).toBe(9)
  })

  it('A의 기록 보너스가 붙는다', () => {
    const out = territoryScore(input({ fragments: [{ day: 1, spotTile: 'cafeteria' }] }))
    expect(out).toBe(9 + 2)
  })
})

describe('연결', () => {
  it('붙어 있는 덩어리를 센다', () => {
    expect(connectionScore(input())).toBe(3)
  })

  it('한 칸뿐이면 연결이 아니다', () => {
    expect(connectionScore(input({ tiles: board({ A: ['baseA'] }) }))).toBe(0)
  })

  it('떨어진 땅은 같이 안 센다 — 제일 큰 덩어리 하나다', () => {
    // 음악실은 2층이다. 붙어 있지 않으니 세 칸 덩어리만 남는다
    const tiles = board({ A: [...MINE, 'musicRoom'] })
    expect(connectionScore(input({ tiles }))).toBe(3)
  })

  it('이어 붙이면 늘어난다', () => {
    const tiles = board({ A: [...MINE, 'annex'] })
    expect(connectionScore(input({ tiles }))).toBe(4)
  })
})

describe('핵심', () => {
  it('핵심 한 칸당 3', () => {
    const tiles = board({ A: ['playground', 'broadcastRoom'] })
    expect(coreScore(input({ tiles }))).toBe(6)
  })

  // 2-3 교실은 아무도 못 가지는 방이 됐다. 혹시 소유가 적혀 있어도
  // 점수로 안 간다 — 두 군데가 어긋나도 점수판은 흔들리지 않는다
  it('2-3 교실은 점수에 안 들어간다', () => {
    const tiles = board({ A: ['centralPlaza'] })
    expect(coreScore(input({ tiles }))).toBe(0)
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
    const tiles = board({ A: [...MINE] })
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

  /*
   * **안 가른 순위.** 화면에 줄을 세우려면 끝까지 갈라야 하지만,
   * 「우리 팀이 1위가 아니다」를 묻는 조항은 안 가른 쪽을 봐야 한다 —
   * 같은 점수인데 지식으로 갈라 2위를 만들어 놓으면, 제일 잘한 팀이
   * 그 조항을 채운다.
   */
  it('공동 1위는 둘 다 1위다', () => {
    const out = rankTeams([row('A', 10), row('B', 10)], (t) => (t === 'A' ? 5 : 1))
    const tied = Object.fromEntries(out.map((r) => [r.team, r.tiedRank]))
    expect(tied).toEqual({ A: 1, B: 1 })
    // 가른 쪽은 그대로 1·2 다
    expect(out.map((r) => r.rank)).toEqual([1, 2])
  })

  it('1·2·2·4 로 건너뛴다', () => {
    const out = rankTeams([row('A', 30), row('B', 20), row('C', 20), row('D', 10)], () => 0)
    const tied = Object.fromEntries(out.map((r) => [r.team, r.tiedRank]))
    expect(tied).toEqual({ A: 1, B: 2, C: 2, D: 4 })
  })

  it('넷이 다 같으면 넷 다 1위다', () => {
    const out = rankTeams([row('A', 7), row('B', 7), row('C', 7), row('D', 7)], () => 0)
    expect(out.every((r) => r.tiedRank === 1)).toBe(true)
  })

  it('다 다르면 가른 순위와 같다', () => {
    const out = rankTeams([row('A', 40), row('B', 30), row('C', 20), row('D', 10)], () => 0)
    expect(out.every((r) => r.rank === r.tiedRank)).toBe(true)
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
