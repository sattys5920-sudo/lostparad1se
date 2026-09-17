// 아침 시퀀스 — 건너뛴 날이 이어지는가, 두 장짜리와 맨 위가 제대로 넘어가는가.
import { describe, expect, it } from 'vitest'
import {
  advance,
  currentDay,
  done,
  pendingDays,
  handledDays,
  readDays,
  shouldPlay,
  skipAll,
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
  /**
   * **하루만 골라 넘기는 길은 없다.**
   *
   * 오늘 아침은 오늘 읽는다. 하루치를 접어 두는 단추가 있으면 그것이
   * 곧 기본값이 되어, A의 기록을 아무도 안 읽고 닷새가 지나간다.
   * 넘길 수 있는 것은 며칠 못 들어온 사람의 **밀린 몫**뿐이다.
   */
  it('밀린 날을 한꺼번에 넘기면 남은 날이 모두 읽지 않음이다', () => {
    const s = skipAll(startMorning([1, 2, 3]))
    expect(done(s)).toBe(true)
    expect(s.skipped).toEqual([1, 2, 3])
    expect(readDays([1, 2, 3], s)).toEqual([])
  })

  it('보던 날 뒤로 밀린 것만 넘어간다', () => {
    let s = startMorning([1, 2, 3])
    s = tap(s, one, 4) // 1일차는 끝까지 봤다
    s = skipAll(s)
    expect(s.skipped).toEqual([2, 3])
    expect(readDays([1, 2, 3], s)).toEqual([1])
  })

  it('넘긴 날은 다시 재생하지 않는다', () => {
    // 넘겼는데 다음 접속에 또 나오면 그건 건너뛰기가 아니다.
    // 본 것으로 적어 두고, 보관함에만 읽지 않음으로 남긴다
    const s = skipAll(startMorning([1, 2]))
    expect(pendingDays([1, 2], [...s.skipped])).toEqual([])
  })
})

describe('다 본 뒤', () => {
  it('더 탭해도 아무 일도 없다', () => {
    const s = skipAll(startMorning([1]))
    expect(advance(s, one)).toEqual(s)
    expect(skipAll(s)).toEqual(s)
  })
})

describe('handledDays', () => {
  it('본 날과 넘긴 날을 함께 돌려준다', () => {
    const before = [1, 2, 3]
    let s = startMorning(before)
    s = tap(s, one, 4) // 1일차는 봤다
    s = skipAll(s) // 2·3 은 넘겼다
    expect(readDays(before, s)).toEqual([1])
    expect(handledDays(before, s)).toEqual([1, 2, 3])
  })

  it('아직 안 본 날은 빠진다', () => {
    const before = [1, 2, 3]
    const s = startMorning(before)
    expect(handledDays(before, s)).toEqual([])
  })

  // 이 둘을 갈라 놓고 readDays만 저장하면 넘긴 아침이 매일 다시 뜬다.
  // 봇 닷새 주행에서 실제로 그랬다.
  it('넘긴 날을 다시 재생하지 않는다', () => {
    const before = [1, 2, 3]
    const s = skipAll(startMorning(before))
    expect(pendingDays([1, 2, 3], readDays(before, s))).toContain(1)
    expect(pendingDays([1, 2, 3], handledDays(before, s))).not.toContain(1)
  })
})
