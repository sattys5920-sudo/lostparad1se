import type { PresenceInterval } from '../types'

/**
 * 위치 구간에서 시간을 뽑아내는 계산들. 좌표를 쌓지 않고 "언제부터 언제까지 어느 방"만
 * 남겨 두면, 함께 있던 시간은 두 구간의 겹침으로 나온다.
 *
 * 아직 방을 안 나갔으면 leftAtMs가 null이다. 그때는 "지금"까지로 친다.
 */

function endOf(iv: PresenceInterval, now: number): number {
  return iv.leftAtMs ?? now
}

function lengthOf(iv: PresenceInterval, now: number): number {
  return Math.max(0, endOf(iv, now) - iv.enteredAtMs)
}

function overlap(a: PresenceInterval, b: PresenceInterval, now: number): number {
  if (a.roomId !== b.roomId) return 0
  const start = Math.max(a.enteredAtMs, b.enteredAtMs)
  const end = Math.min(endOf(a, now), endOf(b, now))
  return Math.max(0, end - start)
}

const toSeconds = (ms: number) => Math.floor(ms / 1000)

export function mine(intervals: PresenceInterval[], playerId: string): PresenceInterval[] {
  return intervals.filter((iv) => iv.playerId === playerId)
}

/** 들어가 본 서로 다른 구역 수. */
export function roomsVisited(intervals: PresenceInterval[], playerId: string): number {
  return new Set(mine(intervals, playerId).map((iv) => iv.roomId)).size
}

/** 지정한 구역들에 머문 총 시간(초). */
export function roomSeconds(
  intervals: PresenceInterval[],
  playerId: string,
  rooms: string[],
  now: number,
): number {
  const set = new Set(rooms)
  return toSeconds(
    mine(intervals, playerId)
      .filter((iv) => set.has(iv.roomId))
      .reduce((sum, iv) => sum + lengthOf(iv, now), 0),
  )
}

/** 특정 인물과 같은 방에 있던 총 시간(초). */
export function togetherSeconds(
  intervals: PresenceInterval[],
  playerId: string,
  otherId: string,
  now: number,
): number {
  const a = mine(intervals, playerId)
  const b = mine(intervals, otherId)
  let ms = 0
  for (const x of a) for (const y of b) ms += overlap(x, y, now)
  return toSeconds(ms)
}

/** 한 번이라도 같은 방에 있었던 서로 다른 사람 수. */
export function metDistinct(intervals: PresenceInterval[], playerId: string): number {
  const a = mine(intervals, playerId)
  const met = new Set<string>()
  for (const other of intervals) {
    if (other.playerId === playerId) continue
    if (met.has(other.playerId)) continue
    if (a.some((x) => overlap(x, other, Date.now()) > 0)) met.add(other.playerId)
  }
  return met.size
}

/** 일정 시간 이상 함께 있었던 서로 다른 사람 수. */
export function togetherDistinct(
  intervals: PresenceInterval[],
  playerId: string,
  minSeconds: number,
  now: number,
): number {
  const others = new Set(intervals.filter((iv) => iv.playerId !== playerId).map((iv) => iv.playerId))
  let count = 0
  for (const otherId of others) {
    if (togetherSeconds(intervals, playerId, otherId, now) >= minSeconds) count += 1
  }
  return count
}

/**
 * 방에 나 혼자였던 시간(초). 내 구간에서, 같은 방에 겹쳐 있던 남의 구간을 전부 뺀다.
 * 겹치는 구간이 여럿이면 합집합으로 빼야 이중으로 빠지지 않는다.
 */
export function aloneSeconds(intervals: PresenceInterval[], playerId: string, now: number): number {
  let ms = 0
  for (const iv of mine(intervals, playerId)) {
    const start = iv.enteredAtMs
    const end = endOf(iv, now)
    const busy: [number, number][] = []
    for (const other of intervals) {
      if (other.playerId === playerId || other.roomId !== iv.roomId) continue
      const s = Math.max(start, other.enteredAtMs)
      const e = Math.min(end, endOf(other, now))
      if (e > s) busy.push([s, e])
    }
    busy.sort((p, q) => p[0] - q[0])
    let occupied = 0
    let cursor = start
    for (const [s, e] of busy) {
      if (e <= cursor) continue
      occupied += e - Math.max(s, cursor)
      cursor = Math.max(cursor, e)
    }
    ms += Math.max(0, end - start - occupied)
  }
  return toSeconds(ms)
}

/**
 * 특정 인물과 "정확히 둘만" 있던 시간(초).
 * 겹친 구간에서 제3자가 낀 시간을 빼면 남는다.
 */
export function pairAloneSeconds(
  intervals: PresenceInterval[],
  playerId: string,
  otherId: string,
  now: number,
): number {
  let ms = 0
  for (const a of mine(intervals, playerId)) {
    for (const b of mine(intervals, otherId)) {
      const start = Math.max(a.enteredAtMs, b.enteredAtMs)
      const end = Math.min(endOf(a, now), endOf(b, now))
      if (end <= start || a.roomId !== b.roomId) continue
      const busy: [number, number][] = []
      for (const third of intervals) {
        if (third.playerId === playerId || third.playerId === otherId) continue
        if (third.roomId !== a.roomId) continue
        const s = Math.max(start, third.enteredAtMs)
        const e = Math.min(end, endOf(third, now))
        if (e > s) busy.push([s, e])
      }
      busy.sort((p, q) => p[0] - q[0])
      let occupied = 0
      let cursor = start
      for (const [s, e] of busy) {
        if (e <= cursor) continue
        occupied += e - Math.max(s, cursor)
        cursor = Math.max(cursor, e)
      }
      ms += Math.max(0, end - start - occupied)
    }
  }
  return toSeconds(ms)
}

/** 일정 시간 이상 단둘이 있었던 서로 다른 사람 수. */
export function pairAloneDistinct(
  intervals: PresenceInterval[],
  playerId: string,
  minSeconds: number,
  now: number,
): number {
  const others = new Set(intervals.filter((iv) => iv.playerId !== playerId).map((iv) => iv.playerId))
  let count = 0
  for (const otherId of others) {
    if (pairAloneSeconds(intervals, playerId, otherId, now) >= minSeconds) count += 1
  }
  return count
}

/**
 * 내가 있던 방에 남이 "나중에" 들어온 횟수.
 * 내가 쫓아간 것과 남이 찾아온 것을 가르는 건 들어온 순서뿐이다.
 */
export function visitedByOthers(intervals: PresenceInterval[], playerId: string, now: number): number {
  let count = 0
  for (const iv of mine(intervals, playerId)) {
    for (const other of intervals) {
      if (other.playerId === playerId || other.roomId !== iv.roomId) continue
      // 내가 먼저 있었고, 내가 나가기 전에 들어왔으면 찾아온 것으로 본다.
      if (other.enteredAtMs > iv.enteredAtMs && other.enteredAtMs < endOf(iv, now)) count += 1
    }
  }
  return count
}

/** 지금 그 방에 있는 사람들(구간이 열려 있는 사람). 목격자 판정에 쓴다. */
export function occupantsOf(intervals: PresenceInterval[], roomId: string): string[] {
  return [
    ...new Set(intervals.filter((iv) => iv.roomId === roomId && iv.leftAtMs === null).map((iv) => iv.playerId)),
  ]
}
