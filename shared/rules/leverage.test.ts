// 약점 — 털어놓기가 남기는 것.
import { describe, expect, it } from 'vitest'
import { bindUntilMs, canUse, extort, holdsOn, reveal, spend, type Leverage } from './leverage'
import { REVEAL_INFLUENCE_CAP, LEVERAGE_EXTORT_INFLUENCE } from './v2'

const seoul = (iso: string) => new Date(`${iso}+09:00`).getTime()
const AT = seoul('2026-03-02T10:00:00')

const CLASSMATES = Array.from({ length: 14 }, (_, i) => `p${i}`)

describe('털어놓기', () => {
  it('첫 1:1은 영향력 3에 약점 하나', () => {
    const out = reveal({
      speakerId: 'p0',
      scope: 'private',
      listenerIds: ['p1'],
      alreadyGained: 0,
      atMs: AT,
      existing: [],
    })
    expect(out.influence).toBe(3)
    expect(out.gained).toHaveLength(1)
    expect(out.gained[0]).toMatchObject({ holderId: 'p1', aboutId: 'p0' })
  })

  it('두 번째 1:1은 약점만 는다', () => {
    const out = reveal({
      speakerId: 'p0',
      scope: 'private',
      listenerIds: ['p2'],
      alreadyGained: 3,
      atMs: AT,
      existing: [],
    })
    expect(out.influence).toBe(0)
    expect(out.gained).toHaveLength(1)
  })

  it('전체 털어놓기는 남은 만큼 채운다', () => {
    const fresh = reveal({
      speakerId: 'p0',
      scope: 'class',
      listenerIds: CLASSMATES,
      alreadyGained: 0,
      atMs: AT,
      existing: [],
    })
    expect(fresh.influence).toBe(REVEAL_INFLUENCE_CAP)
    const after = reveal({
      speakerId: 'p0',
      scope: 'class',
      listenerIds: CLASSMATES,
      alreadyGained: 3,
      atMs: AT,
      existing: [],
    })
    expect(after.influence).toBe(3)
  })

  it('전체 털어놓기는 자기를 뺀 열세 명에게 약점을 준다', () => {
    const out = reveal({
      speakerId: 'p0',
      scope: 'class',
      listenerIds: CLASSMATES,
      alreadyGained: 0,
      atMs: AT,
      existing: [],
    })
    expect(out.gained).toHaveLength(13)
    expect(out.gained.some((g) => g.holderId === 'p0')).toBe(false)
  })

  it('이미 쥔 사람은 또 쥐지 않는다 — 한 번에 하나다', () => {
    const existing: Leverage[] = [{ holderId: 'p1', aboutId: 'p0', gainedAtMs: 0, spentAtMs: null }]
    const out = reveal({
      speakerId: 'p0',
      scope: 'class',
      listenerIds: CLASSMATES,
      alreadyGained: 6,
      atMs: AT,
      existing,
    })
    expect(out.gained.some((g) => g.holderId === 'p1')).toBe(false)
    expect(out.gained).toHaveLength(12)
  })

  it('쓰고 난 약점은 다시 쥘 수 있다', () => {
    const existing: Leverage[] = [{ holderId: 'p1', aboutId: 'p0', gainedAtMs: 0, spentAtMs: 5 }]
    const out = reveal({
      speakerId: 'p0',
      scope: 'private',
      listenerIds: ['p1'],
      alreadyGained: 6,
      atMs: AT,
      existing,
    })
    expect(out.gained).toHaveLength(1)
  })

  it('총량을 넘겨도 영향력이 음수가 되지 않는다', () => {
    const out = reveal({
      speakerId: 'p0',
      scope: 'class',
      listenerIds: ['p1'],
      alreadyGained: 99,
      atMs: AT,
      existing: [],
    })
    expect(out.influence).toBe(0)
  })
})

describe('쥐고 있는가', () => {
  const live: Leverage[] = [{ holderId: 'p1', aboutId: 'p0', gainedAtMs: 0, spentAtMs: null }]
  const spent: Leverage[] = [{ holderId: 'p1', aboutId: 'p0', gainedAtMs: 0, spentAtMs: 9 }]

  it('살아 있는 것만 센다', () => {
    expect(holdsOn(live, 'p1', 'p0')).toBe(true)
    expect(holdsOn(spent, 'p1', 'p0')).toBe(false)
  })

  it('없으면 쓸 수 없다', () => {
    expect(canUse([], 'p1', 'p0').reason).toBe('noLeverage')
  })

  it('이미 쓴 것은 다시 못 쓴다', () => {
    expect(canUse(spent, 'p1', 'p0').reason).toBe('alreadySpent')
  })

  it('쓰면 하나만 사라진다', () => {
    const two: Leverage[] = [
      { holderId: 'p1', aboutId: 'p0', gainedAtMs: 0, spentAtMs: null },
      { holderId: 'p1', aboutId: 'p2', gainedAtMs: 0, spentAtMs: null },
    ]
    const after = spend(two, 'p1', 'p0', AT)
    expect(after[0].spentAtMs).toBe(AT)
    expect(after[1].spentAtMs).toBe(null)
  })
})

describe('발 묶기', () => {
  it('여섯 시간이다', () => {
    expect(bindUntilMs(seoul('2026-03-02T10:00:00'))).toBe(seoul('2026-03-02T16:00:00'))
  })

  it('소등은 세지 않는다', () => {
    // 22:00에 묶이면 두 시간 쓰고 다음 날 08:00부터 네 시간 더
    expect(bindUntilMs(seoul('2026-03-02T22:00:00'))).toBe(seoul('2026-03-03T12:00:00'))
  })
})

describe('갈취', () => {
  it('영향력 3을 옮긴다', () => {
    const out = extort(5, 2)
    expect(out).toEqual({ moved: LEVERAGE_EXTORT_INFLUENCE, fromInfluence: 2, toInfluence: 5 })
  })

  it('없는 것은 뜯지 못한다', () => {
    expect(extort(1, 0)).toEqual({ moved: 1, fromInfluence: 0, toInfluence: 1 })
    expect(extort(0, 4)).toEqual({ moved: 0, fromInfluence: 0, toInfluence: 4 })
  })
})
