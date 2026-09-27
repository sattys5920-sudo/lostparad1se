import { describe, expect, it } from 'vitest'

import {
  BAD_MS,
  GOOD_MS,
  PERFECT_MS,
  RHYTHM_END_MS,
  RHYTHM_LANES,
  cleanTaps,
  rhythmChart,
  rhythmReplay,
  rhythmStart,
  rhythmSweep,
  rhythmTap,
  type Tap,
} from './arcadeRhythm'

describe('악보', () => {
  it('씨앗이 같으면 같은 악보, 다르면 다른 악보', () => {
    expect(rhythmChart(7)).toEqual(rhythmChart(7))
    expect(rhythmChart(7)).not.toEqual(rhythmChart(8))
  })

  it('시각 순서대로이고, 줄은 셋 안이고, 곡 안에 든다', () => {
    const c = rhythmChart(123)
    for (let i = 1; i < c.length; i++) expect(c[i].t).toBeGreaterThanOrEqual(c[i - 1].t)
    for (const n of c) {
      expect(n.lane).toBeGreaterThanOrEqual(0)
      expect(n.lane).toBeLessThan(RHYTHM_LANES)
      expect(n.t).toBeLessThan(RHYTHM_END_MS)
    }
    expect(c.length).toBeGreaterThan(60)
  })

  it('한 줄만 세 번 내리 오지 않는다(시각이 다른 음표끼리)', () => {
    for (const seed of [1, 2, 3, 4, 5, 99, 1234]) {
      const c = rhythmChart(seed).filter((n, i, a) => a.filter((m) => m.t === n.t).length === 1 || i === a.findIndex((m) => m.t === n.t))
      for (let i = 2; i < c.length; i++) {
        const same = c[i].lane === c[i - 1].lane && c[i].lane === c[i - 2].lane
        expect(same, `씨앗 ${seed} ${i}`).toBe(false)
      }
    }
  })

  it('뒤로 갈수록 빽빽하다 — 마지막 네 마디가 첫 네 마디보다 많다', () => {
    const c = rhythmChart(42)
    const bar = 4 * 500
    const first = c.filter((n) => n.t < 2000 + bar * 4).length
    const last = c.filter((n) => n.t >= 2000 + bar * 12).length
    expect(last).toBeGreaterThan(first)
  })
})

describe('판정', () => {
  const chart = rhythmChart(5)
  const exact: Tap[] = chart.map((n) => ({ t: n.t, lane: n.lane }))

  it('음표마다 딱 맞춰 치면 만점 S, 콤보가 음표 수다', () => {
    const r = rhythmReplay(5, exact)
    expect(r.percent).toBe(100)
    expect(r.grade).toBe('S')
    expect(r.maxCombo).toBe(chart.length)
    expect(r.outcome).toBe('win')
  })

  it('다 GOOD 이면 50% — 깨지 못한다', () => {
    const r = rhythmReplay(5, exact.map((t) => ({ ...t, t: t.t + (PERFECT_MS + GOOD_MS) / 2 })))
    expect(r.good).toBe(chart.length)
    expect(r.percent).toBe(50)
    expect(r.outcome).toBe('lose')
  })

  it('안 치면 다 놓친다', () => {
    const r = rhythmReplay(5, [])
    expect(r.miss).toBe(chart.length)
    expect(r.percent).toBe(0)
    expect(r.grade).toBe('D')
  })

  /*
   * **마구 두드리기는 안 통한다.** 세 줄을 40ms 마다 두드리면 어느
   * 음표든 20ms 안에 누름이 있다. BAD 창이 없으면 이것이 만점이다.
   */
  it('세 줄을 40ms 마다 두드리면 거의 다 놓친다', () => {
    const mash: Tap[] = []
    for (let t = 0; t < RHYTHM_END_MS; t += 40) for (let lane = 0; lane < RHYTHM_LANES; lane++) mash.push({ t, lane })
    const r = rhythmReplay(5, mash)
    expect(r.percent).toBeLessThan(20)
    expect(r.outcome).toBe('lose')
  })

  it('너무 일찍 친 누름은 그 음표를 닫는다 — 제때 다시 쳐도 안 된다', () => {
    const n = chart[0]
    let j = rhythmStart(chart)
    j = rhythmTap(chart, j, { t: n.t - (GOOD_MS + BAD_MS) / 2, lane: n.lane }).j
    const again = rhythmTap(chart, j, { t: n.t, lane: n.lane })
    expect(again.j.marks[0]).toBe('miss')
    expect(again.hit?.i === 0).toBe(false)
  })

  it('판정 창 밖의 헛손질은 벌이 없다', () => {
    const n = chart[0]
    let j = rhythmStart(chart)
    j = rhythmTap(chart, j, { t: n.t - BAD_MS - 300, lane: n.lane }).j
    j = rhythmTap(chart, j, { t: n.t, lane: n.lane }).j
    expect(j.marks[0]).toBe('perfect')
  })

  it('화면이 한 번씩 넣은 것과 서버가 기록으로 다시 돌린 것이 같다', () => {
    const taps = exact.filter((_, i) => i % 3 !== 0).map((t, i) => ({ ...t, t: t.t + ((i * 37) % 90) - 45 }))
    let j = rhythmStart(chart)
    for (const tap of taps) j = rhythmTap(chart, j, tap).j
    j = rhythmSweep(chart, j, Infinity)
    const live = { perfect: j.perfect, good: j.good, miss: j.miss, maxCombo: j.maxCombo }
    const r = rhythmReplay(5, taps)
    expect({ perfect: r.perfect, good: r.good, miss: r.miss, maxCombo: r.maxCombo }).toEqual(live)
  })
})

describe('기록 받기', () => {
  it('숫자 아닌 것, 없는 줄, 곡 밖 시각은 버리고 시각 순으로 편다', () => {
    const t = cleanTaps([{ t: 900, lane: 1 }, { t: 'x', lane: 0 }, { t: 100, lane: 5 }, { t: -1, lane: 0 }, { t: RHYTHM_END_MS + 1, lane: 0 }, { t: 300, lane: 2 }, null])
    expect(t).toEqual([{ t: 300, lane: 2 }, { t: 900, lane: 1 }])
    expect(cleanTaps('nope')).toEqual([])
  })
})

describe('둘이서 한 곡', () => {
  it('음표마다 주인이 딱 하나 — 둘 다 칠 것이 있고 합치면 곡 전체다', async () => {
    const { duetOwner, duetPart, duetPercent } = await import('./arcadeRhythm')
    const chart = rhythmChart(8)
    const a = duetPart(chart, 0, 2)
    const b = duetPart(chart, 1, 2)
    expect(a.length).toBeGreaterThan(10)
    expect(b.length).toBeGreaterThan(10)
    expect(a.length + b.length).toBe(chart.length)
    for (const n of chart) expect([0, 1]).toContain(duetOwner(n, 2))
    expect(duetPercent([{ pts: a.length * 2, max: a.length * 2 }, { pts: 0, max: b.length * 2 }])).toBeLessThan(70)
  })
})
