// 행동 — 어디에 서 있어야 하는가.
import { describe, expect, it } from 'vitest'
import {
  ACTION_TOKEN_COST,
  canPlantFlag,
  checkGate,
  checkStand,
  ownerLookup,
  PRODUCE_YIELD,
  STUDY_YIELD,
  scoutAlreadyToday,
  scoutYield,
  type ActionKind,
} from './actions'
import type { TileState } from './resources'
import { PRODUCE_MONEY, SCOUT_GAIN, STUDY_KNOWLEDGE, type TeamId } from './v2'

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

  // 연구는 여기 없다. 페이즈에, 연구실에서만 한다(occupy.ts)
  it('생산과 공부는 우리 땅 아무 데서나 한다', () => {
    // 대상 칸이 달라도 우리 땅 위면 된다
    expect(stand('produce', 'classroom', 'hallway').ok).toBe(true)
    expect(stand('study', 'classroom', 'hallway').ok).toBe(true)
    expect(stand('produce', 'library', 'library').reason).toBe('notOurZone')
    expect(stand('study', 'library', 'library').reason).toBe('notOurZone')
  })

  it('자유 시간에 걸 수 있는 행동에 연구도 견제도 없다', () => {
    const kinds = Object.keys(ACTION_TOKEN_COST)
    expect(kinds).not.toContain('research')
    expect(kinds).not.toContain('sabotage')
    expect(kinds).not.toContain('build')
  })

  it('탐색은 우리 땅이 아닌 곳에서 한다', () => {
    expect(stand('scout', 'library', 'library').ok).toBe(true)
    expect(stand('scout', 'classroom', 'classroom').reason).toBe('ourTile')
  })

  it('네 행동 모두 토큰 한 개다', () => {
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
    // 상점(A 시작 칸) 옆 양호실은 맞닿아 있다
    expect(plant('annex').ok).toBe(true)
    // 다른 층의 과학실은 닿지 않는다
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

describe('생산과 공부', () => {
  it('생산은 돈, 공부는 지식이다', () => {
    expect(PRODUCE_YIELD).toEqual({ money: PRODUCE_MONEY })
    expect(STUDY_YIELD).toEqual({ knowledge: STUDY_KNOWLEDGE })
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

describe('주인 찾기', () => {
  it('칸 목록에서 주인을 짚는다', () => {
    const tiles: TileState[] = [{ tileId: 'classroom', ownerTeam: 'A' }]
    const look = ownerLookup(tiles)
    expect(look('classroom')).toBe('A')
    expect(look('library')).toBe(null)
  })
})
