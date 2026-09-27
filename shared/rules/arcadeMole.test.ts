import { describe, expect, it } from 'vitest'

import { MOLE_HOLES, MOLE_MS, MOLE_PASS, MOLE_POINTS, cleanMoleTaps, moleReplay, moleSchedule, type MoleTap } from './arcadeMole'

describe('두더지 잡기', () => {
  const pops = moleSchedule(11)

  it('씨앗이 같으면 같은 두더지 — 30초 안, 한 구멍에 둘이 겹치지 않는다', () => {
    expect(moleSchedule(11)).toEqual(pops)
    expect(moleSchedule(12)).not.toEqual(pops)
    for (const p of pops) {
      expect(p.t + p.dur).toBeLessThanOrEqual(MOLE_MS)
      expect(p.hole).toBeGreaterThanOrEqual(0)
      expect(p.hole).toBeLessThan(MOLE_HOLES)
    }
    for (let i = 0; i < pops.length; i++)
      for (let j = i + 1; j < pops.length; j++) {
        const [a, b] = [pops[i], pops[j]]
        if (a.hole === b.hole) expect(a.t + a.dur <= b.t || b.t + b.dur <= a.t).toBe(true)
      }
    expect(pops.some((p) => p.kind === 'gold')).toBe(true)
    expect(pops.some((p) => p.kind === 'bomb')).toBe(true)
  })

  it('두더지만 골라 치면 점수가 두더지 값의 합이고 깬다', () => {
    const taps: MoleTap[] = pops.filter((p) => p.kind !== 'bomb').map((p) => ({ t: p.t + 50, hole: p.hole }))
    const r = moleReplay(11, taps)
    const want = pops.filter((p) => p.kind !== 'bomb').reduce((a, p) => a + MOLE_POINTS[p.kind], 0)
    expect(r.score).toBe(want)
    expect(r.bombs).toBe(0)
    expect(r.outcome).toBe(want >= MOLE_PASS ? 'win' : 'lose')
    expect(r.outcome).toBe('win')
  })

  it('폭탄을 치면 깎인다', () => {
    const bomb = pops.find((p) => p.kind === 'bomb')!
    expect(moleReplay(11, [{ t: bomb.t + 10, hole: bomb.hole }]).score).toBe(MOLE_POINTS.bomb)
  })

  it('아홉 구멍을 마구 두드리면 크게 깎여 진다', () => {
    const mash: MoleTap[] = []
    for (let t = 0; t < MOLE_MS; t += 70) for (let h = 0; h < MOLE_HOLES; h++) mash.push({ t, hole: h })
    const r = moleReplay(11, cleanMoleTaps(mash))
    expect(r.score).toBeLessThan(0)
    expect(r.outcome).toBe('lose')
  })
})
