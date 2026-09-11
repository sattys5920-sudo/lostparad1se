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
