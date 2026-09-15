// 학교가 층·복도 구조로 제대로 섰는지 본다.
//
// 이웃을 방 네모에서 계산하므로 배치를 잘못 적으면 여기서 걸린다.
// 전에는 5×5 격자의 90도 회전 대칭을 확인했다 — 층이 생기면서 그
// 대칭은 없어졌다. 대신 **학교로서 말이 되는지**를 본다.
import { describe, expect, it } from 'vitest'
import {
  ADJACENCY,
  ROAM_TO,
  BASE_OF,
  FLOORS,
  TILES,
  TILE_BY_ID,
  connectedSize,
  canRoamTo,
  isAdjacent,
  pathBetween,
  rectsNear,
  stairIdOf,
  tilesOn,
  startingTiles,
  stepsBetween,
} from './board'
import { TEAM_IDS, type TeamId } from './v2'

const byTier = (tier: string) => TILES.filter((t) => t.tier === tier)

describe('판', () => {
  it('방 스물다섯과 계단 여섯이다', () => {
    expect(TILES.filter((t) => t.tier !== 'stair')).toHaveLength(25)
    expect(byTier('stair')).toHaveLength(6)
  })

  it('층위별 칸 수가 맞다', () => {
    expect(byTier('base')).toHaveLength(4)
    expect(byTier('core')).toHaveLength(4)
    expect(byTier('gate')).toHaveLength(4)
    expect(byTier('cross')).toHaveLength(3)
    expect(byTier('plaza')).toHaveLength(1)
    // 연구실은 학교에 하나뿐이다. 연구가 여기서만 되므로 둘이면 판이 갈린다
    expect(byTier('lab')).toHaveLength(1)
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

  it('방끼리 겹치지 않는다', () => {
    for (const floor of FLOORS) {
      const here = tilesOn(floor)
      for (let i = 0; i < here.length; i++) {
        for (let j = i + 1; j < here.length; j++) {
          const a = here[i].rect
          const b = here[j].rect
          const over =
            a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
          expect(over, `${here[i].id} ↔ ${here[j].id}`).toBe(false)
        }
      }
    }
  })

  it('같은 층 이웃은 벽 하나나 복도 하나 사이다', () => {
    for (const t of TILES) {
      for (const n of ADJACENCY[t.id]) {
        const o = TILE_BY_ID[n]
        if (o.floor !== t.floor) continue
        expect(rectsNear(t.rect, o.rect), `${t.id} ↔ ${n}`).toBe(true)
      }
    }
  })

  it('층마다 그 층 안에서 서로 다 닿는다 — 계단 없이도', () => {
    for (const floor of FLOORS) {
      const here = tilesOn(floor).map((t) => t.id)
      const mine = new Set(here)
      const seen = new Set([here[0]])
      const queue = [here[0]]
      while (queue.length > 0) {
        const cur = queue.shift() as string
        for (const n of ADJACENCY[cur]) {
          if (!mine.has(n) || seen.has(n)) continue
          seen.add(n)
          queue.push(n)
        }
      }
      expect(seen.size, floor).toBe(here.length)
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

  it('한 층을 가로지르는 데도 걸음이 든다', () => {
    // 2-3 교실(2층 북서) → 과학실 → 도서관
    expect(stepsBetween('centralPlaza', 'library')).toBe(2)
    // 2-3 교실 → 미술실 → 무용실 → 방송실 → 학생회실
    expect(stepsBetween('centralPlaza', 'studentCouncil')).toBe(4)
  })
})

describe('연구실', () => {
  const lab = TILES.find((t) => t.tier === 'lab') as (typeof TILES)[number]

  it('학교에 하나뿐이다', () => {
    expect(TILES.filter((t) => t.tier === 'lab')).toHaveLength(1)
    expect(lab.name).toBe('연구실')
  })

  it('어느 팀도 시작부터 쥐고 있지 않다', () => {
    for (const team of TEAM_IDS as TeamId[]) {
      expect(startingTiles(team), team).not.toContain(lab.id)
    }
  })

  it('계단 하나로만 드나든다 — 제 땅으로 감쌀 수 없는 막다른 방이다', () => {
    expect(ADJACENCY[lab.id]).toHaveLength(1)
    expect(TILE_BY_ID[ADJACENCY[lab.id][0]].tier).toBe('stair')
  })

  it('네 팀 다 걸어서 닿는다', () => {
    for (const team of TEAM_IDS as TeamId[]) {
      expect(stepsBetween(BASE_OF[team], lab.id), team).toBeLessThan(Number.POSITIVE_INFINITY)
    }
  })
})

describe('복도로 닿는 곳', () => {
  it('같은 층 복도에 붙은 방끼리는 오갈 수 있다 — 이웃이 아니어도', () => {
    // 2-3 교실과 음악실은 2층 복도 양끝이다. 이웃은 아니지만 걸어서 간다
    expect(isAdjacent('centralPlaza', 'musicRoom')).toBe(false)
    expect(canRoamTo('centralPlaza', 'musicRoom')).toBe(true)
  })

  it('층이 다르면 복도로는 안 이어진다', () => {
    expect(canRoamTo('centralPlaza', 'baseA')).toBe(false)
  })

  it('계단으로 층을 넘는 것은 이웃이 맡는다', () => {
    expect(canRoamTo(stairIdOf('f2', 'w'), stairIdOf('f1', 'w'))).toBe(true)
    expect(canRoamTo(stairIdOf('f2', 'w'), 'rooftop')).toBe(true)
  })

  it('계단참은 제 층 방들과 이어진다', () => {
    for (const t of tilesOn('f2')) {
      if (t.tier === 'stair') continue
      expect(canRoamTo(stairIdOf('f2', 'w'), t.id), t.id).toBe(true)
    }
  })

  it('이웃이면 언제나 갈 수 있다', () => {
    for (const t of TILES) {
      for (const n of ADJACENCY[t.id]) expect(canRoamTo(t.id, n), `${t.id}→${n}`).toBe(true)
    }
  })

  it('오갈 수 있는 곳 표는 canRoamTo 와 한 글자도 안 다르다', () => {
    for (const a of TILES) {
      for (const b of TILES) {
        expect(ROAM_TO[a.id].includes(b.id), `${a.id}→${b.id}`).toBe(canRoamTo(a.id, b.id))
      }
    }
  })

  it('오가는 길은 양쪽으로 열린다', () => {
    for (const a of TILES) {
      for (const b of ROAM_TO[a.id]) expect(ROAM_TO[b], `${b}→${a.id}`).toContain(a.id)
    }
  })

  it('층이 다르면 계단을 거쳐야 한다 — 방에서 방으로 곧장은 없다', () => {
    for (const a of TILES) {
      for (const b of ROAM_TO[a.id]) {
        if (a.floor === TILE_BY_ID[b].floor) continue
        // 층을 넘는 걸음은 계단이 한쪽 끝에 있다
        expect(a.tier === 'stair' || TILE_BY_ID[b].tier === 'stair', `${a.id}→${b}`).toBe(true)
      }
    }
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
