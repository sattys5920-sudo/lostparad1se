// A의 기록.
//
// A는 판에 나타나지 않는다. 매일 08:00에 한 조각씩 열린다. **그뿐이다** —
// 읽을 글 한 장이고, 판 위의 무엇도 바꾸지 않는다.
//
// 전에는 둘을 더 했다. 날마다 핵심을 두 칸씩 열어 줬고(열리기 전에는
// 가질 수 없었다), 칸 하나를 지목해 가치를 +2 올렸다. 둘 다 걷어냈다 —
// 여는 쪽은 열넷이 시작하는 방이 영영 안 열리는 구멍이 있었고,
// 지목하는 쪽은 애초에 점수 계산에 안 걸려 있었다.
import { LAST_HOURS_DAY, LAST_HOURS_START_HOUR, TOTAL_DAYS } from './v2'
import { dayNumber, secondsIntoSeoulDay, seoulTimeOn } from './clock'

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

