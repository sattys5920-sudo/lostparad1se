// 자정 판정 — 네 가지 판정과, 본인에게 가는 판에서 새는 것이 없는지.
import { describe, expect, it } from 'vitest'

import { combine, dayVerdict, dayView, deltaOf } from './daily'
import type { ClauseProgress, PersonalResult, SlipMissionProgress } from './judge'

const clause = (over: Partial<ClauseProgress>): ClauseProgress => ({
  kind: 'errandsDone',
  text: '완료한 심부름',
  disclosure: 'realtime',
  unit: 'count',
  mode: 'atLeast',
  have: 0,
  bar: 4,
  met: false,
  broken: false,
  ...over,
})
const slip = (over: Partial<SlipMissionProgress>): SlipMissionProgress => ({
  id: 'twiceSamePerson',
  text: '같은 사람의 쪽지를 두 번 손에 넣는다',
  disclosure: 'realtime',
  unit: 'count',
  mode: 'atLeast',
  have: 0,
  bar: 2,
  met: false,
  broken: false,
  ...over,
})
const result = (clauses: ClauseProgress[], slips: SlipMissionProgress[] = [], choiceMet = false): PersonalResult => ({
  playerId: 'me',
  roleId: 'duty',
  main: { text: '', clauses, met: clauses.every((c) => c.met), broken: clauses.some((c) => c.broken) },
  slips,
  choiceMet,
})
const mid = { final: false, ballotDaysLeft: 2 }
const end = { final: true, ballotDaysLeft: 0 }

describe('네 가지 판정', () => {
  it('채웠으면 달성 — 세는 수는 줄지 않으니 뒤집히지 않는다', () => {
    expect(dayVerdict(result([clause({ have: 4, met: true })]), mid).status).toBe('met')
  })
  it('아직 못 채웠으면 진행 중이고 지금 수치를 같이 적는다', () => {
    const v = dayVerdict(result([clause({ have: 2 })]), mid)
    expect(v.status).toBe('running')
    expect(v.clauses[0].have).toBe(2)
  })
  it('마지막 날 못 채웠으면 실패, 채웠으면 달성', () => {
    expect(dayVerdict(result([clause({ have: 2 })]), end).status).toBe('failed')
    expect(dayVerdict(result([clause({ have: 5, met: true })]), end).status).toBe('met')
  })
  it('전학생의 순위는 끝날 때 판정 — 나머지를 채워도 끝나야 안다', () => {
    const v = dayVerdict(
      result([
        clause({ kind: 'teamNotFirstAtEnd', unit: 'flag', have: 1, bar: 1, met: true, disclosure: 'endOnly' }),
        clause({ kind: 'otherTeamRoomsStood', have: 3, bar: 3, met: true }),
      ]),
      mid,
    )
    expect(v.clauses[0].status).toBe('endOnly')
    expect(v.status).toBe('endOnly')
  })
  it('마지막 선택은 마지막 날에만 정해진다', () => {
    expect(dayVerdict(result([clause({})], [], true), mid).choice).toBe('endOnly')
    expect(dayVerdict(result([clause({})], [], true), end).choice).toBe('met')
    expect(dayVerdict(result([clause({})], [], false), end).choice).toBe('failed')
  })
})

describe('실패 확정은 뒤집힐 수 없을 때만', () => {
  const hits = (have: number) =>
    clause({ kind: 'invisibleHits', text: '내가 적은 이름이 투명인간이 된 날', have, bar: 2, disclosure: 'afterBallot' })
  it('뒷자리 — 남은 투표 날로 채울 수 있으면 진행 중', () => {
    expect(dayVerdict(result([hits(0)]), { final: false, ballotDaysLeft: 2 }).status).toBe('running')
    expect(dayVerdict(result([hits(1)]), { final: false, ballotDaysLeft: 1 }).status).toBe('running')
  })
  it('뒷자리 — 남은 투표 날을 다 맞혀도 모자라면 실패 확정', () => {
    expect(dayVerdict(result([hits(0)]), { final: false, ballotDaysLeft: 1 }).status).toBe('failed')
  })
  it('미화부처럼 새 종이가 생길 수 있는 것은 끝나기 전에 실패로 안 떨어진다', () => {
    const torn = clause({ kind: 'slipsTorn', have: 0, bar: 3 })
    expect(dayVerdict(result([torn]), { final: false, ballotDaysLeft: 0 }).status).toBe('running')
  })
  it('「2명 이하」는 넘으면 실패 확정, 안 넘었으면 아직 모른다', () => {
    const few = (have: number) =>
      slip({ id: 'fewReadMine', mode: 'atMost', have, bar: 2, met: have <= 2, broken: have > 2, disclosure: 'endOnly' })
    expect(dayVerdict(result([clause({})], [few(3)]), mid).slips[0].status).toBe('failed')
    expect(dayVerdict(result([clause({})], [few(1)]), mid).slips[0].status).toBe('running')
  })
})

describe('본인에게 가는 판', () => {
  it('끝날 때 공개인 것은 값도 상태도 빠진다 — 세 사람이 읽었다는 것이 새지 않는다', () => {
    const few = slip({ id: 'fewReadMine', mode: 'atMost', have: 3, bar: 2, met: false, broken: true, disclosure: 'endOnly' })
    const v = dayView(dayVerdict(result([clause({})], [few]), mid), false)
    expect(v.slips[0].have).toBeNull()
    expect(v.slips[0].status).toBe('endOnly')
    expect(JSON.stringify(v)).not.toContain('"have":3')
  })
  it('하루가 바뀔 때 공개인 것(모범생의 표)은 자정에 열린다', () => {
    const trust = clause({ kind: 'trustReceived', have: 2, bar: 3, disclosure: 'daily' })
    expect(dayView(dayVerdict(result([trust]), mid), false).clauses[0].have).toBe(2)
  })
  it('마지막 날에는 다 열린다', () => {
    const few = slip({ id: 'fewReadMine', mode: 'atMost', have: 3, bar: 2, met: false, broken: true, disclosure: 'endOnly' })
    const v = dayView(dayVerdict(result([clause({})], [few]), end), true)
    expect(v.slips[0].have).toBe(3)
    expect(v.slips[0].status).toBe('failed')
  })
})

describe('묶기 · 전날 대비', () => {
  it('하나라도 실패면 실패, 다 달성이면 달성', () => {
    expect(combine(['met', 'failed'])).toBe('failed')
    expect(combine(['met', 'met'])).toBe('met')
    expect(combine(['met', 'running'])).toBe('running')
    expect(combine(['running', 'endOnly'])).toBe('endOnly')
  })
  it('전날보다 얼마나 늘었나', () => {
    const a = dayVerdict(result([clause({ have: 1 })]), mid).clauses
    const b = dayVerdict(result([clause({ have: 3 })]), mid).clauses
    expect(deltaOf(b, a)).toEqual([2])
    expect(deltaOf(b, null)).toEqual([null])
  })
})
