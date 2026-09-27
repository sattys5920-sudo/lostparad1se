// 오락실 — 뒷골목에 줄지어 선 기계 열 대와 그 안의 게임들.
//
// **판정은 늘 서버가 한다.** 화면이 「이겼다」를 보내는 게임이면
// 개발자도구로 누구나 이긴다. 그래서
//
//   ㆍ 차례로 두는 게임(업다운·가위바위보)은 서버가 숨긴 것이나 봉인한
//     것으로 승부가 난다
//   ㆍ 손이 빠른 게임(리듬 같은 것)은 서버가 판(씨앗)을 정하고, 화면이
//     누른 기록을 보내면 **서버가 같은 규칙으로 다시 돌려** 점수를 낸다.
//     화면이 적어 보낸 점수는 안 받는다
//
// **보상은 아직 없다.** 무엇을 줄지는 나중에 정한다 — 그때 붙일
// 자리가 하나이도록, 판이 끝나면 늘 같은 모양(ArcadeOutcome)으로
// 끝을 알린다.
//
// 이 파일은 순수 함수만 둔다. 굴림(roll)은 부르는 쪽이 쥔다.
import { ALLEY, type Cell } from './board'
import type { DrawState } from './arcadeDraw'
import type { NunchiState } from './arcadeNunchi'
import type { TowerState } from './arcadeTower'

// ── 기계 ────────────────────────────────────────────────────────

export const ARCADE_NAME = '오락기'

/** 기계 수. 골목 윗벽을 따라 한 줄로 선다. */
export const ARCADE_COUNT = 10

export interface ArcadeMachine {
  /** 0 부터. 화면에는 +1 해서 「1번 기계」로 적는다. */
  i: number
  /** 기계가 선 칸. 기물이라 못 밟는다. */
  cell: Cell
  /**
   * 앉는 칸. **기계 바로 앞 한 칸이다.** 여기 서 있는 것이 곧 앉은
   * 것이다 — 따로 「앉는다」를 누르지 않는다. 한 칸에는 한 사람만
   * 설 수 있으니(standAt 이 막는다) 한 기계에 한 사람이다.
   */
  seat: Cell
}

/**
 * 기계 열 대. **골목(ALLEY 의 둘째 네모) 윗줄, 왼쪽에서 두 칸 띄고.**
 *
 * 윗줄이라 위는 벽이다 — 두 칸 높이 그림이 벽에 기대 선다. 줄 끝을
 * 두 칸씩 비워서 골목 양끝으로 사람이 드나드는 길이 남는다.
 */
export const ARCADE_MACHINES: readonly ArcadeMachine[] = (() => {
  const r = ALLEY[1]
  return Array.from({ length: ARCADE_COUNT }, (_, i) => {
    const x = r.x + 2 + i
    return { i, cell: { x, y: r.y }, seat: { x, y: r.y + 1 } }
  })
})()

/** 그 칸이 몇 번 기계의 자리인가. 자리가 아니면 null. */
export function machineAtSeat(me: Cell | null | undefined): number | null {
  if (!me) return null
  const m = ARCADE_MACHINES.find((k) => k.seat.x === me.x && k.seat.y === me.y)
  return m ? m.i : null
}

/** 그 칸에 기계가 서 있는가. 몇 번인지. */
export function machineAtCell(x: number, y: number): number | null {
  const m = ARCADE_MACHINES.find((k) => k.cell.x === x && k.cell.y === y)
  return m ? m.i : null
}

export const machineName = (i: number): string => `${i + 1}번 기계`

// ── 게임 목록 ───────────────────────────────────────────────────

export type ArcadeGameId =
  | 'updown' | 'rhythm' | 'snake'
  | 'rps' | 'quickdraw' | 'duet'
  | 'nunchi' | 'tower'
  | 'oneToFifty' | 'mole'

/**
 * 어떻게 겨루는가.
 *
 *   solo    혼자. 이기고 지는 것은 기계와다
 *   versus  여럿이 겨룬다. 제일 잘한 사람이 이긴다
 *   coop    여럿이 한편이다. 다 같이 넘기거나 다 같이 진다
 */
export type ArcadeMode = 'solo' | 'versus' | 'coop'

export interface ArcadeGame {
  id: ArcadeGameId
  name: string
  mode: ArcadeMode
  /** 몇 명이 하는가. 다른 기계에 앉은 사람을 불러 채운다. */
  min: number
  max: number
  /** 고르는 화면에 한 줄. */
  blurb: string
  /**
   * 어떻게 판을 굴리는가.
   *
   *   turn   한 수씩 서버에 묻는다(업다운·가위바위보·먼저 쏴). 한
   *          사람만 나가도 판이 깨진다
   *   live   화면이 제 손으로 굴리고, 끝나면 누른 기록을 통째로 보낸다.
   *          서버는 같은 규칙으로 다시 돌려 점수를 낸다
   *   table  여럿이 판 하나를 같이 본다(눈치 게임·탑 쌓기). 서버가 판을
   *          쥐고, 나간 사람은 빼고 남은 사람끼리 이어 간다
   */
  kind: 'turn' | 'live' | 'table'
  /** 들어갈 수 있는가. 아직 안 만든 게임은 고르는 화면에 「준비 중」으로 선다. */
  ready: boolean
}

export const ARCADE_GAMES: readonly ArcadeGame[] = [
  { id: 'updown', name: '업다운', mode: 'solo', min: 1, max: 1, blurb: '1~100 숨은 숫자를 여섯 번 안에', kind: 'turn', ready: true },
  { id: 'rhythm', name: '리듬 스타', mode: 'solo', min: 1, max: 1, blurb: '떨어지는 음표를 박자에 맞춰', kind: 'live', ready: true },
  { id: 'snake', name: '뱀', mode: 'solo', min: 1, max: 1, blurb: '먹을수록 길어진다. 꼬리를 물지 마라', kind: 'live', ready: true },
  { id: 'rps', name: '가위바위보', mode: 'versus', min: 2, max: 2, blurb: '다른 기계와 한 판', kind: 'turn', ready: true },
  { id: 'quickdraw', name: '먼저 쏴', mode: 'versus', min: 2, max: 2, blurb: '신호가 뜨면 먼저 누른 쪽이 이긴다', kind: 'turn', ready: true },
  { id: 'duet', name: '둘이서 한 곡', mode: 'coop', min: 2, max: 2, blurb: '한 곡을 둘이 나눠 친다', kind: 'live', ready: true },
  { id: 'nunchi', name: '눈치 게임', mode: 'versus', min: 2, max: 4, blurb: '1부터 외친다. 겹치거나 꼴찌면 탈락', kind: 'table', ready: true },
  { id: 'tower', name: '탑 쌓기', mode: 'coop', min: 2, max: 4, blurb: '돌아가며 쌓는다. 무너지면 끝', kind: 'table', ready: true },
  { id: 'oneToFifty', name: '1 to 50', mode: 'versus', min: 1, max: 4, blurb: '1부터 50까지 누가 먼저', kind: 'live', ready: true },
  { id: 'mole', name: '두더지 잡기', mode: 'versus', min: 1, max: 4, blurb: '30초 동안 누가 더 많이', kind: 'live', ready: true },
]

export const ARCADE_BY_ID: Readonly<Record<ArcadeGameId, ArcadeGame>> = Object.fromEntries(
  ARCADE_GAMES.map((g) => [g.id, g]),
) as Record<ArcadeGameId, ArcadeGame>

export const isArcadeGameId = (v: unknown): v is ArcadeGameId => typeof v === 'string' && v in ARCADE_BY_ID

/** 판이 끝나면 늘 이 모양이다. 보상을 붙일 날 여기에 붙인다. */
export type ArcadeOutcome = 'win' | 'lose' | 'draw'

/** 인원 줄. 고르는 화면의 딱지다. */
export const playersLabel = (g: ArcadeGame): string =>
  g.min === g.max ? `${g.max}P` : `${g.min}~${g.max}P`

// ── 방 ──────────────────────────────────────────────────────────
//
// 한 판은 늘 「방」 하나다. 혼자 하는 게임도 방이 하나 서고 사람이
// 하나뿐일 뿐이다 — 그래야 혼자든 넷이든 같은 길로 시작하고 끝난다.
//
//   lobby    고른 사람이 다른 기계에 앉은 사람을 부르는 중
//   playing  시작했다
//   done     끝났다. 결과가 적혀 있다
//   gone     누가 일어나거나 그만둬서 판이 깨졌다

export type RoomStatus = 'lobby' | 'playing' | 'done' | 'gone'
/** 방 안의 자리. 불렀다 · 들어왔다 · 안 한다 · 나갔다. */
export type MemberState = 'invited' | 'in' | 'declined' | 'left'

export interface RoomMember {
  id: string
  name: string
  /** 앉은 기계. 불렀을 때의 기계다. */
  machine: number
  state: MemberState
}

/** 끝난 뒤 한 사람의 결과. */
export interface RoomResult {
  outcome: ArcadeOutcome
  /** 겨룬 수. 게임마다 뜻이 다르다(리듬은 점수, 업다운은 남은 기회). */
  score: number
  /** 화면에 한 줄로 적을 것. 「A · 92.5%」 같은. */
  line: string
}

export interface RoomDoc {
  game: ArcadeGameId
  hostId: string
  members: RoomMember[]
  /** 이 방을 읽을 수 있는 사람. **부른 사람까지 든다** — 부름을 봐야 받는다. */
  memberIds: string[]
  status: RoomStatus
  /** 판의 씨앗. 시작할 때 정해진다. 손이 빠른 게임은 이것으로 같은 판을 만든다. */
  seed: number | null
  /** 시작 시각(서버 시계). 이 전까지 화면은 카운트다운을 센다. */
  startAtMs: number | null
  /** 결과를 낸 사람. **점수는 끝날 때까지 여기 없다** — 서버 봉인에 있다. */
  doneIds: string[]
  /** 다 끝나면 한꺼번에. */
  results: Record<string, RoomResult> | null
  /** 업다운 — 드러난 쪽. 혼자 하는 방이라 방 문서에 둬도 본인만 본다. */
  updown: UpDownView | null
  /** 가위바위보 — 이번 판에 낸 사람과 지난 판들. 무엇을 냈는지는 봉인에 있다. */
  rps: { inIds: string[]; rounds: RpsRound[] } | null
  /** 먼저 쏴 — 이번 판에 쏜 사람과 지난 판들. 몇 ms 였는지는 봉인에 있다. */
  draw?: DrawState | null
  /** 눈치 게임 — 외친 차례. 서버에 닿은 순서 그대로다. */
  nunchi?: NunchiState | null
  /** 탑 쌓기 — 쌓인 블록과 차례. */
  tower?: TowerState | null
  /** 판이 저절로 닫히는 때(벽시계). 아무도 안 누르고 있어도 누구든 닫을 수 있다. */
  deadlineMs?: number | null
  atMs: number
}

/** 카운트다운. 시작을 누른 뒤 이만큼 뒤에 판이 열린다. */
export const ARCADE_COUNTDOWN_MS = 3000

export const LIVE_ROOM: ReadonlySet<RoomStatus> = new Set(['lobby', 'playing'])

/** 들어와 있는 사람. */
export const inMembers = (r: Pick<RoomDoc, 'members'>): RoomMember[] => r.members.filter((m) => m.state === 'in')

/**
 * 한 사람이 방을 떠난 뒤의 방. **부름을 안 받은 것도 떠난 것이다.**
 *
 *   ㆍ 부른 사람(방장)이 고르는 중에 떠나면 방이 깨진다
 *   ㆍ 차례 게임(업다운·가위바위보)은 한 사람만 떠나도 깨진다 — 둘이
 *     번갈아 두는 판에서 한쪽이 사라지면 판이 안 굴러간다
 *   ㆍ 손 게임은 남은 사람끼리 계속한다. 떠난 사람은 진 것으로 친다.
 *     아무도 안 남으면 깨진다
 */
export function roomAfterLeave(room: Pick<RoomDoc, 'game' | 'hostId' | 'members' | 'status'>, uid: string): { members: RoomMember[]; status: RoomStatus } {
  const members = room.members.map((m) =>
    m.id !== uid ? m : { ...m, state: m.state === 'invited' ? ('declined' as const) : m.state === 'in' ? ('left' as const) : m.state },
  )
  if (!LIVE_ROOM.has(room.status)) return { members, status: room.status }
  const anyone = members.some((m) => m.state === 'in')
  let status = room.status
  if (room.status === 'lobby' && (uid === room.hostId || !anyone)) status = 'gone'
  // 손 게임과 판 게임은 남은 사람끼리 이어 간다(판 게임은 서버가 판에서도 뺀다)
  if (room.status === 'playing' && (ARCADE_BY_ID[room.game].kind === 'turn' || !anyone)) status = 'gone'
  return { members, status }
}

/** 손 게임에서 한 사람이 낸 것. 서버가 기록을 다시 돌려 얻는다. */
export interface Scored {
  id: string
  score: number
  line: string
  /** 혼자 기준의 이김·짐. 혼자 하는 게임이면 그대로 쓴다. */
  solo: ArcadeOutcome
  /**
   * 협동 게임에서 합칠 몫. 이 사람이 딴 것(pts)과 딸 수 있던 것(max).
   * 둘이서 한 곡은 둘의 판정을 합쳐 곡 하나로 매긴다.
   */
  pts?: number
  max?: number
}

/** 협동 게임을 합친 몫으로 가를 때 이 퍼센트를 넘기면 깬다. */
export const COOP_PASS = 70

/**
 * 손 게임의 끝. 방식에 따라 이김·짐을 가른다.
 *
 *   solo    제 기준 그대로
 *   versus  제일 높은 사람이 이긴다. 같으면 그 사람들끼리 비긴다.
 *           상대가 일어나 혼자 남았으면 이긴다. 처음부터 혼자였으면
 *           혼자 기준(깼나)으로 가른다
 *   coop    다 같이. 합친 몫으로 가르고, 누가 일어나면 다 같이 진다
 *
 * **중간에 일어난 사람은 진다.** 점수 없이.
 */
export function settleRoom(mode: ArcadeMode, scored: readonly Scored[], leftIds: readonly string[]): Record<string, RoomResult> {
  const out: Record<string, RoomResult> = {}
  const best = Math.max(...scored.map((s) => s.score))
  const top = scored.filter((s) => s.score === best).length
  /*
   * 협동은 **합친 몫**으로 가른다(몫이 있으면). 한 사람만 잘해서는 안
   * 된다. **누가 중간에 일어나면 다 같이 진다** — 곡 절반이 빈다.
   */
  const pts = scored.reduce((a, s) => a + (s.pts ?? 0), 0)
  const max = scored.reduce((a, s) => a + (s.max ?? 0), 0)
  const team: ArcadeOutcome =
    leftIds.length > 0 ? 'lose'
    : max > 0 ? (pts / max) * 100 >= COOP_PASS ? 'win' : 'lose'
    : scored.every((s) => s.solo === 'win') ? 'win' : 'lose'
  for (const s of scored) {
    const outcome: ArcadeOutcome =
      mode === 'solo' ? s.solo
      : mode === 'coop' ? team
      // 혼자 한 판(1~4인 게임을 혼자)은 혼자 기준으로 — 0점이어도 이기면 안 된다.
      // 상대가 일어나서 혼자 남은 것은 이긴 것이다
      : scored.length === 1 ? (leftIds.length === 0 ? s.solo : 'win')
      : s.score === best ? (top > 1 ? 'draw' : 'win')
      : 'lose'
    out[s.id] = { outcome, score: s.score, line: s.line }
  }
  for (const id of leftIds) out[id] = { outcome: 'lose', score: 0, line: '중간에 일어났다' }
  return out
}

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
