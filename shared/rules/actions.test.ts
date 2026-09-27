import { describe, expect, it } from 'vitest'

import { checkGate, ownerLookup } from './actions'
import type { TileState } from './resources'

describe('발이 묶이면', () => {
  it('아무것도 못 한다', () => {
    expect(checkGate({ bound: true, asleep: false }).reason).toBe('bound')
    expect(checkGate({ bound: false, asleep: true }).reason).toBe('asleep')
    expect(checkGate({ bound: false, asleep: false }).ok).toBe(true)
  })
})

describe('주인 찾기', () => {
  it('칸 목록에서 주인을 짚는다', () => {
    const tiles: TileState[] = [{ tileId: 'classroom', ownerTeam: 'A' }]
    const look = ownerLookup(tiles)
    expect(look('classroom')).toBe('A')
    expect(look('library')).toBe(null)
  })
})

/*
 * **생산·공부 시험은 지웠다.** 행동 자체가 없어졌다 — 「우리 땅 위에
 * 서야 한다」도, 돈 1 · 지식 2 도 이제 판에 없다. 페이즈에 토큰을
 * 쓰는 길은 점령(이동)과 연구뿐이고 그 시험은 occupy.test.ts 에 있다.
 */
