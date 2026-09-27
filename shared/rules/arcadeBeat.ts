// 리듬 쌓기 — 들은 리듬을 따라 치고, 판마다 한 박씩 쌓아 간다.
//
// 패드 넷(쿵·짝·칙·딱)으로 된 드럼이다. 한 판은 이렇게 흐른다.
//
//   듣기    한 마디 셈(8분음표 여덟) 뒤 리듬이 울린다. 패드가 불로 보여 준다
//   따라 치기  다시 한 마디 셈 뒤, 들은 그대로 친다. 박자와 패드가 다 맞아야 한다
//
// **쉽게 시작해 어려워진다.** 처음 리듬은 세 박, 느리게(90 BPM), 4분음표
// 간격이다. 한 판 깰 때마다 한 박이 붙고 빨라지며, 8분·점4분 간격이
// 섞인다. 기억과 손이 버티는 데까지 간다 — 5분을 넘기기는 어렵다.
//
// 1인(리듬 쌓기)은 기계가 박을 붙이고, 2인(둘이서 한 곡)은 **사람이
// 번갈아 제 박을 하나씩 보태며 곡을 만든다.** 따라 치는 판정은 같다.
//
// 점수는 서버가 낸다. 화면은 누른 시각과 패드만 적어 보낸다 — 서버는 이
// 파일의 같은 함수로 판을 처음부터 다시 흘려 판정한다.
import { rngFrom } from '../rand'
import { ARCADE_MAX_MS, type ArcadeOutcome } from './arcade'

export const BEAT_PADS = 4
export const PAD_NAME = ['쿵', '짝', '칙', '딱'] as const

/** 셈. 한 마디(8분음표 여덟)를 세고 들어간다. */
export const COUNT_IN = 8
/** 8분음표 하나의 길이. */
export const eighthMs = (bpm: number): number => 30_000 / bpm

/** 이 안쪽이면 PERFECT. */
export const PERFECT_MS = 70
/** 이 안쪽이면 맞은 것이다. 넘으면 그 박은 놓친 것이다. */
export const GOOD_MS = 140
/** 마지막 박 뒤로 판정을 닫기까지 남겨 두는 8분음표 수. */
export const TAIL = 2
/** 한 판이 끝나고 다음 판 셈까지. 좋다·틀렸다를 보여 주는 시간 */
export const ROUND_GAP_MS = 900

/** 모든 판은 여기서 끊는다(오락실 공통 5분). */
export const BEAT_MAX_MS = ARCADE_MAX_MS

export interface BeatNote {
  /** 판의 0 박에서 몇 번째 8분음표인가. */
  step: number
  pad: number
}

export interface BeatTap {
  /** 판 시작(서버가 정한 시각)부터 ms. */
  t: number
  pad: number
}

export interface RoundJudge {
  /** 다 맞고 헛친 것이 없으면 깬 것이다. */
  ok: boolean
  perfect: number
  good: number
  miss: number
  /** 틀린 패드·헛친 박. 하나라도 있으면 못 깬다. */
  wrong: number
  /** 음표마다 맞췄나. 화면이 점을 채운다. */
  hit: boolean[]
}

/**
 * 한 판 판정. zero 는 0 박의 시각, 누름은 [from, to) 안의 것만 본다.
 * **엄격하다** — 박자가 맞아도 패드가 틀리면 틀린 것, 음표 없는 데
 * 친 것도 틀린 것이다. 대신 목숨이 있다.
 */
export function judgeRound(notes: readonly BeatNote[], zero: number, e: number, taps: readonly BeatTap[], from: number, to: number): RoundJudge {
  const hit = notes.map(() => false)
  let perfect = 0
  let good = 0
  let wrong = 0
  for (const tap of taps) {
    if (tap.t < from || tap.t >= to) continue
    let best = -1
    let off = Infinity
    notes.forEach((n, i) => {
      if (hit[i]) return
      const d = Math.abs(zero + n.step * e - tap.t)
      if (d <= GOOD_MS && d < off) {
        best = i
        off = d
      }
    })
    if (best < 0 || notes[best].pad !== tap.pad) {
      wrong++
      continue
    }
    hit[best] = true
    if (off <= PERFECT_MS) perfect++
    else good++
  }
  const miss = hit.filter((h) => !h).length
  return { ok: miss === 0 && wrong === 0, perfect, good, miss, wrong, hit }
}

/** 한 판의 때. 듣기 셈 → 듣기 → 따라 치기 셈 → 따라 치기 → 닫기. */
export interface RoundTimes {
  bpm: number
  e: number
  /** 듣기 셈이 시작되는 때. */
  listenAt: number
  /** 듣기의 0 박. */
  listenZero: number
  /** 따라 치기 셈이 시작되는 때. */
  answerAt: number
  /** 따라 치기의 0 박. */
  answerZero: number
  /** 따라 치기 판정을 받기 시작하는 때(첫 박 한 칸 앞). */
  from: number
  /** 판정을 닫는 때. */
  closeAt: number
}

export function roundTimes(notes: readonly BeatNote[], bpm: number, at: number, extraEighths = 0): RoundTimes {
  const e = eighthMs(bpm)
  const last = notes.length > 0 ? notes[notes.length - 1].step : 0
  const listenZero = at + COUNT_IN * e
  const answerAt = listenZero + (last + TAIL) * e
  const answerZero = answerAt + COUNT_IN * e
  return {
    bpm,
    e,
    listenAt: at,
    listenZero,
    answerAt,
    answerZero,
    from: answerZero - e,
    closeAt: answerZero + (last + TAIL + extraEighths) * e,
  }
}

// ── 1인: 리듬 쌓기 ──────────────────────────────────────────────

export const SOLO_START_NOTES = 3
export const SOLO_BPM_START = 90
/** 한 판 깰 때마다 이만큼 빨라진다. */
export const SOLO_BPM_STEP = 5
export const SOLO_BPM_MAX = 190
export const SOLO_LIVES = 3
/** 이만큼 깨면 CLEAR. 열 박짜리 리듬을 따라 치는 판이다. */
export const SOLO_PASS_ROUNDS = 8
/** 한 판에 받는 누름의 끝. */
export const BEAT_MAX_TAPS = 3000

export const soloBpm = (cleared: number): number => Math.min(SOLO_BPM_MAX, SOLO_BPM_START + cleared * SOLO_BPM_STEP)

/**
 * 기계가 쌓을 리듬. **씨앗이 같으면 같은 리듬이다.** 앞의 n 박은 늘
 * 같고, 판마다 뒤로 한 박씩 더 쓴다.
 *
 * 처음 네 박은 4분음표 간격(두 칸)이다 — 처음 하는 사람도 따라 친다.
 * 그 뒤로 8분(한 칸)·점4분(세 칸)이 섞인다. 한 패드가 세 번 내리 오지
 * 않는다.
 */
/** 처음 이만큼은 4분음표 간격(두 칸)만 쓴다. */
export const SOLO_EASY_NOTES = 4
/** 그 뒤의 간격(8분음표 칸)과 몫. 한 칸이 8분, 두 칸이 4분, 세 칸이 점4분이다 */
export const SOLO_GAPS: readonly { eighths: number; share: number }[] = [
  { eighths: 1, share: 0.4 },
  { eighths: 2, share: 0.45 },
  { eighths: 3, share: 0.15 },
]
const EASY_GAP = 2

function pickGap(r: number): number {
  let acc = 0
  for (const g of SOLO_GAPS) {
    acc += g.share
    if (r < acc) return g.eighths
  }
  return SOLO_GAPS[SOLO_GAPS.length - 1].eighths
}

export function soloNotes(seed: number | string, n: number): BeatNote[] {
  const rnd = rngFrom(`beat:${seed}`)
  const out: BeatNote[] = []
  let step = 0
  for (let i = 0; i < n; i++) {
    const r = rnd()
    const gap = i === 0 ? 0 : i < SOLO_EASY_NOTES ? EASY_GAP : pickGap(r)
    step += gap
    let pad = Math.floor(rnd() * BEAT_PADS)
    const [a, b] = [out.at(-1)?.pad, out.at(-2)?.pad]
    if (a === pad && b === pad) pad = (pad + 1 + Math.floor(rnd() * (BEAT_PADS - 1))) % BEAT_PADS
    out.push({ step, pad })
  }
  return out
}

export interface SoloRound extends RoundTimes {
  /** 몇 번째로 여는 판(0 부터, 다시 하는 판도 센다). */
  index: number
  /** 이 판에서 따라 칠 리듬. */
  notes: BeatNote[]
  judge: RoundJudge | null
}

export interface SoloRun {
  rounds: SoloRound[]
  cleared: number
  lives: number
  /** 끝났나(목숨이 다했거나 5분). */
  over: boolean
  /** 끝나는 때. 안 끝났으면 null. */
  endMs: number | null
  /** 지금 흐르는 판. 끝났으면 null. */
  current: SoloRound | null
}

/**
 * 판 전체를 흘린다. now 까지 닫힌 판은 판정하고, 지금 판을 돌려준다.
 * **화면은 매 프레임 이것을 부르고, 서버는 now=끝으로 한 번 부른다** —
 * 같은 함수라 판정이 어긋날 수 없다.
 */
export function soloRun(seed: number | string, taps: readonly BeatTap[], now: number = Infinity): SoloRun {
  const rounds: SoloRound[] = []
  let cleared = 0
  let lives = SOLO_LIVES
  let at = 0
  for (let index = 0; ; index++) {
    const notes = soloNotes(seed, SOLO_START_NOTES + cleared)
    const times = roundTimes(notes, soloBpm(cleared), at)
    // 5분 안에 못 닫는 판은 안 연다. 끝은 앞 판이 닫힌 때다
    if (times.closeAt > BEAT_MAX_MS) return { rounds, cleared, lives, over: true, endMs: rounds.at(-1)?.closeAt ?? 0, current: null }
    const round: SoloRound = { ...times, index, notes, judge: null }
    rounds.push(round)
    if (now < times.closeAt) return { rounds, cleared, lives, over: false, endMs: null, current: round }
    round.judge = judgeRound(notes, times.answerZero, times.e, taps, times.from, times.closeAt)
    if (round.judge.ok) cleared++
    else lives--
    at = times.closeAt + ROUND_GAP_MS
    if (lives <= 0) return { rounds, cleared, lives, over: true, endMs: times.closeAt, current: null }
  }
}

export function cleanBeatTaps(raw: unknown, maxT = BEAT_MAX_MS): BeatTap[] {
  if (!Array.isArray(raw)) return []
  const out: BeatTap[] = []
  for (const r of raw.slice(0, BEAT_MAX_TAPS)) {
    const t = Number((r as { t?: unknown })?.t)
    const pad = Number((r as { pad?: unknown })?.pad)
    if (!Number.isFinite(t) || t < 0 || t > maxT) continue
    if (!Number.isInteger(pad) || pad < 0 || pad >= BEAT_PADS) continue
    out.push({ t: Math.round(t), pad })
  }
  return out.sort((a, b) => a.t - b.t)
}

export interface SoloResult {
  cleared: number
  /** 제일 길게 따라 친 리듬의 박 수. */
  longest: number
  perfect: number
  score: number
  outcome: ArcadeOutcome
  endMs: number
}

export function soloReplay(seed: number | string, taps: readonly BeatTap[]): SoloResult {
  const run = soloRun(seed, taps)
  const won = run.rounds.filter((r) => r.judge?.ok)
  const longest = Math.max(0, ...won.map((r) => r.notes.length))
  const perfect = won.reduce((a, r) => a + (r.judge?.perfect ?? 0), 0)
  return {
    cleared: run.cleared,
    longest,
    perfect,
    // 깬 판이 먼저, 같으면 PERFECT 가 많은 쪽
    score: run.cleared * 1000 + perfect,
    outcome: run.cleared >= SOLO_PASS_ROUNDS ? 'win' : 'lose',
    endMs: run.endMs ?? BEAT_MAX_MS,
  }
}

// ── 2인: 둘이서 한 곡 ───────────────────────────────────────────
//
// 사람이 곡을 만든다. 차례가 오면 지금까지의 곡을 **듣고**, 따라 친 뒤,
// 곡 끝에 **제 박을 하나 보탠다**(한 마디 안 어디든, 아무 패드나).
// 다음 사람은 보탠 박까지 들은 곡을 따라 치고 또 하나를 보탠다.
//
// 틀리면 팀 목숨이 준다. 곡은 그대로고 다음 사람에게 넘어간다.

export const RELAY_START_NOTES = 2
export const RELAY_BPM_START = 90
export const RELAY_BPM_STEP = 3
export const RELAY_BPM_MAX = 180
export const RELAY_LIVES = 3
/** 보탤 박을 치는 칸. 곡 끝 다음 칸부터 한 마디. */
export const RELAY_ADD = 8
/** 곡이 이만큼 길어지면 CLEAR. */
export const RELAY_GOAL = 12
/** 이만큼이면 더 안 쌓고 끝낸다. */
export const RELAY_MAX_NOTES = 40
/** 차례가 끝나고 다음 차례까지 */
export const RELAY_GAP_MS = 900
/** 차례가 닫히고도 이만큼 안 오면 못 친 것으로 친다(마감). */
export const RELAY_GRACE_MS = 4000

export interface RelayState {
  notes: BeatNote[]
  order: string[]
  /** 몇 번째 차례(0 부터). 빠르기가 이것으로 오른다. */
  turn: number
  /** 지금 칠 사람의 자리(order 안). 누가 나가도 빠르기(turn)는 그대로다 */
  seat: number
  /** 이 차례가 열린 때(벽시계). 듣기 셈이 여기서 시작한다. */
  turnAtMs: number
  lives: number
  /** 지난 차례. 화면이 좋다·틀렸다를 보여 준다. */
  last: { by: string; ok: boolean; added: BeatNote | null; wrong: number; miss: number } | null
}

export const relayBpm = (turn: number): number => Math.min(RELAY_BPM_MAX, RELAY_BPM_START + turn * RELAY_BPM_STEP)

export function relayNew(seed: number | string, order: readonly string[], startAtMs: number): RelayState {
  return { notes: soloNotes(`relay:${seed}`, RELAY_START_NOTES), order: [...order], turn: 0, seat: 0, turnAtMs: startAtMs, lives: RELAY_LIVES, last: null }
}

export const relayWho = (s: RelayState): string | null => (s.order.length === 0 || s.lives <= 0 ? null : s.order[s.seat % s.order.length])

/** 이 차례의 때. 시각은 turnAtMs 부터의 ms 가 아니라 **벽시계**다. */
export function relayTimes(s: RelayState): RoundTimes & { addFrom: number } {
  const t = roundTimes(s.notes, relayBpm(s.turn), s.turnAtMs, RELAY_ADD)
  const last = s.notes.at(-1)?.step ?? 0
  return { ...t, addFrom: t.answerZero + (last + 1) * t.e - GOOD_MS }
}

/**
 * 한 차례 판정. taps 의 t 는 **벽시계**다. 곡을 다 맞게 따라 치고, 보탤
 * 칸에서 한 번 쳐야 깬다. 보탠 박은 가장 가까운 8분음표 칸에 붙인다.
 */
export function relayJudge(s: RelayState, taps: readonly BeatTap[]): RoundJudge & { added: BeatNote | null } {
  const tm = relayTimes(s)
  const last = s.notes.at(-1)?.step ?? 0
  const j = judgeRound(s.notes, tm.answerZero, tm.e, taps, tm.from, tm.addFrom)
  const add = taps.find((t) => t.t >= tm.addFrom && t.t < tm.closeAt)
  let added: BeatNote | null = null
  if (add) {
    const step = Math.round((add.t - tm.answerZero) / tm.e)
    added = { step: Math.max(last + 1, Math.min(last + RELAY_ADD, step)), pad: add.pad }
  }
  return { ...j, ok: j.ok && added !== null, added }
}

/** 차례 하나를 닫는다. taps 가 null 이면 안 친 것(마감)이다. */
export function relayClose(s: RelayState, by: string, taps: readonly BeatTap[] | null, nowMs: number): RelayState {
  const j = taps ? relayJudge(s, taps) : null
  const ok = !!j?.ok
  const notes = ok && j?.added ? [...s.notes, j.added] : s.notes
  return {
    ...s,
    notes,
    turn: s.turn + 1,
    seat: (s.seat + 1) % Math.max(1, s.order.length),
    turnAtMs: nowMs + RELAY_GAP_MS,
    lives: ok ? s.lives : s.lives - 1,
    last: { by, ok, added: ok ? (j?.added ?? null) : null, wrong: j?.wrong ?? 0, miss: j?.miss ?? s.notes.length },
  }
}

export const relayOver = (s: RelayState, startAtMs: number): boolean =>
  s.lives <= 0 || s.notes.length >= RELAY_MAX_NOTES || s.order.length === 0 || relayTimes(s).closeAt - startAtMs > BEAT_MAX_MS

export const relayOutcome = (s: RelayState): ArcadeOutcome => (s.notes.length >= RELAY_GOAL ? 'win' : 'lose')

/** 누가 나갔다. 차례에서 빼고, 그 사람 차례였으면 다음 사람에게 새로 연다. */
export function relayLeave(s: RelayState, id: string, nowMs: number): RelayState {
  const at = s.order.indexOf(id)
  if (at < 0) return s
  const wasTurn = relayWho(s) === id
  const order = s.order.filter((o) => o !== id)
  const cur = s.seat % s.order.length
  const seat = order.length === 0 ? 0 : (at < cur ? cur - 1 : cur) % order.length
  // 그 사람 차례였으면 다음 사람에게 새로 연다(듣기부터)
  return { ...s, order, seat, turnAtMs: wasTurn ? nowMs + RELAY_GAP_MS : s.turnAtMs }
}
