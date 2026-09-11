// 다섯 시의 창고.
//
// DAY 5 17:00 정각, 창고의 문이 잠긴다. 그 순간 창고에 서 있는 사람은
// 19:00까지 나올 수 없다. 행동은 할 수 있고, 판정에서도 센다.
//
// DAY 5 아침에 열리는 A의 마지막 메모에 「다섯 시」가 적혀 있다.
// 알아챈 사람만 피할 수 있다. 그래서 이 규칙은 미리 알리지 않는다 —
// 아침 시퀀스의 「오늘 일어나는 일」 카드에도 넣지 않는다.
import { STORAGE_LOCK_DAY, STORAGE_LOCK_HOUR, STORAGE_TILE, STORAGE_UNLOCK_HOUR } from './v2'
import { dayNumber, secondsIntoSeoulDay, seoulTimeOn } from './clock'
import type { TileId } from './board'

export const LOCKED_TILE: TileId = STORAGE_TILE

/** 그날 문이 잠기는 시각. */
export function lockAtMs(day5Ms: number): number {
  return seoulTimeOn(day5Ms, STORAGE_LOCK_HOUR)
}

/** 문이 열리는 시각. */
export function unlockAtMs(day5Ms: number): number {
  return seoulTimeOn(day5Ms, STORAGE_UNLOCK_HOUR)
}

/** 지금 창고가 잠겨 있는가. */
export function isLocked(startedAtMs: number, nowMs: number): boolean {
  if (dayNumber(startedAtMs, nowMs) !== STORAGE_LOCK_DAY) return false
  const s = secondsIntoSeoulDay(nowMs)
  return s >= STORAGE_LOCK_HOUR * 3600 && s < STORAGE_UNLOCK_HOUR * 3600
}

/**
 * 잠긴 문에 갇혔는가. 17:00 정각에 그 칸에 **서 있던** 사람만이다.
 * 걷는 중이었으면 갇히지 않는다 — 아직 도착하지 않았다.
 */
export function lockedIn(tileId: TileId | null, atLockMoment: boolean): boolean {
  return atLockMoment && tileId === LOCKED_TILE
}

export type LeaveRefusal = 'lockedInStorage'

/** 지금 이 사람이 창고를 떠날 수 있는가. */
export function canLeave(
  tileId: TileId | null,
  startedAtMs: number,
  nowMs: number,
  wasLockedIn: boolean,
): { ok: boolean; reason: LeaveRefusal | null } {
  if (!wasLockedIn) return { ok: true, reason: null }
  if (tileId !== LOCKED_TILE) return { ok: true, reason: null }
  return isLocked(startedAtMs, nowMs)
    ? { ok: false, reason: 'lockedInStorage' }
    : { ok: true, reason: null }
}
