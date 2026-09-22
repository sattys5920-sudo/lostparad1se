// 다섯 기록 — 겹친 시간과 쌓인 줄.
import { describe, expect, it } from 'vitest'

import {
  coStayMs,
  metPeople,
  stayInTeamRoomsMs,
  stayInTileMs,
  tilesVisited,
  tradeCount,
  tradedTeams,
  ownerAt,
  stayInTeamRoomsAtTimeMs,
  type GameRecord,
  type OwnerChange,
  type Stay,
} from './records'
import type { TileId } from './board'
import type { TeamId } from './v2'

const M = 60_000
const NOW = 100 * M

const stay = (playerId: string, tileId: string | null, from: number, to: number | null): Stay => ({
  playerId,
  tileId,
  startMs: from * M,
  endMs: to === null ? null : to * M,
})

describe('같은 방에 있었던 시간', () => {
  it('겹친 만큼만 센다', () => {
    // a 는 0~10분, b 는 5~20분 같은 방 — 겹치는 것은 5분
    const stays = [stay('a', 'library', 0, 10), stay('b', 'library', 5, 20)]
    expect(coStayMs(stays, 'a', 'b', NOW)).toBe(5 * M)
  })

  it('다른 방이면 0이다', () => {
    const stays = [stay('a', 'library', 0, 10), stay('b', 'gym', 0, 10)]
    expect(coStayMs(stays, 'a', 'b', NOW)).toBe(0)
  })

  it('안 겹치면 0이다', () => {
    const stays = [stay('a', 'library', 0, 5), stay('b', 'library', 5, 10)]
    expect(coStayMs(stays, 'a', 'b', NOW)).toBe(0)
  })

  it('여러 번 마주치면 더한다', () => {
    const stays = [
      stay('a', 'library', 0, 10),
      stay('b', 'library', 0, 10),
      stay('a', 'gym', 20, 30),
      stay('b', 'gym', 25, 30),
    ]
    expect(coStayMs(stays, 'a', 'b', NOW)).toBe(15 * M)
  })

  it('걷는 중은 안 센다 — 문 사이에서는 마주친 것이 아니다', () => {
    const stays = [stay('a', null, 0, 10), stay('b', null, 0, 10)]
    expect(coStayMs(stays, 'a', 'b', NOW)).toBe(0)
  })

  it('아직 서 있으면 지금까지로 친다', () => {
    const stays = [stay('a', 'library', 90, null), stay('b', 'library', 90, null)]
    expect(coStayMs(stays, 'a', 'b', NOW)).toBe(10 * M)
  })

  it('자기 자신과는 0이다', () => {
    expect(coStayMs([stay('a', 'library', 0, 10)], 'a', 'a', NOW)).toBe(0)
  })
})

describe('만난 사람 세기', () => {
  const stays = [
    stay('me', 'library', 0, 60),
    // 2분 같이 — 센다
    stay('long', 'library', 0, 2),
    // 30초 같이 — 안 센다
    stay('brief', 'library', 0, 0.5),
    // 다른 방 — 안 센다
    stay('far', 'gym', 0, 60),
  ]

  it('기준 시간을 넘긴 사람만 센다', () => {
    expect(metPeople(stays, 'me', 1 * M, NOW)).toEqual(['long'])
  })

  it('기준을 낮추면 스친 사람도 든다', () => {
    expect(metPeople(stays, 'me', 20_000, NOW)).toEqual(['brief', 'long'])
  })

  it('나는 안 든다', () => {
    expect(metPeople(stays, 'me', 0, NOW)).not.toContain('me')
  })
})

describe('방에 머문 시간', () => {
  const stays = [stay('a', 'library', 0, 10), stay('a', 'library', 20, 25), stay('a', 'gym', 30, 40)]

  it('같은 방 여러 구간을 더한다', () => {
    expect(stayInTileMs(stays, 'a', 'library', NOW)).toBe(15 * M)
  })

  it('남의 팀 방에 머문 시간을 센다', () => {
    // 도서관은 B 것, 체육관은 주인이 없다
    const ownerOf = (id: string): TeamId | null => (id === 'library' ? 'B' : null)
    expect(stayInTeamRoomsMs(stays, 'a', 'B', ownerOf, NOW)).toBe(15 * M)
    expect(stayInTeamRoomsMs(stays, 'a', 'C', ownerOf, NOW)).toBe(0)
  })

  it('발을 들인 방을 모은다 — 잠깐 스쳐도 센다', () => {
    expect(tilesVisited(stays, 'a')).toEqual(['gym', 'library'])
  })

  it('걷는 중은 방문한 방이 아니다', () => {
    expect(tilesVisited([stay('a', null, 0, 10)], 'a')).toEqual([])
  })
})

describe('거래 기록', () => {
  const at = (actorId: string, actorTeam: TeamId, otherId: string, otherTeam: TeamId): GameRecord => ({
    kind: 'trade',
    atMs: 0,
    actorId,
    actorTeam,
    otherId,
    otherTeam,
  })
  const rows: GameRecord[] = [at('a', 'A', 'b', 'B'), at('c', 'C', 'a', 'A'), at('a', 'A', 'b2', 'B')]

  it('제안한 것과 받은 것을 다 센다', () => {
    // 받기만 한 사람도 거래한 것이다 — 제안한 쪽만 세면
    // 아무리 거래해도 안 센 것이 된다
    expect(tradeCount(rows, 'a')).toBe(3)
    expect(tradeCount(rows, 'c')).toBe(1)
  })

  it('상대 팀을 모은다 — 어느 쪽에서 걸었든', () => {
    expect(tradedTeams(rows, 'a')).toEqual(['B', 'C'])
    expect(tradedTeams(rows, 'b')).toEqual(['A'])
  })

  it('같은 팀과 두 번 해도 한 팀이다', () => {
    expect(tradedTeams([at('a', 'A', 'b', 'B'), at('a', 'A', 'b2', 'B')], 'a')).toEqual(['B'])
  })
})

describe('그때 그 방은 누구 것이었나', () => {
  // 소유는 페이즈가 닫힐 때만 바뀐다. 그 줄들이 곧 이력이다
  const changes: OwnerChange[] = [
    { tileId: 'library' as TileId, team: 'A', ownerBefore: null, atMs: 100 },
    { tileId: 'library' as TileId, team: 'B', ownerBefore: 'A', atMs: 300 },
    { tileId: 'musicRoom' as TileId, team: 'C', ownerBefore: null, atMs: 200 },
  ]

  it('첫 변경 전에는 그전 주인이다', () => {
    expect(ownerAt(changes, 'library' as TileId, 50)).toBe(null)
  })

  it('변경 시각에는 이미 바뀐 것으로 본다', () => {
    expect(ownerAt(changes, 'library' as TileId, 100)).toBe('A')
  })

  it('그 사이에는 앞의 주인이다', () => {
    expect(ownerAt(changes, 'library' as TileId, 250)).toBe('A')
  })

  it('두 번째 변경 뒤에는 새 주인이다', () => {
    expect(ownerAt(changes, 'library' as TileId, 999)).toBe('B')
  })

  it('이력이 없는 방은 주인이 없다', () => {
    expect(ownerAt(changes, 'storage' as TileId, 999)).toBe(null)
  })

  it('방마다 따로 센다 — 남의 방 이력에 안 휩쓸린다', () => {
    expect(ownerAt(changes, 'musicRoom' as TileId, 250)).toBe('C')
    expect(ownerAt(changes, 'musicRoom' as TileId, 150)).toBe(null)
  })
})

describe('그때 그 팀 방에 서 있던 시간', () => {
  const changes: OwnerChange[] = [
    { tileId: 'library' as TileId, team: 'A', ownerBefore: null, atMs: 0 },
    { tileId: 'library' as TileId, team: 'B', ownerBefore: 'A', atMs: 500 },
  ]
  const stay = (from: number, to: number | null): Stay => ({
    playerId: 'me',
    tileId: 'library' as TileId,
    startMs: from,
    endMs: to,
  })

  it('주인이 안 바뀐 구간은 통째로 그 팀 몫이다', () => {
    expect(stayInTeamRoomsAtTimeMs([stay(100, 400)], 'me', 'A', changes, 999)).toBe(300)
    expect(stayInTeamRoomsAtTimeMs([stay(100, 400)], 'me', 'B', changes, 999)).toBe(0)
  })

  it('**주인이 바뀌면 그 지점에서 잘라 센다**', () => {
    // 400~700 에 서 있었고 500 에 주인이 A→B 로 바뀌었다
    expect(stayInTeamRoomsAtTimeMs([stay(400, 700)], 'me', 'A', changes, 999)).toBe(100)
    expect(stayInTeamRoomsAtTimeMs([stay(400, 700)], 'me', 'B', changes, 999)).toBe(200)
  })

  it('안 자르면 양쪽에 다 들어간다 — 합이 구간 길이를 안 넘는다', () => {
    const a = stayInTeamRoomsAtTimeMs([stay(400, 700)], 'me', 'A', changes, 999)
    const b = stayInTeamRoomsAtTimeMs([stay(400, 700)], 'me', 'B', changes, 999)
    expect(a + b).toBe(300)
  })

  it('아직 서 있는 구간은 지금까지로 친다', () => {
    expect(stayInTeamRoomsAtTimeMs([stay(600, null)], 'me', 'B', changes, 900)).toBe(300)
  })

  it('걷는 중은 안 센다', () => {
    const walking: Stay = { playerId: 'me', tileId: null, startMs: 0, endMs: 900 }
    expect(stayInTeamRoomsAtTimeMs([walking], 'me', 'A', changes, 999)).toBe(0)
  })

  it('남의 구간은 안 센다', () => {
    const yours: Stay = { ...stay(100, 400), playerId: 'you' }
    expect(stayInTeamRoomsAtTimeMs([yours], 'me', 'A', changes, 999)).toBe(0)
  })
})
