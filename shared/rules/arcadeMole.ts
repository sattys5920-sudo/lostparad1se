// 두더지 잡기 — 30초 동안 아홉 구멍에서 튀어나오는 것을 친다.
//
//   두더지  +1
//   금두더지 +3 (드물고 빨리 숨는다)
//   폭탄    −3 (치지 마라)
//   빈 구멍 −1 (마구 두드리지 마라)
//
// 언제 어느 구멍에서 무엇이 나오는지는 **씨앗에서 나온다.** 넷이 겨루면
// 넷 다 같은 두더지를 친다. 서버가 누른 기록을 다시 돌려 점수를 낸다.
import { rngFrom } from '../rand'
import type { ArcadeOutcome } from './arcade'

export const MOLE_HOLES = 9
export const MOLE_MS = 30_000
/** 혼자 할 때 이만큼 넘기면 깬 것이다. */
export const MOLE_PASS = 25

export type MoleKind = 'mole' | 'gold' | 'bomb'
export const MOLE_POINTS: Record<MoleKind, number> = { mole: 1, gold: 3, bomb: -3 }
/** 빈 구멍을 친 값. */
export const MOLE_EMPTY = -1
/** 한 구멍을 이보다 빨리 다시 친 것은 안 친다. */
export const MOLE_GAP_MS = 60

export interface Pop {
  t: number
  hole: number
  /** 떠 있는 시간. */
  dur: number
  kind: MoleKind
}

/**
 * 튀어나오는 차례. 뒤로 갈수록 자주, 짧게 나온다. 한 구멍에서 둘이
 * 겹치지는 않는다.
 */
export const MOLE_TUNE = {
  /** 첫 두더지. 판이 열리고 이만큼 뒤 */
  firstMs: 800,
  /** 끝 이만큼 전부터는 안 나온다 — 나오자마자 판이 닫히면 억울하다 */
  tailMs: 500,
  /** 다음 두더지까지. 처음 → 끝으로 갈수록 줄어든다 */
  gapFromMs: 750,
  gapToMs: 250,
  /** 떠 있는 시간. 처음 → 끝. 처음엔 느긋하고 끝에는 손이 못 따라간다 */
  upFromMs: 1000,
  upToMs: 430,
  /** 사이 간격을 이만큼 흔든다(0.7~1.3배) */
  jitter: 0.3,
  /** 금두더지가 나올 몫 */
  goldShare: 0.1,
  /** 폭탄이 나올 몫. 처음 → 끝으로 는다 — 끝에는 다섯에 하나가 폭탄이다 */
  bombFrom: 0.06,
  bombTo: 0.22,
  /** 금두더지는 이만큼만 떠 있다 */
  goldUp: 0.7,
} as const

export function moleSchedule(seed: number | string): Pop[] {
  const T = MOLE_TUNE
  const rnd = rngFrom(`mole:${seed}`)
  const out: Pop[] = []
  let t: number = T.firstMs
  while (t < MOLE_MS - T.tailMs) {
    const k = t / MOLE_MS
    const gap = T.gapFromMs + (T.gapToMs - T.gapFromMs) * k
    const dur = T.upFromMs + (T.upToMs - T.upFromMs) * k
    const r = rnd()
    const bomb = T.bombFrom + (T.bombTo - T.bombFrom) * k
    const kind: MoleKind = r < T.goldShare ? 'gold' : r < T.goldShare + bomb ? 'bomb' : 'mole'
    const busy = new Set(out.filter((p) => p.t + p.dur > t).map((p) => p.hole))
    const free = Array.from({ length: MOLE_HOLES }, (_, i) => i).filter((h) => !busy.has(h))
    if (free.length > 0) {
      const hole = free[Math.floor(rnd() * free.length)]
      out.push({ t: Math.round(t), hole, dur: Math.round(kind === 'gold' ? dur * T.goldUp : dur), kind })
    }
    t += gap * (1 - T.jitter + rnd() * T.jitter * 2)
  }
  return out
}

export interface MoleTap {
  t: number
  hole: number
}

export interface MoleState {
  hit: boolean[]
  score: number
  moles: number
  bombs: number
  empty: number
  lastTap: number[]
}

export function moleStart(pops: readonly Pop[]): MoleState {
  return { hit: pops.map(() => false), score: 0, moles: 0, bombs: 0, empty: 0, lastTap: Array.from({ length: MOLE_HOLES }, () => -Infinity) }
}

/** 지금 그 구멍에 떠 있는 것. */
export function upAt(pops: readonly Pop[], hole: number, t: number): number {
  return pops.findIndex((p) => p.hole === hole && t >= p.t && t < p.t + p.dur)
}

export function moleTap(pops: readonly Pop[], s: MoleState, tap: MoleTap): { s: MoleState; got: MoleKind | 'empty' | null } {
  if (tap.t < 0 || tap.t > MOLE_MS || tap.hole < 0 || tap.hole >= MOLE_HOLES) return { s, got: null }
  if (tap.t - s.lastTap[tap.hole] < MOLE_GAP_MS) return { s, got: null }
  const lastTap = [...s.lastTap]
  lastTap[tap.hole] = tap.t
  const i = upAt(pops, tap.hole, tap.t)
  if (i < 0 || s.hit[i]) return { s: { ...s, lastTap, score: s.score + MOLE_EMPTY, empty: s.empty + 1 }, got: 'empty' }
  const hit = [...s.hit]
  hit[i] = true
  const kind = pops[i].kind
  return {
    s: {
      ...s,
      hit,
      lastTap,
      score: s.score + MOLE_POINTS[kind],
      moles: s.moles + (kind === 'bomb' ? 0 : 1),
      bombs: s.bombs + (kind === 'bomb' ? 1 : 0),
    },
    got: kind,
  }
}

export const MOLE_MAX_TAPS = 1500

export function cleanMoleTaps(raw: unknown): MoleTap[] {
  if (!Array.isArray(raw)) return []
  const out: MoleTap[] = []
  for (const r of raw.slice(0, MOLE_MAX_TAPS)) {
    const t = Number((r as { t?: unknown })?.t)
    const hole = Number((r as { hole?: unknown })?.hole)
    if (!Number.isFinite(t) || t < 0 || t > MOLE_MS) continue
    if (!Number.isInteger(hole) || hole < 0 || hole >= MOLE_HOLES) continue
    out.push({ t: Math.round(t), hole })
  }
  return out.sort((a, b) => a.t - b.t)
}

export interface MoleResult {
  score: number
  moles: number
  bombs: number
  empty: number
  outcome: ArcadeOutcome
}

export function moleReplay(seed: number | string, taps: readonly MoleTap[]): MoleResult {
  const pops = moleSchedule(seed)
  let s = moleStart(pops)
  for (const t of taps) s = moleTap(pops, s, t).s
  return { score: s.score, moles: s.moles, bombs: s.bombs, empty: s.empty, outcome: s.score >= MOLE_PASS ? 'win' : 'lose' }
}
