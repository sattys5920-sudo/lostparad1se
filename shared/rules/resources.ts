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

/** 받는다. */
export function gain(have: Record<Resource, number>, bag: Bag): Record<Resource, number> {
  const out = { ...have }
  for (const r of RESOURCES) out[r] += bag[r] ?? 0
  // 금고는 0 아래로 내려가지 않는다
  for (const r of RESOURCES) if (out[r] < 0) out[r] = 0
  return out
}

// ── 팀 금고 ─────────────────────────────────────────────────────

/** 빈 금고. 옛 판의 문서에는 이 칸이 아예 없다. */
export const EMPTY_PURSE: Record<Resource, number> = { money: 0, knowledge: 0 }

/**
 * 그 팀 금고(TeamDoc.resources). **없으면 빈 금고다** — 0 과 「안 적힘」을
 * 같게 본다.
 *
 * **지식은 팀 것이다.** 넷이 같이 벌고 같이 쓴다. 돈은 사람 것이라
 * 여기(팀 금고)가 아니라 사람 문서(PawnDoc.money)에 있다.
 */
export const purseOf = (who: { resources?: Record<Resource, number> } | undefined): Record<Resource, number> =>
  ({ ...EMPTY_PURSE, ...(who?.resources ?? {}) })

/**
 * 옛 판의 개인 지갑들을 팀 금고에 더한다. **한 번 옮기면 지갑은 지운다** —
 * 부르는 쪽(phase.ts)이 사람 문서의 resources 를 지운다.
 */
export function foldPurses(
  vault: Record<Resource, number>,
  purses: readonly (Partial<Record<Resource, number>> | undefined)[],
): Record<Resource, number> {
  const out = { ...vault }
  for (const p of purses) for (const r of RESOURCES) out[r] += p?.[r] ?? 0
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
