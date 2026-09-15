// 걸어 다니는 학교와 규칙이 **같은 학교**인가.
//
// 한때 아니었다. 화면 쪽 판과 규칙 쪽 판이 따로 자라서, 마흔 쌍 중
// 열여덟 쌍이 어긋난 채로 굴렀다. 미술실에서 음악실로 가는 문이 있는데
// 서버는 그 둘을 이웃으로 안 쳐서, 그 문을 지나면 「옆방이 아니다」가
// 떴다. 걸어서 갈 수 있는데 갈 수 없는 방이 있었던 것이다.
//
// world.ts 안에도 같은 확인이 있지만(켤 때 터진다) 여기서 한 번 더 본다.
// 화면을 켜 봐야 아는 것과 시험이 잡아 주는 것은 다르다.
import { describe, expect, it } from 'vitest'

import { ADJACENCY, START_TILE, TILES, TILE_BY_ID } from '../../../shared/rules/board'
import { CANVAS_SCALE, NARROW_PX } from '../game/timing'
import {
  DOORS,
  STAIRS,
  ROOMS,
  ROOM_TILES,
  TILE,
  SPAWNABLE_TILES,
  centerOf,
  isWalkable,
  roomAt,
  spawnFor,
} from './world'
import type { TeamId, TileId } from '../types'

const pair = (a: string, b: string) => [a, b].sort().join('|')

describe('걸어 다니는 학교는 규칙과 같은 판이다', () => {
  it('방이 규칙과 하나씩 맞는다', () => {
    expect(ROOMS.map((r) => r.id).sort()).toEqual(TILES.map((t) => t.id).sort())
  })

  it('방마다 문이 하나다 — 복도로 난다', () => {
    const rooms = TILES.filter((t) => t.tier !== 'stair' && t.floor !== 'roof')
    for (const t of rooms) {
      expect(DOORS.filter((d) => d.a === t.id)).toHaveLength(1)
    }
    expect(DOORS).toHaveLength(rooms.length)
  })

  it('문 너머는 복도다 — 방과 방을 바로 잇지 않는다', () => {
    for (const d of DOORS) expect(d.b).toBeNull()
  })

  it('두 문이 같은 칸에 나지 않는다', () => {
    expect(new Set(DOORS.map((d) => `${d.x},${d.y}`)).size).toBe(DOORS.length)
  })

  it('규칙이 이웃이라고 한 방끼리는 걸어서 닿는다', () => {
    // 복도가 생긴 뒤로는 방과 방 사이에 문이 없다. 대신 **같은 층이면
    // 복도를 지나 걸어서 닿아야** 한다. 층이 다른 쌍(계단)은 건너뛴다
    const far: string[] = []
    for (const [a, ns] of Object.entries(ADJACENCY)) {
      for (const b of ns) {
        if (a >= b) continue
        if (TILE_BY_ID[a].floor !== TILE_BY_ID[b].floor) continue
        if (!walkable(centerOf(a as TileId), centerOf(b as TileId))) far.push(pair(a, b))
      }
    }
    expect(far).toEqual([])
  })

  it('계단은 규칙의 이웃으로 이어진다', () => {
    for (const s of STAIRS) expect(ADJACENCY[s.from]).toContain(s.to)
  })
})

/** 두 자리가 벽을 넘지 않고 이어지는가. 계단은 안 쓴다. */
function walkable(from: { x: number; y: number }, to: { x: number; y: number }): boolean {
  const seen = new Set<string>([`${from.x},${from.y}`])
  const queue = [from]
  while (queue.length > 0) {
    const cur = queue.shift() as { x: number; y: number }
    if (cur.x === to.x && cur.y === to.y) return true
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const n = { x: cur.x + dx, y: cur.y + dy }
      const k = `${n.x},${n.y}`
      if (seen.has(k) || !isWalkable(n.x, n.y)) continue
      seen.add(k)
      queue.push(n)
    }
  }
  return false
}

describe('걸어서 갈 수 있다', () => {
  it('방 한가운데에는 언제나 설 수 있다', () => {
    // 방에 놓일 때 여기로 온다. 가구가 서 있으면 갇힌다
    const stuck = ROOMS.filter((r) => {
      const c = centerOf(r.id)
      return !isWalkable(c.x, c.y)
    })
    expect(stuck.map((r) => r.id)).toEqual([])
  })

  // 화면과 서버가 같은 자리에서 열어야 한다. 어긋나면 첫 화면부터
  // 「이미 그 방이다」가 뜬다 — 서버는 교실에, 아바타는 기지에 선 채로
  it('네 팀 모두 2-3 교실에서 시작한다', () => {
    for (const team of ['A', 'B', 'C', 'D'] as TeamId[]) {
      const s = spawnFor(team)
      expect(roomAt(s.x, s.y)?.id).toBe(START_TILE)
    }
  })

  it('문턱은 어느 방도 아니다', () => {
    // 방 사이 벽 줄에 있으니 어느 쪽 방도 아니다. 이래야 「지금 어느 방인가」가
    // 문 위에서 깜빡이지 않는다
    for (const d of DOORS) for (const t of d.tiles) expect(roomAt(t.x, t.y)).toBeNull()
  })

  it('조각은 기지와 핵심 지역에 떨어지지 않는다', () => {
    const bad = SPAWNABLE_TILES.filter((id: TileId) => {
      const t = TILES.find((x) => x.id === id)
      return !t || t.homeOf !== null || t.tier === 'core' || t.tier === 'plaza'
    })
    expect(bad).toEqual([])
  })
})

describe('방을 곧장 지나갈 수 있다', () => {
  it('문에서 방 한가운데까지 막히지 않는다', () => {
    const stuck: string[] = []
    for (const d of DOORS) {
      const c = centerOf(d.a)
      // 문은 방 한가운데 세로줄에 뚫린다. 그 줄을 따라가면 곧장 닿아야 한다
      const step = c.y > d.y ? 1 : -1
      for (let y = d.y + step; y !== c.y + step; y += step) {
        if (!isWalkable(d.x, y)) stuck.push(`${d.a} @ ${d.x},${y}`)
      }
    }
    expect(stuck).toEqual([])
  })
})

describe('제 방이 한 화면에 들어온다', () => {
  it('방과 양옆 벽이 좁은 화면에 다 들어온다', () => {
    // 캔버스는 화면 폭만큼이고 CANVAS_SCALE 배로 그린다. 방이 화면보다
    // 크면 제 방의 문이 화면 밖에 있고, 그러면 어디로 나가야 하는지
    // 보이지도 누를 수도 없다 — 실제로 그랬다. 「방끼리 이동이 안 된다」
    const seen = Math.floor(NARROW_PX / CANVAS_SCALE / TILE)
    expect(ROOM_TILES + 2).toBeLessThanOrEqual(seen)
  })
})
