// A의 기록 — 무엇이 언제 열리는가.
import { describe, expect, it } from 'vitest'
import {
  coreOpen,
  eventsOn,
  inLastHours,
  isOver,
  lastHoursStartMs,
  openTilesBy,
  openedOn,
  tileValue,
} from './fragments'
import { TILE_BY_ID } from './board'
import { FRAGMENT_TILE_BONUS } from './v2'

const seoul = (iso: string) => new Date(`${iso}+09:00`).getTime()
const START = seoul('2026-03-02T08:00:00')
const dayN = (n: number, hhmm = '10:00') =>
  seoul(`2026-03-0${1 + n}T${hhmm}:00`)

describe('열리는 칸', () => {
  it('DAY 1은 운동장·방송실, DAY 2는 강당·학생회실, DAY 5는 중앙광장', () => {
    expect([...openedOn(1)].sort()).toEqual(['broadcastRoom', 'playground'])
    expect([...openedOn(2)].sort()).toEqual(['auditorium', 'studentCouncil'])
    expect([...openedOn(5)]).toEqual(['centralPlaza'])
  })

  it('DAY 3·4에는 아무것도 열리지 않는다', () => {
    expect(openedOn(3)).toHaveLength(0)
    expect(openedOn(4)).toHaveLength(0)
  })

  it('쌓인다', () => {
    expect(openTilesBy(1).size).toBe(2)
    expect(openTilesBy(2).size).toBe(4)
    expect(openTilesBy(4).size).toBe(4)
    expect(openTilesBy(5).size).toBe(5)
  })

  // 전에는 5×5 격자라 「마주 보는 두 칸」이라는 말이 되었다. 층이
  // 생기면서 그 대칭은 없어졌다 — 대신 날마다 서로 다른 층에서
  // 하나씩 열리는지를 본다. 한 층에 둘이 열리면 그 층 사람만 이득이다
  it('DAY 1·2에 열리는 두 칸은 서로 다른 층이다', () => {
    for (const day of [1, 2]) {
      const [a, b] = openedOn(day).map((id) => TILE_BY_ID[id])
      expect(a.floor, `DAY ${day}`).not.toBe(b.floor)
    }
  })

  it('닷새가 지나면 핵심이 다 열린다', () => {
    expect(openTilesBy(5).size).toBe(5)
  })
})

describe('깃발을 꽂을 수 있는 날', () => {
  it('핵심은 열린 뒤에만', () => {
    expect(coreOpen('playground', 1)).toBe(true)
    expect(coreOpen('auditorium', 1)).toBe(false)
    expect(coreOpen('auditorium', 2)).toBe(true)
  })

  it('중앙광장은 DAY 5부터다', () => {
    expect(coreOpen('centralPlaza', 4)).toBe(false)
    expect(coreOpen('centralPlaza', 5)).toBe(true)
  })

  it('나머지 칸은 처음부터 열려 있다', () => {
    expect(coreOpen('classroom', 1)).toBe(true)
    expect(coreOpen('library', 1)).toBe(true)
  })
})

describe('칸 가치', () => {
  it('기록이 지목하면 +2', () => {
    const base = TILE_BY_ID.library.value
    expect(tileValue('library', [])).toBe(base)
    expect(tileValue('library', [{ day: 1, spotTile: 'library' }])).toBe(base + FRAGMENT_TILE_BONUS)
  })

  it('두 번 지목되면 두 번 오른다', () => {
    const base = TILE_BY_ID.library.value
    const twice = [
      { day: 1, spotTile: 'library' },
      { day: 3, spotTile: 'library' },
    ]
    expect(tileValue('library', twice)).toBe(base + FRAGMENT_TILE_BONUS * 2)
  })
})

describe('날마다 일어나는 일', () => {
  it('DAY 3에 비밀 목표 한 장을 공개한다', () => {
    expect(eventsOn(3).goalReveal).toBe(true)
  })

  it('DAY 4에 모든 동맹이 풀린다', () => {
    expect(eventsOn(4).allianceCleared).toBe(true)
  })

  it('DAY 5에 마지막 여섯 시간이 있다', () => {
    expect(eventsOn(5).hasLastHours).toBe(true)
  })
})

describe('마지막 여섯 시간', () => {
  it('DAY 5 15:00부터다', () => {
    expect(inLastHours(START, dayN(5, '14:59'))).toBe(false)
    expect(inLastHours(START, dayN(5, '15:00'))).toBe(true)
  })

  it('다른 날 15시는 아니다', () => {
    expect(inLastHours(START, dayN(4, '15:00'))).toBe(false)
  })

  it('시작 시각을 짚는다', () => {
    expect(lastHoursStartMs(dayN(5, '10:00'))).toBe(dayN(5, '15:00'))
  })
})

describe('끝', () => {
  it('DAY 5까지는 안 끝났다', () => {
    expect(isOver(START, dayN(5, '20:00'))).toBe(false)
  })

  it('여섯째 날이면 끝났다', () => {
    expect(isOver(START, seoul('2026-03-07T09:00:00'))).toBe(true)
  })
})
