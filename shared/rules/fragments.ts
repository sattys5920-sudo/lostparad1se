// A의 기록.
//
// A는 판에 나타나지 않는다. 매일 08:00에 한 조각씩 열리고, 조각 하나는
// 늘 세 가지를 한다 — 칸 하나의 가치를 올리고, 판을 바꾸고, 역할 한둘을
// 은근히 가리킨다.
//
// 가리켜진 역할이 무엇인지는 여기 없다. 그건 개인 미션 쪽 데이터
// (HINT_SCHEDULE)에 있고, 표 계산에는 「정확히 짚었다」는 답만 들어온다.
// 두 시스템을 붙이지 않으려고 일부러 갈라 뒀다.
import {
  CORE_OPENING,
  FRAGMENT_TILE_BONUS,
  GOAL_REVEAL_DAY,
  LAST_HOURS_DAY,
  LAST_HOURS_START_HOUR,
  TOTAL_DAYS,
} from './v2'
import { TILE_BY_ID, type TileId } from './board'
import { dayNumber, secondsIntoSeoulDay, seoulTimeOn } from './clock'

/** 그날 열리는 칸. 아직 열리지 않은 핵심에는 깃발을 꽂을 수 없다. */
export function openedOn(day: number): readonly TileId[] {
  return CORE_OPENING[day] ?? []
}

/** 오늘까지 열린 칸 전부. */
export function openTilesBy(day: number): Set<TileId> {
  const out = new Set<TileId>()
  for (let d = 1; d <= day; d++) for (const id of openedOn(d)) out.add(id)
  return out
}

/** 그 칸에 지금 깃발을 꽂을 수 있는가. 핵심·중앙광장만 이 제한을 받는다. */
export function coreOpen(tileId: TileId, day: number): boolean {
  const tier = TILE_BY_ID[tileId].tier
  if (tier !== 'core' && tier !== 'plaza') return true
  return openTilesBy(day).has(tileId)
}

/** 조각이 지목한 칸. 가치가 끝까지 +2 오른다. */
export interface Fragment {
  day: number
  /** 가치가 오르는 칸. */
  spotTile: TileId
}

/** 그 칸의 지금 가치. 기본값 + 기록 보너스. */
export function tileValue(tileId: TileId, fragments: readonly Fragment[]): number {
  const bonus = fragments.filter((f) => f.spotTile === tileId).length * FRAGMENT_TILE_BONUS
  return TILE_BY_ID[tileId].value + bonus
}

// ── 날마다 일어나는 일 ──────────────────────────────────────────

export interface DayEvents {
  day: number
  /** 오늘 열리는 칸. */
  opens: readonly TileId[]
  /** 비밀 목표 한 장을 공개해야 하는 날인가. */
  goalReveal: boolean
  /** 마지막 여섯 시간이 있는 날인가. */
  hasLastHours: boolean
}

export function eventsOn(day: number): DayEvents {
  return {
    day,
    opens: openedOn(day),
    goalReveal: day === GOAL_REVEAL_DAY,
    hasLastHours: day === LAST_HOURS_DAY,
  }
}

/** 지금 마지막 여섯 시간인가. DAY 5 15:00부터 종례까지. */
export function inLastHours(startedAtMs: number, nowMs: number): boolean {
  if (dayNumber(startedAtMs, nowMs) !== LAST_HOURS_DAY) return false
  return secondsIntoSeoulDay(nowMs) >= LAST_HOURS_START_HOUR * 3600
}

/** 마지막 여섯 시간이 시작되는 실제 시각. 이때 익고 있던 깃발이 반으로 준다. */
export function lastHoursStartMs(day5Ms: number): number {
  return seoulTimeOn(day5Ms, LAST_HOURS_START_HOUR)
}

/** 판이 끝났는가. DAY 5 21:00 종례. */
export function isOver(startedAtMs: number, nowMs: number): boolean {
  return dayNumber(startedAtMs, nowMs) > TOTAL_DAYS
}

// ── 개방 구조 확인용 ────────────────────────────────────────────

