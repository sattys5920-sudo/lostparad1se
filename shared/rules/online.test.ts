import { describe, expect, it } from 'vitest'

import { AWAY_MS, isAway } from './online'

describe('앱을 켜 두었는가', () => {
  it('5 분이 지나야 꺼진 것이다', () => {
    expect(isAway(1_000, 1_000 + AWAY_MS)).toBe(false)
    expect(isAway(1_000, 1_000 + AWAY_MS + 1)).toBe(true)
  })
  it('신호를 한 번도 안 보낸 사람은 꺼진 것이 아니다', () => {
    expect(isAway(undefined, 10 ** 13)).toBe(false)
    expect(isAway(null, 10 ** 13)).toBe(false)
  })
})
