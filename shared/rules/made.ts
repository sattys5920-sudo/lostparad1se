// 연구실에 놓인 완성품.
//
// 연구를 건 지 스무 분 뒤, **그 연구실에** 완성품이 놓인다. 그때 거기
// 서 있던 본인이 받는다 — 맡겨 놓고 돌아다닐 수는 있지만, 가지러는
// 제 발로 와야 한다.
//
// **그 페이즈 동안에는 만든 사람 것이다.** 남은 손을 못 댄다.
// 페이즈가 끝나도록 안 가져갔으면 **그다음부터는 누구든** 가져간다 —
// 자유 시간에도, 남의 팀도. 남이 주워 가면 그 팀 로봇이 된다.
// 연구를 걸어 놓고 챙기지 않으면 남 좋은 일을 하는 셈이다.
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
  /** 연구를 건 페이즈. **이 페이즈가 열려 있는 동안은 건 사람만** 가져간다 */
  phaseNo?: number
  /** 어느 연구 기계에서 나왔나. 치워질 때까지 그 기계를 차지한다 */
  machine?: number
}

/**
 * 지금은 만든 사람만 손댈 수 있는가. 완성품과 덫이 같은 자를 쓴다.
 *
 * 만든 그 페이즈가 열려 있을 때만 그렇다. 닫히고 나면 누구든이다.
 * 번호를 모르는 옛 문서는 누구든으로 친다.
 */
export const onlyMakerNow = (openPhaseNo: number | null, madePhaseNo: number | undefined): boolean =>
  openPhaseNo !== null && madePhaseNo !== undefined && openPhaseNo === madePhaseNo

export type MadeNo = 'notYours' | 'walking' | 'elsewhere' | 'handsFull'

export const MADE_NO: Record<MadeNo, string> = {
  notYours: '페이즈 동안에는 연구한 사람만 가져간다',
  walking: '걷는 중이다 — 도착해야 가져간다',
  elsewhere: '그 방에 있어야 가져간다',
  handsFull: '로봇은 두 기까지 든다 — 하나를 놓고 와야 가져간다',
}

export interface TakeInput {
  /** 지금 열린 페이즈 번호. 닫혀 있으면 null */
  openPhaseNo: number | null
  /** 완성품을 만든 페이즈 */
  madePhaseNo: number | undefined
  /** 가져가려는 사람이 연구한 사람인가 */
  mine: boolean
  /** 가져가려는 사람이 선 방. 걷는 중이면 null. */
  here: TileId | null
  /** 완성품이 놓인 방. */
  tileId: TileId
  /** 그 사람이 지금 들고 있는 로봇 수. **가져간 것은 손에 든다** — 방 한도가 아니라 이것을 본다 */
  carried: number
  /** 한 사람이 드는 한도. */
  carryCap: number
}

/**
 * 가져갈 수 있는가. **없으면 null 이다.**
 *
 * 만든 페이즈 동안에는 만든 사람만. 그 뒤로는 팀을 안 본다 — 누구든.
 */
export function whyNotTake(a: TakeInput): MadeNo | null {
  if (!a.mine && onlyMakerNow(a.openPhaseNo, a.madePhaseNo)) return 'notYours'
  if (a.here === null) return 'walking'
  if (a.here !== a.tileId) return 'elsewhere'
  if (a.carried >= a.carryCap) return 'handsFull'
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
