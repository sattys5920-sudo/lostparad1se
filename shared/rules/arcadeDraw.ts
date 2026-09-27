// 먼저 쏴 — 신호가 뜨면 먼저 누른 쪽이 이긴다. 세 판 두 선승.
//
// **신호 시각은 씨앗에서 나오고 둘에게 같다.** 누가 얼마나 빨랐는지는
// 제 화면이 신호를 띄운 순간부터 잰다 — 폰 시계가 서로 조금 어긋나도
// 잰 값은 안 어긋난다.
//
// **먼저 쏜 값은 봉인된다.** 둘 다 쏘거나 시간이 다 돼야 편다. 상대가
// 몇 ms 였는지 보고 나서 제 값을 적어 낼 수 없다.
//
// **100ms 보다 빠르면 부정출발이다.** 사람 손은 신호를 보고 그보다 빨리
// 못 누른다(육상도 같은 선을 쓴다). 신호 전에 누른 것도 부정출발이다.
import { rngFrom } from '../rand'

export const DRAW_WINS = 2
/** 비기기만 이어지면 여기서 끊는다. */
export const DRAW_MAX_ROUNDS = 5
export const DRAW_MIN_REACT_MS = 100
/** 「준비」에서 신호까지. 이 사이 어딘가에서 뜬다 */
export const DRAW_WAIT_MIN_MS = 1500
export const DRAW_WAIT_MAX_MS = 5000
/** 한 판이 갈리고 다음 판 「준비」까지 — 결과를 보여 주는 시간 */
export const DRAW_ROUND_GAP_MS = 2500
/** 신호 뒤 이만큼 안에 안 쏘면 못 쏜 것이다. */
export const DRAW_TIMEOUT_MS = 2500

/** 한 사람의 한 발. ms 이거나, 부정출발이거나, 못 쐈거나. */
export type Shot = number | 'early' | 'none'

export interface DrawRound {
  shots: Record<string, Shot>
  /** 이긴 사람. 비기면 null. */
  winner: string | null
}

export interface DrawState {
  /** 몇 번째 판(0 부터). */
  round: number
  /** 이번 판 신호 시각(벽시계). */
  signalAtMs: number
  /** 이번 판에 쏜 사람. **몇 ms 였는지는 없다** — 봉인에 있다. */
  inIds: string[]
  rounds: DrawRound[]
  wins: Record<string, number>
}

/** 그 판의 기다림. 씨앗과 판 번호로 정한다 — 서버와 화면이 같다. */
export function drawWait(seed: number | string, round: number): number {
  const rnd = rngFrom(`draw:${seed}:${round}`)
  return Math.round(DRAW_WAIT_MIN_MS + rnd() * (DRAW_WAIT_MAX_MS - DRAW_WAIT_MIN_MS))
}

export function drawNew(seed: number | string, ids: readonly string[], startAtMs: number): DrawState {
  return {
    round: 0,
    signalAtMs: startAtMs + drawWait(seed, 0),
    inIds: [],
    rounds: [],
    wins: Object.fromEntries(ids.map((id) => [id, 0])),
  }
}

/**
 * 화면이 보낸 한 발을 믿을 수 있는 모양으로. **서버에 닿은 때가 신호
 * 전이면 무조건 부정출발이다** — 화면이 뭐라고 적어 보냈든.
 */
export function normShot(raw: unknown, arrivedAtMs: number, signalAtMs: number): Shot {
  if (raw === 'early' || arrivedAtMs < signalAtMs) return 'early'
  const n = Number(raw)
  if (raw === null || raw === 'none' || !Number.isFinite(n)) return 'none'
  if (n < DRAW_MIN_REACT_MS) return 'early'
  if (n > DRAW_TIMEOUT_MS) return 'none'
  return Math.round(n)
}

/** 한 판을 가른다. 부정출발은 지고, 못 쏜 것은 쏜 것에 진다. */
export function drawJudge(a: string, b: string, shots: Record<string, Shot>): string | null {
  const sa = shots[a] ?? 'none'
  const sb = shots[b] ?? 'none'
  if (sa === 'early' && sb === 'early') return null
  if (sa === 'early') return b
  if (sb === 'early') return a
  if (sa === 'none' && sb === 'none') return null
  if (sa === 'none') return b
  if (sb === 'none') return a
  if (sa < sb) return a
  if (sb < sa) return b
  return null
}

/**
 * 판 하나를 닫고 다음 판을 연다. 누가 두 판을 먼저 따면 끝, 다섯 판을
 * 넘기면 딴 판 수로 가른다(같으면 비김).
 */
export function drawClose(
  s: DrawState,
  seed: number | string,
  ids: readonly [string, string],
  shots: Record<string, Shot>,
  nowMs: number,
): { s: DrawState; over: { winner: string | null } | null } {
  const winner = drawJudge(ids[0], ids[1], shots)
  const wins = { ...s.wins }
  if (winner) wins[winner] = (wins[winner] ?? 0) + 1
  const rounds = [...s.rounds, { shots, winner }]
  const round = s.round + 1
  const next: DrawState = {
    round,
    signalAtMs: nowMs + DRAW_ROUND_GAP_MS + drawWait(seed, round),
    inIds: [],
    rounds,
    wins,
  }
  const champ = ids.find((id) => (wins[id] ?? 0) >= DRAW_WINS)
  if (champ) return { s: next, over: { winner: champ } }
  if (rounds.length >= DRAW_MAX_ROUNDS) {
    const [a, b] = ids
    const w = wins[a] > wins[b] ? a : wins[b] > wins[a] ? b : null
    return { s: next, over: { winner: w } }
  }
  return { s: next, over: null }
}
