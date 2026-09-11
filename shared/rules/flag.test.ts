// 깃발 — 보정 순서와 머릿수.
//
// 여기가 틀리면 판이 통째로 어긋난다. 곱셈 보정이 넷이고 순서가 정해져
// 있어서, 순서를 바꿔도 대부분의 경우 그럴듯한 숫자가 나온다 — 그래서
// 순서 자체를 못 박아 두는 시험이 필요하다.
import { describe, expect, it } from 'vitest'
import { flagCost, flagDurationSec, flagTargetOf, halveRemaining, resolveFlag, type Standing } from './flag'
import { FLAG_COST_TILES_PER_STEP } from './v2'

const MIN = 60

/** 기본값이 든 시간 입력. 필요한 것만 덮어쓴다. */
const dur = (over: Partial<Parameters<typeof flagDurationSec>[0]> = {}) =>
  flagDurationSec({
    target: 'empty',
    defense: 0,
    ownerSpotlighted: false,
    classPresident: false,
    ambush: false,
    lastHours: false,
    ...over,
  })

describe('어느 갈래로 치는가', () => {
  it('핵심과 중앙광장은 주인이 있어도 그쪽이다', () => {
    expect(flagTargetOf('centralPlaza', null)).toBe('plaza')
    expect(flagTargetOf('centralPlaza', 'A')).toBe('plaza')
    expect(flagTargetOf('playground', null)).toBe('core')
    expect(flagTargetOf('playground', 'B')).toBe('core')
  })

  it('그 밖의 칸은 주인 유무로 갈린다', () => {
    expect(flagTargetOf('classroom', null)).toBe('empty')
    expect(flagTargetOf('classroom', 'C')).toBe('enemy')
    expect(flagTargetOf('gym', null)).toBe('empty')
    expect(flagTargetOf('gym', 'D')).toBe('enemy')
  })
})

describe('기본 시간', () => {
  it('빈 칸 30분, 남의 칸 60분, 핵심 120분, 중앙광장 180분', () => {
    expect(dur({ target: 'empty' })).toBe(30 * MIN)
    expect(dur({ target: 'enemy' })).toBe(60 * MIN)
    expect(dur({ target: 'core' })).toBe(120 * MIN)
    expect(dur({ target: 'plaza' })).toBe(180 * MIN)
  })

  it('방어 1당 30분씩 붙는다', () => {
    expect(dur({ target: 'enemy', defense: 3 })).toBe((60 + 90) * MIN)
  })

  it('주목받는 팀의 칸은 기본이 30분으로 내려간다', () => {
    expect(dur({ target: 'enemy', ownerSpotlighted: true })).toBe(30 * MIN)
  })

  it('주목 보정을 받아도 방어는 그대로 붙는다', () => {
    expect(dur({ target: 'enemy', ownerSpotlighted: true, defense: 2 })).toBe((30 + 60) * MIN)
  })

  it('주목은 남의 칸에만 걸린다 — 핵심·중앙광장·빈 칸은 그대로다', () => {
    expect(dur({ target: 'core', ownerSpotlighted: true })).toBe(120 * MIN)
    expect(dur({ target: 'plaza', ownerSpotlighted: true })).toBe(180 * MIN)
    expect(dur({ target: 'empty', ownerSpotlighted: true })).toBe(30 * MIN)
  })
})

describe('보정 순서', () => {
  it('반장 ×0.75', () => {
    expect(dur({ target: 'enemy', classPresident: true })).toBe(45 * MIN)
  })

  it('기습 ×0.5', () => {
    expect(dur({ target: 'enemy', ambush: true })).toBe(30 * MIN)
  })

  it('마지막 여섯 시간 ×0.5', () => {
    expect(dur({ target: 'enemy', lastHours: true })).toBe(30 * MIN)
  })

  it('넷이 겹치면 차례로 곱한다', () => {
    // (60 + 30×2) × 0.75 × 0.5 × 0.5 = 22.5분
    const out = dur({ target: 'enemy', defense: 2, classPresident: true, ambush: true, lastHours: true })
    expect(out).toBe(Math.ceil(22.5 * MIN))
  })

  it('방어는 곱하기 전에 더한다 — 나중에 더하면 답이 달라진다', () => {
    // 먼저 더하면 (60+30)×0.5 = 45분, 나중에 더하면 60×0.5+30 = 60분
    expect(dur({ target: 'enemy', defense: 1, ambush: true })).toBe(45 * MIN)
  })

  it('주목 보정은 곱셈이 아니라 기본값 교체다', () => {
    // 곱셈이었다면 60×0.5×0.5(기습) = 15분이 됐을 것이다
    expect(dur({ target: 'enemy', ownerSpotlighted: true, ambush: true })).toBe(15 * MIN)
    // 교체라 30분에서 출발한다 — 여기서는 같은 값이지만 방어가 있으면 갈린다
    expect(dur({ target: 'enemy', ownerSpotlighted: true, defense: 1, ambush: true })).toBe(30 * MIN)
  })

  it('올림한다', () => {
    // 30 × 0.75 = 22.5분 = 1350초, 딱 떨어진다
    expect(dur({ target: 'empty', classPresident: true })).toBe(1350)
    // 45 × 0.75 × 0.5 = 16.875분 = 1012.5초 → 1013
    expect(dur({ target: 'empty', defense: 0.5, classPresident: true, ambush: true })).toBe(
      Math.ceil(((30 + 15) * 0.75 * 0.5) * MIN),
    )
  })

  it('음수 방어는 0으로 본다', () => {
    expect(dur({ target: 'enemy', defense: -5 })).toBe(60 * MIN)
  })
})

describe('마지막 여섯 시간에 걸친 깃발', () => {
  it('남은 시간만 반으로 준다', () => {
    expect(halveRemaining(3600)).toBe(1800)
    expect(halveRemaining(1801)).toBe(901)
  })

  it('이미 끝난 것은 0이다', () => {
    expect(halveRemaining(0)).toBe(0)
    expect(halveRemaining(-100)).toBe(0)
  })
})

describe('비용', () => {
  it('빈 칸은 돈 2, 남의 칸·핵심은 4, 중앙광장도 4', () => {
    const zero = { ownedTiles: 0, expandCostUp: false }
    expect(flagCost({ target: 'empty', ...zero })).toEqual({ money: 2 })
    expect(flagCost({ target: 'enemy', ...zero })).toEqual({ money: 4 })
  })

  it('핵심과 중앙광장은 영향력도 든다', () => {
    const zero = { ownedTiles: 0, expandCostUp: false }
    expect(flagCost({ target: 'core', ...zero })).toEqual({ money: 4, influence: 4 })
    expect(flagCost({ target: 'plaza', ...zero })).toEqual({ money: 4, influence: 6 })
  })

  it('가진 칸 셋마다 돈이 1 비싸진다', () => {
    const at = (n: number) => flagCost({ target: 'empty', ownedTiles: n, expandCostUp: false }).money
    expect(at(0)).toBe(2)
    expect(at(FLAG_COST_TILES_PER_STEP - 1)).toBe(2)
    expect(at(FLAG_COST_TILES_PER_STEP)).toBe(3)
    expect(at(FLAG_COST_TILES_PER_STEP * 3)).toBe(5)
  })

  it('확장 비용 증가 견제를 맞으면 2가 더 붙는다', () => {
    expect(flagCost({ target: 'enemy', ownedTiles: 0, expandCostUp: true })).toEqual({ money: 6 })
  })
})

describe('판정', () => {
  const p = (playerId: string, team: Standing['team'], captain = false): Standing => ({
    playerId,
    team,
    captain,
  })

  const resolve = (over: Partial<Parameters<typeof resolveFlag>[0]> = {}) =>
    resolveFlag({
      target: 'empty',
      flagTeam: 'A',
      allies: [],
      standing: [p('a1', 'A')],
      planterPresent: true,
      ...over,
    })

  it('우리가 많으면 성공한다', () => {
    const out = resolve({ standing: [p('a1', 'A'), p('a2', 'A'), p('b1', 'B')] })
    expect(out.success).toBe(true)
    expect(out.forCount).toBe(2)
    expect(out.againstCount).toBe(1)
  })

  it('같으면 실패다', () => {
    const out = resolve({ standing: [p('a1', 'A'), p('b1', 'B')] })
    expect(out.success).toBe(false)
    expect(out.reason).toContain('머릿수')
  })

  it('동맹은 우리 쪽으로 센다', () => {
    const out = resolve({ allies: ['C'], standing: [p('a1', 'A'), p('c1', 'C'), p('b1', 'B')] })
    expect(out.success).toBe(true)
    expect(out.forCount).toBe(2)
  })

  it('판정 직전에 동맹이 깨지면 그 사람은 상대다', () => {
    const out = resolve({ allies: [], standing: [p('a1', 'A'), p('c1', 'C'), p('b1', 'B')] })
    expect(out.success).toBe(false)
    expect(out.againstCount).toBe(2)
  })

  it('꽂은 사람이 떠났으면 머릿수와 상관없이 실패다', () => {
    const out = resolve({ standing: [p('a1', 'A'), p('a2', 'A'), p('a3', 'A')], planterPresent: false })
    expect(out.success).toBe(false)
    expect(out.reason).toContain('떠났다')
  })

  it('아무도 없으면 실패다', () => {
    const out = resolve({ standing: [] })
    expect(out.success).toBe(false)
  })
})

describe('주장 머릿수', () => {
  const p = (playerId: string, team: Standing['team'], captain = false): Standing => ({
    playerId,
    team,
    captain,
  })

  it('머릿수 싸움에서는 둘로 센다', () => {
    const out = resolveFlag({
      target: 'empty',
      flagTeam: 'C',
      allies: [],
      standing: [p('c1', 'C', true), p('a1', 'A')],
      planterPresent: true,
    })
    expect(out.forCount).toBe(2)
    expect(out.success).toBe(true)
  })

  it('상대 주장도 둘로 센다', () => {
    const out = resolveFlag({
      target: 'empty',
      flagTeam: 'A',
      allies: [],
      standing: [p('a1', 'A'), p('a2', 'A'), p('c1', 'C', true)],
      planterPresent: true,
    })
    expect(out.againstCount).toBe(2)
    expect(out.success).toBe(false)
  })

  it('핵심의 「둘 이상」에서는 한 명이다', () => {
    const out = resolveFlag({
      target: 'core',
      flagTeam: 'C',
      allies: [],
      standing: [p('c1', 'C', true)],
      planterPresent: true,
    })
    expect(out.forCount).toBe(2)
    expect(out.ownPresence).toBe(1)
    expect(out.success).toBe(false)
    expect(out.reason).toContain('핵심')
  })

  it('주장 하나에 팀원 하나면 핵심도 넘어간다', () => {
    const out = resolveFlag({
      target: 'core',
      flagTeam: 'C',
      allies: [],
      standing: [p('c1', 'C', true), p('c2', 'C')],
      planterPresent: true,
    })
    expect(out.ownPresence).toBe(2)
    expect(out.success).toBe(true)
  })

  it('동맹 인원은 핵심의 「둘 이상」을 채우지 못한다', () => {
    const out = resolveFlag({
      target: 'plaza',
      flagTeam: 'A',
      allies: ['B'],
      standing: [p('a1', 'A'), p('b1', 'B'), p('b2', 'B')],
      planterPresent: true,
    })
    expect(out.forCount).toBe(3)
    expect(out.ownPresence).toBe(1)
    expect(out.success).toBe(false)
  })
})
