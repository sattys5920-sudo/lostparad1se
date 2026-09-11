// 판이 규칙 원문이 말하는 구조와 실제로 맞는지 본다.
//
// 인접을 좌표에서 계산하므로 표를 잘못 옮겨 적으면 여기서 걸린다.
import { describe, expect, it } from 'vitest'
import {
  ADJACENCY,
  BASE_OF,
  TILES,
  TILE_BY_ID,
  areNeighborTeams,
  connectedSize,
  pathBetween,
  startingTiles,
  stepsBetween,
  zoneOwner,
} from './board'
import { GRID, TEAM_IDS, type TeamId } from './v2'

const byTier = (tier: string) => TILES.filter((t) => t.tier === tier)

describe('판', () => {
  it('스물다섯 칸이다', () => {
    expect(TILES).toHaveLength(GRID * GRID)
    expect(new Set(TILES.map((t) => t.id)).size).toBe(GRID * GRID)
  })

  it('층위별 칸 수가 맞다', () => {
    expect(byTier('base')).toHaveLength(4)
    expect(byTier('zone1')).toHaveLength(8)
    expect(byTier('gate')).toHaveLength(4)
    expect(byTier('cross')).toHaveLength(4)
    expect(byTier('core')).toHaveLength(4)
    expect(byTier('plaza')).toHaveLength(1)
  })

  it('인접은 서로에게 성립한다', () => {
    for (const t of TILES) {
      for (const n of ADJACENCY[t.id]) {
        expect(ADJACENCY[n]).toContain(t.id)
      }
    }
  })

  it('대각선은 이웃이 아니다', () => {
    // 구관(4행2열)과 중앙광장(3행3열)은 대각선이다
    expect(ADJACENCY.oldBuilding).not.toContain('centralPlaza')
  })
})

describe('팀마다 똑같이 생겼다', () => {
  it('기지는 우리 1구역 두 칸하고만 맞닿는다', () => {
    for (const team of TEAM_IDS) {
      const neighbors = ADJACENCY[BASE_OF[team]]
      expect(neighbors).toHaveLength(2)
      for (const n of neighbors) {
        expect(TILE_BY_ID[n].tier).toBe('zone1')
        expect(zoneOwner(n)).toBe(team)
      }
    }
  })

  it('1구역 두 칸의 가치 합이 어느 팀이나 4다', () => {
    for (const team of TEAM_IDS) {
      const sum = ADJACENCY[BASE_OF[team]].reduce((n, id) => n + TILE_BY_ID[id].value, 0)
      expect(sum).toBe(4)
    }
    // 3짜리 하나, 1짜리 하나
    for (const team of TEAM_IDS) {
      const values = ADJACENCY[BASE_OF[team]].map((id) => TILE_BY_ID[id].value).sort()
      expect(values).toEqual([1, 3])
    }
  })

  it('기지에서 중앙광장까지 네 걸음이다', () => {
    for (const team of TEAM_IDS) {
      expect(stepsBetween(BASE_OF[team], 'centralPlaza')).toBe(4)
      expect(pathBetween(BASE_OF[team], 'centralPlaza')).toHaveLength(4)
    }
  })

  it('관문은 이웃 두 팀의 1구역과 핵심 하나에 붙는다', () => {
    for (const gate of byTier('gate')) {
      const tiers = ADJACENCY[gate.id].map((id) => TILE_BY_ID[id].tier)
      expect(tiers.filter((t) => t === 'zone1')).toHaveLength(2)
      expect(tiers.filter((t) => t === 'core')).toHaveLength(1)
      const owners = ADJACENCY[gate.id].map(zoneOwner).filter(Boolean)
      expect(new Set(owners).size).toBe(2)
    }
  })

  it('교차로는 우리 1구역 둘과 핵심 둘에 붙는다', () => {
    for (const cross of byTier('cross')) {
      const tiers = ADJACENCY[cross.id].map((id) => TILE_BY_ID[id].tier)
      expect(tiers.filter((t) => t === 'zone1')).toHaveLength(2)
      expect(tiers.filter((t) => t === 'core')).toHaveLength(2)
      const owners = ADJACENCY[cross.id].map(zoneOwner).filter(Boolean)
      expect(new Set(owners).size).toBe(1)
    }
  })

  it('핵심은 관문 하나·교차로 둘·중앙광장에 붙는다', () => {
    for (const core of byTier('core')) {
      const tiers = ADJACENCY[core.id].map((id) => TILE_BY_ID[id].tier)
      expect(tiers.filter((t) => t === 'gate')).toHaveLength(1)
      expect(tiers.filter((t) => t === 'cross')).toHaveLength(2)
      expect(tiers.filter((t) => t === 'plaza')).toHaveLength(1)
    }
  })

  it('중앙광장은 핵심 네 칸에만 붙는다', () => {
    const tiers = ADJACENCY.centralPlaza.map((id) => TILE_BY_ID[id].tier)
    expect(tiers).toEqual(['core', 'core', 'core', 'core'])
  })

  it('팀마다 관문 두 곳을 이웃과 하나씩 나눠 쓴다', () => {
    for (const team of TEAM_IDS) {
      const gates = byTier('gate').filter((g) =>
        ADJACENCY[g.id].some((n) => zoneOwner(n) === team),
      )
      expect(gates).toHaveLength(2)
    }
  })

  it('모든 팀은 이웃 둘과 대각선 하나를 갖는다', () => {
    for (const team of TEAM_IDS) {
      const others = TEAM_IDS.filter((t) => t !== team)
      expect(others.filter((o) => areNeighborTeams(team, o))).toHaveLength(2)
      expect(others.filter((o) => !areNeighborTeams(team, o))).toHaveLength(1)
    }
  })
})

describe('A의 기록이 여는 핵심', () => {
  it('DAY 1·2에 열리는 두 칸은 서로 마주 본다', () => {
    for (const [a, b] of [
      ['playground', 'broadcastRoom'],
      ['auditorium', 'studentCouncil'],
    ]) {
      // 중앙광장을 사이에 두고 반대편 — 거리 2이고 직접 붙어 있지 않다
      expect(stepsBetween(a, b)).toBe(2)
      expect(ADJACENCY[a]).not.toContain(b)
    }
  })

  it('어느 날이든 모든 팀이 열린 핵심 하나와 맞닿는다', () => {
    for (const opened of [
      ['playground', 'broadcastRoom'],
      ['auditorium', 'studentCouncil'],
    ]) {
      for (const team of TEAM_IDS) {
        // 우리 교차로가 열린 핵심에 붙어 있으면 닿는 것이다
        const cross = ADJACENCY[BASE_OF[team]]
          .flatMap((z) => ADJACENCY[z])
          .filter((id) => TILE_BY_ID[id].tier === 'cross')
        const touching = cross.some((c) => ADJACENCY[c].some((n) => opened.includes(n)))
        expect(touching).toBe(true)
      }
    }
  })
})

describe('시작 상태', () => {
  it('팀마다 기지와 1구역 두 칸을 쥔다', () => {
    const claimed = new Set<string>()
    for (const team of TEAM_IDS) {
      const tiles = startingTiles(team)
      expect(tiles).toHaveLength(3)
      for (const id of tiles) {
        expect(claimed.has(id)).toBe(false)
        claimed.add(id)
      }
    }
    expect(claimed.size).toBe(12)
  })
})

describe('연결 점수', () => {
  const owners = (map: Record<string, TeamId>) => (id: string) => map[id] ?? null

  it('시작 상태는 2다 — 기지는 세지 않는다', () => {
    const map: Record<string, TeamId> = {}
    for (const t of startingTiles('A')) map[t] = 'A'
    expect(connectedSize('A', owners(map))).toBe(2)
  })

  it('떨어진 땅은 한 점도 되지 않는다', () => {
    const map: Record<string, TeamId> = {}
    for (const t of startingTiles('A')) map[t] = 'A'
    map.centralPlaza = 'A' // 기지에서 이어지지 않는다
    expect(connectedSize('A', owners(map))).toBe(2)
  })

  it('이어 붙이면 늘어난다', () => {
    const map: Record<string, TeamId> = {}
    for (const t of startingTiles('A')) map[t] = 'A'
    map.oldBuilding = 'A' // 교실·복도에 붙는 교차로
    map.playground = 'A' // 구관에 붙는 핵심
    expect(connectedSize('A', owners(map))).toBe(4)
  })
})
