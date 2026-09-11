// 건물과 자원.
//
// 짓는 조건, 칸의 방어, 21:00에 나오는 생산까지. 방어는 깃발 시간에
// 그대로 들어가고(flag.ts), 생산은 정산에 그대로 들어간다(score.ts) —
// 이 파일이 틀리면 두 군데가 같이 틀린다.
import {
  BUILDING_BY_KIND,
  BUILDING_MAX_LEVEL,
  CARD_REINFORCE_DEFENSE,
  MAINTENANCE_TIERS,
  RESOURCES,
  SABOTAGE_PRODUCTION_FACTOR,
  SLOTS_BY_TIER,
  TREASURER_BUILD_DISCOUNT,
  type BuildingKind,
  type Resource,
  type TeamId,
} from './v2'
import { TILE_BY_ID, type TileId } from './board'

/** 한 칸에 선 건물 하나. */
export interface Placed {
  kind: BuildingKind
  level: number
}

/** 판정에 필요한 칸 하나의 모습. */
export interface TileState {
  tileId: TileId
  ownerTeam: TeamId | null
  buildings: readonly Placed[]
  /** 보강 카드가 붙어 있으면 그 값. */
  reinforced?: number
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
  // 영향력은 0 아래로 내려가지 않는다
  if (out.influence < 0) out.influence = 0
  return out
}

function scaleCost(cost: Bag, factor: number): Bag {
  const out: Bag = {}
  for (const [r, n] of Object.entries(cost) as [Resource, number][]) {
    out[r] = Math.floor(n * factor)
  }
  return out
}

// ── 짓기 ────────────────────────────────────────────────────────

export type BuildRefusal =
  | 'notOurTile'
  | 'baseTile'
  | 'noSlot'
  | 'alreadyHere'
  | 'cannotAfford'

export interface BuildInput {
  tile: TileState
  team: TeamId
  kind: BuildingKind
  resources: Record<Resource, number>
  /** 회계가 지어 주면 돈이 1 싸다. */
  treasurer?: boolean
  /** 급조 카드. 비용이 절반(버림)이고 토큰이 들지 않는다. */
  quickBuild?: boolean
}

export interface BuildResult {
  ok: boolean
  cost: Bag
  resources: Record<Resource, number>
  reason: BuildRefusal | null
}

/** 그 칸에 건물을 몇 개까지 세울 수 있는가. */
export function slotsOf(tileId: TileId): number {
  return SLOTS_BY_TIER[TILE_BY_ID[tileId].tier]
}

/**
 * 짓는 값. 회계 할인은 돈에만, 급조는 전부에 걸린다.
 * 급조를 먼저 반으로 접고 회계 할인을 뺀다 — 순서를 바꾸면 1원 싸진다.
 */
export function buildCost(kind: BuildingKind, opts: { treasurer?: boolean; quickBuild?: boolean } = {}): Bag {
  const spec = BUILDING_BY_KIND[kind]
  let cost: Bag = opts.quickBuild ? scaleCost(spec.cost, 0.5) : { ...spec.cost }
  if (opts.treasurer && cost.money !== undefined) {
    cost = { ...cost, money: Math.max(0, cost.money - TREASURER_BUILD_DISCOUNT) }
  }
  return cost
}

export function build(input: BuildInput): BuildResult {
  const no = (reason: BuildRefusal): BuildResult => ({
    ok: false,
    cost: {},
    resources: input.resources,
    reason,
  })
  if (TILE_BY_ID[input.tile.tileId].tier === 'base') return no('baseTile')
  if (input.tile.ownerTeam !== input.team) return no('notOurTile')
  if (input.tile.buildings.some((b) => b.kind === input.kind)) return no('alreadyHere')
  if (input.tile.buildings.length >= slotsOf(input.tile.tileId)) return no('noSlot')

  const cost = buildCost(input.kind, input)
  const left = pay(input.resources, cost)
  if (!left) return no('cannotAfford')
  return { ok: true, cost, resources: left, reason: null }
}

export type UpgradeRefusal = 'notOurTile' | 'notBuilt' | 'maxLevel' | 'cannotAfford'

/** 개조도 같은 값을 한 번 더 낸다. 생산·방어·범위가 두 배가 된다. */
export function upgrade(input: Omit<BuildInput, 'quickBuild'>): {
  ok: boolean
  cost: Bag
  resources: Record<Resource, number>
  reason: UpgradeRefusal | null
} {
  const no = (reason: UpgradeRefusal) => ({ ok: false, cost: {}, resources: input.resources, reason })
  if (input.tile.ownerTeam !== input.team) return no('notOurTile')
  const here = input.tile.buildings.find((b) => b.kind === input.kind)
  if (!here) return no('notBuilt')
  if (here.level >= BUILDING_MAX_LEVEL) return no('maxLevel')

  const cost = buildCost(input.kind, { treasurer: input.treasurer })
  const left = pay(input.resources, cost)
  if (!left) return no('cannotAfford')
  return { ok: true, cost, resources: left, reason: null }
}

/** 칸이 넘어갈 때. 한 단계 내려가고, 1단계 건물은 무너진다. */
export function downgradeOnCapture(buildings: readonly Placed[]): Placed[] {
  return buildings.filter((b) => b.level > 1).map((b) => ({ ...b, level: b.level - 1 }))
}

// ── 방어 ────────────────────────────────────────────────────────

/** 그 칸의 방어 합. 개조한 건물은 두 배, 보강 카드는 그대로 더한다. */
export function defenseOf(tile: TileState): number {
  let total = 0
  for (const b of tile.buildings) total += BUILDING_BY_KIND[b.kind].defense * b.level
  return total + (tile.reinforced ?? 0)
}

/** 보강 카드가 붙은 칸의 방어. 붙일 때 값을 계산해 두려고 따로 둔다. */
export const REINFORCE_DEFENSE = CARD_REINFORCE_DEFENSE

/** 그 팀이 그 건물을 가지고 있는가. 방송국·비밀기지 판정이 쓴다. */
export function teamHasBuilding(
  tiles: readonly TileState[],
  team: TeamId,
  kind: BuildingKind,
): boolean {
  return tiles.some((t) => t.ownerTeam === team && t.buildings.some((b) => b.kind === kind))
}

// ── 생산 ────────────────────────────────────────────────────────

/** 기지를 뺀 보유 칸 수로 정하는 배율. 넓을수록 덜 거둔다. */
export function maintenanceFactor(ownedTilesExcludingBase: number): number {
  for (const tier of MAINTENANCE_TIERS) {
    if (ownedTilesExcludingBase <= tier.upTo) return tier.factor
  }
  return MAINTENANCE_TIERS[MAINTENANCE_TIERS.length - 1].factor
}

export interface ProduceInput {
  tiles: readonly TileState[]
  team: TeamId
  /** 생산 감소 견제를 맞고 있는가. */
  productionDown?: boolean
}

/**
 * 21:00에 나오는 것. 건물 생산 × 단계 × 영토 배율, 그 뒤 견제.
 * 마지막에 버린다 — 자원은 정수다.
 */
export function dailyProduction(input: ProduceInput): Record<Resource, number> {
  const ours = input.tiles.filter(
    (t) => t.ownerTeam === input.team && TILE_BY_ID[t.tileId].tier !== 'base',
  )
  const factor = maintenanceFactor(ours.length) * (input.productionDown ? SABOTAGE_PRODUCTION_FACTOR : 1)

  const raw: Record<Resource, number> = { money: 0, knowledge: 0, influence: 0 }
  for (const t of ours) {
    for (const b of t.buildings) {
      for (const [r, n] of Object.entries(BUILDING_BY_KIND[b.kind].produces) as [Resource, number][]) {
        raw[r] += n * b.level
      }
    }
  }
  return {
    money: Math.floor(raw.money * factor),
    knowledge: Math.floor(raw.knowledge * factor),
    influence: Math.floor(raw.influence * factor),
  }
}
