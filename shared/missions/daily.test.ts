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
const mid = { final: false, noBallot: false }
const end = { final: true, noBallot: true }

describe('하루짜리 — 자정이 기한이다', () => {
  it('그날 채웠으면 달성', () => {
    expect(dayVerdict(result([clause({ have: 4, met: true })]), mid).status).toBe('met')
  })
  it('그날 못 채웠으면 실패 — 자정 판정에 진행 중은 없다', () => {
    const v = dayVerdict(result([clause({ have: 2 })]), mid)
    expect(v.status).toBe('failed')
    expect(v.clauses[0].have).toBe(2)
  })
  it('마지막 선택만 마지막 날에 정해진다', () => {
    expect(dayVerdict(result([clause({})], [], true), mid).choice).toBe('endOnly')
    expect(dayVerdict(result([clause({})], [], true), end).choice).toBe('met')
    expect(dayVerdict(result([clause({})], [], false), end).choice).toBe('failed')
  })
  it('쪽지 미션도 그날 것으로 판정한다', () => {
    const few = slip({ id: 'fewReadMine', mode: 'atMost', have: 3, bar: 2, met: false, broken: true, disclosure: 'daily' })
    expect(dayVerdict(result([clause({})], [few]), mid).slips[0].status).toBe('failed')
    const two = slip({ have: 2, met: true })
    expect(dayVerdict(result([clause({})], [two]), mid).slips[0].status).toBe('met')
  })
})

describe('투명인간 투표가 없는 날', () => {
  const hits = (have: number) =>
    clause({ kind: 'invisibleHits', text: '내가 적은 이름이 오늘 투명인간이 됨', have, bar: 1, met: have >= 1, disclosure: 'afterBallot' })
  it('투표가 있는 날 — 맞히면 달성, 못 맞히면 실패', () => {
    expect(dayVerdict(result([hits(1)]), mid).status).toBe('met')
    expect(dayVerdict(result([hits(0)]), mid).status).toBe('failed')
  })
  it('투표가 없는 날(마지막 날) — 할 수 없는 일로 실패를 매기지 않는다', () => {
    expect(dayVerdict(result([hits(0)]), { final: true, noBallot: true }).clauses[0].status).toBe('met')
  })
})

describe('본인에게 가는 판', () => {
  it('자정에는 그날 조항이 다 열린다 — 하루가 끝났고 결과를 알려 주는 것이 발표다', () => {
    const trust = clause({ kind: 'trustReceived', have: 2, bar: 3, disclosure: 'daily' })
    const v = dayView(dayVerdict(result([trust]), mid), false)
    expect(v.clauses[0].have).toBe(2)
    expect(v.clauses[0].status).toBe('failed')
  })
  it('「끝날 때」 조항이 남아 있으면 마지막 날 전에는 값도 상태도 빠진다', () => {
    const late = clause({ kind: 'teamNotFirstAtEnd', unit: 'flag', have: 1, bar: 1, met: true, disclosure: 'endOnly' })
    const v = dayView(dayVerdict(result([late]), mid), false)
    expect(v.clauses[0].have).toBeNull()
    expect(v.clauses[0].status).toBe('endOnly')
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
