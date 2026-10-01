// 안개 — 보내면 안 되는 것이 섞이지 않는지.
//
// 여기가 새면 개발자도구 하나로 판이 끝난다. 「보이지 않아야 할 말이
// 목록에 없다」와 「목적지가 어느 view에도 없다」를 확인한다.
import { describe, expect, it } from 'vitest'
import {
  AMBUSH_HIDDEN_FROM_OWN_TEAM,
  isAmbushed,
  nearInHall,
  visiblePawns,
  visibleTiles,
  type PawnPosition,
} from './fog'
import { ALLEY, HALLS } from './board'
import { HALL_SIGHT } from './v2'

/** 복도 한가운데 칸 하나 — 어느 방도 아니다 */
const hallCellOutside = () => ({ x: HALLS[0].rect.x + 1, y: HALLS[0].rect.y })

const pawn = (over: Partial<PawnPosition> & Pick<PawnPosition, 'playerId' | 'team'>): PawnPosition => ({
  tileId: null,
  fromTile: null,
  toTile: null,
  asleep: false,
  hiddenUntilMs: null,
  ...over,
})

/*
 * **머릿수는 들어가야만 안다.** 보이는 방은 내가 안에 있는 방 하나다.
 *
 * 「안 보인다」만 재는 시험은 아무것도 안 보이는 고장에도 통과한다 —
 * 복도 종이가 그렇게 숨었었다. 그래서 늘 「내 방은 보인다」와 짝으로 잰다.
 */
describe('보이는 방', () => {
  it('내가 들어가 있는 방은 보인다', () => {
    expect([...visibleTiles({ myRoom: 'centralPlaza' })]).toEqual(['centralPlaza'])
  })

  it('바로 옆 방도 안 보인다 — 문을 열어야 안다', () => {
    const out = visibleTiles({ myRoom: 'centralPlaza' })
    // 전에는 2-3 교실에 서면 이웃(과학실·미술실)이 보였다
    expect(out.has('scienceRoom')).toBe(false)
    expect(out.has('artRoom')).toBe(false)
  })

  it('복도에 서 있으면 어느 방도 안 보인다', () => {
    expect(visibleTiles({ myRoom: null }).size).toBe(0)
  })

  it('없는 방은 무시한다', () => {
    expect(visibleTiles({ myRoom: 'nowhere' }).size).toBe(0)
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

  it('같은 팀도 내가 안 들어간 방 안에 있으면 안 보인다', () => {
    const out = visiblePawns({
      ...base,
      pawns: [
        pawn({ playerId: 'a2', team: 'A', tileId: 'baseB' }),
        pawn({ playerId: 'a3', team: 'A', tileId: 'centralPlaza' }),
      ],
    })
    expect(out.map((p) => p.playerId)).toEqual(['a3'])
  })

  it('복도로 나선 사람은 마지막 방 안에서 안 보인다 — 선 칸으로 본다', () => {
    // centralPlaza 가 보이는 방이다. 그 방 안 칸에 선 사람과, 방은 그대로인데 복도 칸에 선 사람
    const out = visiblePawns({
      ...base,
      pawns: [pawn({ playerId: 'b1', team: 'B', tileId: 'centralPlaza', at: hallCellOutside() }), pawn({ playerId: 'b2', team: 'B', tileId: 'centralPlaza' })],
    })
    expect(out.map((p) => p.playerId)).toEqual(['b2'])
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

  it('걷는 말은 가는 방이 보일 때만 보인다 — 떠난 방에서는 안 보인다', () => {
    const out = visiblePawns({
      ...base,
      pawns: [
        pawn({ playerId: 'b1', team: 'B', fromTile: 'gym', toTile: 'studentCouncil' }),
        pawn({ playerId: 'b2', team: 'B', fromTile: 'gym', toTile: 'auditorium' }),
        pawn({ playerId: 'b3', team: 'B', fromTile: 'studentCouncil', toTile: 'auditorium' }),
      ],
    })
    expect(out.map((p) => p.playerId)).toEqual(['b1'])
    // 어디서 오는지도 안 간다
    expect(out[0].fromTile).toBe(null)
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
  /** 같은 복도지만 스무 칸 밖. 눈에 안 들어온다 */
  const farInSameHall = { x: 14, y: 80 }
  /** 여섯 칸 — 딱 눈에 들어오는 끝 */
  const edge = { x: 40, y: 80 }
  /** 2층 복도. 같은 건물이지만 딴 줄이다 */
  const otherHall = { x: 33, y: 31 }
  const base = { viewerId: 'me', viewerTeam: 'A' as const, visible: new Set<never>(), nowMs: 1000 }

  const other = (at: { x: number; y: number }) =>
    pawn({ playerId: 'x', team: 'B', tileId: 'baseB', at })

  it('같은 복도에 서면 서로 보인다 — 안개 밖의 방에서 왔어도', () => {
    const out = visiblePawns({ ...base, at: hall, pawns: [other(hall)] })
    expect(out.map((p) => p.playerId)).toContain('x')
  })

  it('눈에 들어오는 끝(여섯 칸)까지는 보인다', () => {
    const out = visiblePawns({ ...base, at: hall, pawns: [other(edge)] })
    expect(out.map((p) => p.playerId)).toContain('x')
  })

  /**
   * **한 줄이 마흔아홉 칸이다.** 같은 복도면 다 보이게 두면 복도에 한
   * 번 서는 것으로 그 층 사람이 전부 드러난다.
   */
  it('같은 복도라도 멀면 안 보인다', () => {
    const out = visiblePawns({ ...base, at: hall, pawns: [other(farInSameHall)] })
    expect(out.map((p) => p.playerId)).not.toContain('x')
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

describe('뒷골목은 한눈에 들어온다', () => {
  const lane = ALLEY[1]
  const left = { x: lane.x, y: lane.y + 1 }
  const right = { x: lane.x + lane.w - 1, y: lane.y + lane.h - 1 }

  it('골목 양끝은 HALL_SIGHT 보다 멀다 — 그래서 이 규칙이 필요하다', () => {
    expect(Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y))).toBeGreaterThan(HALL_SIGHT)
  })

  it('둘 다 골목 안이면 끝과 끝이어도 서로 보인다', () => {
    expect(nearInHall(left, right)).toBe(true)
  })

  it('한 사람이 학교 복도에 있으면 골목 규칙은 안 먹는다 — 멀면 안 보인다', () => {
    const main = HALLS.find((h) => h.floor === 'f1')!.rect
    const far = { x: main.x + 1, y: main.y + 1 }
    expect(nearInHall(left, far)).toBe(false)
  })
})
