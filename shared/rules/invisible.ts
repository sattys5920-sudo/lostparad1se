// 투명인간.
//
// A가 몇 주 동안 겪은 일을, 우리는 하루씩 겪는다. 날마다 마지막
// 페이즈가 닫힐 때, 그날 가장 많이 적힌 이름이 다음 날 지워진다.
//
// **신뢰·호감 표와는 완전히 다른 투표다.** 그쪽은 마주 서야 주는
// 호의고, 이쪽은 만나지 않고 하는 배제다. 둘을 한 통에 담으면
// 「좋아한다」와 「지워라」가 같은 저울에 오른다.
//
// 규칙이 한 줄 더 있다. **가장 많이 적힌 사람이 둘 이상이면 아무도
// 지워지지 않는다.** 누군가를 지우려면 여러 사람이 같은 이름을 적어야
// 한다. 그해 겨울의 투표가 그랬다.
//
// 이 파일은 「누가 지워지는가」와 「지워진 사람이 무엇을 못 하는가」만
// 답한다. 위치를 감추는 일은 fog.ts가 한다 — 투명인간은 안개보다 **먼저**
// 걸러서, 다른 사람에게는 위치 데이터 자체를 보내지 않는다.
import { INVISIBLE_CHAT_MASK, INVISIBLE_MIN_VOTES, INVISIBLE_NO_REPEAT } from './v2'

/** 던진 표 한 장. 누가 누구를 적었는지는 **서버 밖으로 안 나간다.** */
export interface Ballot {
  voterId: string
  targetId: string
  atMs: number
}

export interface BallotCount {
  playerId: string
  count: number
}

/** 이 사람에게 표를 줄 수 있는가. 팀장과 나 자신은 못 적는다. */
export function canName(input: {
  voterId: string
  targetId: string
  /** 지금 팀장인 사람들. 팀장은 적을 수 없다. */
  captainIds: readonly string[]
  /** 어제 투명인간. 이틀 연속은 없으므로 적어도 소용없다. */
  yesterdayId?: string | null
}): { ok: boolean; reason: 'self' | 'captain' | 'repeat' | null } {
  if (input.voterId === input.targetId) return { ok: false, reason: 'self' }
  if (input.captainIds.includes(input.targetId)) return { ok: false, reason: 'captain' }
  // 방어 코드다. 어제 지워진 사람은 오늘 보이지 않았으므로 원래
  // 표를 받을 수 없지만, 규칙을 한 군데 더 적어 둔다
  if (INVISIBLE_NO_REPEAT && input.yesterdayId === input.targetId) return { ok: false, reason: 'repeat' }
  return { ok: true, reason: null }
}

/** 표를 세어 사람마다 몇 장인지. **누가 줬는지는 여기서 사라진다.** */
export function countBallots(ballots: readonly Ballot[]): BallotCount[] {
  const tally = new Map<string, number>()
  for (const b of ballots) tally.set(b.targetId, (tally.get(b.targetId) ?? 0) + 1)
  return [...tally].map(([playerId, count]) => ({ playerId, count })).sort((a, b) => a.playerId.localeCompare(b.playerId))
}

export interface PickInput {
  /** 그날 사람마다 적힌 수. */
  counts: readonly BallotCount[]
  /** 어제 투명인간이었던 사람. 이틀 연속은 없다. */
  yesterdayId?: string | null
}

export interface PickResult {
  /** 다음 날 지워지는 사람. 아무도 아니면 null. */
  playerId: string | null
  reason: 'picked' | 'tooFew' | 'tie' | 'repeat'
}

/**
 * 그날 마지막 페이즈가 닫힐 때. 내일의 투명인간을 고른다.
 *
 *   한 장도 없으면 아무도 아니다
 *   최다가 둘 이상이면 아무도 아니다 — 갈린 표는 사람을 지우지 못한다
 *   어제 그 사람이면 아무도 아니다
 */
export function pickInvisible(input: PickInput): PickResult {
  const live = input.counts.filter((c) => c.count >= INVISIBLE_MIN_VOTES)
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

