// 21:00 정산 — 순서가 곧 규칙이다.
//
// score.ts의 SETTLEMENT_ORDER가 네 걸음을 못 박아 두었다. 여기에 투명인간
// 고르기가 붙는다. 표를 반영한 **뒤에** 골라야 한다 — 그날 던져진 의심표를
// 다 세고 나서 정해지는 것이니까.
//
//   1. 건물 생산
//   2. 받은 표 → 영향력
//   3. 점수와 순위
//   4. 주목과 만회
//   5. 내일의 투명인간
//
// 다섯 번째만 여기 있고 나머지는 score.ts에 있다. 굳이 가른 이유는,
// 투명인간이 영역전이 아니라 「눈이 그치지 않는 학교」의 규칙이기
// 때문이다. 영역전만 돌려 보고 싶을 때 이 파일을 떼면 된다.
import { pickInvisible, type PickResult, type SuspicionCount } from './invisible'
import { settle, type ScoreBreakdown, type SettlementResult } from './score'
import type { TeamId } from './v2'
import type { Vote } from './votes'

export interface SettlementInput {
  /** 생산과 표를 이미 반영한 점수. */
  scores: readonly ScoreBreakdown[]
  influenceOf: (team: TeamId) => number
  /** 그날 던져진 표 전부. */
  votes: readonly Vote[]
  /** 어제 투명인간이었던 사람. 이틀 연속은 없다. */
  yesterdayInvisibleId?: string | null
}

export interface DailySettlement extends SettlementResult {
  /** 내일 지워지는 사람. 표가 갈렸으면 null. */
  invisible: PickResult
}

/** 사람마다 그날 받은 의심표 수. 보낸 사람은 세지 않는다 — 셀 필요도 없다. */
export function suspicionCounts(votes: readonly Vote[]): SuspicionCount[] {
  const tally = new Map<string, number>()
  for (const v of votes) {
    if (v.kind !== 'suspicion') continue
    tally.set(v.targetId, (tally.get(v.targetId) ?? 0) + 1)
  }
  return [...tally].map(([playerId, count]) => ({ playerId, count }))
}

/**
 * 21:00. 순위를 내고, 주목·만회를 정하고, 내일의 투명인간을 고른다.
 *
 * **표에 관해 공개되는 정보는 투명인간 하나뿐이다.** 받은 의심표 수도,
 * 보낸 사람도 나가지 않는다. 그래서 이 함수는 수를 돌려주지 않고
 * 고른 결과만 돌려준다.
 */
export function settleDay(input: SettlementInput): DailySettlement {
  const base = settle(input.scores, input.influenceOf)
  const invisible = pickInvisible({
    counts: suspicionCounts(input.votes),
    yesterdayId: input.yesterdayInvisibleId ?? null,
  })
  return { ...base, invisible }
}

/** 화면에 내려보낼 전부. 사람마다 몇 장 받았는지는 들어 있지 않다. */
export interface SettlementView {
  ranked: SettlementResult['ranked']
  spotlighted: TeamId
  comeback: TeamId
  /** 내일의 투명인간. 없으면 null — 이것도 그대로 알린다. */
  invisibleId: string | null
}

export function settlementView(s: DailySettlement): SettlementView {
  return {
    ranked: s.ranked,
    spotlighted: s.spotlighted,
    comeback: s.comeback,
    invisibleId: s.invisible.playerId,
  }
}
