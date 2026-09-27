import { describe, expect, it } from 'vitest'

import {
  BEAT_MAX_MS,
  BEAT_PADS,
  GOOD_MS,
  RELAY_GOAL,
  RELAY_LIVES,
  RELAY_START_NOTES,
  ROUND_GAP_MS,
  SOLO_EASY_NOTES,
  SOLO_LIVES,
  SOLO_PASS_ROUNDS,
  judgeRound,
  relayClose,
  relayJudge,
  relayLeave,
  relayNew,
  relayOutcome,
  relayOver,
  relayTimes,
  relayWho,
  soloNotes,
  soloReplay,
  soloRun,
  type BeatTap,
} from './arcadeBeat'

/** 판마다 들은 그대로 딱 맞게 치는 손. rounds 판까지만 치고 손을 뗀다 */
function perfectSolo(seed: number, rounds: number): BeatTap[] {
  const taps: BeatTap[] = []
  let now = 0
  for (let i = 0; i < rounds; i++) {
    const run = soloRun(seed, taps, now)
    const r = run.current
    if (!r) break
    for (const n of r.notes) taps.push({ t: Math.round(r.answerZero + n.step * r.e), pad: n.pad })
    now = r.closeAt + ROUND_GAP_MS
  }
  return taps
}

describe('리듬 쌓기 — 리듬', () => {
  it('씨앗이 같으면 같은 리듬이고, 판마다 뒤로 한 박씩 붙는다(앞은 그대로)', () => {
    expect(soloNotes(3, 8)).toEqual(soloNotes(3, 8))
    expect(soloNotes(3, 8).slice(0, 5)).toEqual(soloNotes(3, 5))
    expect(soloNotes(3, 8)).not.toEqual(soloNotes(4, 8))
  })

  it('처음 몇 박은 4분음표 간격이다 — 처음 하는 사람도 따라 친다', () => {
    const n = soloNotes(9, SOLO_EASY_NOTES)
    for (let i = 1; i < n.length; i++) expect(n[i].step - n[i - 1].step).toBe(2)
  })

  it('한 패드가 세 번 내리 오지 않는다', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const n = soloNotes(seed, 30)
      for (let i = 2; i < n.length; i++) expect(n[i].pad === n[i - 1].pad && n[i].pad === n[i - 2].pad).toBe(false)
    }
  })
})

describe('한 판 판정', () => {
  const notes = [{ step: 0, pad: 0 }, { step: 2, pad: 1 }, { step: 4, pad: 2 }]
  const e = 300
  const exact = notes.map((n) => ({ t: 1000 + n.step * e, pad: n.pad }))

  it('박자와 패드가 다 맞으면 깬다', () => {
    const j = judgeRound(notes, 1000, e, exact, 0, 99_999)
    expect(j.ok).toBe(true)
    expect(j.perfect).toBe(3)
  })

  it('패드가 틀리면, 헛치면, 늦으면 못 깬다', () => {
    expect(judgeRound(notes, 1000, e, [...exact.slice(0, 2), { t: 1600, pad: 3 }], 0, 99_999).ok).toBe(false)
    expect(judgeRound(notes, 1000, e, [...exact, { t: 1300, pad: 0 }], 0, 99_999).ok).toBe(false)
    expect(judgeRound(notes, 1000, e, exact.map((x, i) => (i === 1 ? { ...x, t: x.t + GOOD_MS + 1 } : x)), 0, 99_999).ok).toBe(false)
  })

  it('판정 창 밖(듣는 동안 따라 두드린 것)은 안 친다', () => {
    expect(judgeRound(notes, 1000, e, [{ t: 100, pad: 3 }, ...exact], 500, 99_999).ok).toBe(true)
  })
})

describe('리듬 쌓기 — 한 판 전체', () => {
  it('딱 맞게 치면 판마다 한 박씩 늘고 빨라진다 — 깬 판 수만큼 가서 CLEAR', () => {
    const taps = perfectSolo(7, SOLO_PASS_ROUNDS + 2)
    const run = soloRun(7, taps)
    expect(run.cleared).toBe(SOLO_PASS_ROUNDS + 2)
    const ok = run.rounds.filter((r) => r.judge?.ok)
    for (let i = 1; i < ok.length; i++) {
      expect(ok[i].notes.length).toBe(ok[i - 1].notes.length + 1)
      expect(ok[i].bpm).toBeGreaterThan(ok[i - 1].bpm)
    }
    // 손을 뗀 뒤 목숨 셋을 다 쓰고 끝난다
    expect(run.over).toBe(true)
    expect(run.rounds.length).toBe(SOLO_PASS_ROUNDS + 2 + SOLO_LIVES)
    const r = soloReplay(7, taps)
    expect(r.outcome).toBe('win')
    expect(r.cleared).toBe(SOLO_PASS_ROUNDS + 2)
  })

  it('안 치면 세 판 만에 끝나고 진다', () => {
    const r = soloReplay(7, [])
    expect(r.cleared).toBe(0)
    expect(r.outcome).toBe('lose')
    expect(soloRun(7, []).rounds.length).toBe(SOLO_LIVES)
  })

  it('네 패드를 마구 두드리면 한 판도 못 깬다', () => {
    const mash: BeatTap[] = []
    for (let t = 0; t < 60_000; t += 40) for (let p = 0; p < BEAT_PADS; p++) mash.push({ t, pad: p })
    expect(soloReplay(7, mash).cleared).toBe(0)
  })

  it('끝없이 잘 쳐도 5분에서 끊는다', () => {
    const taps = perfectSolo(7, 200)
    const run = soloRun(7, taps)
    expect(run.over).toBe(true)
    expect(run.endMs).toBeLessThanOrEqual(BEAT_MAX_MS)
    expect(run.rounds.every((r) => r.closeAt <= BEAT_MAX_MS)).toBe(true)
  })
})

describe('둘이서 한 곡', () => {
  const start = 10_000
  /** 곡을 딱 맞게 따라 치고 step 칸 뒤에 pad 를 보태는 손 */
  function play(s: ReturnType<typeof relayNew>, addAfter = 2, pad = 3): BeatTap[] {
    const tm = relayTimes(s)
    const last = s.notes.at(-1)!.step
    return [...s.notes.map((n) => ({ t: tm.answerZero + n.step * tm.e, pad: n.pad })), { t: tm.answerZero + (last + addAfter) * tm.e + 20, pad }]
  }

  it('곡은 두 박으로 시작한다. 따라 치고 보태면 한 박이 붙고 다음 사람 차례다', () => {
    let s = relayNew(5, ['a', 'b'], start)
    expect(s.notes).toHaveLength(RELAY_START_NOTES)
    expect(relayWho(s)).toBe('a')
    const j = relayJudge(s, play(s))
    expect(j.ok).toBe(true)
    expect(j.added).toEqual({ step: s.notes.at(-1)!.step + 2, pad: 3 })
    s = relayClose(s, 'a', play(s), 20_000)
    expect(s.notes).toHaveLength(RELAY_START_NOTES + 1)
    expect(relayWho(s)).toBe('b')
    expect(s.lives).toBe(RELAY_LIVES)
  })

  it('보태지 않으면 못 깬다 — 곡은 그대로, 목숨 하나', () => {
    const s = relayNew(5, ['a', 'b'], start)
    const onlyCopy = play(s).slice(0, -1)
    expect(relayJudge(s, onlyCopy).ok).toBe(false)
    const t = relayClose(s, 'a', onlyCopy, 20_000)
    expect(t.notes).toEqual(s.notes)
    expect(t.lives).toBe(RELAY_LIVES - 1)
  })

  it('안 쳤으면(마감) 틀린 것이다. 목숨이 다하면 끝', () => {
    let s = relayNew(5, ['a', 'b'], start)
    for (let i = 0; i < RELAY_LIVES; i++) s = relayClose(s, relayWho(s)!, null, 20_000 + i * 10_000)
    expect(relayOver(s, start)).toBe(true)
    expect(relayOutcome(s)).toBe('lose')
  })

  it('목표 길이를 넘기면 다 같이 깬다', () => {
    let s = relayNew(5, ['a', 'b'], start)
    let now = start
    while (s.notes.length < RELAY_GOAL) {
      const taps = play(s)
      now = relayTimes(s).closeAt
      s = relayClose(s, relayWho(s)!, taps, now)
    }
    expect(relayOutcome(s)).toBe('win')
  })

  it('차례인 사람이 나가면 다음 사람에게 넘어가고 빠르기는 그대로다', () => {
    let s = relayNew(5, ['a', 'b', 'c'], start)
    s = relayClose(s, 'a', play(s), 20_000) // b 차례
    const turn = s.turn
    s = relayLeave(s, 'b', 30_000)
    expect(relayWho(s)).toBe('c')
    expect(s.turn).toBe(turn)
    expect(relayWho(relayLeave(relayNew(5, ['a', 'b', 'c'], 0), 'c', 0))).toBe('a')
  })
})
