// 따라잡기 — 밀린 일을 시각순으로 민다.
//
// 상시 켜진 서버를 전제하지 않는다. 아무도 안 들어온 채 이틀이 지났어도
// 다음 요청이 그 사이의 일을 전부 처리한다. 그래서 「지금 무슨 일이
// 일어나야 하나」가 아니라 「마지막으로 처리한 시각 이후의 일을 전부
// 훑는다」로 짠다.
//
// 여기에는 **무엇을 어떤 순서로 미는가**만 있다. 실제로 미는 일은
// Firestore를 만져야 해서 functions/src/catchup.ts에 있다.
import type { ScheduleKind } from '../model'

export interface Due {
  id: string
  dueAtMs: number
  /** 같은 시각이면 이 값이 작은 것부터. */
  ord: number
  kind: ScheduleKind
  doneAtMs: number | null
}

/**
 * 지금 밀어야 할 것. 이른 것부터.
 *
 * 같은 시각에 겹치면 SCHEDULE_ORD가 순서를 정하고(도착 → 깃발 → 정시),
 * 그것마저 같으면 아이디로 가른다. 정렬이 흔들리면 같은 판을 두 번
 * 따라잡을 때 결과가 달라진다.
 */
export function dueItems(items: readonly Due[], toMs: number): Due[] {
  return items
    .filter((i) => i.doneAtMs === null && i.dueAtMs <= toMs)
    .sort((a, b) => a.dueAtMs - b.dueAtMs || a.ord - b.ord || a.id.localeCompare(b.id))
}

/** 아직 안 온 일 중 가장 이른 시각. 없으면 null — 다음 알람을 걸 때 쓴다. */
export function nextDueMs(items: readonly Due[], afterMs: number): number | null {
  const left = items.filter((i) => i.doneAtMs === null && i.dueAtMs > afterMs)
  return left.length === 0 ? null : Math.min(...left.map((i) => i.dueAtMs))
}

/**
 * **달력은 사람이 넘긴다.**
 *
 * 예전에는 날이 바뀌는 것도 정산도 끝나는 것도 시계가 했다. 판을
 * 세워 두고 며칠 지나면, 아무도 안 들어온 사이에 닷새가 지나가서
 * 다음에 들어온 사람은 엔딩 화면만 본다 — 실제로 그렇게 됐다.
 * 판은 사람이 모여야 도는 것이라 시계에 맡길 수가 없다.
 *
 * 도착만 시계가 민다. 걸음은 사람이 누를 것이 아니다 — 문을 넘어
 * 놓고 운영자를 기다리는 것은 말이 안 된다.
 */
export const BY_HAND: readonly ScheduleKind[] = ['dayStart', 'lastHours', 'settlement', 'gameEnd']

/** 시계가 스스로 미는 것. 지금은 도착뿐이다. */
export function clockItems(items: readonly Due[], toMs: number): Due[] {
  return dueItems(items, toMs).filter((i) => !BY_HAND.includes(i.kind))
}

/**
 * 운영자가 다음에 밀 것 하나.
 *
 * **시각을 보지 않는다.** 아직 그 시간이 아니어도 민다 — 그것이
 * 손으로 넘긴다는 뜻이다. 순서는 원래 달력 그대로라, 정산을 건너뛰고
 * 끝내거나 이틀을 한꺼번에 넘기는 일은 없다.
 */
export function nextByHand(items: readonly Due[]): Due | null {
  const left = items
    .filter((i) => i.doneAtMs === null && BY_HAND.includes(i.kind))
    .sort((a, b) => a.dueAtMs - b.dueAtMs || a.ord - b.ord || a.id.localeCompare(b.id))
  return left[0] ?? null
}
