// 지도가 무엇을 가리는가.
//
// **이름과 자리는 처음부터 보인다. 가리는 것은 머릿수뿐이다.**
// 한때 안 가 본 방을 통째로 검게 칠하고 「?」만 찍었는데, 그러면
// 배치도의 절반이 검은 네모라 어디가 어딘지 못 읽는다. 학교 도면은
// 누구나 볼 수 있는 것이고, 숨길 것은 그 안에 지금 누가 있는가다.
import { describe, expect, it } from 'vitest'

import { TILES } from '../../../shared/rules/board'
import { readMap, type MapFacts } from './MapPlan'

const blank: MapFacts = { here: null, meId: 'me', myTeam: 'A', view: null, tiles: {} }

describe('안 가 본 방도 이름과 자리는 남는다', () => {
  it('한 방도 안 가 봤어도 스물다섯 방 이름이 다 나온다', () => {
    const rooms = readMap(blank)
    expect(rooms.length).toBe(TILES.length)
    expect(rooms.filter((r) => r.name.length > 0).length).toBe(TILES.length)
    expect(rooms.every((r) => !r.known)).toBe(true)
  })

  it('이름은 판이 정한 그대로다', () => {
    const byId = new Map(readMap(blank).map((r) => [r.id, r.name]))
    for (const t of TILES) expect(byId.get(t.id as never), t.id).toBe(t.shortName)
  })

  it('자리와 크기도 안 가린다 — 판에 그려진 그대로다', () => {
    for (const r of readMap(blank)) {
      expect(r.box.w, r.id).toBeGreaterThan(0)
      expect(r.box.h, r.id).toBeGreaterThan(0)
    }
  })

  it('정원도 안 가린다', () => {
    for (const r of readMap(blank)) expect(r.capacity, r.id).toBeGreaterThan(0)
  })

  it('가리는 것은 머릿수뿐이다 — 모르는 방은 null, 아는 방은 숫자', () => {
    const before = readMap(blank)
    expect(before.every((r) => r.count === null && r.dots.length === 0)).toBe(true)

    const seen = readMap({
      ...blank,
      view: {
        visitedTiles: ['artRoom'],
        visibleTiles: [],
        roomCounts: { artRoom: 3 },
        visiblePawns: [],
        visibleRobots: [],
      } as unknown as MapFacts['view'],
    })
    const art = seen.find((r) => r.id === 'artRoom')
    const other = seen.find((r) => r.id === 'library')
    expect(art?.count).toBe(3)
    expect(other?.count).toBeNull()
    // 안 가 본 방도 이름은 그대로다
    expect(other?.name).toBe('도서관')
  })
})
