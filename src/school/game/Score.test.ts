import { describe, expect, it } from 'vitest'

import { addDelta, scoreDelta, teamCounts } from './Score'

describe('팀 점수', () => {
  it('쥔 방만 센다. 주인 없는 방은 어느 팀에도 안 든다', () => {
    const c = teamCounts({
      classroom: { ownerTeam: 'A' },
      library: { ownerTeam: 'A' },
      artRoom: { ownerTeam: 'C' },
      centralPlaza: { ownerTeam: null },
    } as never)
    expect(c).toEqual({ A: 2, B: 0, C: 1, D: 0 })
  })

  it('넷이 늘 다 선다 — 방 하나 없는 팀도 0 으로', () => {
    expect(Object.keys(teamCounts({}))).toEqual(['A', 'B', 'C', 'D'])
  })

  it('바뀐 팀만 차이로 나온다. 빼앗기면 음수다', () => {
    expect(scoreDelta({ A: 2, B: 3, C: 1, D: 0 }, { A: 3, B: 2, C: 1, D: 0 })).toEqual({ A: 1, B: -1 })
  })

  it('아무것도 안 바뀌면 빈 것이다 — 번쩍일 일이 없다', () => {
    expect(scoreDelta({ A: 1, B: 1, C: 1, D: 1 }, { A: 1, B: 1, C: 1, D: 1 })).toEqual({})
  })
})

describe('번쩍이는 동안 들어온 차이', () => {
  /*
   * 캡처에서 잡힌 것: 내 팀이 두 곳, 다른 팀이 한 곳을 따로따로 얻자
   * 내 팀의 +2 가 다른 팀의 +1 에 지워졌다.
   */
  it('더한다 — 나중 것이 앞의 것을 지우지 않는다', () => {
    const a = addDelta({}, { A: 1 })
    const b = addDelta(a, { A: 1 })
    const c = addDelta(b, { D: 1 })
    expect(c).toEqual({ A: 2, D: 1 })
  })

  it('얻었다 잃어서 0 이 되면 그 팀은 번쩍이지 않는다', () => {
    expect(addDelta({ A: 1, B: -1 }, { A: -1 })).toEqual({ B: -1 })
  })
})
