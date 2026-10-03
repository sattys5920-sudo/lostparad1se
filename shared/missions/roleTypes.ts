// 역할 데이터의 모양. roles.ts(판정용)와 roleData.ts(데이터 파일)가 같이 쓴다.
//
// **서버 전용이다.** 화면은 roleNames.ts 만 부른다.
import type { MissionBranch, RoleId } from './roleNames'

/**
 * 진행도는 **본인에게만** 간다. 그 안에서도 보여 주는 때가 다르다.
 *
 *   realtime     바로 갱신한다. 내 행동으로만 정해지는 것
 *   daily        하루가 바뀔 때만 갱신. 받은 표에 걸린 것 —
 *                실시간이면 누가 방금 나에게 표를 줬는지 역추적된다
 *   afterBallot  투명인간 발표 직후에만 갱신. 그 전에 알려 주면
 *                누가 누구를 적었는지가 발표 전에 새어 나간다
 *   endOnly      진행도를 아예 보여 주지 않는다. 남의 순위·소유가
 *                걸린 것. 화면에는 「끝날 때 판정」이라고만 뜬다
 */
export type Disclosure = 'realtime' | 'daily' | 'afterBallot' | 'endOnly'

/**
 * 조항 하나가 무엇을 세는가. 판정 엔진이 종류마다 계산법을 하나씩 갖는다.
 * 여기서는 종류와 기준치만 적고, 세는 방법은 엔진이 안다.
 */
export type ClauseKind =
  // 사람
  | 'sameRoomPeople'
  | 'trustReceived' | 'trustTeams'
  | 'vendBuys' | 'dealsWithOtherTeam'
  // 쪽지
  | 'slipsRead' | 'slipsGiven' | 'slipsTorn'
  // 손
  | 'errandsDone' | 'harvests' | 'robotsMade' | 'robotsSmashedOfOthers' | 'quizzesSolved' | 'roomsLocked'
  // 어긋남 ★
  | 'targetSlipRead' | 'coStayWithTarget'
  | 'teamNotFirstAtEnd' | 'otherTeamRoomsStood'
  | 'invisibleHits' | 'invisibleHitsSameTeam'

export interface Clause {
  kind: ClauseKind
  /**
   * 세는 것. 진행도 한 줄에 그대로 뜬다(문서 원문).
   *
   * **기준 수치는 문장에 박지 않는다.** 화면은 need·minutes를 따로 받아
   * 「3 / 9」처럼 찍는다. 문장 안에 시간이 들어가야 하면 {분} 으로 두고
   * minutes 로 채운다 — 수치를 고칠 때 한 군데만 고치게.
   */
  text: string
  /** 이만큼 이상이어야 한다. */
  need?: number
  /** 이만큼 이하여야 한다. */
  limit?: number
  /** 시간 조건. 분 단위다. */
  minutes?: number
  disclosure: Disclosure
}

/** {분} 을 채운 「세는 것」 */
export const clauseText = (c: Pick<Clause, 'text' | 'minutes'>): string =>
  c.text.replace(/\{분\}/g, String(c.minutes ?? ''))

export interface RoleNote {
  /** 1~5번. 1~2번은 습관, 3~4번은 그날, 5번은 미션 — 그날 것만 DAY 3 이후에 뿌린다 */
  slot: 1 | 2 | 3 | 4 | 5
  kind: 'role' | 'name'
  /** 이름형이면 {이름} 이 들어 있다. 읽는 순간 서버가 채운다 */
  text: string
}

/** 데이터 파일(roleData.ts)의 한 역할 */
export interface RoleData {
  key: RoleId
  /** 01~14 */
  no: number
  name: string
  branch: MissionBranch
  /** ★ — 팀 이익과 부딪힌다 */
  star: boolean
  /** 학생증 앞면 한 줄 */
  intro: string
  /** 학생증 뒷면 「그해 겨울, 나는」 문단 */
  situation: readonly string[]
  /** 미션 요약(운영자 화면) */
  goal: string
  /** 미션 한 줄 — 「이번에는 …」 */
  line: string
  clauses: readonly Clause[]
  /** 조건 표 아래 단서 */
  footnote: string | null
  notes: readonly RoleNote[]
}
