// 오락기 — 복도 구석의 기계 한 대와 그 안의 게임들.
//
// **답은 늘 서버가 쥔다.** 화면이 「이겼다」를 보내는 게임이면
// 개발자도구로 누구나 이긴다. 그래서 여기 있는 게임은 전부 서버가
// 숨긴 것(업다운의 숫자)이나 봉인한 것(대결에서 먼저 낸 수)으로
// 승부가 난다. 화면은 물어보고 그리기만 한다.
//
// **보상은 아직 없다.** 무엇을 줄지는 나중에 정한다 — 그때 붙일
// 자리가 하나이도록, 판이 끝나면 늘 같은 모양(ArcadeOutcome)으로
// 끝을 알린다.
//
// 이 파일은 순수 함수만 둔다. 굴림(roll)은 부르는 쪽이 쥔다.
import type { Cell } from './board'

// ── 기계 ────────────────────────────────────────────────────────

/**
 * 오락기가 선 칸. **1층 복도, 자판기에서 네 칸.**
 *
 * 벽에 등을 대고 선다 — 복도 한가운데에 두면 길을 막는다. 둘레에
 * 설 칸이 다섯이라 둘이 나란히 붙어 대결할 수 있다. 자리를 고른
 * 자는 복도가 끊기지 않는지까지 재서 골랐다(시험이 다시 잰다).
 */
export const ARCADE_CELL: Cell = { x: 28, y: 79 }
export const ARCADE_NAME = '오락기'

/** 옆인가. 둘레 한 칸 — 자판기·게시판과 같은 자다. */
export const atArcade = (me: Cell | null | undefined): boolean =>
  !!me && Math.abs(me.x - ARCADE_CELL.x) <= 1 && Math.abs(me.y - ARCADE_CELL.y) <= 1 &&
  !(me.x === ARCADE_CELL.x && me.y === ARCADE_CELL.y)

// ── 게임 목록 ───────────────────────────────────────────────────

export type ArcadeGameId =
  | 'updown' | 'baseball' | 'rpsMachine' | 'highLow' | 'blackjack' | 'bombBox'
  | 'rps' | 'mukjjippa' | 'chamchamcham' | 'holjjak'

export interface ArcadeGame {
  id: ArcadeGameId
  name: string
  /** 1 은 기계와, 2 는 오락기 옆에 선 사람과. */
  players: 1 | 2
  /** 고르는 화면에 한 줄. */
  blurb: string
  /** 들어갈 수 있는가. 아직 안 만든 게임은 고르는 화면에 「준비 중」으로 선다. */
  ready: boolean
}

export const ARCADE_GAMES: readonly ArcadeGame[] = [
  { id: 'updown', name: '업다운', players: 1, blurb: '1~100 숨은 숫자를 여섯 번 안에', ready: true },
  { id: 'baseball', name: '숫자야구', players: 1, blurb: '세 자리 숫자, 스트라이크와 볼', ready: false },
  { id: 'rpsMachine', name: '가위바위보 기계', players: 1, blurb: '이기면 불빛이 돈다', ready: false },
  { id: 'highLow', name: '하이로우', players: 1, blurb: '다음 카드가 높을까 낮을까', ready: false },
  { id: 'blackjack', name: '블랙잭', players: 1, blurb: '21 을 넘지 않게', ready: false },
  { id: 'bombBox', name: '폭탄 상자', players: 1, blurb: '폭탄을 피해 상자를 연다', ready: false },
  { id: 'rps', name: '가위바위보', players: 2, blurb: '옆 사람과 한 판', ready: true },
  { id: 'mukjjippa', name: '묵찌빠', players: 2, blurb: '공격권을 쥐고 따라오게', ready: false },
  { id: 'chamchamcham', name: '참참참', players: 2, blurb: '고개를 돌려라', ready: false },
  { id: 'holjjak', name: '홀짝', players: 2, blurb: '쥔 구슬이 홀이냐 짝이냐', ready: false },
]

export const ARCADE_BY_ID: Readonly<Record<ArcadeGameId, ArcadeGame>> = Object.fromEntries(
  ARCADE_GAMES.map((g) => [g.id, g]),
) as Record<ArcadeGameId, ArcadeGame>

/** 판이 끝나면 늘 이 모양이다. 보상을 붙일 날 여기에 붙인다. */
export type ArcadeOutcome = 'win' | 'lose' | 'draw'

// ── 업다운 ──────────────────────────────────────────────────────

export const UPDOWN_MAX = 100
/**
 * 부를 수 있는 횟수. **여섯.**
 *
 * 일곱이면 반씩 잘라 가는 사람이 늘 이긴다(2⁷ = 128 ≥ 100). 여섯이면
 * 제일 잘해도 100 중 63 을 잡는다 — 머리를 쓰면 이기는 쪽이 많지만
 * 늘 이기지는 않는다.
 */
export const UPDOWN_TRIES = 6

export type UpDownHint = 'up' | 'down' | 'hit'

/** 숨은 쪽. **서버만 쥔다** — 화면으로는 판이 끝날 때까지 안 간다. */
export interface UpDownSecret {
  target: number
}

/** 드러난 쪽. 이것만 화면으로 간다. */
export interface UpDownView {
  guesses: { n: number; hint: UpDownHint }[]
  left: number
  outcome: ArcadeOutcome | null
  /** 끝난 뒤에만 채운다. 진 사람이 답을 알아야 판이 닫힌다. */
  answer: number | null
}

export function updownNew(roll: number): { secret: UpDownSecret; view: UpDownView } {
  const target = 1 + Math.min(UPDOWN_MAX - 1, Math.floor(roll * UPDOWN_MAX))
  return { secret: { target }, view: { guesses: [], left: UPDOWN_TRIES, outcome: null, answer: null } }
}

export type UpDownRefusal = 'over' | 'notNumber' | 'outOfRange'

export const UPDOWN_NO: Record<UpDownRefusal, string> = {
  over: '이미 끝난 판이다',
  notNumber: '숫자를 불러야 한다',
  outOfRange: `1부터 ${UPDOWN_MAX}까지다`,
}

export function updownGuess(
  secret: UpDownSecret,
  view: UpDownView,
  n: number,
): { ok: true; view: UpDownView } | { ok: false; why: UpDownRefusal } {
  if (view.outcome !== null) return { ok: false, why: 'over' }
  if (!Number.isInteger(n)) return { ok: false, why: 'notNumber' }
  if (n < 1 || n > UPDOWN_MAX) return { ok: false, why: 'outOfRange' }
  const hint: UpDownHint = n < secret.target ? 'up' : n > secret.target ? 'down' : 'hit'
  const left = view.left - 1
  const outcome: ArcadeOutcome | null = hint === 'hit' ? 'win' : left === 0 ? 'lose' : null
  return {
    ok: true,
    view: {
      guesses: [...view.guesses, { n, hint }],
      left,
      outcome,
      answer: outcome !== null ? secret.target : null,
    },
  }
}

// ── 가위바위보 대결 ─────────────────────────────────────────────

export type RpsPick = 'rock' | 'paper' | 'scissors'
export const RPS_PICKS: readonly RpsPick[] = ['rock', 'paper', 'scissors']
export const RPS_LABEL: Record<RpsPick, string> = { rock: '바위', paper: '보', scissors: '가위' }

/** a 쪽에서 본 승부. */
export function rpsJudge(a: RpsPick, b: RpsPick): 'a' | 'b' | 'tie' {
  if (a === b) return 'tie'
  const beats: Record<RpsPick, RpsPick> = { rock: 'scissors', paper: 'rock', scissors: 'paper' }
  return beats[a] === b ? 'a' : 'b'
}

/**
 * 비기면 다시 낸다. **다섯 번 연속 비기면 무승부로 닫는다** — 둘이
 * 같은 것만 계속 내면 판이 영영 안 끝난다.
 */
export const RPS_MAX_ROUNDS = 5

export interface RpsRound {
  a: RpsPick
  b: RpsPick
  winner: 'a' | 'b' | 'tie'
}

/**
 * 둘 다 냈을 때 한 판을 닫는다. **이 함수는 둘 다 낸 뒤에만 부른다** —
 * 한쪽만 낸 상태는 서버의 봉인(secret)에만 있고, 대결 문서에는 「냈다」
 * 표시만 선다.
 */
export function rpsResolve(
  rounds: readonly RpsRound[],
  a: RpsPick,
  b: RpsPick,
): { rounds: RpsRound[]; outcome: 'a' | 'b' | 'draw' | null } {
  const winner = rpsJudge(a, b)
  const next = [...rounds, { a, b, winner }]
  if (winner !== 'tie') return { rounds: next, outcome: winner }
  return { rounds: next, outcome: next.length >= RPS_MAX_ROUNDS ? 'draw' : null }
}

export const isRpsPick = (v: unknown): v is RpsPick => typeof v === 'string' && (RPS_PICKS as readonly string[]).includes(v)
