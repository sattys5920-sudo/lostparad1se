// 아침 시퀀스 — 건너뛴 날이 이어지는가, 두 장짜리와 맨 위가 제대로 넘어가는가.
import { describe, expect, it } from 'vitest'
import {
  advance,
  currentDay,
  done,
  pendingDays,
  readDays,
  shouldPlay,
  skipAll,
  skipDay,
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

describe('한 날의 네 장면', () => {
  it('날짜 → 기록 → 오늘 → 미니맵', () => {
    let s = startMorning([1])
    expect(s.scene).toBe('date')
    s = advance(s, one); expect(s.scene).toBe('record')
    s = advance(s, one); expect(s.scene).toBe('today')
    s = advance(s, one); expect(s.scene).toBe('map')
    s = advance(s, one); expect(done(s)).toBe(true)
  })
})

describe('종이가 두 장일 때 (DAY 2)', () => {
  it('두 장을 다 넘겨야 다음 장면이다', () => {
    let s = startMorning([2])
    s = advance(s, two)
    expect(s.scene).toBe('record')
    expect(s.paperIndex).toBe(0)
    s = advance(s, two)
    expect(s.scene).toBe('record')
    expect(s.paperIndex).toBe(1)
    s = advance(s, two)
    expect(s.scene).toBe('today')
  })
})

describe('맨 위가 있을 때 (DAY 5)', () => {
  it('탭을 한 번 더 받아야 나온다', () => {
    let s = startMorning([5])
    s = advance(s, withTop)
    expect(s.scene).toBe('record')
    expect(s.topShown).toBe(false)
    s = advance(s, withTop)
    expect(s.scene).toBe('record')
    expect(s.topShown).toBe(true)
    s = advance(s, withTop)
    expect(s.scene).toBe('today')
  })

  it('맨 위가 없으면 그냥 넘어간다', () => {
    const s = advance(advance(startMorning([1]), one), one)
    expect(s.scene).toBe('today')
  })
})

describe('며칠을 건너뛰고 들어온 사람', () => {
  it('빠진 날을 날짜순으로 이어서 본다', () => {
    let s = startMorning([1, 2, 3])
    expect(currentDay(s)).toBe(1)
    s = tap(s, one, 4)
    expect(currentDay(s)).toBe(2)
    expect(s.scene).toBe('date')
    s = tap(s, two, 5)
    expect(currentDay(s)).toBe(3)
    s = tap(s, one, 4)
    expect(done(s)).toBe(true)
  })
})

describe('건너뛰기', () => {
  it('그 날만 건너뛰고 다음 날은 이어서 본다', () => {
    let s = startMorning([1, 2])
    s = skipDay(s)
    expect(currentDay(s)).toBe(2)
    expect(s.skipped).toEqual([1])
    expect(s.scene).toBe('date')
  })

  it('건너뛴 날은 「읽지 않음」으로 남는다', () => {
    const before = [1, 2, 3]
    let s = startMorning(before)
    s = skipDay(s)
    s = tap(s, one, 4)
    s = skipDay(s)
    expect(s.skipped).toEqual([1, 3])
    expect(readDays(before, s)).toEqual([2])
  })

  it('전부 건너뛰면 남은 날이 모두 읽지 않음이다', () => {
    const s = skipAll(startMorning([1, 2, 3]))
    expect(done(s)).toBe(true)
    expect(s.skipped).toEqual([1, 2, 3])
    expect(readDays([1, 2, 3], s)).toEqual([])
  })

  it('건너뛴 날은 다시 재생하지 않는다', () => {
    // 건너뛰기를 눌렀는데 다음 접속에 또 나오면 그건 건너뛰기가 아니다.
    // 본 것으로 적어 두고, 보관함에만 읽지 않음으로 남긴다
    const s = skipDay(startMorning([1, 2]))
    const seenNow = [...s.skipped]
    expect(pendingDays([1, 2], seenNow)).toEqual([2])
  })
})

describe('다 본 뒤', () => {
  it('더 탭해도 아무 일도 없다', () => {
    const s = skipAll(startMorning([1]))
    expect(advance(s, one)).toEqual(s)
    expect(skipDay(s)).toEqual(s)
  })
})
