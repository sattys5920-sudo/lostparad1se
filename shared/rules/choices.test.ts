import { describe, expect, it } from 'vitest'
import {
  CHOSEN_ONE_DAY,
  DAY4_CHOICE_DAY,
  DAY4_CHOICES,
  canChooseDay4,
  canChoosePerson,
  closingMutual,
  closingTogether,
  day4Met,
} from './choices'

const base = { day: CHOSEN_ONE_DAY, chooserId: 'a', targetId: 'b', known: true }

describe('중요한 사람', () => {
  it('DAY 3에만 고른다', () => {
    expect(canChoosePerson(base).ok).toBe(true)
    expect(canChoosePerson({ ...base, day: 2 }).reason).toBe('wrongDay')
    expect(canChoosePerson({ ...base, day: 4 }).reason).toBe('wrongDay')
  })

  it('자기 자신은 못 고른다', () => {
    expect(canChoosePerson({ ...base, targetId: 'a' }).reason).toBe('self')
  })

  it('명단에 없는 사람도 못 고른다', () => {
    expect(canChoosePerson({ ...base, known: false }).reason).toBe('unknown')
  })

  // 날짜 검사 하나가 잠금까지 한다. 따로 둔 안전장치는 아무 일도 안 했다
  it('DAY 3이 지나면 그대로 잠긴다', () => {
    expect(canChoosePerson({ ...base, day: CHOSEN_ONE_DAY + 1 }).reason).toBe('wrongDay')
  })
})

describe('DAY 4 선택', () => {
  it('셋뿐이다', () => {
    expect(DAY4_CHOICES.map((c) => c.id)).toEqual(['team', 'self', 'bond'])
  })

  it('DAY 4에만 고른다', () => {
    expect(canChooseDay4(DAY4_CHOICE_DAY).ok).toBe(true)
    expect(canChooseDay4(3).reason).toBe('wrongDay')
    expect(canChooseDay4(5).reason).toBe('wrongDay')
  })

  const out = { choice: null, teamRank: 1, mainMet: true, bondMet: true } as const

  // 「아무것도 고르지 않음」은 세 번째 선택지가 아니다
  it('안 골랐으면 실패다', () => {
    expect(day4Met(out)).toBe(false)
  })

  it('팀은 2위 이내면 성공', () => {
    expect(day4Met({ ...out, choice: 'team', teamRank: 1 })).toBe(true)
    expect(day4Met({ ...out, choice: 'team', teamRank: 2 })).toBe(true)
    expect(day4Met({ ...out, choice: 'team', teamRank: 3 })).toBe(false)
  })

  it('나는 주 미션, 그 사람은 인연 미션', () => {
    expect(day4Met({ ...out, choice: 'self', mainMet: true, bondMet: false })).toBe(true)
    expect(day4Met({ ...out, choice: 'self', mainMet: false, bondMet: true })).toBe(false)
    expect(day4Met({ ...out, choice: 'bond', mainMet: false, bondMet: true })).toBe(true)
    expect(day4Met({ ...out, choice: 'bond', mainMet: true, bondMet: false })).toBe(false)
  })
})

describe('종례', () => {
  it('같은 칸에 있으면 함께다', () => {
    const out = closingTogether({
      chosenBy: { a: 'b', b: 'c', c: null },
      tileAt: { a: 'library', b: 'library', c: 'gym' },
    })
    expect(out).toEqual({ a: true, b: false, c: false })
  })

  // 걷는 중이면 어느 칸에도 없다
  it('걷는 중이면 함께가 아니다', () => {
    const out = closingTogether({ chosenBy: { a: 'b' }, tileAt: { a: null, b: null } })
    expect(out.a).toBe(false)
  })

  it('서로 골랐으면 마주 본 것이다', () => {
    expect(closingMutual({ a: 'b', b: 'a', c: 'a' })).toEqual({ a: true, b: true, c: false })
  })

  it('안 고른 사람은 마주 볼 것도 없다', () => {
    expect(closingMutual({ a: null, b: 'a' })).toEqual({ a: false, b: false })
  })
})
