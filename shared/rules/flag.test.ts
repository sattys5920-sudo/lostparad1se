// 깃발 — 꽂고, 뽑고, 하루치를 받는다.
import { describe, expect, it } from 'vitest'

import {
  canHoldFlags,
  flagTotal,
  flagsIn,
  spendFlags,
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

describe('팀 상자', () => {
  it('페이즈 몫부터 쓴다', () => {
    expect(spendFlags({ given: 2, bought: 1 }, 2)).toEqual({ given: 1, bought: 1 })
  })

  it('페이즈 몫이 바닥나면 산 것을 쓴다', () => {
    expect(spendFlags({ given: 1, bought: 2 }, 1)).toEqual({ given: 0, bought: 1 })
  })

  it('늘었으면 그대로다', () => {
    expect(spendFlags({ given: 1, bought: 0 }, 3)).toEqual({ given: 1, bought: 0 })
  })
})
