// 공개 시각 게이트 — 날짜를 건너뛴 요청이 막히는지.
//
// 여기가 뚫리면 첫날 아침에 닷새치를 다 읽는다. 그 판은 되돌릴 수 없다.
import { describe, expect, it } from 'vitest'
import { canRelease, releasedDays } from './release'

const seoul = (iso: string) => new Date(`${iso}+09:00`).getTime()
const START = seoul('2026-03-02T08:00:00')
const on = (day: number, hhmm: string) => seoul(`2026-03-0${1 + day}T${hhmm}:00`)

describe('열리는 시각', () => {
  it('그날 08:00에 열린다', () => {
    expect(canRelease(2, START, on(2, '07:59')).ok).toBe(false)
    expect(canRelease(2, START, on(2, '08:00')).ok).toBe(true)
  })

  it('지난 날은 계속 열려 있다', () => {
    expect(canRelease(1, START, on(4, '12:00')).ok).toBe(true)
  })

  it('내일 것은 못 받는다', () => {
    const out = canRelease(3, START, on(2, '23:59'))
    expect(out.ok).toBe(false)
    expect(out.reason).toBe('notYet')
  })

  it('첫날 아침에 마지막 날을 달라고 해도 막는다', () => {
    expect(canRelease(5, START, on(1, '08:00')).reason).toBe('notYet')
  })

  it('소등 중에 미리 받아 갈 수 없다', () => {
    // DAY 2 03:00은 아직 DAY 1이다
    expect(canRelease(2, START, seoul('2026-03-03T03:00:00')).reason).toBe('notYet')
  })

  it('없는 날은 따로 답한다', () => {
    expect(canRelease(0, START, on(3, '12:00')).reason).toBe('noSuchDay')
    expect(canRelease(6, START, on(3, '12:00')).reason).toBe('noSuchDay')
    expect(canRelease(1.5, START, on(3, '12:00')).reason).toBe('noSuchDay')
  })

  it('시작 전에는 아무것도 없다', () => {
    expect(canRelease(1, null, on(1, '12:00')).reason).toBe('notStarted')
  })
})

describe('지금까지 열린 날', () => {
  it('하루씩 늘어난다', () => {
    expect(releasedDays(START, on(1, '08:00'))).toEqual([1])
    expect(releasedDays(START, on(3, '12:00'))).toEqual([1, 2, 3])
    expect(releasedDays(START, on(5, '21:00'))).toEqual([1, 2, 3, 4, 5])
  })

  it('닷새를 넘지 않는다', () => {
    expect(releasedDays(START, seoul('2026-03-20T12:00:00'))).toHaveLength(5)
  })

  it('소등 중에도 어제까지는 읽을 수 있다', () => {
    // DAY 2의 소등(3/4 07:00)에는 DAY 1·2가 이미 열려 있다.
    // dayNumber가 08:00 경계를 보므로 이때가 아직 DAY 2다
    expect(releasedDays(START, on(3, '07:00'))).toEqual([1, 2])
  })

  it('판이 시작하기 전에는 첫 조각도 없다', () => {
    expect(releasedDays(START, seoul('2026-03-02T07:00:00'))).toEqual([])
  })
})
