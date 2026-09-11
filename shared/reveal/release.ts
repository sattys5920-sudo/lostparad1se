// A의 기록이 언제 열리는가.
//
// 서버와 화면이 같은 함수를 쓴다. 화면은 「아직 안 열렸다」를 그리는 데
// 쓰고, 서버는 **거절하는 데** 쓴다. 둘이 다른 답을 내면 화면에는 잠겨
// 있는데 요청은 통과하는 구멍이 생긴다.
//
// 열리는 시각은 그날 08:00이다. DAY n은 판이 시작한 날로부터 n번째 날.
import { TOTAL_DAYS } from '../rules/v2'
import { dayNumber } from '../rules/clock'

export type ReleaseRefusal = 'noSuchDay' | 'notYet' | 'notStarted'

export interface ReleaseCheck {
  ok: boolean
  reason: ReleaseRefusal | null
}

/**
 * 그 조각을 지금 내려보내도 되는가.
 *
 * 날짜를 건너뛴 요청을 여기서 막는다 — DAY 1 아침에 DAY 5를 달라고 해도
 * 「아직」이라고 답한다. 있지도 않은 날은 「그런 날 없다」다. 둘을 갈라
 * 두는 이유는, 없는 날과 아직 안 온 날에 같은 말을 하면 닷새가 몇 날인지
 * 떠보게 되기 때문이다. 닷새라는 건 이미 모두가 안다.
 */
export function canRelease(day: number, startedAtMs: number | null, nowMs: number): ReleaseCheck {
  if (!Number.isInteger(day) || day < 1 || day > TOTAL_DAYS) {
    return { ok: false, reason: 'noSuchDay' }
  }
  if (!startedAtMs) return { ok: false, reason: 'notStarted' }

  // 시작 전에는 첫 조각도 없다
  if (nowMs < startedAtMs) return { ok: false, reason: 'notYet' }

  // dayNumber가 08:00 경계를 이미 본다. 소등 중이면 어제를 돌려주므로
  // 여기서 08:00을 또 따지면 안 된다 — 그러면 밤새 어제 조각까지 잠긴다.
  const today = dayNumber(startedAtMs, nowMs)
  return day > today ? { ok: false, reason: 'notYet' } : { ok: true, reason: null }
}

/** 지금까지 열린 날. 보관함이 이걸로 목록을 만든다. */
export function releasedDays(startedAtMs: number | null, nowMs: number): number[] {
  const out: number[] = []
  for (let d = 1; d <= TOTAL_DAYS; d++) {
    if (canRelease(d, startedAtMs, nowMs).ok) out.push(d)
  }
  return out
}

export const REFUSAL_MESSAGE: Record<ReleaseRefusal, string> = {
  noSuchDay: '그런 날은 없다.',
  notYet: '아직 열리지 않았다.',
  notStarted: '아직 판이 시작되지 않았다.',
}
