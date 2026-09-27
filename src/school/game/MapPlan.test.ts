// 지도가 무엇을 가리는가.
//
// **이름과 자리는 처음부터 보인다. 가리는 것은 머릿수뿐이다.**
// 한때 안 가 본 방을 통째로 검게 칠하고 「?」만 찍었는데, 그러면
// 배치도의 절반이 검은 네모라 어디가 어딘지 못 읽는다. 학교 도면은
// 누구나 볼 수 있는 것이고, 숨길 것은 그 안에 지금 누가 있는가다.
import { describe, expect, it } from 'vitest'

import { TILES } from '../../../shared/rules/board'
import { MINI_FONT_PX, miniLabels, nearbyOf, planFrame, readMap, type MapFacts } from './MapPlan'

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

  /*
   * **머릿수는 들어가 있는 방에만.** 가 본 방이라도 지금 밖이면 null 이다.
   *
   * 전에는 가 본 방이면 숫자를 적었다. 서버가 그 방 숫자를 안 보내면
   * `?? 0` 으로 「0명」이 돼서, 가 본 방이 전부 빈방으로 거짓말했다.
   * 가 본 방(artRoom)에 숫자가 딸려 와도 — 서버가 그러지는 않지만 —
   * 화면은 들어가 있는 방(library)의 숫자만 믿는다.
   */
  it('가리는 것은 머릿수뿐이다 — 들어가 있는 방은 숫자, 나머지는 null', () => {
    const before = readMap(blank)
    expect(before.every((r) => r.count === null && r.dots.length === 0)).toBe(true)

    const seen = readMap({
      ...blank,
      view: {
        visitedTiles: ['artRoom', 'library'],
        visibleTiles: ['library'],
        roomCounts: { artRoom: 3, library: 2 },
        visiblePawns: [],
        visibleRobots: [],
      } as unknown as MapFacts['view'],
    })
    const art = seen.find((r) => r.id === 'artRoom')
    const lib = seen.find((r) => r.id === 'library')
    const never = seen.find((r) => r.id === 'musicRoom')
    expect(lib?.count).toBe(2)
    // 가 봤지만 지금 밖 — 「0명」이 아니라 모른다
    expect(art?.known).toBe(true)
    expect(art?.count).toBeNull()
    expect(never?.count).toBeNull()
    // 안 가 본 방도 이름은 그대로다
    expect(never?.name).toBe('음악실')
  })
})

/*
 * **미니맵 이름끼리 안 겹친다 — 스물다섯 방 어디에 서 있어도.**
 *
 * 88px 미니맵이 가장 좁다. 테두리 2px·안쪽 4px 를 양쪽에서 빼면 그림은
 * 76px 이다(box-sizing 이 무엇이든 이보다 작아지지는 않는다 — 작을수록
 * 글자가 방에 비해 커지므로 여기서 안 겹치면 더 큰 데서도 안 겹친다).
 * 그리는 쪽과 같은 함수(planFrame·miniLabels)로 잰다.
 */
describe('미니맵 이름', () => {
  const INNER_PX = 88 - 2 * 2 - 2 * 4
  const overlap = (a: { l: number; r: number; t: number; b: number }, b: typeof a) =>
    a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b

  /** 그 방에 서서 본 미니맵 한 장 — 그리는 쪽과 같은 함수로 짠다. */
  const viewFrom = (here: (typeof TILES)[number]) => {
    const near = nearbyOf(here.id)
    const shown = readMap({ ...blank, here: here.id }).filter((r) => near.has(r.id))
    const f = planFrame(shown)
    const font = MINI_FONT_PX / Math.min(INNER_PX / f.w, INNER_PX / f.h)
    return { shown, labels: miniLabels(shown, font, here.id) }
  }

  it('어느 방에 서 있어도 이름끼리 겹치지 않는다', () => {
    const clashes: string[] = []
    for (const here of TILES) {
      const ls = viewFrom(here).labels
      for (let i = 0; i < ls.length; i++)
        for (let j = i + 1; j < ls.length; j++)
          if (overlap(ls[i].box, ls[j].box)) clashes.push(`${here.shortName}: ${ls[i].text}×${ls[j].text}`)
    }
    expect(clashes).toEqual([])
  })

  it('내 방 이름은 늘 있고, 늘 위에 앉는다', () => {
    for (const here of TILES) {
      const mine = viewFrom(here).labels.find((l) => l.id === here.id)
      expect(mine?.top, here.shortName).toBe(true)
    }
  })

  /*
   * **빠지는 이름은 딱 하나다** — 강당에 서서 볼 때의 운동장. 방을
   * 옮기거나 이름을 바꿔서 이 수가 늘면 여기서 멈춘다. 빼는 규칙이
   * 조용히 이름을 여럿 삼키는 것을 막는다.
   */
  it('자리가 없어 빠지는 이웃 이름은 한 판 전체에서 하나뿐이다', () => {
    const dropped: string[] = []
    for (const here of TILES) {
      const { shown, labels } = viewFrom(here)
      const has = new Set(labels.map((l) => l.id))
      for (const r of shown) if (!has.has(r.id)) dropped.push(`${here.shortName}에서 ${r.mini}`)
    }
    expect(dropped).toEqual(['강당에서 운동장'])
  })

  /*
   * **이 시험이 무는지.** 비키는 일을 안 하면(늘 위에만 앉히면) 강당에
   * 서서 볼 때 「강당」과 「운동장」이 겹친다 — 재 본 경우다. 그 경우를
   * 직접 만들어서, 겹침을 잡는 자가 실제로 잡는지 본다.
   */
  it('겹침 자는 겹친 것을 잡는다', () => {
    const a = { id: 'x' as never, mini: '강당', box: { x: 0, y: 0, w: 10, h: 40 } }
    const b = { id: 'y' as never, mini: '운동장', box: { x: 6, y: 0, w: 10, h: 40 } }
    const [la, lb] = miniLabels([a, b], 8)
    expect(la.top).toBe(true)
    expect(lb.top).toBe(false) // 위가 막혀서 아래로 비켰다
    expect(overlap(la.box, lb.box)).toBe(false)
  })
})
