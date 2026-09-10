import { ADJACENCY, CORE_INFLUENCE_COST, TILES, tileById } from '../data/tiles'
import { TEAMS, teamById } from '../data/teams'
import { BUILDINGS, buildingByKind } from '../data/buildings'
import { CARDS } from '../data/cards'
import { fragmentByDay } from '../data/fragments'
import { FRAGMENT_TILE_BONUS, VOTE_INFLUENCE } from '../types'
import type {
  AllianceEntry,
  BuildingKind,
  CardKind,
  LeverageToken,
  ResourceBundle,
  RoleId,
  SabotageEffectKind,
  TeamId,
  TeamScoreBreakdown,
  TeamState,
  TerritoryActionKind,
  TerritoryState,
  TileId,
  TileState,
  TradeProposal,
  VoteEntry,
} from '../types'

const ZERO: ResourceBundle = { money: 0, food: 0, knowledge: 0, culture: 0, influence: 0, actionPoints: 0 }

/** 팀 크기와 상관없이 하루에 팀이 쓸 수 있는 행동 수. 3인 팀이 손해 보지 않게 고정값으로 둔다. */
export const TEAM_DAILY_ACTIONS = 4
/** 한 사람이 하루에 할 수 있는 영역 행동의 최대치. 한 명이 팀 행동을 독점하지 못하게 막는다. */
export const MAX_ACTIONS_PER_PLAYER = 2

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function addResources(a: ResourceBundle, b: Partial<ResourceBundle>): ResourceBundle {
  return {
    money: a.money + (b.money ?? 0),
    food: a.food + (b.food ?? 0),
    knowledge: a.knowledge + (b.knowledge ?? 0),
    culture: a.culture + (b.culture ?? 0),
    influence: a.influence + (b.influence ?? 0),
    actionPoints: a.actionPoints + (b.actionPoints ?? 0),
  }
}

function canAfford(resources: ResourceBundle, cost: Partial<ResourceBundle>): boolean {
  return (Object.keys(cost) as (keyof ResourceBundle)[]).every((key) => resources[key] >= (cost[key] ?? 0))
}

function subtractResources(a: ResourceBundle, cost: Partial<ResourceBundle>): ResourceBundle {
  return addResources(
    a,
    Object.fromEntries(Object.entries(cost).map(([k, v]) => [k, -(v ?? 0)])) as Partial<ResourceBundle>,
  )
}

function isBaseTile(tileId: TileId): boolean {
  return tileById[tileId].homeOf !== null
}

function teamHasBuilding(state: TerritoryState, team: TeamId, kind: BuildingKind): boolean {
  return Object.values(state.tiles).some((t) => t.ownerTeam === team && t.buildings.some((b) => b.kind === kind))
}

/**
 * 하루에 한 사람이 쓸 수 있는 행동은 둘까지고, 약점에 눌린 사람은 아예 움직일 수 없다.
 * 교역과 카드 사용은 여기에 걸리지 않는다 — 협상은 언제든 할 수 있어야 판이 산다.
 */
function assertFreeToAct(state: TerritoryState, day: number, playerId: string): void {
  if (state.blockedPlayerIds.includes(playerId)) {
    throw new Error('약점을 잡혀 오늘은 움직일 수 없다.')
  }
  const used = state.actionLog.filter((e) => e.day === day && e.playerId === playerId).length
  if (used >= MAX_ACTIONS_PER_PLAYER) {
    throw new Error('오늘 쓸 수 있는 행동을 다 썼다.')
  }
}

/** 14명 기준 4/4/3/3. 인원이 다르면 최대한 고르게 나눈 뒤 앞 팀부터 한 명씩 더 준다. */
export function assignTeams(playerIds: string[]): Record<string, TeamId> {
  const n = playerIds.length
  const base = Math.floor(n / 4)
  const remainder = n % 4
  const sizes: Record<TeamId, number> = { A: base, B: base, C: base, D: base }
  ;(['A', 'B', 'C', 'D'] as TeamId[]).slice(0, remainder).forEach((id) => {
    sizes[id] += 1
  })

  const shuffled = [...playerIds]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }

  const assignment: Record<string, TeamId> = {}
  let cursor = 0
  for (const teamId of ['A', 'B', 'C', 'D'] as TeamId[]) {
    for (let i = 0; i < sizes[teamId]; i++) {
      assignment[shuffled[cursor]] = teamId
      cursor += 1
    }
  }
  return assignment
}

export function initialTerritoryState(): TerritoryState {
  const tiles: Record<TileId, TileState> = {} as Record<TileId, TileState>
  for (const t of TILES) {
    tiles[t.id] = { id: t.id, ownerTeam: t.homeOf, buildings: [] }
  }
  const teams: Record<TeamId, TeamState> = {} as Record<TeamId, TeamState>
  for (const t of TEAMS) {
    teams[t.id] = {
      id: t.id,
      // 영향력은 0에서 시작한다. 오직 다른 팀 사람들이 준 표로만 들어온다.
      resources: { money: 6, food: 6, knowledge: 4, culture: 4, influence: 0, actionPoints: TEAM_DAILY_ACTIONS },
      hand: [],
      researchTier: 0,
    }
  }
  return {
    tiles,
    teams,
    actionLog: [],
    sabotageEffects: [],
    tradeProposals: [],
    alliances: [],
    unlockedTiles: TILES.filter((t) => !t.isCore).map((t) => t.id),
    releasedFragments: [],
    leverage: [],
    blockedPlayerIds: [],
  }
}

/** A의 기록이 지목한 구역은 값이 오른다 — 모두가 그리로 몰린다. */
function fragmentBonusFor(state: TerritoryState, tileId: TileId): number {
  return state.releasedFragments.some((day) => fragmentByDay[day]?.tileId === tileId) ? FRAGMENT_TILE_BONUS : 0
}

export function tileValue(state: TerritoryState, tileId: TileId): number {
  const spec = tileById[tileId]
  const built = state.tiles[tileId].buildings.reduce((sum, b) => sum + buildingByKind[b.kind].valueBonus * b.level, 0)
  return spec.baseValue + built + fragmentBonusFor(state, tileId)
}

export function ownedTiles(state: TerritoryState, team: TeamId): TileId[] {
  return Object.values(state.tiles)
    .filter((t) => t.ownerTeam === team && !isBaseTile(t.id))
    .map((t) => t.id)
}

/** 기지에서 시작해 같은 팀 소유 타일로만 이어지는, 실제로 붙어 있는 영토의 크기. */
export function connectedTerritorySize(state: TerritoryState, team: TeamId): number {
  const baseId = teamById[team].baseTileId
  const visited = new Set<TileId>([baseId])
  const queue: TileId[] = [baseId]
  while (queue.length > 0) {
    const current = queue.shift() as TileId
    for (const next of ADJACENCY[current]) {
      if (visited.has(next)) continue
      if (state.tiles[next].ownerTeam === team) {
        visited.add(next)
        queue.push(next)
      }
    }
  }
  visited.delete(baseId)
  return visited.size
}

function maintenanceMultiplier(tileCount: number): number {
  if (tileCount <= 5) return 1
  if (tileCount <= 10) return 0.8
  return 0.6
}

function activeSabotage(state: TerritoryState, team: TeamId, kind: SabotageEffectKind): boolean {
  return state.sabotageEffects.some((s) => s.targetTeam === team && s.kind === kind)
}

/** 핵심 지역은 영향력으로만 살 수 있다 — 표를 얻지 못한 팀은 중앙을 밟지 못한다. */
export function expandCost(state: TerritoryState, team: TeamId, targetTileId: TileId): ResourceBundle {
  const tier = Math.floor(ownedTiles(state, team).length / 3)
  const penalty = activeSabotage(state, team, 'expandCostUp') ? 2 : 0
  const core = tileById[targetTileId].isCore
  return {
    ...ZERO,
    money: 2 + tier + penalty,
    influence: core ? CORE_INFLUENCE_COST : 0,
    actionPoints: 1,
  }
}

export function canExpand(
  state: TerritoryState,
  team: TeamId,
  targetTileId: TileId,
): { ok: true } | { ok: false; reason: string } {
  const tile = state.tiles[targetTileId]
  const spec = tileById[targetTileId]
  if (!tile || !spec) return { ok: false, reason: '존재하지 않는 구역이다.' }
  if (isBaseTile(targetTileId)) return { ok: false, reason: '기지는 점령할 수 없다.' }
  if (!state.unlockedTiles.includes(targetTileId)) {
    return { ok: false, reason: '아직 A의 기록이 열어 주지 않은 곳이다.' }
  }
  if (tile.ownerTeam !== null) return { ok: false, reason: '이미 다른 팀(혹은 우리 팀)이 차지했다.' }
  const adjacentToMine = ADJACENCY[targetTileId].some((n) => state.tiles[n].ownerTeam === team)
  if (!adjacentToMine) return { ok: false, reason: '우리 영역과 맞닿아 있지 않다.' }
  return { ok: true }
}

export function performExpand(
  state: TerritoryState,
  day: number,
  team: TeamId,
  playerId: string,
  targetTileId: TileId,
): TerritoryState {
  assertFreeToAct(state, day, playerId)
  const check = canExpand(state, team, targetTileId)
  if (!check.ok) throw new Error(check.reason)
  const cost = expandCost(state, team, targetTileId)
  const teamState = state.teams[team]
  if (!canAfford(teamState.resources, cost)) {
    throw new Error(cost.influence > 0 ? '핵심 지역에는 영향력이 모자란다.' : '자원이 부족하다.')
  }

  const next = clone(state)
  next.teams[team].resources = subtractResources(teamState.resources, cost)
  next.tiles[targetTileId].ownerTeam = team
  pushLog(next, day, 'expand', team, playerId, targetTileId, null, null)
  return next
}

export function canBuild(
  state: TerritoryState,
  team: TeamId,
  tileId: TileId,
  kind: BuildingKind,
): { ok: true } | { ok: false; reason: string } {
  const tile = state.tiles[tileId]
  const spec = tileById[tileId]
  if (!tile || tile.ownerTeam !== team) return { ok: false, reason: '우리 팀 영역이 아니다.' }
  if (isBaseTile(tileId)) return { ok: false, reason: '기지에는 건물을 지을 수 없다.' }
  if (tile.buildings.length >= spec.buildingSlots) return { ok: false, reason: '건물 슬롯이 가득 찼다.' }
  if (tile.buildings.some((b) => b.kind === kind)) return { ok: false, reason: '이미 같은 건물이 있다.' }
  return { ok: true }
}

export function performBuild(
  state: TerritoryState,
  day: number,
  team: TeamId,
  playerId: string,
  tileId: TileId,
  kind: BuildingKind,
): TerritoryState {
  assertFreeToAct(state, day, playerId)
  const check = canBuild(state, team, tileId, kind)
  if (!check.ok) throw new Error(check.reason)
  const spec = buildingByKind[kind]
  const teamState = state.teams[team]
  if (!canAfford(teamState.resources, spec.cost)) throw new Error('자원이 부족하다.')

  const next = clone(state)
  next.teams[team].resources = subtractResources(teamState.resources, spec.cost)
  next.tiles[tileId].buildings.push({ kind, level: 1 })
  pushLog(next, day, 'build', team, playerId, tileId, kind, spec.name)
  return next
}

export function performUpgrade(
  state: TerritoryState,
  day: number,
  team: TeamId,
  playerId: string,
  tileId: TileId,
  kind: BuildingKind,
): TerritoryState {
  assertFreeToAct(state, day, playerId)
  const tile = state.tiles[tileId]
  if (!tile || tile.ownerTeam !== team) throw new Error('우리 팀 영역이 아니다.')
  const building = tile.buildings.find((b) => b.kind === kind)
  if (!building) throw new Error('그 건물이 없다.')
  if (building.level >= 2) throw new Error('이미 최고 단계다.')
  const spec = buildingByKind[kind]
  const teamState = state.teams[team]
  if (!canAfford(teamState.resources, spec.cost)) throw new Error('자원이 부족하다.')

  const next = clone(state)
  next.teams[team].resources = subtractResources(teamState.resources, spec.cost)
  const nextBuilding = next.tiles[tileId].buildings.find((b) => b.kind === kind)
  if (nextBuilding) nextBuilding.level = 2
  pushLog(next, day, 'upgrade', team, playerId, tileId, kind, spec.name)
  return next
}

function randomCardKind(): CardKind {
  return CARDS[Math.floor(Math.random() * CARDS.length)].kind
}

export function performResearch(state: TerritoryState, day: number, team: TeamId, playerId: string): TerritoryState {
  assertFreeToAct(state, day, playerId)
  const teamState = state.teams[team]
  const cost: Partial<ResourceBundle> = { knowledge: 2 + teamState.researchTier, actionPoints: 1 }
  if (!canAfford(teamState.resources, cost)) throw new Error('자원이 부족하다.')

  const next = clone(state)
  next.teams[team].resources = subtractResources(teamState.resources, cost)
  next.teams[team].researchTier += 1
  const drawn = randomCardKind()
  next.teams[team].hand.push({ id: crypto.randomUUID(), kind: drawn, drawnDay: day })
  pushLog(next, day, 'research', team, playerId, null, null, `카드 획득: ${cardName(drawn)}`)
  return next
}

export function performExplore(state: TerritoryState, day: number, team: TeamId, playerId: string): TerritoryState {
  assertFreeToAct(state, day, playerId)
  const teamState = state.teams[team]
  const cost: Partial<ResourceBundle> = { actionPoints: 1 }
  if (!canAfford(teamState.resources, cost)) throw new Error('행동력이 부족하다.')
  const bonusKeys: (keyof ResourceBundle)[] = ['money', 'food', 'knowledge', 'culture']
  const bonusKey = bonusKeys[Math.floor(Math.random() * bonusKeys.length)]

  const next = clone(state)
  next.teams[team].resources = subtractResources(teamState.resources, cost)
  next.teams[team].resources = addResources(next.teams[team].resources, { [bonusKey]: 2 })
  pushLog(next, day, 'explore', team, playerId, null, null, `발견: ${RESOURCE_LABEL[bonusKey]} +2`)
  return next
}

export function performProduce(state: TerritoryState, day: number, team: TeamId, playerId: string): TerritoryState {
  assertFreeToAct(state, day, playerId)
  const teamState = state.teams[team]
  const cost: Partial<ResourceBundle> = { actionPoints: 1 }
  if (!canAfford(teamState.resources, cost)) throw new Error('행동력이 부족하다.')

  const next = clone(state)
  next.teams[team].resources = subtractResources(teamState.resources, cost)
  next.teams[team].resources = addResources(next.teams[team].resources, { money: 2, food: 2 })
  pushLog(next, day, 'produce', team, playerId, null, null, '돈 +2, 식량 +2')
  return next
}

export function performSabotage(
  state: TerritoryState,
  day: number,
  team: TeamId,
  playerId: string,
  targetTeam: TeamId,
  kind: SabotageEffectKind,
): TerritoryState {
  assertFreeToAct(state, day, playerId)
  if (targetTeam === team) throw new Error('같은 팀을 견제할 수 없다.')
  const teamState = state.teams[team]
  const cost: Partial<ResourceBundle> = { influence: 2, actionPoints: 1 }
  if (!canAfford(teamState.resources, cost)) throw new Error('영향력이 부족하다. 표를 더 받아야 한다.')

  const next = clone(state)
  next.teams[team].resources = subtractResources(teamState.resources, cost)
  next.sabotageEffects.push({
    id: crypto.randomUUID(),
    kind,
    fromTeam: team,
    targetTeam,
    expiresAfterDay: day + (kind === 'tradeBlocked' ? 1 : 2),
    createdAtMs: Date.now(),
  })
  pushLog(next, day, 'sabotage', team, playerId, null, null, `${teamById[targetTeam].name} 대상 · ${kind}`)
  return next
}

// ── 투표 · 영향력 ────────────────────────────────────────────────
// 영향력은 오직 여기서만 만들어진다. 지도에서 이기려면 사람들 사이로 나가야 한다.

/** 오늘 공개된 A의 기록이 이 역할을 가리키고 있는지. */
export function fragmentImplicates(state: TerritoryState, day: number, roleId: RoleId): boolean {
  if (!state.releasedFragments.includes(day)) return false
  return Boolean(fragmentByDay[day]?.implicatedRoles.includes(roleId))
}

export function voteInfluenceDelta(
  state: TerritoryState,
  vote: VoteEntry,
  targetTeam: TeamId,
  targetRoleId: RoleId | null,
): number {
  let delta = VOTE_INFLUENCE[vote.category]
  if (delta > 0 && teamHasBuilding(state, targetTeam, 'broadcastStation')) delta += 1
  if (delta < 0 && teamHasBuilding(state, targetTeam, 'hideout')) delta += 1
  // A의 기록이 가리킨 역할을 정확히 짚어 의심했다면 타격이 두 배가 된다.
  if (vote.category === 'suspicion' && targetRoleId && fragmentImplicates(state, vote.day, targetRoleId)) {
    delta *= 2
  }
  return delta
}

/** 남을 의심하면 우리 팀도 값을 치른다. 그래서 의심은 아무 데나 던질 수 없다. */
export const SUSPICION_SELF_COST = 1

export function applyVote(
  state: TerritoryState,
  vote: VoteEntry,
  voterTeam: TeamId,
  targetTeam: TeamId,
  targetRoleId: RoleId | null,
): TerritoryState {
  if (voterTeam === targetTeam) throw new Error('같은 팀에는 표를 줄 수 없다.')
  const next = clone(state)
  const delta = voteInfluenceDelta(next, vote, targetTeam, targetRoleId)
  next.teams[targetTeam].resources.influence = Math.max(0, next.teams[targetTeam].resources.influence + delta)
  if (vote.category === 'suspicion') {
    next.teams[voterTeam].resources.influence = Math.max(
      0,
      next.teams[voterTeam].resources.influence - SUSPICION_SELF_COST,
    )
  }
  return next
}

/** 소문은 옮겨질 때마다 그 사람 팀의 영향력을 깎는다. 처음 꺼낸 사람은 값을 치르지 않는다. */
export function applyRetoldRumor(state: TerritoryState, aboutTeam: TeamId): TerritoryState {
  const next = clone(state)
  next.teams[aboutTeam].resources.influence = Math.max(0, next.teams[aboutTeam].resources.influence - 1)
  return next
}

// ── A의 기록 ────────────────────────────────────────────────────

export function releaseFragment(state: TerritoryState, day: number): TerritoryState {
  const fragment = fragmentByDay[day]
  if (!fragment) throw new Error('그 날의 기록이 없다.')
  if (state.releasedFragments.includes(day)) throw new Error('이미 공개된 기록이다.')
  const next = clone(state)
  next.releasedFragments.push(day)
  for (const tileId of fragment.unlocks) {
    if (!next.unlockedTiles.includes(tileId)) next.unlockedTiles.push(tileId)
  }
  return next
}

// ── 약점 ────────────────────────────────────────────────────────

export function grantLeverage(
  state: TerritoryState,
  holderId: string,
  aboutId: string,
  source: LeverageToken['source'],
  day: number,
): TerritoryState {
  if (holderId === aboutId) return state
  const next = clone(state)
  const already = next.leverage.some((l) => l.holderId === holderId && l.aboutId === aboutId && l.spentAs === null)
  if (already) return next
  next.leverage.push({
    id: crypto.randomUUID(),
    holderId,
    aboutId,
    source,
    spentAs: null,
    day,
    createdAtMs: Date.now(),
  })
  return next
}

/**
 * 쥐고 있던 약점을 쓴다. 한 번 쓰면 사라진다.
 *  block  — 그 사람은 오늘 영역 행동을 할 수 없다.
 *  extort — 그 사람 팀에서 영향력 3을 뜯어 우리 팀으로 옮긴다.
 */
export function spendLeverage(
  state: TerritoryState,
  day: number,
  leverageId: string,
  holderId: string,
  mode: 'block' | 'extort',
  holderTeam: TeamId,
  targetTeam: TeamId,
): TerritoryState {
  const token = state.leverage.find((l) => l.id === leverageId)
  if (!token || token.spentAs !== null) throw new Error('이미 쓴 약점이다.')
  if (token.holderId !== holderId) throw new Error('내가 쥔 약점이 아니다.')

  const next = clone(state)
  const nextToken = next.leverage.find((l) => l.id === leverageId) as LeverageToken
  nextToken.spentAs = mode

  if (mode === 'block') {
    if (!next.blockedPlayerIds.includes(token.aboutId)) next.blockedPlayerIds.push(token.aboutId)
  } else {
    const taken = Math.min(3, next.teams[targetTeam].resources.influence)
    next.teams[targetTeam].resources.influence -= taken
    next.teams[holderTeam].resources.influence += taken
  }
  pushLog(next, day, 'sabotage', holderTeam, holderId, null, null, mode === 'block' ? '약점으로 발을 묶었다' : '약점으로 영향력을 뜯었다')
  return next
}

// ── 교역 · 동맹 ──────────────────────────────────────────────────

export function proposeTrade(
  state: TerritoryState,
  day: number,
  fromTeam: TeamId,
  toTeam: TeamId,
  offer: Partial<ResourceBundle>,
  request: Partial<ResourceBundle>,
  message: string | null,
): TerritoryState {
  if (fromTeam === toTeam) throw new Error('같은 팀과는 교역할 수 없다.')
  if (activeSabotage(state, fromTeam, 'tradeBlocked')) throw new Error('지금은 교역이 막혀 있다.')
  const pending = state.tradeProposals.filter((p) => p.fromTeam === fromTeam && p.status === 'pending').length
  if (pending >= 3) throw new Error('아직 답을 못 받은 제안이 너무 많다.')
  const next = clone(state)
  const proposal: TradeProposal = {
    id: crypto.randomUUID(),
    fromTeam,
    toTeam,
    offer,
    request,
    status: 'pending',
    message,
    day,
    createdAtMs: Date.now(),
  }
  next.tradeProposals.push(proposal)
  return next
}

export function respondTrade(state: TerritoryState, proposalId: string, accept: boolean): TerritoryState {
  const proposal = state.tradeProposals.find((p) => p.id === proposalId)
  if (!proposal || proposal.status !== 'pending') throw new Error('이미 처리된 제안이다.')

  const next = clone(state)
  const nextProposal = next.tradeProposals.find((p) => p.id === proposalId) as TradeProposal
  if (!accept) {
    nextProposal.status = 'declined'
    return next
  }
  const fromState = next.teams[proposal.fromTeam]
  const toState = next.teams[proposal.toTeam]
  if (!canAfford(fromState.resources, proposal.offer)) throw new Error('제안한 쪽 자원이 부족해졌다.')
  if (!canAfford(toState.resources, proposal.request)) throw new Error('받는 쪽 자원이 부족하다.')
  next.teams[proposal.fromTeam].resources = addResources(
    subtractResources(fromState.resources, proposal.offer),
    proposal.request,
  )
  next.teams[proposal.toTeam].resources = addResources(
    subtractResources(toState.resources, proposal.request),
    proposal.offer,
  )
  nextProposal.status = 'accepted'
  return next
}

export function withdrawTrade(state: TerritoryState, proposalId: string): TerritoryState {
  const next = clone(state)
  const proposal = next.tradeProposals.find((p) => p.id === proposalId)
  if (proposal && proposal.status === 'pending') proposal.status = 'withdrawn'
  return next
}

export function proposeAlliance(state: TerritoryState, day: number, teamA: TeamId, teamB: TeamId): TerritoryState {
  if (teamA === teamB) throw new Error('같은 팀과는 동맹을 맺을 수 없다.')
  const next = clone(state)
  const entry: AllianceEntry = {
    id: crypto.randomUUID(),
    teams: [teamA, teamB],
    status: 'proposed',
    day,
    createdAtMs: Date.now(),
  }
  next.alliances.push(entry)
  return next
}

export function respondAlliance(state: TerritoryState, allianceId: string, accept: boolean): TerritoryState {
  const next = clone(state)
  const entry = next.alliances.find((a) => a.id === allianceId)
  if (!entry) throw new Error('존재하지 않는 제안이다.')
  entry.status = accept ? 'active' : 'broken'
  return next
}

export function breakAlliance(state: TerritoryState, allianceId: string): TerritoryState {
  const next = clone(state)
  const entry = next.alliances.find((a) => a.id === allianceId)
  if (entry) entry.status = 'broken'
  return next
}

export const RESOURCE_LABEL: Record<keyof ResourceBundle, string> = {
  money: '돈',
  food: '식량',
  knowledge: '지식',
  culture: '문화',
  influence: '영향력',
  actionPoints: '행동력',
}

function cardName(kind: CardKind): string {
  return CARDS.find((c) => c.kind === kind)?.name ?? kind
}

function cardEffect(kind: CardKind): Partial<ResourceBundle> | null {
  switch (kind) {
    case 'fastExpand':
      return { actionPoints: 2 }
    case 'chainOccupy':
      return { actionPoints: 1, money: 2 }
    case 'pioneer':
      return { knowledge: 2 }
    case 'detour':
      return { actionPoints: 1 }
    case 'buildDiscount':
      return { money: 2 }
    case 'instantBuild':
      return { actionPoints: 2 }
    case 'buildingBoost':
      return { knowledge: 1, culture: 1 }
    case 'bonusProduction':
      return { money: 2, food: 2, knowledge: 1, culture: 1 }
    case 'doubleResource':
      return { money: 3 }
    case 'tradeBonus':
      return { money: 1, food: 1, culture: 1 }
    case 'jointDevelopment':
      return { knowledge: 2, culture: 1 }
    case 'hiddenPassage':
      return { actionPoints: 1, knowledge: 1 }
    case 'secretSpace':
      return { money: 1, knowledge: 1, culture: 1 }
    case 'emergencyMobilization':
      return { actionPoints: 3 }
    case 'majorProject':
      return { money: 1, food: 1, knowledge: 1, culture: 1, actionPoints: 1 }
    default:
      return null
  }
}

/** 카드를 쓴다. 견제·협정 카드는 targetTeam이 필요하다. 카드 사용은 하루 행동을 쓰지 않는다. */
export function playCard(
  state: TerritoryState,
  day: number,
  team: TeamId,
  playerId: string,
  cardId: string,
  targetTeam: TeamId | null,
): TerritoryState {
  const teamState = state.teams[team]
  const card = teamState.hand.find((c) => c.id === cardId)
  if (!card) throw new Error('그 카드가 없다.')

  const next = clone(state)
  next.teams[team].hand = next.teams[team].hand.filter((c) => c.id !== cardId)

  if (card.kind === 'raiseExpandCost' || card.kind === 'cutProduction' || card.kind === 'blockTrade') {
    if (!targetTeam) throw new Error('대상 팀을 골라야 한다.')
    const kindMap: Record<string, SabotageEffectKind> = {
      raiseExpandCost: 'expandCostUp',
      cutProduction: 'productionDown',
      blockTrade: 'tradeBlocked',
    }
    const effectKind = kindMap[card.kind]
    next.sabotageEffects.push({
      id: crypto.randomUUID(),
      kind: effectKind,
      fromTeam: team,
      targetTeam,
      expiresAfterDay: day + (effectKind === 'tradeBlocked' ? 1 : 2),
      createdAtMs: Date.now(),
    })
  } else if (card.kind === 'temporaryPact') {
    if (!targetTeam) throw new Error('대상 팀을 골라야 한다.')
    next.alliances.push({
      id: crypto.randomUUID(),
      teams: [team, targetTeam],
      status: 'proposed',
      day,
      createdAtMs: Date.now(),
    })
  } else {
    const effect = cardEffect(card.kind)
    if (effect) next.teams[team].resources = addResources(next.teams[team].resources, effect)
  }

  pushLog(next, day, 'research', team, playerId, null, null, `카드 사용: ${cardName(card.kind)}`)
  return next
}

/** 하루가 끝날 때: 건물 생산 정산, 행동력 재충전, 만료된 견제·족쇄 정리. */
export function dailyRollover(state: TerritoryState, endingDay: number): TerritoryState {
  const next = clone(state)
  for (const team of TEAMS) {
    const owned = ownedTiles(next, team.id)
    const multiplier = maintenanceMultiplier(owned.length)
    const debuffed = activeSabotage(next, team.id, 'productionDown')
    let gross: ResourceBundle = { ...ZERO }
    for (const tileId of owned) {
      for (const b of next.tiles[tileId].buildings) {
        const spec = buildingByKind[b.kind]
        const scaled = Object.fromEntries(
          Object.entries(spec.produces).map(([k, v]) => [k, (v ?? 0) * b.level]),
        ) as Partial<ResourceBundle>
        gross = addResources(gross, scaled)
      }
    }
    const factor = multiplier * (debuffed ? 0.5 : 1)
    const net = Object.fromEntries(
      Object.entries(gross).map(([k, v]) => [k, Math.floor((v as number) * factor)]),
    ) as Partial<ResourceBundle>
    next.teams[team.id].resources = addResources(next.teams[team.id].resources, net)
    // 행동력은 팀 크기와 무관하게 똑같이 채워진다.
    next.teams[team.id].resources.actionPoints = TEAM_DAILY_ACTIONS
  }
  const nextDay = endingDay + 1
  next.sabotageEffects = next.sabotageEffects.filter((s) => s.expiresAfterDay >= nextDay)
  next.blockedPlayerIds = []
  return next
}

export function scoreTeam(state: TerritoryState, team: TeamId): TeamScoreBreakdown {
  const owned = ownedTiles(state, team)
  const territory = owned.reduce((sum, id) => sum + tileValue(state, id), 0)
  const connection = connectedTerritorySize(state, team)
  const core = owned.filter((id) => tileById[id].isCore).length * 3
  const r = state.teams[team].resources
  const resource = Math.floor((r.money + r.food + r.knowledge + r.culture + r.influence) / 5)
  const development =
    owned.reduce((sum, id) => sum + state.tiles[id].buildings.reduce((s, b) => s + b.level, 0), 0) +
    state.teams[team].researchTier * 2
  return {
    territory,
    connection,
    core,
    resource,
    development,
    total: territory + connection + core + resource + development,
  }
}

export function finalScores(state: TerritoryState): Record<TeamId, TeamScoreBreakdown> {
  const result = {} as Record<TeamId, TeamScoreBreakdown>
  for (const t of TEAMS) result[t.id] = scoreTeam(state, t.id)
  return result
}

function pushLog(
  state: TerritoryState,
  day: number,
  kind: TerritoryActionKind,
  team: TeamId,
  playerId: string,
  tileId: TileId | null,
  buildingKind: BuildingKind | null,
  detail: string | null,
): void {
  state.actionLog.push({
    id: crypto.randomUUID(),
    day,
    kind,
    team,
    playerId,
    tileId,
    buildingKind,
    detail,
    createdAtMs: Date.now(),
  })
}

export function actionsUsedToday(state: TerritoryState, day: number, playerId: string): number {
  return state.actionLog.filter((e) => e.day === day && e.playerId === playerId).length
}

export function hasPlayerActedToday(state: TerritoryState, day: number, playerId: string): boolean {
  return actionsUsedToday(state, day, playerId) >= MAX_ACTIONS_PER_PLAYER
}

export { CORE_INFLUENCE_COST, BUILDINGS }
