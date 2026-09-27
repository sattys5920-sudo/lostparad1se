// 리듬 스타 — 세 줄로 떨어지는 음표를 판정선에서 누른다.
//
// **점수는 서버가 낸다.** 화면은 서버가 준 씨앗으로 같은 악보를 만들어
// 그리고, 누른 시각과 줄만 적어 보낸다. 서버는 이 파일의 rhythmReplay
// 로 악보를 다시 만들고 그 기록을 처음부터 다시 판정한다. 화면이 보여
// 준 점수와 서버가 낸 점수가 다를 수 없다 — 같은 함수다.
//
// 시각은 전부 **곡이 시작한 순간부터의 ms** 다. 서버 시계와 맞출 필요가
// 없다 — 혼자 치는 곡이고, 판정은 음표와 누른 순간의 간격만 본다.
import { rngFrom } from '../rand'
import type { ArcadeOutcome } from './arcade'

export const RHYTHM_LANES = 3
/** 120 이면 한 박이 500ms 다. 손가락으로 치기에 빠르지도 느리지도 않다. */
export const RHYTHM_BPM = 120
export const BEAT_MS = 60_000 / RHYTHM_BPM
/** 마디 수. 한 마디 네 박이라 열여섯이면 32초다. */
export const RHYTHM_BARS = 16
/** 첫 음표 전에 비워 두는 박. 이 동안 「4 · 3 · 2 · 1」을 센다. */
export const RHYTHM_LEAD_BEATS = 4

/** 이 안쪽이면 PERFECT. */
export const PERFECT_MS = 50
/** 이 안쪽이면 GOOD. 넘으면 그 음표는 놓친 것이다. */
export const GOOD_MS = 110
/**
 * 이 안쪽인데 GOOD 밖이면 **너무 일찍(늦게) 친 것**이다. 그 음표는
 * 놓친 것으로 닫힌다.
 *
 * 이게 없으면 세 줄을 40ms 마다 마구 두드리는 것이 만점이 된다 —
 * 어느 음표든 누름 하나가 20ms 안에 걸리기 때문이다. 이 창이 있으면
 * 마구 두드린 손은 음표가 오기 한참 전에 그 음표를 닫아 버린다.
 */
export const BAD_MS = 200
/** 토막마다 반 박(8분음표)이 끼어드는 몫. 뒤로 갈수록 빽빽하다 */
export const RHYTHM_HALF_BEAT: readonly number[] = [0, 0.3, 0.6, 0.6]
/** 이 퍼센트를 넘기면 깬 것이다(혼자 하는 판의 이김). */
export const RHYTHM_PASS = 70

/** 곡이 끝나는 시각. 마지막 음표 뒤로 한 마디를 둔다. */
export const RHYTHM_END_MS = (RHYTHM_LEAD_BEATS + RHYTHM_BARS * 4 + 4) * BEAT_MS

export interface Note {
  /** 판정선에 닿는 시각(ms). */
  t: number
  lane: number
}

export interface Tap {
  t: number
  lane: number
}

/**
 * 악보. **씨앗이 같으면 늘 같은 악보다.**
 *
 * 네 마디씩 네 토막이고 뒤로 갈수록 빽빽해진다.
 *
 *   1 토막  박마다 하나
 *   2 토막  가끔 반 박(8분음표)이 끼어든다
 *   3 토막  반 박이 자주
 *   4 토막  마디 첫 박에 두 줄을 한꺼번에(화음)
 *
 * 한 줄만 세 번 연달아 나오지 않게 한다 — 한 손가락으로 연타만 하는
 * 곡은 리듬 게임이 아니라 버튼 연타다.
 */
export function rhythmChart(seed: number | string): Note[] {
  const rnd = rngFrom(`rhythm:${seed}`)
  const out: Note[] = []
  let last = -1
  let twice = false
  const pick = (): number => {
    for (;;) {
      const lane = Math.floor(rnd() * RHYTHM_LANES)
      if (lane === last && twice) continue
      twice = lane === last
      last = lane
      return lane
    }
  }
  const at = (beat: number) => (RHYTHM_LEAD_BEATS + beat) * BEAT_MS
  for (let bar = 0; bar < RHYTHM_BARS; bar++) {
    const level = Math.floor(bar / 4)
    for (let b = 0; b < 4; b++) {
      const beat = bar * 4 + b
      if (level === 3 && b === 0) {
        const a = pick()
        const c = (a + 1 + Math.floor(rnd() * (RHYTHM_LANES - 1))) % RHYTHM_LANES
        out.push({ t: at(beat), lane: Math.min(a, c) }, { t: at(beat), lane: Math.max(a, c) })
        // 화음은 두 줄을 한꺼번에 쓴다. **다음 음표는 남은 한 줄로 간다** —
        // 안 그러면 화음의 한 줄이 곧장 두 번 더 와서 세 번 연달아가 된다
        last = Array.from({ length: RHYTHM_LANES }, (_, l) => l).find((l) => l !== a && l !== c) ?? a
        twice = false
        out.push({ t: at(beat + 0.5), lane: last })
        continue
      } else {
        out.push({ t: at(beat), lane: pick() })
      }
      const half = RHYTHM_HALF_BEAT[level] ?? 0
      if (rnd() < half) out.push({ t: at(beat + 0.5), lane: pick() })
    }
  }
  return out
}

export type Mark = 'perfect' | 'good' | 'miss'

/** 판정 중인 판. 화면은 한 번 누를 때마다, 서버는 기록을 처음부터 넣는다. */
export interface RhythmJudge {
  /** 음표마다. 아직 안 지나갔으면 null. */
  marks: (Mark | null)[]
  combo: number
  maxCombo: number
  perfect: number
  good: number
  miss: number
  /** 줄마다 마지막으로 받은 누름. 사람 손으로 못 낼 연타를 거른다. */
  lastTap: number[]
}

export function rhythmStart(chart: readonly Note[]): RhythmJudge {
  return {
    marks: chart.map(() => null),
    combo: 0,
    maxCombo: 0,
    perfect: 0,
    good: 0,
    miss: 0,
    lastTap: Array.from({ length: RHYTHM_LANES }, () => -Infinity),
  }
}

/** 같은 줄을 이보다 빨리 다시 누른 것은 안 친다. 초당 스물다섯 번이다. */
export const TAP_GAP_MS = 40

/**
 * 지나간 음표를 놓친 것으로 적는다. **누름을 넣기 전에 꼭 먼저 부른다**
 * — 그래야 콤보가 시간 순서대로 끊긴다.
 */
export function rhythmSweep(chart: readonly Note[], j: RhythmJudge, now: number): RhythmJudge {
  let next: RhythmJudge | null = null
  for (let i = 0; i < chart.length; i++) {
    if (chart[i].t + GOOD_MS >= now) break
    if (j.marks[i] !== null) continue
    next ??= { ...j, marks: [...j.marks], lastTap: [...j.lastTap] }
    next.marks[i] = 'miss'
    next.miss++
    next.combo = 0
  }
  return next ?? j
}

/**
 * 한 번 누른다. 그 줄에서 **판정 창 안의 제일 이른 음표**를 친다.
 * GOOD 밖 BAD 안이면 그 음표를 놓친 것으로 닫는다(BAD_MS).
 * 어느 창에도 없으면 헛손질이다 — 벌점은 없고 콤보도 안 끊긴다.
 */
export function rhythmTap(
  chart: readonly Note[],
  j0: RhythmJudge,
  tap: Tap,
): { j: RhythmJudge; hit: { i: number; mark: Mark } | null } {
  const j = rhythmSweep(chart, j0, tap.t)
  if (tap.t - j.lastTap[tap.lane] < TAP_GAP_MS) return { j, hit: null }
  const lastTap = [...j.lastTap]
  lastTap[tap.lane] = tap.t
  for (let i = 0; i < chart.length; i++) {
    const n = chart[i]
    if (n.t - BAD_MS > tap.t) break
    if (n.lane !== tap.lane || j.marks[i] !== null) continue
    const off = Math.abs(n.t - tap.t)
    if (off > BAD_MS) continue
    const marks = [...j.marks]
    if (off > GOOD_MS) {
      // 너무 이르다 — 그 음표는 여기서 닫힌다
      marks[i] = 'miss'
      return { j: { ...j, marks, lastTap, combo: 0, miss: j.miss + 1 }, hit: { i, mark: 'miss' } }
    }
    const mark: Mark = off <= PERFECT_MS ? 'perfect' : 'good'
    marks[i] = mark
    const combo = j.combo + 1
    return {
      j: {
        ...j,
        marks,
        lastTap,
        combo,
        maxCombo: Math.max(j.maxCombo, combo),
        perfect: j.perfect + (mark === 'perfect' ? 1 : 0),
        good: j.good + (mark === 'good' ? 1 : 0),
      },
      hit: { i, mark },
    }
  }
  return { j: { ...j, lastTap }, hit: null }
}

export type RhythmGrade = 'S' | 'A' | 'B' | 'C' | 'D'

export interface RhythmResult {
  perfect: number
  good: number
  miss: number
  maxCombo: number
  /** 0~100, 소수 한 자리. PERFECT 는 2, GOOD 는 1 로 쳐서 만점에 견준다. */
  percent: number
  grade: RhythmGrade
  /** 한 줄로 겨룰 때 쓰는 수. */
  score: number
  outcome: ArcadeOutcome
}

export function rhythmResult(chart: readonly Note[], j: RhythmJudge): RhythmResult {
  const full = chart.length * 2
  const percent = full === 0 ? 0 : Math.round(((j.perfect * 2 + j.good) / full) * 1000) / 10
  const grade: RhythmGrade = percent >= 95 ? 'S' : percent >= 85 ? 'A' : percent >= RHYTHM_PASS ? 'B' : percent >= 50 ? 'C' : 'D'
  return {
    perfect: j.perfect,
    good: j.good,
    miss: j.miss,
    maxCombo: j.maxCombo,
    percent,
    grade,
    score: j.perfect * 300 + j.good * 100 + j.maxCombo * 10,
    outcome: percent >= RHYTHM_PASS ? 'win' : 'lose',
  }
}

/** 한 판에 받는 누름의 끝. 음표 수의 세 배면 마구 두드려도 넘지 않는다. */
export const RHYTHM_MAX_TAPS = 600

/**
 * 화면이 보낸 누름 기록을 믿을 수 있는 모양으로 편다. 숫자가 아닌 것,
 * 없는 줄, 곡 밖의 시각은 버리고 시각 순으로 늘어놓는다.
 */
export function cleanTaps(raw: unknown): Tap[] {
  if (!Array.isArray(raw)) return []
  const out: Tap[] = []
  for (const r of raw.slice(0, RHYTHM_MAX_TAPS)) {
    const t = Number((r as { t?: unknown })?.t)
    const lane = Number((r as { lane?: unknown })?.lane)
    if (!Number.isFinite(t) || t < 0 || t > RHYTHM_END_MS) continue
    if (!Number.isInteger(lane) || lane < 0 || lane >= RHYTHM_LANES) continue
    out.push({ t: Math.round(t), lane })
  }
  return out.sort((a, b) => a.t - b.t)
}

/** 악보 하나에 기록 하나를 처음부터 넣는다. */
export function rhythmReplayChart(chart: readonly Note[], taps: readonly Tap[]): RhythmResult {
  let j = rhythmStart(chart)
  for (const tap of taps) j = rhythmTap(chart, j, tap).j
  j = rhythmSweep(chart, j, Infinity)
  return rhythmResult(chart, j)
}

/** 기록 하나로 판 전체를 다시 판정한다. **서버가 점수를 내는 길은 이것뿐이다.** */
export function rhythmReplay(seed: number | string, taps: readonly Tap[]): RhythmResult {
  return rhythmReplayChart(rhythmChart(seed), taps)
}

// ── 둘이서 한 곡 ────────────────────────────────────────────────
//
// 같은 곡을 **두 마디씩 번갈아** 친다. 한 사람이 치는 동안 다른 사람은
// 쉬며 제 차례를 기다린다 — 주고받는 합주다. 둘의 판정을 합쳐 곡 하나로
// 매긴다. 한 사람만 잘해서는 못 깬다.

/** 몇 마디씩 번갈아 치는가. */
export const DUET_BARS = 2

/** 그 음표가 몇 번째 사람의 것인가. */
export function duetOwner(n: Note, players: number): number {
  const bar = Math.floor((n.t / BEAT_MS - RHYTHM_LEAD_BEATS) / 4)
  return Math.floor(bar / DUET_BARS) % players
}

/** 그 사람이 칠 음표만. */
export const duetPart = (chart: readonly Note[], who: number, players: number): Note[] =>
  chart.filter((n) => duetOwner(n, players) === who)

/** 판정을 점수로 합칠 때 쓰는 수. PERFECT 2, GOOD 1, 만점은 음표 수의 두 배. */
export const rhythmPts = (r: Pick<RhythmResult, 'perfect' | 'good'>): number => r.perfect * 2 + r.good

/** 둘의 점수를 합쳐 곡 하나로. */
export function duetPercent(parts: readonly { pts: number; max: number }[]): number {
  const max = parts.reduce((a, p) => a + p.max, 0)
  const pts = parts.reduce((a, p) => a + p.pts, 0)
  return max === 0 ? 0 : Math.round((pts / max) * 1000) / 10
}
