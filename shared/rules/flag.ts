// 깃발 — 얼마나 걸리고, 누가 이기는가.
//
// 땅을 가져가는 방법은 이것 하나뿐이라 규칙이 제일 촘촘하다. 보정이
// 곱셈 네 번이고 순서가 정해져 있어서, 순서를 바꾸면 결과가 달라진다.
import {
  CAPTAIN_HEAD_COUNT,
  FLAG_AMBUSH_FACTOR,
  FLAG_BASE_GAME_MIN,
  FLAG_CLASS_PRESIDENT_FACTOR,
  FLAG_CORE_MIN_PRESENCE,
  FLAG_COST_INFLUENCE,
  FLAG_COST_MONEY,
  FLAG_COST_TILES_PER_STEP,
  FLAG_DEFENSE_GAME_MIN,
  FLAG_LAST_HOURS_FACTOR,
  FLAG_SPOTLIGHT_BASE_GAME_MIN,
  SABOTAGE_EXTRA_FLAG_MONEY,
  type FlagTarget,
  type Resource,
  type TeamId,
} from './v2'
import { TILE_BY_ID, type TileId } from './board'

/** 그 칸이 어느 갈래로 쳐지는가. 핵심·중앙광장은 주인이 있든 없든 그쪽이다. */
export function flagTargetOf(tileId: TileId, ownerTeam: TeamId | null): FlagTarget {
  const tier = TILE_BY_ID[tileId].tier
  if (tier === 'plaza') return 'plaza'
  if (tier === 'core') return 'core'
  return ownerTeam === null ? 'empty' : 'enemy'
}

export interface DurationInput {
  target: FlagTarget
  /** 그 칸의 방어 합. 건물 단계와 보강 카드까지 더한 값. */
  defense: number
  /** 그 칸 주인이 주목받는 팀인가. 남의 칸일 때만 값이 내려간다. */
  ownerSpotlighted: boolean
  /** 꽂는 사람이 반장인가. */
  classPresident: boolean
  /** 기습 카드를 쓰는가. */
  ambush: boolean
  /** DAY 5 15:00 이후인가. */
  lastHours: boolean
}

/**
 * 깃발이 익는 데 걸리는 시간(게임 초).
 *
 * 보정은 반드시 이 순서다. 곱셈이라 순서를 바꾸면 답이 달라진다.
 *
 *   기본(주목이면 30분) + 방어×30분
 *     → 반장 ×0.75
 *     → 기습 ×0.5
 *     → 마지막 여섯 시간 ×0.5
 *
 * 결과는 올린다.
 */
export function flagDurationSec(input: DurationInput): number {
  const base =
    input.target === 'enemy' && input.ownerSpotlighted
      ? FLAG_SPOTLIGHT_BASE_GAME_MIN
      : FLAG_BASE_GAME_MIN[input.target]

  let minutes = base + Math.max(0, input.defense) * FLAG_DEFENSE_GAME_MIN
  if (input.classPresident) minutes *= FLAG_CLASS_PRESIDENT_FACTOR
  if (input.ambush) minutes *= FLAG_AMBUSH_FACTOR
  if (input.lastHours) minutes *= FLAG_LAST_HOURS_FACTOR
  return Math.ceil(minutes * 60)
}

/**
 * DAY 5 15:00에 이미 익고 있던 깃발은 그 순간 남은 시간이 절반이 된다.
 * 이미 지난 시간은 건드리지 않는다.
 */
export function halveRemaining(remainingSec: number): number {
  return Math.ceil(Math.max(0, remainingSec) * FLAG_LAST_HOURS_FACTOR)
}

// ── 비용 ────────────────────────────────────────────────────────

export interface CostInput {
  target: FlagTarget
  /** 지금 가진 칸 수(기지 제외). 셋마다 돈이 1 비싸진다. */
  ownedTiles: number
  /** 확장 비용 증가 견제를 맞고 있는가. */
  expandCostUp: boolean
}

/**
 * 성공할 때 내는 것. 꽂을 때가 아니라 **성공하는 순간** 계산해서 뺀다 —
 * 그 사이에 칸이 늘었으면 더 비싸진다. 모자라면 실패하고, 토큰은 돌려받지
 * 못한다.
 */
export function flagCost(input: CostInput): Partial<Record<Resource, number>> {
  const step = Math.floor(Math.max(0, input.ownedTiles) / FLAG_COST_TILES_PER_STEP)
  const money =
    FLAG_COST_MONEY[input.target] + step + (input.expandCostUp ? SABOTAGE_EXTRA_FLAG_MONEY : 0)
  const influence = FLAG_COST_INFLUENCE[input.target]
  return influence > 0 ? { money, influence } : { money }
}

// ── 판정 ────────────────────────────────────────────────────────

/** 판정 순간 그 칸에 서 있던 말 하나. */
export interface Standing {
  playerId: string
  team: TeamId
  /** 3인 팀의 오늘 주장인가. 머릿수를 둘로 센다. */
  captain: boolean
}

export interface ResolveInput {
  target: FlagTarget
  flagTeam: TeamId
  /** 완료 시각 기준 깃발 팀의 동맹. 판정 직전에 깨질 수도 있다. */
  allies: readonly TeamId[]
  /** 완료 시각에 그 칸에 서 있던 말 전부. 잠든 말·발 묶인 말·잠복 중인 말 모두 포함. */
  standing: readonly Standing[]
  /** 꽂은 사람이 아직 그 칸에 있는가. 떠났으면 그 자리에서 실패다. */
  planterPresent: boolean
}

export interface ResolveResult {
  success: boolean
  /** 깃발 쪽 머릿수(주장 보정 포함). */
  forCount: number
  /** 나머지 전체 머릿수. */
  againstCount: number
  /** 핵심·중앙광장에서 세는 깃발 팀의 실제 인원. 주장도 한 명이다. */
  ownPresence: number
  reason: string
}

/**
 * 깃발 시간이 다 찬 순간의 판정.
 *
 *   깃발 쪽(깃발 팀 + 동맹) > 나머지 전체    같으면 실패
 *   핵심·중앙광장은 깃발 팀 실제 인원이 둘 이상
 *
 * 주장은 머릿수를 둘로 세지만, 「둘 이상」 조건에서는 한 명이다.
 */
export function resolveFlag(input: ResolveInput): ResolveResult {
  const friendly = new Set<TeamId>([input.flagTeam, ...input.allies])
  let forCount = 0
  let againstCount = 0
  let ownPresence = 0

  for (const s of input.standing) {
    const heads = s.captain ? CAPTAIN_HEAD_COUNT : 1
    if (friendly.has(s.team)) forCount += heads
    else againstCount += heads
    if (s.team === input.flagTeam) ownPresence += 1
  }

  const needsPresence = input.target === 'core' || input.target === 'plaza'
  const base = { forCount, againstCount, ownPresence }

  if (!input.planterPresent) {
    return { ...base, success: false, reason: '꽂은 사람이 칸을 떠났다' }
  }
  if (forCount <= againstCount) {
    return { ...base, success: false, reason: '머릿수가 모자라다' }
  }
  if (needsPresence && ownPresence < FLAG_CORE_MIN_PRESENCE) {
    return {
      ...base,
      success: false,
      reason: `핵심은 우리 팀 ${FLAG_CORE_MIN_PRESENCE}명이 서 있어야 한다`,
    }
  }
  return { ...base, success: true, reason: '성공' }
}
