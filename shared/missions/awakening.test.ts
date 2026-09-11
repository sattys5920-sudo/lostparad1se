// 그 자리와 깨달음 — 투명인간이면 두 배로 쌓인다.
import { describe, expect, it } from 'vitest'
import { AWAKENING_NEED_SEC, awakenedCount, awakeningOf, placeSeconds, type InvisibleSpan } from './awakening'
import type { Interval } from '../rules/presence'

const seoul = (iso: string) => new Date(`${iso}+09:00`).getTime()
const HOUR = 3600
const from = seoul('2026-03-02T00:00:00')
const to = seoul('2026-03-08T00:00:00')

const iv = (start: string, end: string | null, state: Interval['state'] = 'standing'): Interval => ({
  playerId: 'me',
  tileId: 'storage',
  startMs: seoul(start),
  endMs: end === null ? null : seoul(end),
  state,
})

const stay = (intervals: Interval[], spans: InvisibleSpan[] = []) =>
  placeSeconds(intervals, 'me', 'storage', spans, from, to)

describe('쌓이는 시간', () => {
  it('세 시간이면 열린다', () => {
    expect(AWAKENING_NEED_SEC).toBe(3 * HOUR)
  })

  it('나눠 서 있어도 더해진다', () => {
    const out = stay([
      iv('2026-03-02T10:00:00', '2026-03-02T11:00:00'),
      iv('2026-03-03T10:00:00', '2026-03-03T12:00:00'),
    ])
    expect(out).toBe(3 * HOUR)
  })

  it('소등은 빠진다', () => {
    // 23:00 ~ 다음 날 09:00 = 활동 2시간
    expect(stay([iv('2026-03-02T23:00:00', '2026-03-03T09:00:00')])).toBe(2 * HOUR)
  })

  it('잠든 말도 센다', () => {
    expect(stay([iv('2026-03-02T10:00:00', '2026-03-02T13:00:00', 'asleep')])).toBe(3 * HOUR)
  })

  it('걷는 중은 세지 않는다', () => {
    expect(stay([iv('2026-03-02T10:00:00', '2026-03-02T13:00:00', 'walking')])).toBe(0)
  })

  it('다른 칸은 세지 않는다', () => {
    const elsewhere: Interval = { ...iv('2026-03-02T10:00:00', '2026-03-02T13:00:00'), tileId: 'library' }
    expect(stay([elsewhere])).toBe(0)
  })
})

describe('투명인간이면 두 배', () => {
  it('지워진 동안은 두 배로 쌓인다', () => {
    const spans: InvisibleSpan[] = [
      { playerId: 'me', startMs: seoul('2026-03-02T10:00:00'), endMs: seoul('2026-03-02T12:00:00') },
    ]
    // 두 시간을 두 배로 → 네 시간
    expect(stay([iv('2026-03-02T10:00:00', '2026-03-02T12:00:00')], spans)).toBe(4 * HOUR)
  })

  it('겹친 부분만 두 배다', () => {
    const spans: InvisibleSpan[] = [
      { playerId: 'me', startMs: seoul('2026-03-02T10:00:00'), endMs: seoul('2026-03-02T11:00:00') },
    ]
    // 10~12시 두 시간 중 앞 한 시간만 두 배 → 3시간
    expect(stay([iv('2026-03-02T10:00:00', '2026-03-02T12:00:00')], spans)).toBe(3 * HOUR)
  })

  it('남이 지워진 건 상관없다', () => {
    const spans: InvisibleSpan[] = [
      { playerId: 'other', startMs: seoul('2026-03-02T10:00:00'), endMs: seoul('2026-03-02T12:00:00') },
    ]
    expect(stay([iv('2026-03-02T10:00:00', '2026-03-02T12:00:00')], spans)).toBe(2 * HOUR)
  })

  it('지워진 하루면 한 시간 반으로도 열린다', () => {
    const spans: InvisibleSpan[] = [
      { playerId: 'me', startMs: seoul('2026-03-02T10:00:00'), endMs: seoul('2026-03-02T23:00:00') },
    ]
    const out = awakeningOf(
      [iv('2026-03-02T10:00:00', '2026-03-02T11:30:00')],
      'me', 'storage', spans, from, to,
    )
    expect(out.open).toBe(true)
  })
})

describe('열림', () => {
  it('모자라면 안 열린다', () => {
    const out = awakeningOf([iv('2026-03-02T10:00:00', '2026-03-02T12:00:00')], 'me', 'storage', [], from, to)
    expect(out).toMatchObject({ have: 2 * HOUR, need: 3 * HOUR, open: false })
  })

  it('딱 맞으면 열린다', () => {
    const out = awakeningOf([iv('2026-03-02T10:00:00', '2026-03-02T13:00:00')], 'me', 'storage', [], from, to)
    expect(out.open).toBe(true)
  })

  it('깨달음에 이른 사람을 센다', () => {
    expect(awakenedCount([{ have: 0, need: 1, open: false }, { have: 1, need: 1, open: true }])).toBe(1)
  })
})
