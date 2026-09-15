// 공개 시각 게이트 — 날짜를 건너뛴 요청이 막히는지.
//
// 여기가 뚫리면 첫날 아침에 닷새치를 다 읽는다. 그 판은 되돌릴 수 없다.
import { describe, expect, it } from 'vitest'
import { canRelease, releasedDays } from './release'

const seoul = (iso: string) => new Date(`${iso}+09:00`).getTime()
const START = seoul('2026-03-02T08:00:00')
const on = (day: number, hhmm: string) => seoul(`2026-03-0${1 + day}T${hhmm}:00`)

describe('열리는 시각', () => {
  // 하루가 자정에 바뀌니 그날 것도 자정에 열린다
  it('그날 자정에 열린다', () => {
    expect(canRelease(2, START, seoul('2026-03-02T23:59:00')).ok).toBe(false)
    expect(canRelease(2, START, on(2, '00:00')).ok).toBe(true)
  })

  it('지난 날은 계속 열려 있다', () => {
    expect(canRelease(1, START, on(4, '12:00')).ok).toBe(true)
  })

  it('내일 것은 못 받는다', () => {
    const out = canRelease(3, START, on(2, '23:59'))
    expect(out.ok).toBe(false)
    expect(out.reason).toBe('notYet')
  })

  it('첫날에 마지막 날을 달라고 해도 막는다', () => {
    expect(canRelease(5, START, on(1, '08:00')).reason).toBe('notYet')
  })

  it('그 전날에는 못 받는다', () => {
    // 3/3 03:00 은 이미 DAY 2 다 — DAY 3 을 달라면 막힌다
    expect(canRelease(3, START, seoul('2026-03-03T03:00:00')).reason).toBe('notYet')
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

  // 자정을 넘으면 그날 것이 바로 열린다. 예전에는 아침 8시까지 기다렸다
  it('새벽에도 그날 것까지 읽을 수 있다', () => {
    expect(releasedDays(START, on(3, '07:00'))).toEqual([1, 2, 3])
  })

  it('판이 시작하기 전에는 첫 조각도 없다', () => {
    expect(releasedDays(START, seoul('2026-03-02T07:00:00'))).toEqual([])
  })
})
