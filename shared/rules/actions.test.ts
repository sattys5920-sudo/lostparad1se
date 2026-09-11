// 행동 — 어디에 서 있어야 하는가.
import { describe, expect, it } from 'vitest'
import {
  ACTION_TOKEN_COST,
  canPlantFlag,
  checkGate,
  checkSabotage,
  checkStand,
  ownerLookup,
  researchCost,
  scoutAlreadyToday,
  scoutYield,
  type ActionKind,
} from './actions'
import type { TileState } from './buildings'
import { RESEARCH_BASE_KNOWLEDGE, SABOTAGE_INFLUENCE, SCOUT_GAIN, type TeamId } from './v2'

/** A는 기지와 1구역, B는 동아리실 하나. 나머지는 빈 칸이다. */
const OWNERS: Record<string, TeamId | null> = {
  baseA: 'A',
  classroom: 'A',
  hallway: 'A',
  clubRoom: 'B',
}
const ownerOf = (id: string) => OWNERS[id] ?? null

const stand = (kind: ActionKind, standingOn: string | null, targetTile: string, team: TeamId = 'A') =>
  checkStand({ kind, standingOn, targetTile, team, ownerOf })

describe('서 있어야 할 곳', () => {
  it('걷는 중에는 아무것도 못 한다', () => {
    for (const kind of Object.keys(ACTION_TOKEN_COST) as ActionKind[]) {
      expect(stand(kind, null, 'classroom').reason).toBe('walking')
    }
  })

  it('깃발은 그 칸에 직접 서 있어야 한다', () => {
    expect(stand('flag', 'library', 'library').ok).toBe(true)
    expect(stand('flag', 'classroom', 'library').reason).toBe('notThere')
  })

  it('건설은 우리 칸 위에서만 한다', () => {
    expect(stand('build', 'classroom', 'classroom').ok).toBe(true)
    expect(stand('build', 'clubRoom', 'clubRoom').reason).toBe('notOurTile')
  })

  it('연구와 생산은 우리 땅 아무 데서나 한다', () => {
    expect(stand('research', 'hallway', 'hallway').ok).toBe(true)
    // 대상 칸이 달라도 우리 땅 위면 된다
    expect(stand('produce', 'classroom', 'hallway').ok).toBe(true)
    expect(stand('produce', 'library', 'library').reason).toBe('notOurZone')
  })

  it('탐색은 우리 땅이 아닌 곳에서 한다', () => {
    expect(stand('scout', 'library', 'library').ok).toBe(true)
    expect(stand('scout', 'classroom', 'classroom').reason).toBe('ourTile')
  })

  it('견제는 상대 팀 칸 안에 들어가야 한다', () => {
    expect(stand('sabotage', 'clubRoom', 'clubRoom').ok).toBe(true)
    // 빈 칸은 상대 칸이 아니다
    expect(stand('sabotage', 'library', 'library').reason).toBe('notEnemyTile')
    expect(stand('sabotage', 'classroom', 'classroom').reason).toBe('notEnemyTile')
  })

  it('여섯 행동 모두 토큰 한 개다', () => {
    for (const n of Object.values(ACTION_TOKEN_COST)) expect(n).toBe(1)
  })
})

describe('발이 묶이면', () => {
  it('아무것도 못 한다', () => {
    expect(checkGate({ bound: true, asleep: false }).reason).toBe('bound')
    expect(checkGate({ bound: false, asleep: true }).reason).toBe('asleep')
    expect(checkGate({ bound: false, asleep: false }).ok).toBe(true)
  })
})

describe('깃발을 꽂을 수 있는 칸', () => {
  const plant = (tileId: string, over: Record<string, unknown> = {}) =>
    canPlantFlag({ tileId, team: 'A', ownerOf, hasFlag: false, coreOpen: true, ...over })

  it('기지에는 누구도 못 꽂는다', () => {
    expect(plant('baseB').reason).toBe('baseTile')
    expect(plant('baseA').reason).toBe('baseTile')
  })

  it('우리 영역과 맞닿아야 한다', () => {
    // 교실(A) 옆 도서관은 맞닿아 있다
    expect(plant('library').ok).toBe(true)
    // 반대편 과학실은 닿지 않는다
    expect(plant('scienceRoom').reason).toBe('notTouchingUs')
  })

  it('한 칸에 깃발은 하나다', () => {
    expect(plant('library', { hasFlag: true }).reason).toBe('flagHere')
  })

  it('핵심과 중앙광장은 A의 기록이 연 뒤에만 꽂는다', () => {
    expect(plant('playground', { coreOpen: false }).reason).toBe('coreClosed')
    expect(plant('centralPlaza', { coreOpen: false }).reason).toBe('coreClosed')
    // 열려 있어도 맞닿아 있어야 하는 건 그대로다
    expect(plant('centralPlaza', { coreOpen: true }).reason).toBe('notTouchingUs')
  })

  it('봉쇄된 칸에는 못 꽂는다', () => {
    expect(plant('library', { blockaded: true }).reason).toBe('blockaded')
  })
})

describe('연구', () => {
  it('단계가 오를수록 비싸진다', () => {
    expect(researchCost(0)).toEqual({ knowledge: RESEARCH_BASE_KNOWLEDGE })
    expect(researchCost(3)).toEqual({ knowledge: RESEARCH_BASE_KNOWLEDGE + 3 })
  })
})

describe('탐색', () => {
  it('돈이나 지식을 2 준다', () => {
    expect(scoutYield(0)).toEqual({ money: SCOUT_GAIN })
    expect(scoutYield(0.9)).toEqual({ knowledge: SCOUT_GAIN })
  })

  it('1을 넘겨도 넘치지 않는다', () => {
    expect(Object.keys(scoutYield(1))).toHaveLength(1)
    expect(Object.keys(scoutYield(-1))).toHaveLength(1)
  })

  it('같은 칸은 팀당 하루 한 번이다', () => {
    const done = [{ team: 'A' as TeamId, tileId: 'library' }]
    expect(scoutAlreadyToday(done, 'A', 'library')).toBe(true)
    expect(scoutAlreadyToday(done, 'B', 'library')).toBe(false)
    expect(scoutAlreadyToday(done, 'A', 'gym')).toBe(false)
  })
})

describe('견제', () => {
  const have = { money: 0, knowledge: 0, influence: 3 }

  it('영향력 2가 든다', () => {
    const out = checkSabotage({ kind: 'productionDown', targetTeam: 'B', team: 'A', resources: have })
    expect(out.ok).toBe(true)
    expect(out.cost).toEqual({ influence: SABOTAGE_INFLUENCE })
  })

  it('우리 팀에는 못 건다', () => {
    expect(
      checkSabotage({ kind: 'productionDown', targetTeam: 'A', team: 'A', resources: have }).reason,
    ).toBe('ownTeam')
  })

  it('영향력이 모자라면 막는다', () => {
    const poor = { money: 9, knowledge: 9, influence: 1 }
    expect(
      checkSabotage({ kind: 'tradeBlocked', targetTeam: 'B', team: 'A', resources: poor }).reason,
    ).toBe('cannotAfford')
  })

  it('카드로 걸면 영향력이 들지 않는다', () => {
    const broke = { money: 0, knowledge: 0, influence: 0 }
    const out = checkSabotage({ kind: 'tradeBlocked', targetTeam: 'B', team: 'A', resources: broke, byCard: true })
    expect(out.ok).toBe(true)
    expect(out.cost).toEqual({})
  })
})

describe('주인 찾기', () => {
  it('칸 목록에서 주인을 짚는다', () => {
    const tiles: TileState[] = [{ tileId: 'classroom', ownerTeam: 'A', buildings: [] }]
    const look = ownerLookup(tiles)
    expect(look('classroom')).toBe('A')
    expect(look('library')).toBe(null)
  })
})
