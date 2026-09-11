// 투명인간.
//
// A가 몇 주 동안 겪은 일을, 우리는 하루씩 겪는다. 매일 21:00에 그날
// 의심표를 가장 많이 받은 사람이 다음 날 지워진다.
//
// 규칙이 한 줄 더 있다. **가장 많이 받은 사람이 둘 이상이면 아무도
// 지워지지 않는다.** 누군가를 지우려면 모두가 같은 이름을 적어야 한다.
// 그해 겨울의 투표가 그랬다.
//
// 이 파일은 「누가 지워지는가」와 「지워진 사람이 무엇을 못 하는가」만
// 답한다. 위치를 감추는 일은 fog.ts가 한다 — 투명인간은 안개보다 **먼저**
// 걸러서, 다른 사람에게는 위치 데이터 자체를 보내지 않는다.
import { INVISIBLE_CHAT_MASK, INVISIBLE_MIN_SUSPICION, INVISIBLE_NO_REPEAT } from './v2'

export interface SuspicionCount {
  playerId: string
  count: number
}

export interface PickInput {
  /** 그날 사람마다 받은 의심표 수. */
  counts: readonly SuspicionCount[]
  /** 어제 투명인간이었던 사람. 이틀 연속은 없다. */
  yesterdayId?: string | null
}

export interface PickResult {
  /** 다음 날 지워지는 사람. 아무도 아니면 null. */
  playerId: string | null
  reason: 'picked' | 'tooFew' | 'tie' | 'repeat'
}

/**
 * 21:00. 내일의 투명인간을 고른다.
 *
 *   두 장 미만이면 아무도 아니다
 *   최다가 둘 이상이면 아무도 아니다 — 갈린 표는 사람을 지우지 못한다
 *   어제 그 사람이면 아무도 아니다
 */
export function pickInvisible(input: PickInput): PickResult {
  const live = input.counts.filter((c) => c.count >= INVISIBLE_MIN_SUSPICION)
  if (live.length === 0) return { playerId: null, reason: 'tooFew' }

  const top = Math.max(...live.map((c) => c.count))
  const leaders = live.filter((c) => c.count === top)
  if (leaders.length > 1) return { playerId: null, reason: 'tie' }

  const picked = leaders[0].playerId
  if (INVISIBLE_NO_REPEAT && input.yesterdayId === picked) {
    return { playerId: null, reason: 'repeat' }
  }
  return { playerId: picked, reason: 'picked' }
}

// ── 지워진 하루 ─────────────────────────────────────────────────

/**
 * 투명인간이 못 하는 일과 할 수 있는 일.
 *
 * 걷기·행동·털어놓기는 그대로 된다. 공인된 고백만은 투명해도 들린다 —
 * 스스로 입을 열면 없는 사람도 보인다.
 */
export const INVISIBLE_CAN = {
  walk: true,
  act: true,
  reveal: true,
  /** 표를 줄 수는 있다. */
  castVote: true,
} as const

export const INVISIBLE_CANNOT = {
  /** 남에게 보인다. 같은 팀에게도. */
  beSeen: false,
  /** 깃발 판정에서 센다. */
  countInFlag: false,
  /** 표를 받는다. */
  receiveVote: false,
  /** 전체 채팅이 그대로 전해진다. */
  speakInClass: false,
} as const

/** 지금 이 사람이 투명인간인가. */
export function isInvisible(invisibleId: string | null | undefined, playerId: string): boolean {
  return invisibleId != null && invisibleId === playerId
}

/**
 * 전체 채팅에 나갈 글. 서버에서 치환한 뒤 전달한다 —
 * 원문을 보내 놓고 화면에서 가리면 개발자도구로 다 보인다.
 */
export function maskClassChat(text: string, speakerInvisible: boolean, viewerIsSpeaker: boolean): string {
  if (!speakerInvisible || viewerIsSpeaker) return text
  return INVISIBLE_CHAT_MASK
}

/**
 * 깃발 판정에 세는 말만 남긴다. 투명인간은 그 자리에 서 있어도 없는
 * 사람이다. 개인 미션의 「서 있었다」는 이 함수를 거치지 않는다 —
 * 거기서는 센다.
 */
export function countableForFlag<T extends { playerId: string }>(
  standing: readonly T[],
  invisibleId: string | null | undefined,
): T[] {
  return standing.filter((s) => !isInvisible(invisibleId, s.playerId))
}
