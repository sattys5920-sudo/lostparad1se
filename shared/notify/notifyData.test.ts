import { describe, expect, it } from 'vitest'

import { DEFAULT_SETTINGS, settingsOf } from './notifyData'

describe('설정 읽기', () => {
  it('비었으면 기본값 — 모두 받기(앱 안). 앱 밖은 권한을 받은 뒤에', () => {
    expect(settingsOf(undefined)).toEqual(DEFAULT_SETTINGS)
    for (const m of Object.values(DEFAULT_SETTINGS.modes)) expect(m).toBe('app')
  })
  it('모르는 값은 기본값으로', () => {
    const s = settingsOf({ on: false, modes: { tag: 'off', made: 'loud' } })
    expect(s.on).toBe(false)
    expect(s.modes.tag).toBe('off')
    expect(s.modes.made).toBe('app')
  })
})
