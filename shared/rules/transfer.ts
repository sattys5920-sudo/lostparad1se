// 이적 — 남의 팀 사람을 내 팀으로 데려온다.
//
// **배신은 자유 시간에만 일어난다.** 점령전이 열려 있는 동안에는 못
// 꺼낸다. 종이 친 뒤에 사람이 넘어가면 그 페이즈의 머릿수가 도중에
// 바뀌는데, 이미 서 있는 자리로 겨루는 중에 편이 바뀌면 판정이 아니라
// 사고다.
//
// **수락해도 그 자리에서 넘어가지는 않는다.** 다음 페이즈가 열릴 때
// 발효된다. 그래서 합의한 다음 자유 시간 내내 「이미 넘어가기로 한
// 사람」이 옛 팀 곁에 남아 있다 — 이 시간이 이 규칙의 전부다.
//
// 순위 조건은 없다. 어느 팀이든 누구에게든 꺼낼 수 있다.
import type { TeamId } from './v2'

/** 이 날부터 이적을 꺼낼 수 있다. 첫날은 서로를 알기도 전이다. */
export const TRANSFER_FROM_DAY = 2

/** 답을 기다리는 시간. 거래와 같다 — 마주 선 채로 묻고 답한다. */
export const TRANSFER_ASK_MS = 15_000

export type TransferStatus = 'asking' | 'taken' | 'refused' | 'gone'

/** games/{gameId}/transfers/{id}. 마주 선 둘만 읽는다. */
export interface TransferState {
  /** 부른 사람. **이 사람의 팀으로** 데려간다. */
  byId: string
  byTeam: TeamId
  /** 옮길 사람. 「이적하시겠습니까」는 이쪽에 뜬다. */
  toId: string
  /** 그 사람이 떠날 팀. */
  fromTeam: TeamId
  askedAtMs: number
  status: TransferStatus
}

/** 못 꺼내는 까닭. 서버가 거절할 때와 화면이 미리 적어 둘 때가 같은 말이다. */
export type TransferNo =
  | 'phase'
  | 'early'
  | 'self'
  | 'sameTeam'
  | 'walking'
  | 'far'
  | 'asking'
  | 'pending'
  | 'lastOne'

export const TRANSFER_NO: Record<TransferNo, string> = {
  phase: '점령전 중에는 못 꺼낸다',
  early: `${TRANSFER_FROM_DAY}일째부터 꺼낼 수 있다`,
  self: '나에게는 못 꺼낸다',
  sameTeam: '같은 팀이다',
  walking: '둘 다 멈춰 서야 한다',
  far: '바로 옆 칸에 서야 한다 — 한 걸음 더 다가간다',
  asking: '이미 묻고 있는 중이다',
  pending: '이미 옮기기로 한 사람이다',
  lastOne: '그 팀에 마지막 한 사람이다',
}

export interface TransferAsk {
  /** 게임 속 며칠째인가. */
  day: number
  phaseOpen: boolean
  byId: string
  byTeam: TeamId
  toId: string
  toTeam: TeamId
  /** 둘 다 서 있는가. 걷는 중이면 말을 못 꺼낸다. */
  bothStanding: boolean
  /** 바로 옆 칸인가. 같은 방만으로는 모자라다. */
  nextTo: boolean
  /** 둘 중 누구든 이미 묻고 있는 제안이 있는가. */
  asking: boolean
  /**
   * 옮길 사람에게 이미 걸린 이적이 있는가.
   *
   * **화면은 모른다.** 남의 pawn 은 안 보내므로, 화면은 undefined 를
   * 넣고 서버가 보게 둔다 — 여기서 거짓으로 채우면 될 리 없는 단추가
   * 켜져 있는 것보다 나쁜, 될 것이 꺼져 있는 화면이 된다.
   */
  movingTo?: TeamId | null
  /** 옮길 사람이 떠날 팀의 지금 인원. 화면은 안개 때문에 모른다. */
  fromTeamSize?: number
}

/**
 * 꺼낼 수 있는가. **없으면 null 이다.**
 *
 * 화면과 서버가 같은 답을 내야 한다 — 화면이 따로 판단하면 눌리는데
 * 거절당하거나, 될 것이 꺼져 있다. 화면이 못 보는 두 가지는 빼고
 * 부른다. **모르는 것을 모른다고 두는 편이** 안 될 것을 켜 두는
 * 쪽이고, 그건 서버가 거절하면서 까닭을 말해 준다.
 */
export function whyNotTransfer(a: TransferAsk): TransferNo | null {
  if (a.phaseOpen) return 'phase'
  if (a.day < TRANSFER_FROM_DAY) return 'early'
  if (a.byId === a.toId) return 'self'
  if (a.byTeam === a.toTeam) return 'sameTeam'
  if (!a.bothStanding) return 'walking'
  if (!a.nextTo) return 'far'
  if (a.asking) return 'asking'
  if (a.movingTo != null) return 'pending'
  // **팀이 비면 안 된다.** 사람 없는 팀이 쥔 방은 아무도 뺏으러 오지
  // 않아도 그대로 남아, 아무도 안 하는 팀이 점수를 갖는다
  if (a.fromTeamSize !== undefined && a.fromTeamSize <= 1) return 'lastOne'
  return null
}

/** 답을 기다리다 시간이 다 됐는가. */
export function askExpired(t: Pick<TransferState, 'status' | 'askedAtMs'>, nowMs: number): boolean {
  return t.status === 'asking' && nowMs >= t.askedAtMs + TRANSFER_ASK_MS
}
