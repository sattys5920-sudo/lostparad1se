import { describe, expect, it } from 'vitest'

import { NUNCHI_LIMIT_MS, NUNCHI_SAME_MS, nunchiCall, nunchiNew, nunchiResult, type NunchiState } from './arcadeNunchi'

const ids = ['a', 'b', 'c']
function call(s: NunchiState, id: string, t: number): NunchiState {
  const r = nunchiCall(s, id, t, 0, ids.length)
  if (!r.ok) throw new Error(r.why)
  return r.s
}

describe('눈치 게임', () => {
  it('셋이면 2 까지 — 못 외친 한 사람이 진다(겹침 창이 지나야 닫힌다)', () => {
    let s = call(nunchiNew(), 'a', 1000)
    s = call(s, 'b', 2000)
    expect(s.calls.map((c) => c.n)).toEqual([1, 2])
    expect(nunchiResult(s, 2000 + NUNCHI_SAME_MS - 1, 0, ids)).toBe(null)
    expect(nunchiResult(s, 2000 + NUNCHI_SAME_MS, 0, ids)).toEqual({ a: 'win', b: 'win', c: 'lose' })
  })

  it('둘이 한꺼번에 외치면 둘 다 진다', () => {
    let s = call(nunchiNew(), 'a', 1000)
    s = call(s, 'b', 1000 + NUNCHI_SAME_MS - 1)
    expect(nunchiResult(s, 1700, 0, ids)).toEqual({ a: 'lose', b: 'lose', c: 'win' })
  })

  it('마지막 숫자 직후 남은 사람이 겹쳐 외쳐도 겹친 것이다', () => {
    let s = call(nunchiNew(), 'a', 1000)
    s = call(s, 'b', 3000)
    s = call(s, 'c', 3000 + NUNCHI_SAME_MS - 10)
    expect(nunchiResult(s, 5000, 0, ids)).toEqual({ a: 'win', b: 'lose', c: 'lose' })
  })

  it('시작 전·두 번·끝난 뒤는 안 받는다', () => {
    expect(nunchiCall(nunchiNew(), 'a', -1, 0, 3)).toEqual({ ok: false, why: 'early' })
    const s = call(nunchiNew(), 'a', 1000)
    expect(nunchiCall(s, 'a', 3000, 0, 3)).toEqual({ ok: false, why: 'twice' })
    expect(nunchiCall(nunchiNew(), 'a', NUNCHI_LIMIT_MS, 0, 3)).toEqual({ ok: false, why: 'over' })
  })

  it('시간이 다 되면 못 외친 사람은 다 진다', () => {
    const s = call(nunchiNew(), 'a', 1000)
    expect(nunchiResult(s, NUNCHI_LIMIT_MS, 0, ids)).toEqual({ a: 'win', b: 'lose', c: 'lose' })
  })
})
