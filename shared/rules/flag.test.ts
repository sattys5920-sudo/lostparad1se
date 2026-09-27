// 깃발 — 꽂고, 뽑고, 하루치를 받는다.
import { describe, expect, it } from 'vitest'

import {
  FLAGS_PER_DAY,
  canHoldFlags,
  flagTotal,
  flagsIn,
  grantFlags,
  pullTarget,
  withPlanted,
  withPulled,
  type FlagMap,
} from './flag'

describe('꽂기와 뽑기', () => {
  it('꽂으면 그 방 그 팀 수가 하나 는다. 원래 것은 안 고친다', () => {
    const before: FlagMap = { library: { A: 1 } }
    const after = withPlanted(before, 'library', 'A')
    expect(flagsIn(after, 'library', 'A')).toBe(2)
    expect(flagsIn(before, 'library', 'A')).toBe(1)
  })

  it('뽑으면 하나 준다. 마지막 하나를 뽑으면 그 팀 칸이 사라진다', () => {
    const one = withPulled({ library: { B: 1, C: 2 } }, 'library', 'B') as FlagMap
    expect(one.library?.B).toBeUndefined()
    expect(flagTotal(one, 'library')).toBe(2)
  })

  it('없는 것은 못 뽑는다', () => {
    expect(withPulled({}, 'library', 'B')).toBeNull()
  })

  it('안 고르면 나 말고 제일 많이 꽂은 팀 것을 뽑는다. 동수면 팀 순서', () => {
    expect(pullTarget({ library: { A: 5, B: 1, C: 3 } }, 'library', 'A')).toBe('C')
    expect(pullTarget({ library: { B: 2, C: 2 } }, 'library', 'A')).toBe('B')
    expect(pullTarget({ library: { A: 2 } }, 'library', 'A')).toBeNull()
  })

  it('2-3 교실에는 못 꽂는다', () => {
    expect(canHoldFlags('centralPlaza')).toBe(false)
    expect(canHoldFlags('library')).toBe(true)
  })
})

describe('하루치', () => {
  it('날이 바뀌면 들어온다. 남은 것은 그대로 간다', () => {
    expect(grantFlags(2, 1, 2)).toEqual({ held: 2 + FLAGS_PER_DAY, day: 2 })
  })

  it('**같은 날 두 번 안 들어온다**', () => {
    expect(grantFlags(1, 3, 3)).toEqual({ held: 1, day: 3 })
  })

  it('처음 받는 날도 들어온다', () => {
    expect(grantFlags(0, null, 1)).toEqual({ held: FLAGS_PER_DAY, day: 1 })
  })
})
