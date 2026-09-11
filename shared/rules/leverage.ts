// 약점 — 털어놓기가 남기는 것.
//
// 숨긴 사실을 밝히면 들은 사람 전원이 나에 대한 약점 하나를 쥔다.
// 영향력은 상한이 있지만 약점은 없다 — 두 번째부터의 1:1이 순수하게
// 손해인 이유가 여기 있다.
//
// 역할을 밝히거나 채팅에 글을 쓰는 것으로는 약점이 생기지 않는다.
// 「공인된 고백」 카드로 올라간 털어놓기만 센다. 손으로 친 말은 어떤
// 판정에도 쓰이지 않는다.
import { LEVERAGE_BIND_GAME_HOURS, LEVERAGE_EXTORT_INFLUENCE, type RevealScope } from './v2'
import { addActiveSeconds } from './clock'
import { revealInfluenceGain } from './reveal'

/** 누가 누구의 약점을 쥐고 있는가. */
export interface Leverage {
  holderId: string
  aboutId: string
  gainedAtMs: number
  /** 쓰면 사라진다. */
  spentAtMs: number | null
}

/** 아직 손에 남아 있는 약점인가. */
export const isLive = (l: Leverage): boolean => l.spentAtMs === null

/** 같은 사람에 대한 약점은 한 번에 하나만 쥔다. */
export function holdsOn(all: readonly Leverage[], holderId: string, aboutId: string): boolean {
  return all.some((l) => isLive(l) && l.holderId === holderId && l.aboutId === aboutId)
}

export interface RevealInput {
  speakerId: string
  scope: RevealScope
  /** 그 자리에서 들은 사람. 1:1이면 한 명, 전체면 나머지 열세 명. */
  listenerIds: readonly string[]
  /** 지금까지 이 사람이 털어놓기로 받은 총량. */
  alreadyGained: number
  atMs: number
  existing: readonly Leverage[]
}

export interface RevealResult {
  /** 이번에 오르는 영향력. 말하는 사람 팀으로 간다. */
  influence: number
  /** 새로 생기는 약점. 이미 쥐고 있는 사람에게는 늘지 않는다. */
  gained: Leverage[]
}

/**
 * 털어놓기 한 번의 결과.
 *
 * 영향력은 총량 6에 걸리지만 약점은 걸리지 않는다. 이미 나에 대한
 * 약점을 쥔 사람은 또 쥐지 않는다 — 한 번에 하나다.
 */
export function reveal(input: RevealInput): RevealResult {
  const influence = revealInfluenceGain(input.alreadyGained, input.scope)
  const gained: Leverage[] = []
  for (const listenerId of input.listenerIds) {
    if (listenerId === input.speakerId) continue
    if (holdsOn(input.existing, listenerId, input.speakerId)) continue
    if (gained.some((g) => g.holderId === listenerId)) continue
    gained.push({ holderId: listenerId, aboutId: input.speakerId, gainedAtMs: input.atMs, spentAtMs: null })
  }
  return { influence, gained }
}

// ── 쓰는 법 ─────────────────────────────────────────────────────

export type LeverageUse = 'bind' | 'extort'

/** 발 묶기가 풀리는 시각. 여섯 시간이되 소등은 세지 않는다. */
export function bindUntilMs(nowMs: number): number {
  return addActiveSeconds(nowMs, LEVERAGE_BIND_GAME_HOURS * 3600)
}

export interface ExtortResult {
  /** 실제로 옮겨진 양. 상대에게 3이 없으면 있는 만큼만 간다. */
  moved: number
  fromInfluence: number
  toInfluence: number
}

/** 갈취. 영향력은 0 아래로 내려가지 않으므로 없는 것은 뜯지 못한다. */
export function extort(fromInfluence: number, toInfluence: number): ExtortResult {
  const moved = Math.max(0, Math.min(LEVERAGE_EXTORT_INFLUENCE, fromInfluence))
  return { moved, fromInfluence: fromInfluence - moved, toInfluence: toInfluence + moved }
}

export type UseRefusal = 'noLeverage' | 'alreadySpent'

/** 그 약점을 지금 쓸 수 있는가. 한 번 쓰면 사라진다. */
export function canUse(
  all: readonly Leverage[],
  holderId: string,
  aboutId: string,
): { ok: boolean; reason: UseRefusal | null } {
  const any = all.some((l) => l.holderId === holderId && l.aboutId === aboutId)
  if (!any) return { ok: false, reason: 'noLeverage' }
  return holdsOn(all, holderId, aboutId) ? { ok: true, reason: null } : { ok: false, reason: 'alreadySpent' }
}

/** 쓴 것으로 표시한다. 목록을 갈아 끼우지 않고 새 배열을 돌려준다. */
export function spend(
  all: readonly Leverage[],
  holderId: string,
  aboutId: string,
  atMs: number,
): Leverage[] {
  let done = false
  return all.map((l) => {
    if (done || !isLive(l) || l.holderId !== holderId || l.aboutId !== aboutId) return l
    done = true
    return { ...l, spentAtMs: atMs }
  })
}
