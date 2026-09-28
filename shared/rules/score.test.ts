// 점수와 정산. **팀 점수는 가진 방 개수다** — 방은 모두 1점.
import { describe, expect, it } from 'vitest'
import { publicScore, rankTeams, settle, territoryScore, type ScoreBreakdown, type ScoreInput } from './score'
import { TILE_IDS } from './board'
import type { TileState } from './resources'
import type { TeamId } from './v2'

/** 판 전체. owned에 적은 칸만 그 팀 것이다. */
function board(owned: Partial<Record<TeamId, string[]>>): TileState[] {
  const who = new Map<string, TeamId>()
  for (const [t, ids] of Object.entries(owned) as [TeamId, string[]][]) {
    for (const id of ids) who.set(id, t)
  }
  return TILE_IDS.map((tileId) => ({ tileId, ownerTeam: who.get(tileId) ?? null }))
}

const MINE = ['baseA', 'cafeteria', 'hallway']

const input = (over: Partial<ScoreInput> = {}): ScoreInput => ({
  tiles: board({ A: [...MINE] }),
  team: 'A',
  ...over,
})

describe('영역', () => {
  it('가진 방 하나에 1점 — 어느 방이든 같다', () => {
    // 교무실 · 급식실 · 가사실. 전에는 4 · 4 · 1 이었다
    expect(territoryScore(input())).toBe(3)
  })

  it('남의 팀 방은 안 센다', () => {
    const tiles = board({ A: ['baseA'], B: ['cafeteria', 'hallway'] })
    expect(territoryScore(input({ tiles }))).toBe(1)
    expect(territoryScore(input({ tiles, team: 'B' }))).toBe(2)
  })

  /* 떨어져 있어도 한 방은 한 방이다. 연결 점수를 걷어냈다 */
  it('떨어진 방도 똑같이 1점이다 — 연결은 안 본다', () => {
    const tiles = board({ A: ['baseA', 'musicRoom'] })
    expect(territoryScore(input({ tiles }))).toBe(2)
  })
})

describe('점수', () => {
  /* 핵심 방 · 자원 · 연구 단계가 더해지던 것을 걷어냈다 */
  it('합계는 가진 방 개수뿐이다', () => {
    const out = publicScore(input())
    expect(out).toEqual({ team: 'A', territory: 3, total: 3 })
  })
})

describe('순위', () => {
  const row = (team: TeamId, total: number): ScoreBreakdown => ({ team, territory: total, total })

  it('방이 많은 팀이 앞이다', () => {
    const out = rankTeams([row('A', 1), row('B', 2)])
    expect(out[0].team).toBe('B')
    expect(out[0].rank).toBe(1)
  })

  /*
   * **안 가른 순위.** 화면에 줄을 세우려면 끝까지 갈라야 하지만,
   * 「우리 팀이 1위가 아니다」를 묻는 조항은 안 가른 쪽을 봐야 한다.
   * 동점을 지식·돈으로 가르지 않는다 — 개인 지갑이 팀 순위에 끼면 안 된다
   */
  it('공동 1위는 둘 다 1위다 — 줄만 이름 순으로 선다', () => {
    const out = rankTeams([row('B', 3), row('A', 3)])
    const tied = Object.fromEntries(out.map((r) => [r.team, r.tiedRank]))
    expect(tied).toEqual({ A: 1, B: 1 })
    expect(out.map((r) => r.team)).toEqual(['A', 'B'])
    expect(out.map((r) => r.rank)).toEqual([1, 2])
  })

  it('1·2·2·4 로 건너뛴다', () => {
    const out = rankTeams([row('A', 4), row('B', 3), row('C', 3), row('D', 1)])
    const tied = Object.fromEntries(out.map((r) => [r.team, r.tiedRank]))
    expect(tied).toEqual({ A: 1, B: 2, C: 2, D: 4 })
  })

  it('넷이 다 같으면 넷 다 1위다', () => {
    const out = rankTeams([row('A', 2), row('B', 2), row('C', 2), row('D', 2)])
    expect(out.every((r) => r.tiedRank === 1)).toBe(true)
  })
})

describe('정산', () => {
  it('1위는 주목, 꼴찌는 만회다', () => {
    const rows = (['A', 'B', 'C', 'D'] as TeamId[]).map((t, i) => ({ team: t, territory: 4 - i, total: 4 - i }))
    const out = settle(rows)
    expect(out.spotlighted).toBe('A')
    expect(out.comeback).toBe('D')
    expect(out.ranked.map((r) => r.rank)).toEqual([1, 2, 3, 4])
  })
})
