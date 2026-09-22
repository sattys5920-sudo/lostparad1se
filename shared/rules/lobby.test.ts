import { describe, expect, it } from 'vitest'
import {
  TEAMS,
  TOTAL_SEATS,
  canAssign,
  canStart,
  dealTeams,
  openTeams,
  seatsLeft,
  timedEvents,
  type Seat,
} from './lobby'
import { STARTING_TEAM_SIZES, TOTAL_DAYS, type TeamId } from './v2'
import { dayNumber, secondsIntoSeoulDay } from './clock'

const full = (): Seat[] =>
  TEAMS.flatMap((t) =>
    Array.from({ length: STARTING_TEAM_SIZES[t] }, (_, i) => ({ playerId: `${t}${i}`, team: t })),
  )

describe('자리', () => {
  it('열넷이다', () => {
    expect(TOTAL_SEATS).toBe(14)
    expect(full()).toHaveLength(14)
  })

  it('빈 로비는 네 팀 다 열려 있다', () => {
    expect(openTeams([])).toHaveLength(4)
    expect(seatsLeft([])).toEqual({ A: 4, B: 4, C: 3, D: 3 })
  })

  it('안 고른 사람은 가장 많이 빈 팀으로 간다', () => {
    const seats: Seat[] = [{ playerId: 'x', team: 'A' }]
    expect(openTeams(seats)[0]).toBe('B')
  })

  it('다 찬 팀은 목록에서 빠진다', () => {
    const seats = full().filter((s) => s.team !== 'A')
    expect(openTeams(seats)).toEqual(['A'])
  })

  it('꽉 차면 아무 팀도 안 남는다', () => {
    expect(openTeams(full())).toEqual([])
  })
})

describe('시작할 수 있는가', () => {
  it('열넷이 정원대로 앉으면 된다', () => {
    expect(canStart(full()).ok).toBe(true)
  })

  it('한 명 모자라면 안 된다', () => {
    expect(canStart(full().slice(1)).ok).toBe(false)
  })

  it('아직 배정하지 않았으면 안 된다', () => {
    const out = canStart(seated())
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch('배정')
  })

  it('한 사람만 팀이 없어도 안 된다', () => {
    const seats = full()
    seats[3] = { ...seats[3], team: null }
    expect(canStart(seats).ok).toBe(false)
  })

  it('같은 사람이 두 번 앉아 있으면 안 된다', () => {
    const seats = full()
    seats[1] = { ...seats[1], playerId: seats[0].playerId }
    expect(canStart(seats).reason).toMatch('두 번')
  })

  it('머릿수는 맞아도 팀이 어긋나면 안 된다', () => {
    const seats = full()
    const a = seats.findIndex((s) => s.team === 'A')
    const c = seats.findIndex((s) => s.team === 'C')
    seats[a] = { ...seats[a], team: 'C' as TeamId }
    seats[c] = { ...seats[c], team: 'A' as TeamId }
    expect(canStart(seats).ok).toBe(true) // 맞바꾼 것이라 정원은 그대로다

    seats[a] = { ...seats[a], team: 'B' as TeamId }
    expect(canStart(seats).ok).toBe(false)
  })
})

/** 팀 없이 앉기만 한 열넷. 배정 전 로비의 모습이다. */
const seated = (n = TOTAL_SEATS): Seat[] =>
  Array.from({ length: n }, (_, i) => ({ playerId: `p${String(i).padStart(2, '0')}`, team: null }))

describe('배정할 수 있는가', () => {
  it('열넷이 다 앉으면 된다', () => {
    expect(canAssign(seated()).ok).toBe(true)
  })

  it('한 명 모자라면 안 된다', () => {
    expect(canAssign(seated(13)).ok).toBe(false)
  })

  it('같은 사람이 두 번 앉아 있으면 안 된다', () => {
    const seats = seated()
    seats[1] = { ...seats[1], playerId: seats[0].playerId }
    expect(canAssign(seats).reason).toMatch('두 번')
  })

  it('운영자가 정원보다 많이 못 박아 두면 안 된다', () => {
    const seats = seated()
    for (let i = 0; i < STARTING_TEAM_SIZES.A + 1; i++) seats[i] = { ...seats[i], team: 'A' as TeamId }
    expect(canAssign(seats).ok).toBe(false)
    expect(canAssign(seats).reason).toMatch('A팀')
  })

  it('정원만큼 못 박은 것은 된다', () => {
    const seats = seated()
    for (let i = 0; i < STARTING_TEAM_SIZES.A; i++) seats[i] = { ...seats[i], team: 'A' as TeamId }
    expect(canAssign(seats).ok).toBe(true)
  })
})

describe('팀 나누기', () => {
  it('빈 로비를 4·4·3·3으로 채운다', () => {
    const out = dealTeams(seated(), 'seed')
    for (const t of TEAMS) {
      expect(out.filter((s) => s.team === t).length, t).toBe(STARTING_TEAM_SIZES[t])
    }
    expect(out.some((s) => s.team === null)).toBe(false)
  })

  it('나눈 자리는 곧바로 시작할 수 있다', () => {
    expect(canStart(dealTeams(seated(), 'seed')).ok).toBe(true)
  })

  it('같은 씨앗이면 같은 답이다', () => {
    expect(dealTeams(seated(), 'same')).toEqual(dealTeams(seated(), 'same'))
  })

  it('씨앗을 바꾸면 답이 달라진다 — 늘 같은 자리에 같은 팀이 오지 않는다', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 20; i++) {
      seen.add(dealTeams(seated(), `seed-${i}`).map((s) => s.team).join(''))
    }
    expect(seen.size).toBeGreaterThan(1)
  })

  it('들어온 순서는 결과를 바꾸지 않는다', () => {
    const a = dealTeams(seated(), 'order')
    const b = dealTeams([...seated()].reverse(), 'order')
    const teamOf = (rows: Seat[]) => new Map(rows.map((s) => [s.playerId, s.team]))
    expect(teamOf(b)).toEqual(teamOf(a))
  })

  it('못 박아 둔 자리는 안 건드린다', () => {
    const seats = seated()
    seats[0] = { ...seats[0], team: 'C' as TeamId }
    seats[1] = { ...seats[1], team: 'C' as TeamId }
    const out = dealTeams(seats, 'pinned')
    expect(out[0].team).toBe('C')
    expect(out[1].team).toBe('C')
    for (const t of TEAMS) {
      expect(out.filter((s) => s.team === t).length, t).toBe(STARTING_TEAM_SIZES[t])
    }
  })

  it('이미 다 정해져 있으면 그대로 돌려준다', () => {
    expect(dealTeams(full(), 'x')).toEqual(full())
  })
})

describe('닷새치 시간표', () => {
  // DAY 1 08:00에 시작한 판
  const start = Date.UTC(2026, 2, 1, 23, 0, 0)
  const list = timedEvents(start)
  const kinds = (k: string) => list.filter((e) => e.kind === k)

  it('시각순이다', () => {
    const sorted = [...list].sort((a, b) => a.dueAtMs - b.dueAtMs)
    expect(list).toEqual(sorted)
  })

  it('정산은 닷새 모두 있다', () => {
    expect(kinds('settlement')).toHaveLength(TOTAL_DAYS)
  })

  it('DAY 1 아침은 시작 그 자체라 따로 없다', () => {
    expect(kinds('dayStart').map((e) => e.day)).toEqual([2, 3, 4, 5])
  })

  it('마지막 여섯 시간은 DAY 5에 한 번', () => {
    const last = kinds('lastHours')
    expect(last).toHaveLength(1)
    expect(last[0].day).toBe(5)
  })

  it('끝은 하나뿐이고 맨 마지막이다', () => {
    expect(kinds('gameEnd')).toHaveLength(1)
    expect(list[list.length - 1].kind).toBe('gameEnd')
  })

  it('정산은 전부 21:00이다', () => {
    for (const e of kinds('settlement')) {
      expect(secondsIntoSeoulDay(e.dueAtMs) / 3600).toBe(21)
    }
  })

  it('하루의 시작은 전부 자정이고 그날이 맞다', () => {
    for (const e of kinds('dayStart')) {
      expect(secondsIntoSeoulDay(e.dueAtMs) / 3600).toBe(0)
      expect(dayNumber(start, e.dueAtMs)).toBe(e.day)
    }
  })

  // DAY 5 의 24시는 자정 직전까지 아직 DAY 5다
  it('끝나는 시각은 아직 DAY 5다', () => {
    const end = kinds('gameEnd')[0]
    expect(dayNumber(start, end.dueAtMs - 1)).toBe(5)
  })

  it('정산이 그날 안에 있다', () => {
    for (const e of kinds('settlement')) {
      expect(dayNumber(start, e.dueAtMs)).toBe(e.day)
    }
  })

  // 08:00 전에 시작한 판도 그날이 DAY 1이다
  it('새벽에 연 판도 그날이 DAY 1이다', () => {
    const dawn = Date.UTC(2026, 2, 1, 20, 0, 0) // 서울 05:00
    for (const e of timedEvents(dawn)) {
      if (e.kind === 'gameEnd') continue
      expect(dayNumber(dawn, e.dueAtMs)).toBe(e.day)
    }
  })
})
