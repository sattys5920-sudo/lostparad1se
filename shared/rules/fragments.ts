// A의 기록.
//
// A는 판에 나타나지 않는다. 매일 08:00에 한 조각씩 열리고, 조각 하나는
// 칸 하나의 가치를 올린다.
//
// **방을 열어 주는 일은 이제 안 한다.** 전에는 날마다 핵심을 두 칸씩
// 열어 줬고 열리기 전에는 가질 수 없었다. 스물다섯 방 전부 첫날부터
// 다툰다 — v2.ts 의 「방은 처음부터 다 열려 있다」를 보라.
import {
  FRAGMENT_TILE_BONUS,
  LAST_HOURS_DAY,
  LAST_HOURS_START_HOUR,
  TOTAL_DAYS,
} from './v2'
import { TILE_BY_ID, type TileId } from './board'
import { dayNumber, secondsIntoSeoulDay, seoulTimeOn } from './clock'

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
  /** 마지막 여섯 시간이 있는 날인가. */
  hasLastHours: boolean
}

export function eventsOn(day: number): DayEvents {
  return { day, hasLastHours: day === LAST_HOURS_DAY }
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

