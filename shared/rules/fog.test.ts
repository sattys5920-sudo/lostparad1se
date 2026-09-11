// 안개 — 보내면 안 되는 것이 섞이지 않는지.
//
// 여기가 새면 개발자도구 하나로 판이 끝난다. 「보이지 않아야 할 말이
// 목록에 없다」와 「목적지가 어느 view에도 없다」를 확인한다.
import { describe, expect, it } from 'vitest'
import {
  AMBUSH_HIDDEN_FROM_OWN_TEAM,
  isAmbushed,
  visiblePawns,
  visibleTiles,
  type PawnPosition,
} from './fog'
import { startingTiles } from './board'
import { INTEL_VISION_BONUS, OBSERVATORY_RANGE } from './v2'

const pawn = (over: Partial<PawnPosition> & Pick<PawnPosition, 'playerId' | 'team'>): PawnPosition => ({
  tileId: null,
  fromTile: null,
  toTile: null,
  asleep: false,
  hiddenUntilMs: null,
  ...over,
})

describe('보이는 칸', () => {
  it('우리 칸은 늘 보인다', () => {
    const mine = startingTiles('A')
    const out = visibleTiles({ ownedTiles: mine, myPawnTiles: [] })
    for (const id of mine) expect(out.has(id)).toBe(true)
  })

  it('말이 선 칸과 그 이웃이 보인다', () => {
    const out = visibleTiles({ ownedTiles: [], myPawnTiles: ['centralPlaza'] })
    expect(out.has('centralPlaza')).toBe(true)
    expect(out.has('studentCouncil')).toBe(true)
    expect(out.has('broadcastRoom')).toBe(true)
    // 두 칸 떨어진 곳은 안 보인다
    expect(out.has('mainBuilding')).toBe(false)
  })

  it('정보부장이 있으면 한 겹 더 본다', () => {
    const out = visibleTiles({ ownedTiles: [], myPawnTiles: ['centralPlaza'], intelOfficer: true })
    expect(INTEL_VISION_BONUS).toBe(1)
    expect(out.has('mainBuilding')).toBe(true)
    // 세 칸은 여전히 안 보인다
    expect(out.has('baseA')).toBe(false)
  })

  it('관측소는 두 칸을 걷어 낸다', () => {
    const out = visibleTiles({
      ownedTiles: [],
      myPawnTiles: [],
      observatories: [{ tileId: 'centralPlaza', level: 1 }],
    })
    expect(OBSERVATORY_RANGE).toBe(2)
    expect(out.has('mainBuilding')).toBe(true)
    expect(out.has('baseA')).toBe(false)
  })

  it('개조한 관측소는 네 칸이다', () => {
    const out = visibleTiles({
      ownedTiles: [],
      myPawnTiles: [],
      observatories: [{ tileId: 'centralPlaza', level: 2 }],
    })
    expect(out.has('baseA')).toBe(true)
  })

  it('없는 칸은 무시한다', () => {
    const out = visibleTiles({ ownedTiles: ['nowhere'], myPawnTiles: ['nowhere'] })
    expect(out.size).toBe(0)
  })
})

describe('보이는 말', () => {
  const visible = new Set(['centralPlaza', 'studentCouncil'])
  const base = { viewerId: 'a1', viewerTeam: 'A' as const, visible, nowMs: 1000 }

  it('자기 말은 무슨 일이 있어도 보인다', () => {
    const out = visiblePawns({
      ...base,
      pawns: [pawn({ playerId: 'a1', team: 'A', tileId: 'baseB', hiddenUntilMs: 9999 })],
    })
    expect(out).toHaveLength(1)
  })

  it('같은 팀 말은 안개와 상관없이 보인다', () => {
    const out = visiblePawns({
      ...base,
      pawns: [pawn({ playerId: 'a2', team: 'A', tileId: 'baseB' })],
    })
    expect(out.map((p) => p.playerId)).toEqual(['a2'])
  })

  it('다른 팀 말은 안개가 걷힌 칸에서만 보인다', () => {
    const out = visiblePawns({
      ...base,
      pawns: [
        pawn({ playerId: 'b1', team: 'B', tileId: 'centralPlaza' }),
        pawn({ playerId: 'b2', team: 'B', tileId: 'gym' }),
      ],
    })
    expect(out.map((p) => p.playerId)).toEqual(['b1'])
  })

  it('걷는 말은 떠난 칸이나 다음 칸이 보이면 보인다', () => {
    const out = visiblePawns({
      ...base,
      pawns: [
        pawn({ playerId: 'b1', team: 'B', fromTile: 'gym', toTile: 'studentCouncil' }),
        pawn({ playerId: 'b2', team: 'B', fromTile: 'gym', toTile: 'auditorium' }),
      ],
    })
    expect(out.map((p) => p.playerId)).toEqual(['b1'])
  })

  it('잠복한 말은 안개가 걷힌 칸에 서 있어도 안 보인다', () => {
    const out = visiblePawns({
      ...base,
      pawns: [pawn({ playerId: 'b1', team: 'B', tileId: 'centralPlaza', hiddenUntilMs: 9999 })],
    })
    expect(out).toHaveLength(0)
  })

  it('잠복이 풀리면 다시 보인다', () => {
    const p = pawn({ playerId: 'b1', team: 'B', tileId: 'centralPlaza', hiddenUntilMs: 500 })
    expect(isAmbushed(p, 1000)).toBe(false)
    expect(visiblePawns({ ...base, pawns: [p] })).toHaveLength(1)
  })

  it('잠복한 같은 팀 말은 규칙 원문대로 팀에게도 가리고 있다', () => {
    const out = visiblePawns({
      ...base,
      pawns: [pawn({ playerId: 'a2', team: 'A', tileId: 'baseA', hiddenUntilMs: 9999 })],
    })
    expect(out).toHaveLength(AMBUSH_HIDDEN_FROM_OWN_TEAM ? 0 : 1)
  })
})

describe('새면 안 되는 것', () => {
  it('어느 view에도 목적지가 들어 있지 않다', () => {
    const out = visiblePawns({
      viewerId: 'a1',
      viewerTeam: 'A',
      visible: new Set(['gym']),
      nowMs: 0,
      pawns: [
        pawn({ playerId: 'a1', team: 'A', fromTile: 'baseA', toTile: 'classroom' }),
        pawn({ playerId: 'b1', team: 'B', fromTile: 'gym', toTile: 'clubRoom' }),
      ],
    })
    for (const v of out) {
      expect(Object.keys(v).sort()).toEqual(
        ['asleep', 'fromTile', 'playerId', 'team', 'tileId', 'toTile', 'walking'].sort(),
      )
      expect(JSON.stringify(v)).not.toContain('destination')
    }
  })

  it('서 있는 말에는 떠난 칸·다음 칸이 남지 않는다', () => {
    const out = visiblePawns({
      viewerId: 'a1',
      viewerTeam: 'A',
      visible: new Set<string>(),
      nowMs: 0,
      pawns: [pawn({ playerId: 'a1', team: 'A', tileId: 'baseA', fromTile: 'classroom', toTile: 'library' })],
    })
    expect(out[0].fromTile).toBe(null)
    expect(out[0].toTile).toBe(null)
  })
})
