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

import { ADJACENCY, START_TILE, TILES } from '../../../shared/rules/board'
import { CANVAS_SCALE, NARROW_PX } from '../game/timing'
import {
  DOORS,
  DOOR_WIDE,
  MAP_W,
  ROOMS,
  ROOM_TILES,
  TILE,
  SPAWNABLE_TILES,
  centerOf,
  doorHere,
  isWalkable,
  roomAt,
  spawnFor,
  tileAt,
} from './world'
import type { TeamId, TileId } from '../types'

const pair = (a: string, b: string) => [a, b].sort().join('|')

const rulePairs = (() => {
  const out = new Set<string>()
  for (const [a, ns] of Object.entries(ADJACENCY)) for (const n of ns) out.add(pair(a, n))
  return out
})()

describe('걸어 다니는 학교는 규칙과 같은 판이다', () => {
  it('방이 규칙과 하나씩 맞는다', () => {
    expect(ROOMS.map((r) => r.id).sort()).toEqual(TILES.map((t) => t.id).sort())
  })

  it('문이 있는 곳은 규칙도 이웃이라고 한다', () => {
    const wrong = DOORS.filter((d) => !ADJACENCY[d.a]?.includes(d.b)).map((d) => `${d.a}↔${d.b}`)
    expect(wrong).toEqual([])
  })

  it('규칙이 이웃이라고 한 곳에는 문이 있다', () => {
    const doors = new Set(DOORS.map((d) => pair(d.a, d.b)))
    expect([...rulePairs].filter((p) => !doors.has(p))).toEqual([])
  })

  it('문 하나에 이웃 한 쌍 — 두 번 뚫지 않는다', () => {
    expect(DOORS.length).toBe(rulePairs.size)
    expect(new Set(DOORS.map((d) => `${d.x},${d.y}`)).size).toBe(DOORS.length)
  })

  it('문은 세 칸이다 — 한 칸이면 한 칸 옆에 선 사람이 못 지나간다', () => {
    for (const d of DOORS) {
      expect(d.tiles.length).toBe(DOOR_WIDE)
      for (const t of d.tiles) {
        expect(tileAt(t.x, t.y)).toBe('door')
        expect(doorHere(t.x, t.y)).toBe(d)
      }
    }
  })

  it('문 세 칸이 전부 같은 벽 줄에 있다', () => {
    for (const d of DOORS) {
      const sameCol = d.tiles.every((t) => t.x === d.x)
      const sameRow = d.tiles.every((t) => t.y === d.y)
      expect(sameCol || sameRow).toBe(true)
    }
  })
})

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
  it('문에서 문까지 한가운데를 지나 직선으로 간다', () => {
    // 문은 벽 한가운데에 뚫린다. 방 한가운데를 지나는 십자가 뚫려 있으면
    // 어느 문에서 들어와도 곧장 반대쪽 문으로 나갈 수 있다. 막혀 있으면
    // 사람은 벽을 따라 방을 한 바퀴 돌게 된다 — 실제로 관문 넷이 그랬다
    const blocked: string[] = []
    for (const d of DOORS) {
      for (const id of [d.a, d.b]) {
        const c = centerOf(id)
        // 문 세 칸 어디로 들어와도 한가운데까지 막히지 않아야 한다
        for (const t of d.tiles) {
          let x = t.x
          let y = t.y
          // 벽 줄을 먼저 벗어난 다음 한가운데로 꺾는다
          while (x !== c.x || y !== c.y) {
            if (x !== c.x && Math.sign(c.x - t.x) !== 0) x += Math.sign(c.x - x)
            else if (y !== c.y) y += Math.sign(c.y - y)
            else x += Math.sign(c.x - x)
            if (!isWalkable(x, y)) {
              blocked.push(`${id} 문(${t.x},${t.y})→가운데 @${x},${y}`)
              break
            }
          }
        }
      }
    }
    expect(blocked).toEqual([])
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

describe('네 팀이 똑같은 학교를 걷는다', () => {
  it('걸을 수 있는 칸이 90도 회전에 대해 대칭이다', () => {
    // 자리가 유불리가 되면 안 된다. 한 팀만 가구가 덜 놓인 방을 쓰면
    // 그 팀만 잘 지나다닌다
    // 판 크기는 world 가 정한다. 여기서 다시 적으면 어긋난다
    const N = MAP_W
    const rot = (x: number, y: number) => [N - 1 - y, x]
    const off: string[] = []
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const [rx, ry] = rot(x, y)
        if (isWalkable(x, y) !== isWalkable(rx, ry)) off.push(`${x},${y}`)
      }
    }
    expect(off).toEqual([])
  })
})
