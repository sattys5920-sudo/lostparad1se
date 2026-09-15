// 학교가 층·복도 구조로 제대로 섰는지 본다.
//
// 이웃을 층·줄·자리에서 계산하므로 배치를 잘못 적으면 여기서 걸린다.
// 전에는 5×5 격자의 90도 회전 대칭을 확인했다 — 층이 생기면서 그
// 대칭은 없어졌다. 대신 **학교로서 말이 되는지**를 본다.
import { describe, expect, it } from 'vitest'
import {
  ADJACENCY,
  BASE_OF,
  FLOORS,
  TILES,
  TILE_BY_ID,
  connectedSize,
  pathBetween,
  rowOf,
  stairIdOf,
  startingTiles,
  stepsBetween,
} from './board'
import { TEAM_IDS, type TeamId } from './v2'

const byTier = (tier: string) => TILES.filter((t) => t.tier === tier)

describe('판', () => {
  it('방 스물넷과 계단 여섯이다', () => {
    expect(TILES.filter((t) => t.tier !== 'stair')).toHaveLength(24)
    expect(byTier('stair')).toHaveLength(6)
  })

  it('층위별 칸 수가 맞다', () => {
    expect(byTier('base')).toHaveLength(4)
    expect(byTier('core')).toHaveLength(4)
    expect(byTier('gate')).toHaveLength(4)
    expect(byTier('cross')).toHaveLength(3)
    expect(byTier('plaza')).toHaveLength(1)
  })

  it('id 가 겹치지 않는다', () => {
    expect(new Set(TILES.map((t) => t.id)).size).toBe(TILES.length)
  })

  it('이름이 겹치지 않는다', () => {
    expect(new Set(TILES.map((t) => t.name)).size).toBe(TILES.length)
  })

  it('인접은 서로에게 성립한다', () => {
    for (const [a, ns] of Object.entries(ADJACENCY)) {
      for (const n of ns) expect(ADJACENCY[n]).toContain(a)
    }
  })

  it('외톨이 방이 없다', () => {
    for (const t of TILES) expect(ADJACENCY[t.id].length).toBeGreaterThan(0)
  })
})

describe('층과 복도', () => {
  it('네 층이다 — 지하·1층·2층·옥상', () => {
    expect([...FLOORS]).toEqual(['b1', 'f1', 'f2', 'roof'])
  })

  it('같은 층 같은 줄에서는 옆자리끼리 이웃이다', () => {
    for (const floor of FLOORS) {
      for (const side of ['up', 'down'] as const) {
        const row = rowOf(floor, side)
        for (let i = 1; i < row.length; i++) {
          expect(ADJACENCY[row[i - 1].id]).toContain(row[i].id)
        }
      }
    }
  })

  it('복도를 사이에 두고 마주 본 방끼리 이웃이다', () => {
    for (const floor of FLOORS) {
      const up = rowOf(floor, 'up')
      const down = rowOf(floor, 'down')
      for (let i = 0; i < Math.min(up.length, down.length); i++) {
        expect(ADJACENCY[up[i].id]).toContain(down[i].id)
      }
    }
  })

  it('층이 다른 방끼리는 계단을 거치지 않고는 못 간다', () => {
    for (const t of TILES) {
      for (const n of ADJACENCY[t.id]) {
        if (TILE_BY_ID[t.id].floor === TILE_BY_ID[n].floor) continue
        // 층을 넘는 이웃은 계단뿐이다(옥상으로 올라가는 계단 포함)
        const one = TILE_BY_ID[t.id].tier === 'stair'
        const two = TILE_BY_ID[n].tier === 'stair'
        expect(one || two).toBe(true)
      }
    }
  })
})

describe('계단', () => {
  it('층마다 서쪽·동쪽 하나씩이다. 옥상만 없다', () => {
    for (const floor of ['b1', 'f1', 'f2'] as const) {
      for (const end of ['w', 'e'] as const) {
        expect(TILE_BY_ID[stairIdOf(floor, end)]).toBeDefined()
      }
    }
  })

  it('바로 위아래 층끼리만 이어진다 — 지하에서 옥상으로 바로 못 간다', () => {
    for (const end of ['w', 'e'] as const) {
      expect(ADJACENCY[stairIdOf('b1', end)]).toContain(stairIdOf('f1', end))
      expect(ADJACENCY[stairIdOf('b1', end)]).not.toContain(stairIdOf('f2', end))
      expect(ADJACENCY[stairIdOf('f2', end)]).toContain('rooftop')
    }
  })

  it('서쪽 계단과 동쪽 계단은 서로 안 통한다', () => {
    for (const floor of ['b1', 'f1', 'f2'] as const) {
      expect(ADJACENCY[stairIdOf(floor, 'w')]).not.toContain(stairIdOf(floor, 'e'))
    }
  })

  it('아무도 계단을 가질 수 없다', () => {
    for (const t of byTier('stair')) expect(t.homeOf).toBeNull()
  })
})

describe('걸어서 닿는다', () => {
  it('어느 방에서 어느 방으로든 길이 있다', () => {
    const ids = TILES.map((t) => t.id)
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue
        expect(pathBetween(a, b).length, `${a}→${b}`).toBeGreaterThan(0)
      }
    }
  })

  it('지하에서 옥상까지는 계단을 세 번 오른다', () => {
    // 창고(지하) → 서쪽 계단 셋 → 옥상
    expect(stepsBetween('storage', 'rooftop')).toBe(4)
  })

  it('같은 층 같은 줄의 양끝은 계단으로 돌아가는 편이 빠를 수도 있다', () => {
    // 2층 위 줄 다섯 칸. 끝에서 끝은 복도를 따라 네 걸음, 계단으로도 네 걸음
    expect(stepsBetween('centralPlaza', 'library')).toBe(4)
  })
})

describe('시작 상태', () => {
  it('기지는 넷이고 팀마다 하나다', () => {
    expect(Object.keys(BASE_OF).sort()).toEqual([...TEAM_IDS].sort())
  })

  it('시작할 때 쥐는 칸에 계단은 없다', () => {
    for (const team of TEAM_IDS as TeamId[]) {
      for (const id of startingTiles(team)) {
        expect(TILE_BY_ID[id].tier).not.toBe('stair')
      }
    }
  })

  it('기지는 제 시작 칸에 들어 있다', () => {
    for (const team of TEAM_IDS as TeamId[]) {
      expect(startingTiles(team)).toContain(BASE_OF[team])
    }
  })
})

describe('연결 점수', () => {
  const owners = (mine: string[]) => (id: string) => (mine.includes(id) ? ('A' as TeamId) : null)

  it('기지만 쥐면 0이다 — 기지는 세지 않는다', () => {
    expect(connectedSize('A', owners([BASE_OF.A]))).toBe(0)
  })

  it('떨어진 땅은 한 점도 되지 않는다', () => {
    const far = TILES.find((t) => t.floor === 'f2' && t.tier === 'zone1') as (typeof TILES)[number]
    expect(connectedSize('A', owners([BASE_OF.A, far.id]))).toBe(0)
  })

  it('이어 붙이면 늘어난다', () => {
    const next = ADJACENCY[BASE_OF.A].filter((id) => TILE_BY_ID[id].tier !== 'stair')
    expect(connectedSize('A', owners([BASE_OF.A, ...next]))).toBe(next.length)
  })
})
