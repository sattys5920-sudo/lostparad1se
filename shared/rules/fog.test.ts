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
import { INTEL_VISION_BONUS } from './v2'

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
    // 2-3 교실의 이웃 — 옆 교실, 복도 건너, 서쪽 계단
    expect(out.has('scienceRoom')).toBe(true)
    expect(out.has('artRoom')).toBe(true)
    // 두 칸 떨어진 곳은 안 보인다
    expect(out.has('musicRoom')).toBe(false)
  })

  it('정보부장이 있으면 한 겹 더 본다', () => {
    const out = visibleTiles({ ownedTiles: [], myPawnTiles: ['centralPlaza'], intelOfficer: true })
    expect(INTEL_VISION_BONUS).toBe(1)
    expect(out.has('musicRoom')).toBe(true)
    // 세 칸은 여전히 안 보인다
    expect(out.has('baseD')).toBe(false)
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

/**
 * 복도는 트여 있다.
 *
 * 안개는 방을 덮는다. 복도는 어느 방도 아니라 덮을 것이 없고, 실제로
 * 거기 서면 눈앞에 사람이 보인다. 이게 없으면 복도에서 어깨를 맞대고
 * 서 있어도 남남이다 — 각자 마지막으로 들어간 방이 다르고, 그 방이
 * 서로 안 보이기 때문이다.
 */
describe('복도에서 마주치기', () => {
  /** 1층 가운데 복도. spot-check 가 이 칸이 복도임을 확인한다 */
  const hall = { x: 34, y: 80 }
  const farInSameHall = { x: 14, y: 80 }
  /** 2층 복도. 같은 건물이지만 딴 줄이다 */
  const otherHall = { x: 33, y: 31 }
  const base = { viewerId: 'me', viewerTeam: 'A' as const, visible: new Set<never>(), nowMs: 1000 }

  const other = (at: { x: number; y: number }) =>
    pawn({ playerId: 'x', team: 'B', tileId: 'baseB', at })

  it('같은 복도에 서면 서로 보인다 — 안개 밖의 방에서 왔어도', () => {
    const out = visiblePawns({ ...base, at: hall, pawns: [other(hall)] })
    expect(out.map((p) => p.playerId)).toContain('x')
  })

  it('복도 반대쪽 끝도 보인다 — 문으로 끊기지 않는다', () => {
    const out = visiblePawns({ ...base, at: hall, pawns: [other(farInSameHall)] })
    expect(out.map((p) => p.playerId)).toContain('x')
  })

  it('딴 층 복도는 안 보인다', () => {
    const out = visiblePawns({ ...base, at: hall, pawns: [other(otherHall)] })
    expect(out.map((p) => p.playerId)).not.toContain('x')
  })

  it('내가 복도에 없으면 안 보인다 — 방 안에서 복도가 들여다보이지 않는다', () => {
    const out = visiblePawns({ ...base, at: { x: 15, y: 70 }, pawns: [other(hall)] })
    expect(out.map((p) => p.playerId)).not.toContain('x')
  })

  /** **잠복은 복도에서도 잠복이다.** 트였다고 숨은 사람이 드러나지 않는다 */
  it('잠복한 사람은 같은 복도라도 안 보인다', () => {
    const out = visiblePawns({
      ...base,
      at: hall,
      pawns: [pawn({ playerId: 'x', team: 'B', tileId: 'baseB', at: hall, hiddenUntilMs: 9999 })],
    })
    expect(out.map((p) => p.playerId)).not.toContain('x')
  })
})
