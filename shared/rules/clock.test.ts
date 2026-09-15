// 게임 시계 — 하루가 자정에 바뀌고 멈추는 구간이 없는지 본다.
//
// 여기가 틀리면 깃발이 엉뚱한 때 익고, 새벽에 들어온 사람이 어제에 선다.
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

describe('멈추는 구간', () => {
  // 하루가 자정에 열리니 멈춰 있는 시각이 없다. 예전에는 24:00~08:00 이었다
  it('없다 — 어느 시각에도 판은 돌고 있다', () => {
    for (const t of ['00:00:00', '00:30:00', '07:59:59', '08:00:00', '23:59:59']) {
      expect(isLightsOut(seoul(`2026-03-02T${t}`))).toBe(false)
    }
    expect(ACTIVE_SECONDS_PER_DAY).toBe(24 * HOUR)
  })
})

describe('흐른 시간 세기', () => {
  it('낮 동안은 그대로 흐른다', () => {
    const a = seoul('2026-03-02T10:00:00')
    const b = seoul('2026-03-02T12:30:00')
    expect(activeSecondsBetween(a, b)).toBe(2.5 * HOUR)
  })

  it('새벽에도 그대로 흐른다', () => {
    const a = seoul('2026-03-02T01:00:00')
    const b = seoul('2026-03-02T05:00:00')
    expect(activeSecondsBetween(a, b)).toBe(4 * HOUR)
  })

  it('밤을 넘어도 빠지는 것이 없다', () => {
    // 23:30 → 다음 날 08:30. 실제로 9시간이고 게임 시계도 9시간이다
    const a = seoul('2026-03-02T23:30:00')
    const b = seoul('2026-03-03T08:30:00')
    expect(activeSecondsBetween(a, b)).toBe(9 * HOUR)
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

  it('자정을 넘어도 그냥 이어진다', () => {
    // 23:30에 60분짜리 깃발 → 다음 날 00:30에 익는다
    const start = seoul('2026-03-02T23:30:00')
    expect(addActiveMinutes(start, 60)).toBe(seoul('2026-03-03T00:30:00'))
  })

  it('새벽에 시작해도 그 자리에서 센다', () => {
    const start = seoul('2026-03-02T03:00:00')
    expect(addActiveMinutes(start, 30)).toBe(seoul('2026-03-02T03:30:00'))
  })

  it('며칠을 넘겨도 맞다', () => {
    const start = seoul('2026-03-02T20:00:00')
    const end = addActiveSeconds(start, 24 * HOUR)
    expect(end).toBe(seoul('2026-03-03T20:00:00'))
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

  // 예전에는 새벽이 전날에 붙었다. 이제는 자정을 넘으면 다음 날이다
  it('자정에 날이 바뀐다', () => {
    expect(dayNumber(started, seoul('2026-03-03T00:00:00'))).toBe(2)
    expect(dayNumber(started, seoul('2026-03-03T03:00:00'))).toBe(2)
    expect(dayNumber(started, seoul('2026-03-06T08:00:00'))).toBe(5)
  })
})
