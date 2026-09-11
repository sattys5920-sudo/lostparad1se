// 게임 시계 — 소등을 건너뛰는지 본다.
//
// 여기가 틀리면 깃발이 밤새 익어 버리거나, 발 묶기가 아침에 안 풀린다.
import { describe, expect, it } from 'vitest'
import {
  activeSecondsBetween,
  addActiveMinutes,
  addActiveSeconds,
  dayNumber,
  gameNow,
  isLightsOut,
  realTimeOf,
  secondsIntoSeoulDay,
  seoulTimeOn,
} from './clock'
import { ACTIVE_SECONDS_PER_DAY } from './v2'

/** 서울 시각을 밀리초로. 서울은 UTC+9이고 서머타임이 없다. */
const seoul = (iso: string) => new Date(`${iso}+09:00`).getTime()
const MIN = 60
const HOUR = 3600

describe('서울 시각 읽기', () => {
  it('그날 몇 초가 지났는지 센다', () => {
    expect(secondsIntoSeoulDay(seoul('2026-03-02T00:00:00'))).toBe(0)
    expect(secondsIntoSeoulDay(seoul('2026-03-02T08:00:00'))).toBe(8 * HOUR)
    expect(secondsIntoSeoulDay(seoul('2026-03-02T23:59:59'))).toBe(24 * HOUR - 1)
  })

  it('그날 몇 시를 짚는다', () => {
    expect(seoulTimeOn(seoul('2026-03-02T13:37:00'), 8)).toBe(seoul('2026-03-02T08:00:00'))
    expect(seoulTimeOn(seoul('2026-03-02T13:37:00'), 21)).toBe(seoul('2026-03-02T21:00:00'))
  })
})

describe('소등', () => {
  it('24:00부터 08:00까지다', () => {
    expect(isLightsOut(seoul('2026-03-02T00:30:00'))).toBe(true)
    expect(isLightsOut(seoul('2026-03-02T07:59:59'))).toBe(true)
    expect(isLightsOut(seoul('2026-03-02T08:00:00'))).toBe(false)
    expect(isLightsOut(seoul('2026-03-02T23:59:59'))).toBe(false)
  })
})

describe('흐른 시간 세기', () => {
  it('낮 동안은 그대로 흐른다', () => {
    const a = seoul('2026-03-02T10:00:00')
    const b = seoul('2026-03-02T12:30:00')
    expect(activeSecondsBetween(a, b)).toBe(2.5 * HOUR)
  })

  it('소등 동안은 멈춘다', () => {
    const a = seoul('2026-03-02T01:00:00')
    const b = seoul('2026-03-02T05:00:00')
    expect(activeSecondsBetween(a, b)).toBe(0)
  })

  it('밤을 넘으면 소등만큼 빠진다', () => {
    // 23:30 → 다음 날 08:30. 실제로는 9시간이지만 활동 시간은 1시간이다
    const a = seoul('2026-03-02T23:30:00')
    const b = seoul('2026-03-03T08:30:00')
    expect(activeSecondsBetween(a, b)).toBe(1 * HOUR)
  })

  it('하루를 통째로 건너뛰어도 맞다', () => {
    const a = seoul('2026-03-02T08:00:00')
    const b = seoul('2026-03-05T08:00:00')
    expect(activeSecondsBetween(a, b)).toBe(3 * ACTIVE_SECONDS_PER_DAY)
  })

  it('거꾸로면 0이다', () => {
    expect(activeSecondsBetween(seoul('2026-03-02T12:00:00'), seoul('2026-03-02T11:00:00'))).toBe(0)
  })
})

describe('활동 시간 더하기', () => {
  it('낮에는 그냥 더해진다', () => {
    const start = seoul('2026-03-02T10:00:00')
    expect(addActiveMinutes(start, 30)).toBe(seoul('2026-03-02T10:30:00'))
  })

  it('밤을 만나면 다음 날 아침으로 넘어간다', () => {
    // 23:30에 60분짜리 깃발 → 30분은 오늘, 30분은 내일 08:00부터
    const start = seoul('2026-03-02T23:30:00')
    expect(addActiveMinutes(start, 60)).toBe(seoul('2026-03-03T08:30:00'))
  })

  it('소등 중에 시작하면 등교 시각부터 센다', () => {
    const start = seoul('2026-03-02T03:00:00')
    expect(addActiveMinutes(start, 30)).toBe(seoul('2026-03-02T08:30:00'))
  })

  it('여러 밤을 넘겨도 맞다', () => {
    const start = seoul('2026-03-02T20:00:00')
    // 하루 활동 시간이 16시간. 20시부터 4시간 남았으니 4 + 16 + 4 = 24시간
    const end = addActiveSeconds(start, 24 * HOUR)
    expect(end).toBe(seoul('2026-03-04T12:00:00'))
  })

  it('더한 만큼 다시 세면 그대로다', () => {
    for (const iso of ['2026-03-02T08:00:00', '2026-03-02T19:12:34', '2026-03-02T23:59:00']) {
      for (const minutes of [30, 60, 120, 180, 500]) {
        const start = seoul(iso)
        const end = addActiveMinutes(start, minutes)
        expect(activeSecondsBetween(start, end)).toBe(minutes * MIN)
      }
    }
  })

  it('0이나 음수는 제자리다', () => {
    const start = seoul('2026-03-02T10:00:00')
    expect(addActiveSeconds(start, 0)).toBe(start)
    expect(addActiveSeconds(start, -100)).toBe(start)
  })
})

describe('개발용 시계', () => {
  it('아무것도 안 걸면 실제 시각이다', () => {
    expect(gameNow(undefined, 1_700_000_000_000)).toBe(1_700_000_000_000)
  })

  it('배속만큼 빨리 간다', () => {
    const clock = { anchorRealMs: 1000, anchorGameMs: seoul('2026-03-02T08:00:00'), speed: 60 }
    // 실제 10초 = 게임 10분
    expect(gameNow(clock, 11_000)).toBe(seoul('2026-03-02T08:10:00'))
  })

  it('되돌리면 제자리다', () => {
    const clock = { anchorRealMs: 5_000, anchorGameMs: seoul('2026-03-02T08:00:00'), speed: 30 }
    const real = 5_000 + 123_456
    expect(realTimeOf(gameNow(clock, real), clock)).toBeCloseTo(real, 6)
  })
})

describe('며칠째인가', () => {
  const started = seoul('2026-03-02T08:00:00')

  it('첫날은 DAY 1이다', () => {
    expect(dayNumber(started, seoul('2026-03-02T08:00:00'))).toBe(1)
    expect(dayNumber(started, seoul('2026-03-02T23:59:00'))).toBe(1)
  })

  it('소등은 전날에 붙는다', () => {
    expect(dayNumber(started, seoul('2026-03-03T03:00:00'))).toBe(1)
  })

  it('08:00에 날이 바뀐다', () => {
    expect(dayNumber(started, seoul('2026-03-03T08:00:00'))).toBe(2)
    expect(dayNumber(started, seoul('2026-03-06T08:00:00'))).toBe(5)
  })
})
