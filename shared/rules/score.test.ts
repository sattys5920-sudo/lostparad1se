// 점수와 정산 — 공개 점수에 비밀 목표가 섞이지 않는지.
import { describe, expect, it } from 'vitest'
import {
  connectionScore,
  coreScore,
  developmentScore,
  finalScore,
  goalAchieved,
  goalScore,
  publicScore,
  rankTeams,
  resourceScore,
  settle,
  territoryScore,
  type ScoreInput,
  type TeamState,
} from './score'
import { startingTiles, TILE_BY_ID, TILE_IDS } from './board'
import type { TileState } from './buildings'
import { GOAL_BY_KIND, type GoalKind, type TeamId } from './v2'

const team = (over: Partial<TeamState> = {}): TeamState => ({
  team: 'A',
  resources: { money: 0, knowledge: 0, influence: 0 },
  researchTier: 0,
  allyTeam: null,
  goals: [],
  lostTile: false,
  raidSuccesses: 0,
  brokeAlliance: false,
  trustFrom: [],
  revealed: false,
  ...over,
})

/** 판 전체. owned에 적은 칸만 그 팀 것이다. */
function board(owned: Partial<Record<TeamId, string[]>>, buildings: Record<string, TileState['buildings']> = {}): TileState[] {
  const who = new Map<string, TeamId>()
  for (const [t, ids] of Object.entries(owned) as [TeamId, string[]][]) {
    for (const id of ids) who.set(id, t)
  }
  return TILE_IDS.map((tileId) => ({
    tileId,
    ownerTeam: who.get(tileId) ?? TILE_BY_ID[tileId].homeOf,
    buildings: buildings[tileId] ?? [],
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
    // A의 1구역은 교실 3, 복도 1
    expect(territoryScore(input())).toBe(4)
  })

  it('건물 가치가 붙는다', () => {
    const tiles = board({ A: [...startingTiles('A')] }, { classroom: [{ kind: 'store', level: 1 }] })
    expect(territoryScore(input({ tiles }))).toBe(4 + 2)
  })

  it('개조해도 가치 보너스는 그대로다', () => {
    const tiles = board({ A: [...startingTiles('A')] }, { classroom: [{ kind: 'store', level: 2 }] })
    expect(territoryScore(input({ tiles }))).toBe(4 + 2)
  })

  it('A의 기록 보너스가 붙는다', () => {
    const out = territoryScore(input({ fragments: [{ day: 1, spotTile: 'classroom' }] }))
    expect(out).toBe(4 + 2)
  })
})

describe('연결', () => {
  it('기지에서 이어진 칸만 센다', () => {
    expect(connectionScore(input())).toBe(2)
  })

  it('떨어진 땅은 한 점도 아니다', () => {
    const tiles = board({ A: [...startingTiles('A'), 'gym'] })
    expect(connectionScore(input({ tiles }))).toBe(2)
  })

  it('이어 붙이면 늘어난다', () => {
    const tiles = board({ A: [...startingTiles('A'), 'library'] })
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
    expect(resourceScore(input({ team: team({ resources: { money: 7, knowledge: 3, influence: 4 } }) }))).toBe(2)
    expect(resourceScore(input({ team: team({ resources: { money: 4, knowledge: 0, influence: 0 } }) }))).toBe(0)
  })

  it('발전은 건물 단계 합에 연구 단계 두 배를 더한다', () => {
    const tiles = board({ A: [...startingTiles('A')] }, {
      classroom: [{ kind: 'shop', level: 2 }],
      hallway: [{ kind: 'archive', level: 1 }],
    })
    expect(developmentScore(input({ tiles, team: team({ researchTier: 3 }) }))).toBe(2 + 1 + 6)
  })
})

describe('비밀 목표', () => {
  const check = (kind: GoalKind, over: Partial<ScoreInput> = {}, rivalTeam?: TeamId) =>
    goalAchieved({ kind, rivalTeam }, input(over))

  it('관문 두 칸', () => {
    expect(check('gateGuard', { tiles: board({ A: ['library'] }) })).toBe(false)
    expect(check('gateGuard', { tiles: board({ A: ['library', 'gym'] }) })).toBe(true)
  })

  it('한가운데와 두 개의 심장', () => {
    expect(check('theMiddle', { tiles: board({ A: ['centralPlaza'] }) })).toBe(true)
    expect(check('twoHearts', { tiles: board({ A: ['playground', 'auditorium'] }) })).toBe(true)
    expect(check('twoHearts', { tiles: board({ A: ['playground'] }) })).toBe(false)
  })

  it('끊기지 않는 길은 연결 9 이상이다', () => {
    const wide = board({ A: ['baseA', 'classroom', 'hallway', 'library', 'garden', 'artRoom', 'oldBuilding', 'playground', 'rooftop', 'mainBuilding'] })
    expect(check('unbrokenPath', { tiles: wide })).toBe(true)
    expect(check('unbrokenPath')).toBe(false)
  })

  it('철옹성은 한 번도 안 뺏겼을 때다', () => {
    expect(goalAchieved({ kind: 'fortress' }, input({ team: team({ lostTile: false }) }))).toBe(true)
    expect(goalAchieved({ kind: 'fortress' }, input({ team: team({ lostTile: true }) }))).toBe(false)
  })

  it('약탈자는 세 번 이상이다', () => {
    expect(goalAchieved({ kind: 'raider' }, input({ team: team({ raidSuccesses: 2 }) }))).toBe(false)
    expect(goalAchieved({ kind: 'raider' }, input({ team: team({ raidSuccesses: 3 }) }))).toBe(true)
  })

  it('먼 친구는 대각선 팀과 동맹일 때다', () => {
    // A는 왼쪽 아래, B는 오른쪽 아래로 이웃이다. C는 오른쪽 위 — 대각선
    expect(goalAchieved({ kind: 'distantFriend' }, input({ team: team({ allyTeam: 'B' }) }))).toBe(false)
    expect(goalAchieved({ kind: 'distantFriend' }, input({ team: team({ allyTeam: 'C' }) }))).toBe(true)
  })

  it('배신 없는 반은 먼저 깬 적 없고 끝날 때 동맹이 있을 때다', () => {
    expect(goalAchieved({ kind: 'noBetrayal' }, input({ team: team({ allyTeam: 'B' }) }))).toBe(true)
    expect(
      goalAchieved({ kind: 'noBetrayal' }, input({ team: team({ allyTeam: 'B', brokeAlliance: true }) })),
    ).toBe(false)
    expect(goalAchieved({ kind: 'noBetrayal' }, input({ team: team({ allyTeam: null }) }))).toBe(false)
  })

  it('모두의 신뢰는 나머지 세 팀 전부에게서 받았을 때다', () => {
    expect(goalAchieved({ kind: 'everyonesTrust' }, input({ team: team({ trustFrom: ['B', 'C'] }) }))).toBe(false)
    expect(
      goalAchieved({ kind: 'everyonesTrust' }, input({ team: team({ trustFrom: ['B', 'C', 'D'] }) })),
    ).toBe(true)
  })

  it('입 무거운 반은 아무도 털어놓지 않았을 때다', () => {
    expect(goalAchieved({ kind: 'tightLipped' }, input({ team: team({ revealed: true }) }))).toBe(false)
  })

  it('학구파·알부자는 문턱값이다', () => {
    expect(goalAchieved({ kind: 'scholars' }, input({ team: team({ researchTier: 4 }) }))).toBe(true)
    expect(
      goalAchieved({ kind: 'moneyed' }, input({ team: team({ resources: { money: 15, knowledge: 0, influence: 0 } }) })),
    ).toBe(true)
  })

  it('건축가는 2단계 건물 셋이다', () => {
    const three = board({ A: ['classroom', 'hallway', 'garden'] }, {
      classroom: [{ kind: 'shop', level: 2 }],
      hallway: [{ kind: 'archive', level: 2 }],
      garden: [{ kind: 'security', level: 2 }],
    })
    expect(check('architect', { tiles: three })).toBe(true)
  })

  it('방송부는 둘 다 있어야 한다', () => {
    const one = board({ A: ['classroom'] }, { classroom: [{ kind: 'broadcast', level: 1 }] })
    expect(check('broadcastClub', { tiles: one })).toBe(false)
    const both = board({ A: ['classroom', 'hallway'] }, {
      classroom: [{ kind: 'broadcast', level: 1 }],
      hallway: [{ kind: 'hideout', level: 1 }],
    })
    expect(check('broadcastClub', { tiles: both })).toBe(true)
  })

  it('라이벌은 적힌 팀보다 영역 점수가 높을 때다', () => {
    const territoryOf = (t: TeamId) => (t === 'A' ? 10 : 5)
    expect(goalAchieved({ kind: 'rival', rivalTeam: 'B' }, input(), territoryOf)).toBe(true)
    expect(goalAchieved({ kind: 'rival', rivalTeam: 'B' }, input(), () => 5)).toBe(false)
  })

  it('달성한 것만 점수가 된다', () => {
    const t = team({ goals: [{ kind: 'fortress' }, { kind: 'raider' }], lostTile: false, raidSuccesses: 0 })
    expect(goalScore(input({ team: t }))).toBe(GOAL_BY_KIND.fortress.points)
  })
})

describe('공개 점수와 최종 점수', () => {
  const t = team({ goals: [{ kind: 'fortress' }] })

  it('공개 점수에는 비밀 목표가 0이다', () => {
    const out = publicScore(input({ team: t }))
    expect(out.goals).toBe(0)
  })

  it('최종 점수에만 들어간다', () => {
    const open = publicScore(input({ team: t }))
    const done = finalScore(input({ team: t }))
    expect(done.goals).toBe(GOAL_BY_KIND.fortress.points)
    expect(done.total).toBe(open.total + GOAL_BY_KIND.fortress.points)
  })

  it('합계가 항목의 합과 같다', () => {
    const out = finalScore(input({ team: t }))
    expect(out.total).toBe(
      out.territory + out.connection + out.core + out.resource + out.development + out.goals,
    )
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
