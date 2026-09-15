// 행동 — 어디에 서 있어야 하는가.
import { describe, expect, it } from 'vitest'
import {
  ACTION_TOKEN_COST,
  checkGate,
  checkStand,
  ownerLookup,
  PRODUCE_YIELD,
  STUDY_YIELD,
  type ActionKind,
} from './actions'
import type { TileState } from './resources'
import { PRODUCE_MONEY, STUDY_KNOWLEDGE, type TeamId } from './v2'

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

  // 연구는 여기 없다. 페이즈에, 연구실에서만 한다(occupy.ts)
  it('생산과 공부는 우리 땅 아무 데서나 한다', () => {
    // 대상 칸이 달라도 우리 땅 위면 된다
    expect(stand('produce', 'classroom', 'hallway').ok).toBe(true)
    expect(stand('study', 'classroom', 'hallway').ok).toBe(true)
    expect(stand('produce', 'library', 'library').reason).toBe('notOurZone')
    expect(stand('study', 'library', 'library').reason).toBe('notOurZone')
  })

  it('자유 시간 행동은 깃발·생산·공부뿐이다', () => {
    const kinds = Object.keys(ACTION_TOKEN_COST)
    for (const gone of ['research', 'sabotage', 'build', 'scout']) {
      expect(kinds, gone).not.toContain(gone)
    }
  })

  it('세 행동 모두 토큰 한 개다', () => {
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

describe('생산과 공부', () => {
  it('생산은 돈, 공부는 지식이다', () => {
    expect(PRODUCE_YIELD).toEqual({ money: PRODUCE_MONEY })
    expect(STUDY_YIELD).toEqual({ knowledge: STUDY_KNOWLEDGE })
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
