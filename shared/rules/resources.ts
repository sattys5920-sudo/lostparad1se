// 자원과 칸의 방어.
//
// 예전에는 여기에 건물이 같이 있었다. 짓기·개조·건물 생산은 다
// 걷어냈다 — 남은 것은 돈·지식을 세는 일과, 보강 카드가 올려 주는
// 방어뿐이다. 방어는 깃발 시간에 그대로 들어간다(flag.ts).
import { RESOURCES, type Resource, type TeamId } from './v2'
import type { TileId } from './board'

/** 판정에 필요한 칸 하나의 모습. */
export interface TileState {
  tileId: TileId
  ownerTeam: TeamId | null
}

export type Bag = Partial<Record<Resource, number>>

// ── 자원 셈 ─────────────────────────────────────────────────────

/** 이 묶음을 낼 수 있는가. */
export function canPay(have: Record<Resource, number>, cost: Bag): boolean {
  return RESOURCES.every((r) => (have[r] ?? 0) >= (cost[r] ?? 0))
}

/** 낸다. 모자라면 null — 반쯤 빠진 상태를 만들지 않는다. */
export function pay(have: Record<Resource, number>, cost: Bag): Record<Resource, number> | null {
  if (!canPay(have, cost)) return null
  const out = { ...have }
  for (const r of RESOURCES) out[r] -= cost[r] ?? 0
  return out
}

/** 받는다. */
export function gain(have: Record<Resource, number>, bag: Bag): Record<Resource, number> {
  const out = { ...have }
  for (const r of RESOURCES) out[r] += bag[r] ?? 0
  // 금고는 0 아래로 내려가지 않는다
  for (const r of RESOURCES) if (out[r] < 0) out[r] = 0
  return out
}

// ── 지갑 ────────────────────────────────────────────────────────

/** 빈 지갑. 옛 판의 문서에는 이 칸이 아예 없다. */
export const EMPTY_PURSE: Record<Resource, number> = { money: 0, knowledge: 0 }

/** 그 사람 지갑. **없으면 빈 지갑이다** — 0 과 「안 적힘」을 같게 본다. */
export const purseOf = (who: { resources?: Record<Resource, number> } | undefined): Record<Resource, number> =>
  who?.resources ?? { ...EMPTY_PURSE }

/**
 * 번 것을 지갑에 넣는다.
 *
 * **상한은 없다.** 하루에 얼마를 벌든 버는 만큼 가진다 — 벌이를
 * 막는 것은 시간과 발품이지 숫자가 아니다.
 */
export const earn = (
  who: { resources?: Record<Resource, number> } | undefined,
  bag: Bag,
): Record<Resource, number> => gain(purseOf(who), bag)

/**
 * 팀 하나가 함께 가진 것. **지갑 넷을 더한 값이다.**
 *
 * 점수판은 여전히 팀 단위다 — 자원이 개인 것이 되었다고 해서
 * 「우리 팀이 얼마나 가졌나」가 없어지는 것은 아니다. 다만 그 숫자가
 * 금고 하나가 아니라 네 지갑의 합이 됐다.
 */
export function teamPurse(
  people: readonly { team: TeamId; resources?: Record<Resource, number> }[],
  team: TeamId,
): Record<Resource, number> {
  const out = { ...EMPTY_PURSE }
  for (const p of people) {
    if (p.team !== team) continue
    for (const r of RESOURCES) out[r] += p.resources?.[r] ?? 0
  }
  return out
}

// ── 방어 ────────────────────────────────────────────────────────

/**
 * 그 칸의 방어.
 *
 * **이제 보강 카드뿐이다.** 건물이 있던 동안에는 건물 방어에
 * 카드를 더했다 — 건물을 걷어내면서 더할 것이 하나만 남았다.
 * 함수는 그대로 둔다. 부르는 쪽(flag.ts·move.ts)이 「이 칸의 방어」를
 * 한 군데서만 묻게 하려는 것이지, 더할 것이 여럿이라서가 아니었다.
 */

/** 보강 카드가 붙은 칸의 방어. 붙일 때 값을 계산해 두려고 따로 둔다. */
