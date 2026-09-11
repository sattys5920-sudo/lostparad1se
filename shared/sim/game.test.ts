// 시뮬레이션이 끝까지 도는지, 그리고 규칙의 바닥이 뚫리지 않는지.
//
// 판 수는 적게 잡는다 — 백 판 보고서는 `npm run sim`으로 따로 돌린다.
// 여기서 보는 건 「닷새가 멈추지 않고 끝나는가」와 「어떤 값도 규칙이
// 허용하지 않는 범위로 넘어가지 않는가」다.
import { describe, expect, it } from 'vitest'
import { runGames, simulateGame } from './game'
import { MAX_PERSONAL_SCORE } from '../missions/roles'
import { TEAM_IDS } from '../rules/v2'

const START = new Date('2026-03-02T08:00:00+09:00').getTime()

describe('한 판', () => {
  const out = simulateGame('t-1', START)

  it('닷새가 끝까지 간다', () => {
    expect(out.finished).toBe(true)
  })

  it('네 팀 모두 점수가 나온다', () => {
    expect(out.teamScores).toHaveLength(4)
    expect(TEAM_IDS).toContain(out.winner)
    for (const s of out.teamScores) expect(s.total).toBeGreaterThanOrEqual(0)
  })

  it('열네 명 모두 개인 점수가 나온다', () => {
    expect(out.personal).toHaveLength(14)
    for (const p of out.personal) {
      expect(p.score).toBeGreaterThanOrEqual(0)
      expect(p.score).toBeLessThanOrEqual(MAX_PERSONAL_SCORE)
    }
  })

  it('성공한 깃발이 꽂은 깃발보다 많을 수 없다', () => {
    expect(out.flagsSucceeded).toBeLessThanOrEqual(out.flagsPlanted)
  })

  it('표는 한 사람 하루 한 장을 넘지 않는다', () => {
    expect(out.votesCast).toBeLessThanOrEqual(14 * 5)
  })

  it('같은 씨앗이면 같은 판이다', () => {
    expect(simulateGame('t-1', START)).toEqual(out)
  })

  it('씨앗이 다르면 다른 판이다', () => {
    expect(simulateGame('t-2', START).teamScores).not.toEqual(out.teamScores)
  })
})

describe('여러 판', () => {
  const report = runGames(8, START, 'reg')

  it('판마다 승자가 갈린다', () => {
    const total = TEAM_IDS.reduce((a, t) => a + report.wins[t], 0)
    expect(total).toBe(8)
  })

  it('역할 열넷 전부의 달성률이 나온다', () => {
    expect(Object.keys(report.mainRate)).toHaveLength(14)
    for (const v of Object.values(report.mainRate)) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('개인 점수 분포가 0~9 안에 있다', () => {
    expect(report.personalScore.dist).toHaveLength(10)
    const total = report.personalScore.dist.reduce((a, b) => a + b, 0)
    expect(total).toBe(8 * 14)
  })

  it('닷새 동안 깃발이 실제로 오간다 — 판이 얼어붙지 않는다', () => {
    expect(report.perGame.flagsSucceeded).toBeGreaterThan(0)
    expect(report.perGame.buildings).toBeGreaterThan(0)
  })
})
