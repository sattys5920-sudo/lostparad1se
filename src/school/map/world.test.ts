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
  inDoorLane,
  isWalkable,
  propAt,
  roomAt,
  roomById,
  signAt,
  spawnFor,
} from './world'
import { FURNITURE } from './furniture'
import { propTiles, WALL_PROPS } from './props'
import { signTextPx, signTiles } from './signs'
import type { TeamId, TileId } from '../types'

const pair = (a: string, b: string) => [a, b].sort().join('|')

describe('걸어 다니는 학교는 규칙과 같은 판이다', () => {
  it('방이 규칙과 하나씩 맞는다', () => {
    expect(ROOMS.map((r) => r.id).sort()).toEqual(TILES.map((t) => t.id).sort())
  })

  it('방마다 문이 적어도 하나 있다 — 복도로 난다', () => {
    const rooms = TILES.filter((t) => t.floor !== 'roof')
    for (const t of rooms) {
      expect(DOORS.filter((d) => d.a === t.id).length, t.id).toBeGreaterThan(0)
    }
  })

  it('문 너머는 복도다 — 방과 방을 바로 잇지 않는다', () => {
    for (const d of DOORS) expect(d.b).toBeNull()
  })

  it('두 문이 같은 칸에 나지 않는다', () => {
    expect(new Set(DOORS.map((d) => `${d.x},${d.y}`)).size).toBe(DOORS.length)
  })

  it('규칙이 이웃이라고 한 방끼리는 걸어서 닿는다', () => {
    // 복도가 생긴 뒤로는 방과 방 사이에 문이 없다. 대신 **복도를
    // 지나 걸어서 닿아야** 한다. 이웃은 이제 언제나 같은 층이다
    const far: string[] = []
    for (const [a, ns] of Object.entries(ADJACENCY)) {
      for (const b of ns) {
        if (a >= b) continue
        expect(TILE_BY_ID[a].floor, `${a} ↔ ${b}`).toBe(TILE_BY_ID[b].floor)
        if (!walkable(centerOf(a as TileId), centerOf(b as TileId))) far.push(pair(a, b))
      }
    }
    expect(far).toEqual([])
  })

  it('계단은 방이 아닌 자리에 내려놓는다 — 옥상만 빼고', () => {
    // 계단은 문이다. 방 한복판에 내려놓으면 문을 안 지나고 들어선
    // 것이 되고, 서버는 그 방을 모르는데 화면만 안에 서 있게 된다
    for (const st of STAIRS) {
      const landed = roomAt(st.toX, st.toY)?.id ?? null
      expect(landed === null || landed === 'rooftop', `${st.from}→${st.to}`).toBe(true)
    }
  })

  it('계단 칸도 그 내려놓는 자리도 밟을 수 있다', () => {
    for (const st of STAIRS) {
      expect(isWalkable(st.x, st.y), `${st.from}→${st.to} 밟는 자리`).toBe(true)
      expect(isWalkable(st.toX, st.toY), `${st.from}→${st.to} 내려놓는 자리`).toBe(true)
    }
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
  it('어느 문으로 들어와도 방 한가운데까지 간다', () => {
    const stuck: string[] = []
    for (const d of DOORS) {
      const c = centerOf(d.a)
      // 문에서 시작해 **그 방 안에서만** 걸어 한가운데에 닿는지 본다.
      // 가구가 길을 막으면 여기서 걸린다 — 문은 열려 있는데 못 들어가는 방
      const seen = new Set([`${d.x},${d.y}`])
      const queue = [{ x: d.x, y: d.y }]
      let ok = false
      while (queue.length > 0 && !ok) {
        const cur = queue.pop() as { x: number; y: number }
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          const nx = cur.x + dx
          const ny = cur.y + dy
          const k = `${nx},${ny}`
          if (seen.has(k)) continue
          if (roomAt(nx, ny)?.id !== d.a) continue
          if (!isWalkable(nx, ny)) continue
          seen.add(k)
          if (nx === c.x && ny === c.y) ok = true
          queue.push({ x: nx, y: ny })
        }
      }
      if (!ok) stuck.push(`${d.a} @ ${d.x},${d.y}`)
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

describe('소품과 팻말이 길을 막지 않는다', () => {
  /**
   * **캐릭터를 방 안 모든 칸에 걸어가 보게 한다.**
   *
   * 소품을 놓기 시작하면서 생긴 위험이다 — 구석 한 칸이 책상과 벽에
   * 둘러싸여 영영 못 가는 자리가 된다. 문(옥상은 계단)에서 출발해
   * 그 방 안에서만 걸어, 밟을 수 있는 칸에 하나도 빠짐없이 닿는지 본다.
   */
  it('문에서 걸어 방 안 모든 칸에 닿는다', () => {
    const trapped: string[] = []
    for (const room of ROOMS) {
      const r = room.rects[0]
      const inside = (x: number, y: number) =>
        x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h
      const seen = new Set<string>()
      const queue: { x: number; y: number }[] = []
      const go = (x: number, y: number) => {
        if (!inside(x, y) || seen.has(`${x},${y}`) || !isWalkable(x, y)) return
        seen.add(`${x},${y}`)
        queue.push({ x, y })
      }
      // 문 자리는 벽 줄이라 방 밖이다. 문으로 들어선 첫 칸에서 출발한다
      for (const d of DOORS) {
        if (d.a !== room.id) continue
        go(Math.min(Math.max(d.x, r.x), r.x + r.w - 1), Math.min(Math.max(d.y, r.y), r.y + r.h - 1))
      }
      for (const st of STAIRS) if (roomAt(st.x, st.y)?.id === room.id) go(st.x, st.y)
      expect(queue.length, `${room.name} 에 들어갈 데가 없다`).toBeGreaterThan(0)
      while (queue.length > 0) {
        const c = queue.pop() as { x: number; y: number }
        go(c.x, c.y - 1)
        go(c.x, c.y + 1)
        go(c.x - 1, c.y)
        go(c.x + 1, c.y)
      }
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          if (isWalkable(x, y) && !seen.has(`${x},${y}`)) {
            trapped.push(`${room.name} ${x - r.x},${y - r.y}`)
          }
        }
      }
    }
    expect(trapped).toEqual([])
  })

  it('문 앞과 문에서 방 안으로 드는 길은 비어 있다', () => {
    const blocked: string[] = []
    for (const d of DOORS) {
      const r = roomById[d.a].rects[0]
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          if (!inDoorLane(x, y)) continue
          if (propAt(x, y) || signAt(x, y)) blocked.push(`${d.a} ${x - r.x},${y - r.y}`)
        }
      }
    }
    expect(blocked).toEqual([])
  })

  it('소품끼리 겹치지 않고, 팻말과도 겹치지 않는다', () => {
    // 겹치면 뒤에 놓인 것이 앞엣것을 지운다 — 반쪽짜리 책상이 남는다.
    // world.ts 가 켜질 때 터뜨리지만, 여기서도 센다
    let cells = 0
    let objects = 0
    for (const room of ROOMS) {
      for (const it of FURNITURE[room.id].props) {
        const size = propTiles(it.kind)
        objects += size.w * size.h
      }
      objects += signTiles(room.name)
      const r = room.rects[0]
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          if (propAt(x, y) || signAt(x, y)) cells++
          expect(propAt(x, y) && signAt(x, y), `${room.name} ${x},${y}`).toBeFalsy()
        }
      }
    }
    expect(cells).toBe(objects)
  })

  it('방마다 소품이 다섯이나 여섯이다 — 창고만 비운다', () => {
    for (const room of ROOMS) {
      const n = FURNITURE[room.id].props.length
      if (room.id === 'storage') expect(n, room.name).toBe(0)
      else expect(n, room.name).toBeGreaterThanOrEqual(5)
      expect(n, room.name).toBeLessThanOrEqual(6)
    }
  })

  it('벽에 거는 것은 벽 쪽 줄에만 놓는다', () => {
    // 액자·칠판·거울은 바로 위가 벽이라야 걸린 것으로 보인다.
    // 방 한가운데에 놓이면 허공에 뜬다
    for (const room of ROOMS) {
      for (const it of FURNITURE[room.id].props) {
        if (WALL_PROPS.has(it.kind)) expect(it.y, `${room.name} ${it.kind}`).toBe(0)
      }
    }
  })

  it('팻말은 제 방의 주 출입문이 난 벽에 선다', () => {
    for (const room of ROOMS) {
      const mine = DOORS.filter((d) => d.a === room.id)
      if (mine.length === 0) continue // 옥상은 문이 없다
      const main = mine.find((d) => d.horizontal) ?? mine[0]
      const r = room.rects[0]
      const want = !main.horizontal ? 0 : main.y < r.y ? 0 : r.h - 1
      expect(FURNITURE[room.id].sign.y, room.name).toBe(want)
    }
  })

  it('방 이름이 팻말 판 안에 들어간다', () => {
    for (const room of ROOMS) {
      const tiles = signTiles(room.name)
      expect(signTextPx(room.name), room.name).toBeLessThanOrEqual(tiles * 16 - 4)
      expect(tiles, room.name).toBeGreaterThanOrEqual(2)
    }
  })
})
