import { ADJACENCY, CORE_UNLOCK_DAY, TILES, tileById } from '../data/tiles'
import { TEAMS, teamById } from '../data/teams'
import { BUILDINGS, buildingByKind } from '../data/buildings'
import { CARDS } from '../data/cards'
import type {
  AllianceEntry,
  BuildingKind,
  CardKind,
  ResourceBundle,
  SabotageEffectKind,
  TeamId,
  TeamScoreBreakdown,
  TeamState,
  TerritoryActionKind,
  TerritoryState,
  TileId,
  TileState,
  TradeProposal,
} from '../types'

const ZERO: ResourceBundle = { money: 0, food: 0, knowledge: 0, culture: 0, influence: 0, actionPoints: 0 }

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

/** 하루에 한 사람이 쓸 수 있는 영역 행동은 하나뿐이다(교역·카드 사용은 예외). */
function assertFreeToAct(state: TerritoryState, day: number, playerId: string): void {
  if (state.actionLog.some((e) => e.day === day && e.playerId === playerId)) {
    throw new Error('오늘은 이미 행동했다.')
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
      resources: { money: 6, food: 6, knowledge: 4, culture: 4, influence: 2, actionPoints: 0 },
      hand: [],
      researchTier: 0,
    }
  }
  return { tiles, teams, actionLog: [], sabotageEffects: [], tradeProposals: [], alliances: [] }
}

export function tileValue(state: TerritoryState, tileId: TileId): number {
  const spec = tileById[tileId]
  const built = state.tiles[tileId].buildings.reduce(
    (sum, b) => sum + buildingByKind[b.kind].valueBonus * b.level,
    0,
  )
  return spec.baseValue + built
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

export function expandCost(state: TerritoryState, team: TeamId): ResourceBundle {
  const tier = Math.floor(ownedTiles(state, team).length / 3)
  const penalty = activeSabotage(state, team, 'expandCostUp') ? 2 : 0
  return { ...ZERO, money: 2 + tier + penalty, actionPoints: 1 }
}

export function canExpand(
  state: TerritoryState,
  day: number,
  team: TeamId,
  targetTileId: TileId,
): { ok: true } | { ok: false; reason: string } {
  const tile = state.tiles[targetTileId]
  const spec = tileById[targetTileId]
  if (!tile || !spec) return { ok: false, reason: '존재하지 않는 구역이다.' }
  if (isBaseTile(targetTileId)) return { ok: false, reason: '기지는 점령할 수 없다.' }
  if (spec.coreUnlocksOnDay !== null && day < spec.coreUnlocksOnDay) {
    return { ok: false, reason: `DAY ${spec.coreUnlocksOnDay}부터 개방되는 핵심 지역이다.` }
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
  const check = canExpand(state, day, team, targetTileId)
  if (!check.ok) throw new Error(check.reason)
  const cost = expandCost(state, team)
  const teamState = state.teams[team]
  if (!canAfford(teamState.resources, cost)) throw new Error('자원이 부족하다.')

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

export function performResearch(
  state: TerritoryState,
  day: number,
  team: TeamId,
  playerId: string,
): TerritoryState {
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
  const bonusKeys: (keyof ResourceBundle)[] = ['money', 'food', 'knowledge', 'culture', 'influence']
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
  if (!canAfford(teamState.resources, cost)) throw new Error('자원이 부족하다.')

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

export function respondTrade(
  state: TerritoryState,
  proposalId: string,
  accept: boolean,
): TerritoryState {
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
      return { actionPoints: 1, influence: 1 }
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
      return { money: 2, food: 2, knowledge: 1, culture: 1, influence: 1 }
    case 'doubleResource':
      return { money: 3 }
    case 'tradeBonus':
      return { influence: 2 }
    case 'jointDevelopment':
      return { knowledge: 2, culture: 1 }
    case 'hiddenPassage':
      return { actionPoints: 1, influence: 1 }
    case 'secretSpace':
      return { money: 1, knowledge: 1, culture: 1 }
    case 'emergencyMobilization':
      return { actionPoints: 3 }
    case 'majorProject':
      return { money: 1, food: 1, knowledge: 1, culture: 1, influence: 1, actionPoints: 1 }
    default:
      return null
  }
}

/** 카드를 쓴다. 견제·협정 카드는 targetTeam이 필요하다. */
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

/** 하루가 끝날 때: 건물 생산 정산, 행동력 재충전, 만료된 견제 효과 제거. */
export function dailyRollover(
  state: TerritoryState,
  endingDay: number,
  teamMemberCounts: Record<TeamId, number>,
): TerritoryState {
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
    next.teams[team.id].resources.actionPoints = teamMemberCounts[team.id] ?? 0
  }
  const nextDay = endingDay + 1
  next.sabotageEffects = next.sabotageEffects.filter((s) => s.expiresAfterDay >= nextDay)
  return next
}

export function scoreTeam(state: TerritoryState, team: TeamId): TeamScoreBreakdown {
  const owned = ownedTiles(state, team)
  const territory = owned.reduce((sum, id) => sum + tileValue(state, id), 0)
  const connection = connectedTerritorySize(state, team)
  const core = owned.filter((id) => tileById[id].coreUnlocksOnDay !== null).length * 3
  const r = state.teams[team].resources
  const resource = Math.floor((r.money + r.food + r.knowledge + r.culture + r.influence) / 5)
  const development =
    owned.reduce((sum, id) => sum + state.tiles[id].buildings.reduce((s, b) => s + b.level, 0), 0) +
    state.teams[team].researchTier * 2
  return { territory, connection, core, resource, development, total: territory + connection + core + resource + development }
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

export function hasPlayerActedToday(state: TerritoryState, day: number, playerId: string): boolean {
  return state.actionLog.some((e) => e.day === day && e.playerId === playerId)
}

export { CORE_UNLOCK_DAY, BUILDINGS }
