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
  STAIRWELLS,
  TILE_IDS,
  stairwellOf,
  tilesOn,
  startingTiles,
  stepsBetween,
} from './board'
import { TEAM_IDS, type TeamId } from './v2'

const byTier = (tier: string) => TILES.filter((t) => t.tier === tier)

describe('판', () => {
  it('방 스물다섯이다. **계단은 칸이 아니다**', () => {
    expect(TILES).toHaveLength(25)
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

  it('이웃이 없는 방은 연구실과 옥상뿐이다', () => {
    // 둘 다 계단으로만 드나든다. 계단이 칸이 아니게 되면서 「가까운
    // 방」이 하나도 없어졌다 — 전에도 이웃이 계단뿐이었으니 달라진
    // 것은 없다. 걸어서는 여전히 어디서든 닿는다(canRoamTo)
    const alone = TILES.filter((t) => ADJACENCY[t.id].length === 0).map((t) => t.id)
    expect(alone.sort()).toEqual(['labRoom', 'rooftop'])
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

  it('층마다 그 층 안에서 이웃으로 다 이어진다 — 연구실만 빼고', () => {
    // 연구실은 복도 끝 막다른 방이라 가까운 방이 없다. 걸어서는
    // 닿지만(canRoamTo) 「이웃」은 아니다
    for (const floor of FLOORS) {
      const here = tilesOn(floor).map((t) => t.id).filter((id) => id !== 'labRoom')
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

  it('이웃은 언제나 같은 층이다', () => {
    // 이웃은 「가까운 방」이다. 층이 다르면 아무리 좌표가 겹쳐도
    // 가깝지 않다 — 사이에 바닥이 있다
    for (const t of TILES) {
      for (const n of ADJACENCY[t.id]) {
        expect(TILE_BY_ID[n].floor, `${t.id} ↔ ${n}`).toBe(t.floor)
      }
    }
  })
})

describe('계단', () => {
  it('칸이 아니다. 층마다 서·동 하나씩인 복도다', () => {
    expect(STAIRWELLS).toHaveLength(6)
    for (const floor of ['b1', 'f1', 'f2'] as const) {
      for (const end of ['w', 'e'] as const) expect(stairwellOf(floor, end)).not.toBeNull()
    }
    // 옥상에는 계단통이 없다. 2층 계단이 곧장 올라온다
    expect(stairwellOf('roof', 'w')).toBeNull()
  })

  it('칸 목록에 없다 — 이름도 정원도 주인도 없다', () => {
    expect(TILES.some((t) => t.name.includes('계단'))).toBe(false)
    expect(TILE_IDS.some((id: string) => id.startsWith('stair'))).toBe(false)
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

  it('지하에서 옥상까지도 한 걸음이다 — 계단은 세지 않는다', () => {
    expect(pathBetween('storage', 'rooftop')).toEqual(['rooftop'])
  })

  // **걸음과 다리는 다른 것이다.** 걸음은 문을 세고(어디든 하나),
  // 다리는 「가까운 방」을 센다 — 안개가 이쪽을 본다
  it('이웃으로 세는 다리는 층을 안 넘는다', () => {
    // 2-3 교실(2층 북서) → 과학실 → 도서관
    expect(stepsBetween('centralPlaza', 'library')).toBe(2)
    // 2-3 교실 → 미술실 → 무용실 → 방송실 → 학생회실
    expect(stepsBetween('centralPlaza', 'studentCouncil')).toBe(4)
    // 층이 다르면 아무리 걸어서 가까워도 다리가 없다
    expect(stepsBetween('centralPlaza', 'baseA')).toBe(Number.POSITIVE_INFINITY)
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

  it('계단으로만 드나든다 — 제 땅으로 감쌀 수 없는 막다른 방이다', () => {
    expect(ADJACENCY[lab.id]).toHaveLength(0)
    // 그래도 걸어서는 닿는다. 값이 붙는 것은 문 하나뿐이다
    expect(canRoamTo('centralPlaza', lab.id)).toBe(true)
  })

  it('네 팀 다 한 걸음에 닿는다', () => {
    for (const team of TEAM_IDS as TeamId[]) {
      expect(pathBetween(BASE_OF[team], lab.id), team).toEqual([lab.id])
    }
  })
})

describe('복도로 닿는 곳', () => {
  it('같은 층 복도에 붙은 방끼리는 오갈 수 있다 — 이웃이 아니어도', () => {
    // 2-3 교실과 음악실은 2층 복도 양끝이다. 이웃은 아니지만 걸어서 간다
    expect(isAdjacent('centralPlaza', 'musicRoom')).toBe(false)
    expect(canRoamTo('centralPlaza', 'musicRoom')).toBe(true)
  })

  it('계단이 복도라 층도 이어진다 — 학교가 통째로 한 덩어리다', () => {
    expect(canRoamTo('centralPlaza', 'baseA')).toBe(true)
    expect(canRoamTo('storage', 'rooftop')).toBe(true)
    for (const a of TILES) {
      for (const b of TILES) {
        if (a.id === b.id) continue
        expect(canRoamTo(a.id, b.id), `${a.id}→${b.id}`).toBe(true)
      }
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

})

describe('시작 상태', () => {
  it('기지는 넷이고 팀마다 하나다', () => {
    expect(Object.keys(BASE_OF).sort()).toEqual([...TEAM_IDS].sort())
  })

  it('네 팀이 비슷하게 쥐고 시작한다', () => {
    // 계단을 칸으로 두거나 계단 양쪽 방을 이웃으로 묶으면 여기가
    // 무너진다 — 계단 옆에 기지를 둔 팀만 위층 방까지 들고 시작한다
    const sizes = (TEAM_IDS as TeamId[]).map((t) => startingTiles(t).length)
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1)
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
    const next = ADJACENCY[BASE_OF.A]
    expect(connectedSize('A', owners([BASE_OF.A, ...next]))).toBe(next.length)
  })
})
