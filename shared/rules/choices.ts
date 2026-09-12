// DAY 3과 DAY 4의 선택.
//
// 라벨과 판정만 여기 있다. 역할 데이터(roles.ts)에 두면 화면이 선택지
// 세 줄 때문에 숨긴 사실 열넷을 통째로 불러오게 된다 — roleNames.ts와
// 같은 이유다.
import { CHOSEN_ONE_DAY, DAY4_CHOICE_DAY } from './v2'

export { CHOSEN_ONE_DAY, DAY4_CHOICE_DAY }

// ── DAY 3 · 중요한 사람 ─────────────────────────────────────────

export type ChooseRefusal = 'wrongDay' | 'self' | 'unknown'

export interface ChooseInput {
  day: number
  chooserId: string
  targetId: string
  /** 명단에 있는 사람인가. */
  known: boolean
}

/**
 * 중요한 사람을 고를 수 있는가.
 *
 * DAY 3 하루 동안은 몇 번이든 바꿀 수 있다. 날이 지나면 저절로
 * 잠긴다 — 끝에 가서 유리한 쪽으로 갈아타는 건 고른 것이 아니다.
 *
 * 「잠김」을 따로 두지 않는다. 날짜 검사가 이미 그 일을 한다. 아무 일도
 * 안 하는 안전장치는 없느니만 못하다 — 나중에 날짜 검사를 손보는
 * 사람이 잠김이 지켜 준다고 믿는다.
 */
export function canChoosePerson(input: ChooseInput): { ok: boolean; reason: ChooseRefusal | null } {
  if (input.day !== CHOSEN_ONE_DAY) return { ok: false, reason: 'wrongDay' }
  if (input.chooserId === input.targetId) return { ok: false, reason: 'self' }
  if (!input.known) return { ok: false, reason: 'unknown' }
  return { ok: true, reason: null }
}

// ── DAY 4 · 무엇을 지킬 것인가 ──────────────────────────────────

export type Day4Choice = 'team' | 'self' | 'bond'

export interface Day4ChoiceSpec {
  id: Day4Choice
  label: string
  text: string
}

export const DAY4_CHOICES: readonly Day4ChoiceSpec[] = [
  { id: 'team', label: '팀을 지킨다', text: '우리 팀이 최종 2위 이내' },
  { id: 'self', label: '나를 지킨다', text: '내 주 미션 달성' },
  { id: 'bond', label: '그 사람을 지킨다', text: '내 인연 미션 달성' },
]

export const DAY4_CHOICE_IDS: readonly Day4Choice[] = DAY4_CHOICES.map((c) => c.id)

/** 「팀을 지킨다」가 성립하는 순위. 공동 2위도 성공이다. */
export const DAY4_TEAM_RANK_WITHIN = 2

/** DAY 4 하루 동안만. 여기도 날짜 검사 하나면 족하다. */
export function canChooseDay4(day: number): { ok: boolean; reason: ChooseRefusal | null } {
  if (day !== DAY4_CHOICE_DAY) return { ok: false, reason: 'wrongDay' }
  return { ok: true, reason: null }
}

export interface Day4Outcome {
  choice: Day4Choice | null
  /** 우리 팀 최종 순위. 1이 1위다. */
  teamRank: number
  /** 주 미션을 달성했는가. */
  mainMet: boolean
  /** 인연 미션을 달성했는가. */
  bondMet: boolean
}

/**
 * 고른 것을 지켰는가.
 *
 * 안 골랐으면 실패다. 「아무것도 고르지 않음」은 세 번째 선택지가
 * 아니다 — 고르는 일 자체가 DAY 4의 미션이다.
 */
export function day4Met(out: Day4Outcome): boolean {
  if (out.choice === null) return false
  if (out.choice === 'team') return out.teamRank <= DAY4_TEAM_RANK_WITHIN
  if (out.choice === 'self') return out.mainMet
  return out.bondMet
}

// ── 종례의 두 가지 ──────────────────────────────────────────────

export interface ClosingInput {
  /** 사람마다 고른 중요한 사람. 안 골랐으면 null. */
  chosenBy: Readonly<Record<string, string | null>>
  /** 종례 순간 사람마다 선 칸. 걷는 중이면 null. */
  tileAt: Readonly<Record<string, string | null>>
}

/** 종례 순간 중요한 사람과 같은 칸에 있었는가. */
export function closingTogether(input: ClosingInput): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const [playerId, chosen] of Object.entries(input.chosenBy)) {
    const mine = input.tileAt[playerId]
    // 걷는 중이면 어느 칸에도 없다. 같이 있던 것이 아니다
    out[playerId] = chosen !== null && mine !== null && mine !== undefined && input.tileAt[chosen] === mine
  }
  return out
}

/** 서로를 중요한 사람으로 골랐는가. */
export function closingMutual(chosenBy: Readonly<Record<string, string | null>>): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const [playerId, chosen] of Object.entries(chosenBy)) {
    out[playerId] = chosen !== null && chosenBy[chosen] === playerId
  }
  return out
}
