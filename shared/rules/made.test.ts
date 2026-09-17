import { describe, expect, it } from 'vitest'

import { landsToOwner, whyNotTake, type TakeInput } from './made'
import type { TileId } from './board'

const LAB = 'labRoom' as TileId
const ELSE = 'storage' as TileId

const ok = (over: Partial<TakeInput> = {}): TakeInput => ({
  phaseOpen: true,
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

  /** 팀을 안 본다. 주인이 없어진 물건이라 누구든 가져간다. */
  it('남의 팀이어도 가져간다 — 팀을 안 본다', () => {
    expect(whyNotTake(ok())).toBeNull()
  })

  it('자유 시간에는 나와 있지 않다', () => {
    expect(whyNotTake(ok({ phaseOpen: false }))).toBe('freeTime')
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
