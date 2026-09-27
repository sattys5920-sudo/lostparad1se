// 1 to 50 — 5×5 판에서 1부터 50까지 차례로 누른다.
//
// 칸마다 앞면(1~25)과 뒷면(26~50)이 있다. 앞면 숫자를 누르면 그 칸이
// 뒤집혀 뒷면 숫자가 나오고, 뒷면을 누르면 칸이 빈다. **씨앗이 같으면
// 판이 같다** — 넷이 겨루면 넷 다 같은 판을 누른다.
//
// 서버가 다시 돌린다. 화면은 누른 시각과 칸만 적어 보낸다.
//
// **틀리게 누르면 잠깐 손이 묶인다**(FIFTY_LOCK_MS). 벌이 없으면 스물다섯
// 칸을 마구 훑는 것이 차례대로 찾는 것보다 빠르다.
import { rngFrom } from '../rand'
import type { ArcadeOutcome } from './arcade'

export const FIFTY_SIDE = 5
export const FIFTY_CELLS = FIFTY_SIDE * FIFTY_SIDE
export const FIFTY_LAST = FIFTY_CELLS * 2
/** 틀리게 누른 뒤 손이 묶이는 시간. 이 동안 누른 것은 안 친다. */
export const FIFTY_LOCK_MS = 400
/** 판 끝. 못 끝내도 여기서 멈춘다. */
export const FIFTY_LIMIT_MS = 90_000
/** 혼자 할 때 이 안에 끝내면 깬 것이다. */
export const FIFTY_PASS_MS = 60_000

export interface FiftyBoard {
  front: number[]
  back: number[]
}

function shuffle(xs: number[], rnd: () => number): number[] {
  const out = [...xs]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export function fiftyBoard(seed: number | string): FiftyBoard {
  const rnd = rngFrom(`fifty:${seed}`)
  const nums = (from: number) => Array.from({ length: FIFTY_CELLS }, (_, i) => from + i)
  return { front: shuffle(nums(1), rnd), back: shuffle(nums(FIFTY_CELLS + 1), rnd) }
}

export interface FiftyTap {
  t: number
  cell: number
}

export interface FiftyState {
  /** 칸마다 지금 보이는 숫자. 빈 칸은 null. */
  cells: (number | null)[]
  /** 다음에 눌러야 할 숫자. */
  next: number
  lockUntil: number
  wrong: number
  /** 50 을 누른 시각. 못 끝냈으면 null. */
  doneAt: number | null
}

export function fiftyStart(b: FiftyBoard): FiftyState {
  return { cells: [...b.front], next: 1, lockUntil: -Infinity, wrong: 0, doneAt: null }
}

/** 한 번 누른다. 맞으면 hit, 틀리면 miss, 묶여 있거나 끝났으면 null. */
export function fiftyTap(b: FiftyBoard, s: FiftyState, tap: FiftyTap): { s: FiftyState; hit: boolean | null } {
  if (s.doneAt !== null || tap.t < s.lockUntil || tap.t > FIFTY_LIMIT_MS) return { s, hit: null }
  if (tap.cell < 0 || tap.cell >= FIFTY_CELLS) return { s, hit: null }
  if (s.cells[tap.cell] !== s.next) {
    return { s: { ...s, lockUntil: tap.t + FIFTY_LOCK_MS, wrong: s.wrong + 1 }, hit: false }
  }
  const cells = [...s.cells]
  cells[tap.cell] = s.next <= FIFTY_CELLS ? b.back[tap.cell] : null
  const next = s.next + 1
  return { s: { ...s, cells, next, doneAt: next > FIFTY_LAST ? tap.t : null }, hit: true }
}

export const FIFTY_MAX_TAPS = 2000

export function cleanFiftyTaps(raw: unknown): FiftyTap[] {
  if (!Array.isArray(raw)) return []
  const out: FiftyTap[] = []
  for (const r of raw.slice(0, FIFTY_MAX_TAPS)) {
    const t = Number((r as { t?: unknown })?.t)
    const cell = Number((r as { cell?: unknown })?.cell)
    if (!Number.isFinite(t) || t < 0 || t > FIFTY_LIMIT_MS) continue
    if (!Number.isInteger(cell) || cell < 0 || cell >= FIFTY_CELLS) continue
    out.push({ t: Math.round(t), cell })
  }
  return out.sort((a, b) => a.t - b.t)
}

export interface FiftyResult {
  doneMs: number | null
  /** 어디까지 눌렀나. 끝냈으면 50. */
  reached: number
  wrong: number
  /** 겨룰 때 쓰는 수. 끝낸 사람은 빠를수록, 못 끝낸 사람은 멀리 갈수록 크다. */
  score: number
  outcome: ArcadeOutcome
  /** 이 판이 끝난 시각(판 시작부터). 서버가 「너무 이르다」를 잴 때 쓴다. */
  endMs: number
}

/** 끝낸 사람은 못 끝낸 사람보다 늘 위다. */
const FINISH_BONUS = 1_000_000

export function fiftyReplay(seed: number | string, taps: readonly FiftyTap[]): FiftyResult {
  const b = fiftyBoard(seed)
  let s = fiftyStart(b)
  for (const t of taps) s = fiftyTap(b, s, t).s
  const reached = s.next - 1
  const done = s.doneAt
  return {
    doneMs: done,
    reached,
    wrong: s.wrong,
    score: done !== null ? FINISH_BONUS + (FIFTY_LIMIT_MS - done) : reached,
    outcome: done !== null && done <= FIFTY_PASS_MS ? 'win' : 'lose',
    endMs: done ?? (taps.at(-1)?.t ?? 0),
  }
}
