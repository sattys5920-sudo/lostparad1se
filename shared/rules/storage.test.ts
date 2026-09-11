// 다섯 시의 창고.
import { describe, expect, it } from 'vitest'
import { canLeave, isLocked, lockAtMs, lockedIn, LOCKED_TILE, unlockAtMs } from './storage'
import { STORAGE_LOCK_HOUR, STORAGE_UNLOCK_HOUR } from './v2'

const seoul = (iso: string) => new Date(`${iso}+09:00`).getTime()
const START = seoul('2026-03-02T08:00:00')
/** DAY n의 어느 시각. 판은 3월 2일 08:00에 시작한다. */
const on = (day: number, hhmm: string) => seoul(`2026-03-0${1 + day}T${hhmm}:00`)

describe('잠기는 시각', () => {
  it('17:00에 잠기고 19:00에 열린다', () => {
    expect(STORAGE_LOCK_HOUR).toBe(17)
    expect(STORAGE_UNLOCK_HOUR).toBe(19)
    expect(lockAtMs(on(5, '10:00'))).toBe(on(5, '17:00'))
    expect(unlockAtMs(on(5, '10:00'))).toBe(on(5, '19:00'))
  })

  it('DAY 5에만 잠긴다', () => {
    expect(isLocked(START, on(5, '17:00'))).toBe(true)
    expect(isLocked(START, on(4, '17:00'))).toBe(false)
    expect(isLocked(START, on(1, '17:00'))).toBe(false)
  })

  it('두 시간 동안이다', () => {
    expect(isLocked(START, on(5, '16:59'))).toBe(false)
    expect(isLocked(START, on(5, '17:00'))).toBe(true)
    expect(isLocked(START, on(5, '18:59'))).toBe(true)
    expect(isLocked(START, on(5, '19:00'))).toBe(false)
  })
})

describe('갇히는 사람', () => {
  it('17:00 정각에 창고에 서 있던 사람만', () => {
    expect(lockedIn(LOCKED_TILE, true)).toBe(true)
    expect(lockedIn('library', true)).toBe(false)
  })

  it('걷는 중이었으면 갇히지 않는다', () => {
    expect(lockedIn(null, true)).toBe(false)
  })

  it('그 순간이 아니면 갇히지 않는다', () => {
    expect(lockedIn(LOCKED_TILE, false)).toBe(false)
  })
})

describe('나갈 수 있는가', () => {
  it('갇혔으면 19:00까지 못 나간다', () => {
    const out = canLeave(LOCKED_TILE, START, on(5, '18:00'), true)
    expect(out.ok).toBe(false)
    expect(out.reason).toBe('lockedInStorage')
  })

  it('19:00이 되면 나간다', () => {
    expect(canLeave(LOCKED_TILE, START, on(5, '19:00'), true).ok).toBe(true)
  })

  it('갇히지 않았으면 언제든 나간다', () => {
    expect(canLeave(LOCKED_TILE, START, on(5, '18:00'), false).ok).toBe(true)
  })
})
