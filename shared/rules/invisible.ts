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
import { INVISIBLE_MIN_VOTES, INVISIBLE_NO_REPEAT } from './v2'

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

/**
 * 지우개로 지운 표를 뺀다. **세고 난 다음에 뺀다.**
 *
 * 지우개는 「누가 적었는가」를 건드리지 않는다 — 어느 한 장을 골라
 * 없애면 그 사람이 적은 표만 사라져서, 지운 사람이 알 수 없는 것을
 * 판이 알게 된다. 수만 줄인다.
 *
 * 0 이 되면 목록에서 빠진다. 「0표인 사람」이 남아 있으면 동점 판정이
 * 엉뚱하게 갈린다.
 */
export function eraseFrom(
  counts: readonly BallotCount[],
  erased: Readonly<Record<string, number>>,
): BallotCount[] {
  return counts
    .map((c) => ({ playerId: c.playerId, count: Math.max(0, c.count - (erased[c.playerId] ?? 0)) }))
    .filter((c) => c.count > 0)
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
  /** 점령전은 그대로 겨룬다. 서 있는 자리로 하는 일이라 말이 필요 없다. */
  act: true,
  reveal: true,
  /**
   * 신뢰·호감표를 **주는 것**은 된다.
   *
   * 지워졌다고 누군가를 믿는 일까지 빼앗지는 않는다. 받는 것은
   * 막힌다 — 없는 사람에게는 줄 수 없다.
   */
  castVote: true,
} as const

export const INVISIBLE_CANNOT = {
  /** 남에게 보인다. 같은 팀에게도. */
  beSeen: false,
  /** 표를 받는다. */
  receiveVote: false,
  /**
   * 친 말이 남에게 간다.
   *
   * **줄 자체가 안 간다.** 가려서 보내면 「어느 방에 있는가」가 새는데,
   * 그것은 맵이 일부러 지워 놓은 값이다. 본인 화면에만 남는다.
   */
  speakInClass: false,
  /** 거래·이적·쪽지 건네기 — 마주 보고 하는 일 전부. */
  dealWithPeople: false,
  /** 사람을 겨눈 카드. 쓰지도 못하고 겨눠지지도 않는다. */
  targetPeopleWithCards: false,
  /** 호출. 부르는 쪽도 불리는 쪽도 아니다 — 어느 쪽이든 위치가 샌다. */
  summon: false,
} as const

/**
 * 그 줄이 이 사람에게 가는가. **방에서 하는 말에만 쓴다.**
 *
 * 무전(팀 줄)은 이것을 안 거친다 — 지워진 것은 판정에서지 팀에서가
 * 아니고, 방이 아니라 팀에 매인 줄이라 **어디 있는지가 안 샌다.**
 * 대신 그 줄에는 이름 옆에 「안 보임」이 붙는다.
 *
 * **지워진 사람이 친 줄은 본인에게만 간다.** 전에는 말만 「…」로 가려서
 * 모두에게 보냈다. 그런데 새는 것은 **누구인가**가 아니라 **어디
 * 있는가**였다 — 오늘의 투명인간이 누구인지는 아침에 다 같이 들어서
 * 알지만, 지금 어느 방에 있는지는 맵이 일부러 지워 놓은 값이다.
 * 가려진 줄 하나가 그 방에 있다는 것을 알려 준다.
 *
 * 본인에게 남기는 것은 「안 쳐졌다」와 「안 들렸다」를 가르기 위해서다.
 */
export function chatReaches(
  line: { playerId: string; invisible: boolean },
  viewerId: string,
): boolean {
  return !line.invisible || line.playerId === viewerId
}

/** 지금 이 사람이 투명인간인가. */
export function isInvisible(invisibleId: string | null | undefined, playerId: string): boolean {
  return invisibleId != null && invisibleId === playerId
}


