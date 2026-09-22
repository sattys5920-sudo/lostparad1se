// 아침 시퀀스 — 건너뛴 날이 이어지는가, 두 장짜리가 제대로 넘어가는가.
import { describe, expect, it } from 'vitest'
import {
  advance,
  currentDay,
  done,
  pendingDays,
  handledDays,
  readDays,
  shouldPlay,
  startMorning,
  type DayScript,
} from './morning'

const one: DayScript = { day: 1, papers: [{ hasTop: false }] }
const two: DayScript = { day: 2, papers: [{ hasTop: false }, { hasTop: false }] }
const withTop: DayScript = { day: 5, papers: [{ hasTop: true }] }

/** 탭을 n번 한다. */
function tap(s: ReturnType<typeof startMorning>, script: DayScript | null, n: number) {
  let out = s
  for (let i = 0; i < n; i++) out = advance(out, script)
  return out
}

describe('안 본 날', () => {
  it('열린 날 중 안 본 것만 고른다', () => {
    expect(pendingDays([1, 2, 3], [1])).toEqual([2, 3])
  })

  it('날짜순으로 준다', () => {
    expect(pendingDays([3, 1, 2], [])).toEqual([1, 2, 3])
  })

  it('다 봤으면 재생하지 않는다', () => {
    expect(shouldPlay([1, 2], [1, 2])).toBe(false)
    expect(shouldPlay([1, 2], [1])).toBe(true)
  })
})

describe('한 날의 두 장면', () => {
  /**
   * **날짜 카드와 「오늘 일어나는 일」은 없앴다.** 아침에 남는 것은
   * A가 쓴 종이 한 장이고, 탭하면 자리를 비추고 끝난다.
   */
  it('기록 → 미니맵', () => {
    let s = startMorning([1])
    expect(s.scene).toBe('record')
    s = advance(s, one); expect(s.scene).toBe('map')
    s = advance(s, one); expect(done(s)).toBe(true)
  })
})

describe('종이가 두 장일 때 (DAY 2)', () => {
  it('두 장을 다 넘겨야 다음 장면이다', () => {
    let s = startMorning([2])
    expect(s.scene).toBe('record')
    expect(s.paperIndex).toBe(0)
    s = advance(s, two)
    expect(s.scene).toBe('record')
    expect(s.paperIndex).toBe(1)
    s = advance(s, two)
    expect(s.scene).toBe('map')
  })
})

describe('맨 위가 있을 때', () => {
  /**
   * **지금 데이터에는 맨 위 줄이 없다.** 기계는 남겨 둔다 — 한 종이에
   * 나중에 쓴 줄과 먼저 쓴 줄이 같이 있을 수 있는 모양이다.
   */
  it('탭을 한 번 더 받아야 나온다', () => {
    let s = startMorning([5])
    expect(s.scene).toBe('record')
    expect(s.topShown).toBe(false)
    s = advance(s, withTop)
    expect(s.scene).toBe('record')
    expect(s.topShown).toBe(true)
    s = advance(s, withTop)
    expect(s.scene).toBe('map')
  })

  it('맨 위가 없으면 그냥 넘어간다', () => {
    const s = advance(startMorning([1]), one)
    expect(s.scene).toBe('map')
  })
})

describe('며칠을 건너뛰고 들어온 사람', () => {
  it('빠진 날을 날짜순으로 이어서 본다', () => {
    let s = startMorning([1, 2, 3])
    expect(currentDay(s)).toBe(1)
    s = tap(s, one, 2)
    expect(currentDay(s)).toBe(2)
    expect(s.scene).toBe('record')
    s = tap(s, two, 3)
    expect(currentDay(s)).toBe(3)
    s = tap(s, one, 2)
    expect(done(s)).toBe(true)
  })
})

describe('건너뛰기는 없다', () => {
  /**
   * **아침은 관리자가 여는 대로 겪는다.**
   *
   * 하루치를 접어 두는 단추가 있으면 그것이 곧 기본값이 된다 — 누르는
   * 쪽이 늘 빠르니까, A의 기록을 아무도 안 읽고 닷새가 지나간다.
   * 밀린 몫을 한꺼번에 넘기는 길도 같은 이유로 없앴다. 못 들어온 날은
   * 다음에 들어올 때 날짜순으로 이어서 본다.
   */
  it('넘기는 길이 없다 — 탭으로만 넘어간다', () => {
    let s = startMorning([1, 2])
    expect(s.skipped).toEqual([])
    s = tap(s, one, 2)
    expect(currentDay(s)).toBe(2)
    expect(s.skipped).toEqual([])
  })

  it('끝까지 본 날만 읽은 것이다', () => {
    const before = [1, 2]
    let s = startMorning(before)
    s = tap(s, one, 2)
    expect(readDays(before, s)).toEqual([1])
    s = tap(s, one, 2)
    expect(readDays(before, s)).toEqual([1, 2])
    expect(pendingDays(before, handledDays(before, s))).toEqual([])
  })
})


describe('다 본 뒤', () => {
  it('더 탭해도 아무 일도 없다', () => {
    const s = tap(startMorning([1]), one, 2)
    expect(done(s)).toBe(true)
    expect(advance(s, one)).toEqual(s)
  })
})

describe('handledDays', () => {
  it('끝까지 본 날을 돌려준다', () => {
    const before = [1, 2, 3]
    let s = startMorning(before)
    s = tap(s, one, 2)
    s = tap(s, one, 2)
    expect(readDays(before, s)).toEqual([1, 2])
    expect(handledDays(before, s)).toEqual([1, 2])
  })

  it('아직 안 본 날은 빠진다', () => {
    const before = [1, 2, 3]
    const s = startMorning(before)
    expect(handledDays(before, s)).toEqual([])
  })

  /**
   * 옛 판에는 넘긴 날이 적혀 있다. 그 판이 아직 돌고 있으므로
   * **적힌 것을 그대로 읽어야 한다** — 이 둘을 갈라 놓고 readDays 만
   * 저장하면 그 아침이 매일 다시 뜬다. 봇 닷새 주행에서 그랬다.
   */
  it('옛 판에 넘긴 날로 적힌 것은 다시 재생하지 않는다', () => {
    const before = [1, 2, 3]
    const old = { ...startMorning(before), queue: [2, 3], skipped: [1] }
    expect(pendingDays(before, readDays(before, old))).toContain(1)
    expect(pendingDays(before, handledDays(before, old))).not.toContain(1)
  })
})
