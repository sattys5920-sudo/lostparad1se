import { describe, expect, it } from 'vitest'

import { landsToOwner, whyNotTake, type TakeInput } from './made'
import type { TileId } from './board'

const LAB = 'labRoom' as TileId
const ELSE = 'storage' as TileId

const ok = (over: Partial<TakeInput> = {}): TakeInput => ({
  openPhaseNo: 3,
  madePhaseNo: 3,
  mine: true,
  here: LAB,
  tileId: LAB,
  teamRobots: 0,
  teamCap: 6,
  roomRobots: 0,
  roomCap: 3,
  ...over,
})

describe('완성품을 가져간다', () => {
  it('그 방에 서 있으면 가져간다', () => {
    expect(whyNotTake(ok())).toBeNull()
  })

  /** 만든 페이즈 동안에는 만든 사람 것이다 */
  it('그 페이즈 동안에는 남이 못 가져간다', () => {
    expect(whyNotTake(ok({ mine: false }))).toBe('notYours')
  })

  /** 페이즈가 끝나도록 안 가져갔으면 누구든 — 남의 팀도 */
  it('페이즈가 닫히면 누구든 가져간다 — 자유 시간에도', () => {
    expect(whyNotTake(ok({ mine: false, openPhaseNo: null }))).toBeNull()
    expect(whyNotTake(ok({ mine: true, openPhaseNo: null }))).toBeNull()
  })

  it('다음 페이즈에도 누구든 가져간다', () => {
    expect(whyNotTake(ok({ mine: false, openPhaseNo: 4 }))).toBeNull()
  })

  it('페이즈 번호가 없는 옛 문서는 누구든', () => {
    expect(whyNotTake(ok({ mine: false, madePhaseNo: undefined }))).toBeNull()
  })

  it('걷는 중이거나 딴 방이면 못 가져간다', () => {
    expect(whyNotTake(ok({ here: null }))).toBe('walking')
    expect(whyNotTake(ok({ here: ELSE }))).toBe('elsewhere')
  })

  it('한도에 걸리면 못 가져간다', () => {
    expect(whyNotTake(ok({ teamRobots: 6 }))).toBe('teamFull')
    expect(whyNotTake(ok({ roomRobots: 3 }))).toBe('roomFull')
  })
})

describe('완성될 때 누가 받는가', () => {
  it('그 연구실에 서 있으면 본인이 받는다', () => {
    expect(landsToOwner(LAB, LAB)).toBe(true)
  })

  it('딴 데 있거나 걷는 중이면 주인이 없어진다', () => {
    expect(landsToOwner(ELSE, LAB)).toBe(false)
    expect(landsToOwner(null, LAB)).toBe(false)
  })
})
