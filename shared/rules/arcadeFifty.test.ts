import { describe, expect, it } from 'vitest'

import {
  FIFTY_CELLS,
  FIFTY_LAST,
  FIFTY_LIMIT_MS,
  FIFTY_LOCK_MS,
  cleanFiftyTaps,
  fiftyBoard,
  fiftyReplay,
  fiftyStart,
  fiftyTap,
  type FiftyTap,
} from './arcadeFifty'

/** 차례대로 정확히 누르는 손. gap ms 마다 */
function perfectRun(seed: number, gap: number): FiftyTap[] {
  const b = fiftyBoard(seed)
  let s = fiftyStart(b)
  const taps: FiftyTap[] = []
  for (let n = 1; n <= FIFTY_LAST; n++) {
    const cell = s.cells.indexOf(n)
    const tap = { t: n * gap, cell }
    taps.push(tap)
    s = fiftyTap(b, s, tap).s
  }
  return taps
}

describe('1 to 50', () => {
  it('앞면은 1~25, 뒷면은 26~50 — 씨앗이 같으면 같은 판', () => {
    const b = fiftyBoard(4)
    expect([...b.front].sort((x, y) => x - y)).toEqual(Array.from({ length: FIFTY_CELLS }, (_, i) => i + 1))
    expect([...b.back].sort((x, y) => x - y)).toEqual(Array.from({ length: FIFTY_CELLS }, (_, i) => i + 26))
    expect(fiftyBoard(4)).toEqual(b)
    expect(fiftyBoard(5)).not.toEqual(b)
  })

  it('차례대로 누르면 50 에서 끝나고, 빨리 끝내면 깬다', () => {
    const r = fiftyReplay(4, perfectRun(4, 500))
    expect(r.doneMs).toBe(50 * 500)
    expect(r.reached).toBe(FIFTY_LAST)
    expect(r.outcome).toBe('win')
    const slow = fiftyReplay(4, perfectRun(4, 1500))
    expect(slow.outcome).toBe('lose')
    // 빨리 끝낸 쪽이 더 높다. 끝낸 쪽이 못 끝낸 쪽보다 늘 높다
    expect(r.score).toBeGreaterThan(slow.score)
    expect(slow.score).toBeGreaterThan(fiftyReplay(4, perfectRun(4, 500).slice(0, 49)).score)
  })

  it('틀리게 누르면 잠깐 손이 묶인다 — 그 사이 맞게 눌러도 안 친다', () => {
    const b = fiftyBoard(4)
    let s = fiftyStart(b)
    const wrong = s.cells.indexOf(2)
    const right = s.cells.indexOf(1)
    s = fiftyTap(b, s, { t: 1000, cell: wrong }).s
    expect(fiftyTap(b, s, { t: 1000 + FIFTY_LOCK_MS - 1, cell: right }).hit).toBe(null)
    expect(fiftyTap(b, s, { t: 1000 + FIFTY_LOCK_MS, cell: right }).hit).toBe(true)
  })

  it('스물다섯 칸을 마구 훑으면 시간 안에 못 끝낸다', () => {
    const mash: FiftyTap[] = []
    for (let t = 0; t < FIFTY_LIMIT_MS; t += 15) mash.push({ t, cell: (t / 15) % FIFTY_CELLS })
    const r = fiftyReplay(4, mash)
    expect(r.doneMs).toBe(null)
    expect(r.outcome).toBe('lose')
  })

  it('누른 기록 받기 — 칸 밖·시간 밖은 버리고 시각 순으로', () => {
    expect(cleanFiftyTaps([{ t: 50, cell: 3 }, { t: 10, cell: 30 }, { t: -1, cell: 1 }, { t: 20, cell: 0 }])).toEqual([
      { t: 20, cell: 0 },
      { t: 50, cell: 3 },
    ])
  })
})
