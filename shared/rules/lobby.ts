// 로비. 자리와 닷새치 시간표.
//
// 화면과 서버가 같이 쓴다 — 로비 화면이 「C팀 한 자리 남음」을 그리는
// 계산과 서버가 참가를 받아 주는 계산이 같아야 한다. 둘이 다르면
// 화면에는 자리가 있는데 눌러도 거절당한다.
import { dayHourMs, dayStartMs } from './clock'
import {
  LAST_HOURS_DAY,
  LAST_HOURS_START_HOUR,
  SETTLEMENT_HOUR,
  TEAM_SIZES,
  TOTAL_DAYS,
  type TeamId,
} from './v2'

export const TEAMS = Object.keys(TEAM_SIZES) as TeamId[]

/** 열넷이 다 앉아야 시작한다. */
export const TOTAL_SEATS = Object.values(TEAM_SIZES).reduce((a, b) => a + b, 0)

export interface Seat {
  playerId: string
  team: TeamId
}

/** 팀마다 몇 자리 남았는가. */
export function seatsLeft(seats: readonly Seat[]): Record<TeamId, number> {
  return Object.fromEntries(
    TEAMS.map((t) => [t, TEAM_SIZES[t] - seats.filter((s) => s.team === t).length]),
  ) as Record<TeamId, number>
}

/** 아직 자리가 남은 팀. 적게 찬 쪽부터 — 고르지 않은 사람은 여기 첫 팀으로 간다. */
export function openTeams(seats: readonly Seat[]): TeamId[] {
  const left = seatsLeft(seats)
  return TEAMS.filter((t) => left[t] > 0).sort((a, b) => left[b] - left[a] || TEAMS.indexOf(a) - TEAMS.indexOf(b))
}

/** 시작할 수 있는가. 인원과 팀별 정원이 정확히 맞아야 한다. */
export function canStart(seats: readonly Seat[]): { ok: boolean; reason: string | null } {
  if (seats.length !== TOTAL_SEATS) return { ok: false, reason: `${TOTAL_SEATS}명이어야 한다 (${seats.length}명).` }
  if (new Set(seats.map((s) => s.playerId)).size !== seats.length) {
    return { ok: false, reason: '같은 사람이 두 번 앉아 있다.' }
  }
  for (const t of TEAMS) {
    const got = seats.filter((s) => s.team === t).length
    if (got !== TEAM_SIZES[t]) return { ok: false, reason: `${t}팀은 ${TEAM_SIZES[t]}명이어야 한다 (${got}명).` }
  }
  return { ok: true, reason: null }
}

// ── 닷새치 시간표 ───────────────────────────────────────────────

export type TimedKind = 'dayStart' | 'settlement' | 'lastHours' | 'gameEnd'

export interface TimedEvent {
  dueAtMs: number
  kind: TimedKind
  day: number
}

/**
 * 시작할 때 한 번에 깔아 두는 정시 이벤트.
 *
 * DAY 1의 08:00은 시작 그 자체라 따로 밀 것이 없다. 마지막은 DAY 5
 * 소등이다 — 24시를 넘겨 세는 건 dayHourMs가 맡는다.
 */
export function timedEvents(startedAtMs: number): TimedEvent[] {
  const out: TimedEvent[] = []
  for (let day = 1; day <= TOTAL_DAYS; day++) {
    if (day > 1) out.push({ dueAtMs: dayStartMs(startedAtMs, day), kind: 'dayStart', day })
    out.push({ dueAtMs: dayHourMs(startedAtMs, day, SETTLEMENT_HOUR), kind: 'settlement', day })
    if (day === LAST_HOURS_DAY) {
      out.push({ dueAtMs: dayHourMs(startedAtMs, day, LAST_HOURS_START_HOUR), kind: 'lastHours', day })
    }
  }
  out.push({ dueAtMs: dayHourMs(startedAtMs, TOTAL_DAYS, 24), kind: 'gameEnd', day: TOTAL_DAYS })
  return out.sort((a, b) => a.dueAtMs - b.dueAtMs)
}
