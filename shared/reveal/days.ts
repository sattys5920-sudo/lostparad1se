// 닷새의 이름과, 그날 일어나는 일.
//
// 날 이름은 team_rules_v2 2장과 otherworld_setting 7장의 것이다. 숨길
// 것이 없어 화면과 서버가 같이 쓴다.
//
// 「오늘 일어나는 일」 카드에는 **시스템 사건만 사실대로** 적는다.
// 해석도 암시도 넣지 않는다 — 「오늘은 균열의 날입니다」 같은 말은
// 플레이어가 스스로 느껴야 하는 것을 대신 말해 버린다.
//
// 다섯 시의 창고는 여기 없다. 알아챈 사람만 피할 수 있어야 하고,
// 알아챌 단서는 그날 아침 A의 마지막 메모에 이미 적혀 있다.
import { ALLIANCE_CLEAR_DAY, CORE_OPENING, GOAL_REVEAL_DAY, LAST_HOURS_DAY, LAST_HOURS_START_HOUR, RUMOR_DECAY_DAY, TOTAL_DAYS } from '../rules/v2'
import { CHOSEN_ONE_DAY } from '../missions/roles'
import { TILE_BY_ID, type TileId } from '../rules/board'

export const DAY_NAMES: Record<number, string> = {
  1: '평범했던 우리',
  2: '소문',
  3: '균열',
  4: '선택',
  5: '마지막 날',
}

export function dayName(day: number): string {
  return DAY_NAMES[day] ?? ''
}

/** 날짜 카드에 찍히는 한 줄. 「DAY 2 · 소문」 */
export function dateCardLine(day: number): string {
  return `DAY ${day} · ${dayName(day)}`
}

/**
 * 「오늘 일어나는 일」 한 줄.
 *
 * kind는 화면이 아이콘을 고르는 데 쓴다. text는 그대로 찍는다.
 * needsName이 붙은 줄은 서버가 이름을 채워 넣는다 — 투명인간뿐이다.
 */
export type TodayKind = 'open' | 'invisible' | 'alliance' | 'goal' | 'chosen' | 'scoreboard' | 'rumor'

export interface TodayItem {
  kind: TodayKind
  text: string
}

export interface TodayInput {
  day: number
  /** 오늘의 투명인간. 없으면 null — 표가 갈렸거나 두 장이 안 됐다. */
  invisibleName?: string | null
}

const tileName = (id: TileId): string => TILE_BY_ID[id]?.name ?? id

/** 그날 아침에 알려 줄 것 전부. 순서는 이 배열 그대로다. */
export function todayItems(input: TodayInput): TodayItem[] {
  const out: TodayItem[] = []
  const { day } = input

  const opens = CORE_OPENING[day] ?? []
  if (opens.length > 0) {
    out.push({ kind: 'open', text: `${opens.map(tileName).join(' · ')} 개방` })
  }

  // 투명인간은 어제 21:00에 정해졌다. 오늘 하루 지워진다
  if (input.invisibleName) {
    out.push({ kind: 'invisible', text: `오늘의 투명인간 · ${input.invisibleName}` })
  }

  if (day === RUMOR_DECAY_DAY) {
    out.push({ kind: 'rumor', text: '소문으로 깎이는 영향력이 두 배' })
  }
  if (day === GOAL_REVEAL_DAY) {
    out.push({ kind: 'goal', text: '팀마다 비밀 목표 한 장을 골라 공개' })
  }
  if (day === CHOSEN_ONE_DAY) {
    out.push({ kind: 'chosen', text: '중요한 사람을 고른다' })
  }
  if (day === ALLIANCE_CLEAR_DAY) {
    out.push({ kind: 'alliance', text: '모든 동맹이 풀린다' })
  }
  if (day === LAST_HOURS_DAY) {
    out.push({ kind: 'scoreboard', text: `${LAST_HOURS_START_HOUR}:00부터 점수판이 꺼진다` })
  }

  return out
}

export const DAYS: readonly number[] = Array.from({ length: TOTAL_DAYS }, (_, i) => i + 1)
