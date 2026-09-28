import { describe, expect, it } from 'vitest'

import { DEFAULT_SETTINGS, isQuiet, quietEndsAt, settingsOf } from './notifyData'

const kst = (h: number, m = 0) => Date.UTC(2026, 2, 3, h - 9, m)

describe('조용한 시간', () => {
  it('서울 00:00~07:59 는 조용하다', () => {
    expect(isQuiet(kst(0))).toBe(true)
    expect(isQuiet(kst(7, 59))).toBe(true)
    expect(isQuiet(kst(8))).toBe(false)
    expect(isQuiet(kst(23, 59))).toBe(false)
  })
  it('끝나는 시각은 그날 08:00', () => {
    expect(quietEndsAt(kst(3, 20))).toBe(kst(8))
    expect(quietEndsAt(kst(12))).toBe(kst(12))
  })
})

describe('설정 읽기', () => {
  it('비었으면 기본값 — 태그 · 공지는 앱 밖에서도', () => {
    expect(settingsOf(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(DEFAULT_SETTINGS.modes.tag).toBe('push')
    expect(DEFAULT_SETTINGS.modes.notice).toBe('push')
    expect(DEFAULT_SETTINGS.modes.made).toBe('app')
  })
  it('모르는 값은 기본값으로', () => {
    const s = settingsOf({ on: false, modes: { tag: 'off', made: 'loud' } })
    expect(s.on).toBe(false)
    expect(s.modes.tag).toBe('off')
    expect(s.modes.made).toBe('app')
  })
})
