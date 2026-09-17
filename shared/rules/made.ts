// 연구실에 놓인 완성품.
//
// 연구를 건 지 스무 분 뒤, **그 연구실에** 완성품이 놓인다. 그때 거기
// 서 있던 본인이 받는다 — 맡겨 놓고 돌아다닐 수는 있지만, 가지러는
// 제 발로 와야 한다. 다시 들어오는 데에 토큰과 시간이 드는 것이 이
// 규칙의 값이다.
//
// **못 받으면 주인이 없어진다.** 먼저 온 사람이 가진다 — 누구든.
// 남의 팀이 주워 가면 그 팀 로봇이 된다. 연구실을 비우면 남 좋은 일을
// 하는 셈이라, 연구실은 지킬 이유가 있는 방이 된다.
//
// **자유 시간에는 없다.** 페이즈가 닫히면 치워졌다가 다음 페이즈가
// 열릴 때 그 자리에 다시 놓인다. 자유 시간에 온 학교를 걸어 다니며
// 줍는 것이 되면, 지키는 일도 뺏는 일도 뜻이 없어진다.
import type { TileId } from './board'
import type { TeamId } from './v2'

/** games/{gameId}/made/{id} — 주인 없이 놓인 완성품 하나. */
export interface MadeDoc {
  /** 놓인 방. 연구를 건 그 연구실이다. */
  tileId: TileId
  /** 건 사람. 기록에만 쓴다 — 가져갈 권리가 아니다. */
  byPlayerId: string
  /** 건 사람의 팀. 이것도 기록이다. */
  byTeam: TeamId
  /** 놓인 게임 시각. */
  atMs: number
}

export type MadeNo = 'freeTime' | 'walking' | 'elsewhere' | 'teamFull' | 'roomFull'

export const MADE_NO: Record<MadeNo, string> = {
  freeTime: '자유 시간에는 완성품이 나와 있지 않다',
  walking: '걷는 중이다 — 도착해야 가져간다',
  elsewhere: '그 방에 있어야 가져간다',
  teamFull: '로봇을 더 가질 수 없다',
  roomFull: '이 방에 로봇이 꽉 찼다',
}

export interface TakeInput {
  phaseOpen: boolean
  /** 가져가려는 사람이 선 방. 걷는 중이면 null. */
  here: TileId | null
  /** 완성품이 놓인 방. */
  tileId: TileId
  /** 그 사람 팀이 지금 가진 로봇 수. */
  teamRobots: number
  /** 팀당 한도. */
  teamCap: number
  /** 그 방에 있는 로봇 수. */
  roomRobots: number
  /** 한 방 한도. */
  roomCap: number
}

/**
 * 가져갈 수 있는가. **없으면 null 이다.**
 *
 * 팀을 안 본다 — 주인이 없어진 물건이라 누구든 가져간다.
 */
export function whyNotTake(a: TakeInput): MadeNo | null {
  if (!a.phaseOpen) return 'freeTime'
  if (a.here === null) return 'walking'
  if (a.here !== a.tileId) return 'elsewhere'
  if (a.teamRobots >= a.teamCap) return 'teamFull'
  if (a.roomRobots >= a.roomCap) return 'roomFull'
  return null
}

/**
 * 완성될 때 그 자리에 있던 본인이 받는가.
 *
 * 받으면 그대로 그 팀 로봇이 되고, 아니면 주인 없는 물건으로 놓인다.
 */
export function landsToOwner(researcherTile: TileId | null, labTile: TileId): boolean {
  return researcherTile === labTile
}
