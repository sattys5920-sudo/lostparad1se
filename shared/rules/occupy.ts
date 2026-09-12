// 점령 — 방은 사람이 많은 팀의 것이다.
//
// 깃발을 꽂아 시간을 채우던 방식을 걷어내고, **그 방에 서 있는 머릿수**로
// 주인을 정한다. 뺏으려면 몰려가야 하고, 지키려면 남아 있어야 한다.
//
// 한 페이즈에 모두가 행동 하나를 고르고, 관리자가 페이즈를 닫으면
// 한꺼번에 처리된다. 차례를 기다리지 않으므로 남이 무엇을 골랐는지
// 모른 채 고른다 — 그래서 고른 것은 서버만 쥐고 있어야 한다.
//
// 이 파일은 **순수 함수**다. 문서도 시계도 데이터베이스도 모른다.
// 같은 입력에 늘 같은 결과라, 서버가 돌리든 시험이 돌리든 같다.
import { ADJACENCY, TILE_BY_ID, TILES, type TileId } from './board'
import { CAPTAIN_HEAD_COUNT, SHORT_HANDED_TEAMS, type TeamId, type Tier } from './v2'

// ── 수치 ────────────────────────────────────────────────────────
//
// 플레이테스트에서 제일 먼저 손댈 값들이라 한곳에 모은다.

/** 하루에 여는 페이즈 수. */
export const PHASES_PER_DAY = 10
/** 사람 한 명이 데리고 다닐 수 있는 로봇. */
export const MAX_CARRIED_ROBOTS = 2
/** 위장한 사람이 남에게 보이는 머릿수. 판정은 이 값을 쓰지 않는다. */
export const DISGUISE_SHOWN_AS = 2
/** 연구에 걸리는 페이즈. 발전소를 쥐면 0이다. */
export const RESEARCH_PHASES = 1
export const RESEARCH_PHASES_WITH_PLANT = 0

export type RoomKind = 'normal' | 'narrow' | 'lab' | 'plant'

/** 방에 들어갈 수 있는 머릿수. 로봇도 한 자리를 차지한다. */
export const ROOM_CAPACITY: Record<RoomKind, number> = {
  normal: 6,
  narrow: 2,
  lab: 4,
  plant: 4,
}

/**
 * 방 종류. **회전 대칭인 묶음째로** 준다.
 *
 * 이 판은 90도 돌리면 겹친다(board.ts). 그래서 한 묶음을 통째로 같은
 * 종류로 두면 네 팀의 기지에서 각 종류까지의 거리가 저절로 같아진다.
 * 한두 칸만 골라 바꾸면 반드시 어느 팀이 가까워진다.
 *
 *   관문 넷   좁은 방 — 길목이라 머릿수로 밀어붙일 수 없다
 *   교차로 넷 연구실 — 팀마다 하나씩, 기지에서 같은 거리
 *   중앙광장  발전소 — 한 곳뿐이고 네 기지에서 정확히 같은 거리다
 */
export const KIND_BY_TIER: Record<Tier, RoomKind> = {
  base: 'normal',
  zone1: 'normal',
  gate: 'narrow',
  cross: 'lab',
  core: 'normal',
  plaza: 'plant',
}

export const ROOM_KIND: Readonly<Record<TileId, RoomKind>> = Object.fromEntries(
  TILES.map((t) => [t.id, KIND_BY_TIER[t.tier]]),
) as Record<TileId, RoomKind>

export const capacityOf = (id: TileId): number => ROOM_CAPACITY[ROOM_KIND[id]]

// ── 판 위의 것들 ────────────────────────────────────────────────

export interface Person {
  playerId: string
  team: TeamId
  tileId: TileId
  /** 세 명뿐인 팀의 주장. 점령 판정에서 둘로 센다. */
  captain: boolean
}

export interface Robot {
  id: string
  team: TeamId
  /** 데리고 다니는 중이면 주인이 선 방과 같다. */
  tileId: TileId
  /** 누가 데리고 있는가. 두고 간 로봇은 null. */
  carriedBy: string | null
}

export interface PhaseState {
  people: readonly Person[]
  robots: readonly Robot[]
  owners: Readonly<Partial<Record<TileId, TeamId | null>>>
  /** 지난 페이즈에 연구를 건 사람들. 이번 페이즈 끝에 로봇이 된다. */
  pendingResearch: readonly string[]
}

export type ActionKind =
  | 'move'
  | 'research'
  | 'summon'
  | 'disturb'
  | 'disguise'
  | 'dropRobot'
  | 'smashRobot'

export interface Action {
  playerId: string
  kind: ActionKind
  /** 이동의 목적지. */
  targetTile?: TileId
  /** 호출·방해의 대상이 사람일 때. */
  targetPlayer?: string
  /** 방해·부수기의 대상이 로봇일 때. */
  targetRobot?: string
  /**
   * 낸 순서. 같은 것을 두 사람이 노리면 **먼저 낸 쪽만** 된다.
   * 호출이 겹칠 때도, 꽉 찬 방에 둘이 들어가려 할 때도 이 값으로 가른다.
   */
  atMs: number
}

export type LogKind =
  | 'moved'
  | 'moveBlocked'
  | 'summoned'
  | 'summonFailed'
  | 'disturbed'
  | 'disturbFailed'
  | 'disguised'
  | 'robotLeft'
  | 'robotSmashed'
  | 'smashFailed'
  | 'researchStarted'
  | 'researchDone'
  | 'researchFailed'
  | 'captured'
  | 'held'

export interface LogLine {
  kind: LogKind
  playerId?: string
  tileId?: TileId
  team?: TeamId
  targetPlayer?: string
  targetRobot?: string
  /** 안 된 이유. 화면이 한 줄로 보인다. */
  why?: string
}

export interface PhaseResult {
  next: PhaseState
  log: readonly LogLine[]
  /** 이번 페이즈에 위장한 사람. 화면이 이걸로 남에게 보일 숫자를 만든다. */
  disguised: readonly string[]
}

// ── 머릿수 ──────────────────────────────────────────────────────

/** 점령 판정에서 이 사람이 몇으로 세는가. 주장은 둘이다. */
export const headOf = (p: Person): number => (p.captain ? CAPTAIN_HEAD_COUNT : 1)

/** 세 명뿐인 팀인가. 주장을 두는 쪽이다. */
export const isShortHanded = (team: TeamId): boolean => SHORT_HANDED_TEAMS.includes(team)

/** 방을 차지하는 자리 수. 사람도 로봇도 하나씩이다 — 정원은 머릿수가 아니라 자리다. */
function seatsIn(state: PhaseState, tileId: TileId): number {
  return (
    state.people.filter((p) => p.tileId === tileId).length +
    state.robots.filter((r) => r.tileId === tileId).length
  )
}

/**
 * 주인을 정한다. **가장 많은 팀이 하나뿐일 때만** 바뀐다.
 *
 * 동점이면 주인이 그대로다. 비어 있던 방이 동점이면 계속 빈 방이다 —
 * 밀어내려면 확실히 더 많아야 한다.
 */
export function ownerOf(
  weights: Readonly<Partial<Record<TeamId, number>>>,
  before: TeamId | null,
): TeamId | null {
  const rows = Object.entries(weights).filter(([, n]) => (n ?? 0) > 0) as [TeamId, number][]
  if (rows.length === 0) return before
  const top = Math.max(...rows.map(([, n]) => n))
  const leaders = rows.filter(([, n]) => n === top)
  return leaders.length === 1 ? leaders[0][0] : before
}

// ── 페이즈 처리 ─────────────────────────────────────────────────

/**
 * 한 페이즈를 한꺼번에 처리한다.
 *
 * 순서가 규칙의 절반이다.
 *
 *   1 이동      스스로 걷는 것이 먼저다
 *   2 호출      끌려가는 사람이 이미 움직였으면 불발
 *   3 로봇      두고 가기 · 부수기 — 점령을 세기 전에 끝나야 한다
 *   4 방해      자리를 잡은 뒤에 건다
 *   5 점령      여기서 주인이 정해진다
 *   6 연구 완료 새로 생긴 로봇은 이번 판정에 못 끼어든다
 */
export function resolvePhase(state: PhaseState, actionsIn: readonly Action[]): PhaseResult {
  const actions = [...actionsIn].sort((a, b) => a.atMs - b.atMs)
  const log: LogLine[] = []

  // 움직이는 동안 계속 바뀌므로 복사본을 들고 간다
  const people = state.people.map((p) => ({ ...p }))
  let robots = state.robots.map((r) => ({ ...r }))
  const byId = new Map(people.map((p) => [p.playerId, p]))
  const act = new Map(actions.map((a) => [a.playerId, a]))

  const seats = new Map<TileId, number>()
  for (const t of TILES) seats.set(t.id, 0)
  const recount = () => {
    for (const t of TILES) seats.set(t.id, 0)
    for (const p of people) seats.set(p.tileId, (seats.get(p.tileId) ?? 0) + 1)
    for (const r of robots) seats.set(r.tileId, (seats.get(r.tileId) ?? 0) + 1)
  }
  recount()

  const carriedOf = (playerId: string) => robots.filter((r) => r.carriedBy === playerId)

  /** 사람 하나를 옆방으로 옮긴다. 데리고 있는 로봇도 같이 간다. */
  function step(p: Person, to: TileId): { ok: true } | { ok: false; why: string } {
    if (!ADJACENCY[p.tileId]?.includes(to)) return { ok: false, why: '옆방이 아니다.' }
    const party = 1 + carriedOf(p.playerId).length
    const room = capacityOf(to)
    if ((seats.get(to) ?? 0) + party > room) {
      return { ok: false, why: `${TILE_BY_ID[to].name}이(가) 꽉 찼다. 정원 ${room}.` }
    }
    const from = p.tileId
    const moving = carriedOf(p.playerId)
    seats.set(from, (seats.get(from) ?? 0) - party)
    seats.set(to, (seats.get(to) ?? 0) + party)
    p.tileId = to
    for (const r of moving) r.tileId = to
    return { ok: true }
  }

  // 1 이동
  for (const a of actions) {
    if (a.kind !== 'move') continue
    const p = byId.get(a.playerId)
    if (!p || !a.targetTile) continue
    const out = step(p, a.targetTile)
    if (out.ok) log.push({ kind: 'moved', playerId: p.playerId, tileId: a.targetTile, team: p.team })
    else log.push({ kind: 'moveBlocked', playerId: p.playerId, tileId: a.targetTile, why: out.why })
  }

  // 2 호출 — 같은 사람을 둘이 부르면 먼저 부른 쪽만
  const pulled = new Set<string>()
  for (const a of actions) {
    if (a.kind !== 'summon') continue
    const caller = byId.get(a.playerId)
    const target = a.targetPlayer ? byId.get(a.targetPlayer) : undefined
    if (!caller || !target) continue
    const fail = (why: string) =>
      log.push({ kind: 'summonFailed', playerId: caller.playerId, targetPlayer: a.targetPlayer, why })
    if (target.team !== caller.team) {
      fail('같은 팀만 부를 수 있다.')
      continue
    }
    if (pulled.has(target.playerId)) {
      fail('이미 다른 사람이 먼저 불렀다.')
      continue
    }
    if (act.get(target.playerId)?.kind === 'move') {
      fail('그 사람은 스스로 움직였다.')
      continue
    }
    if (target.tileId === caller.tileId) {
      fail('이미 같은 방에 있다.')
      continue
    }
    const next = stepToward(target.tileId, caller.tileId)
    if (!next) {
      fail('길이 없다.')
      continue
    }
    const out = step(target, next)
    if (!out.ok) {
      fail(out.why)
      continue
    }
    pulled.add(target.playerId)
    log.push({ kind: 'summoned', playerId: caller.playerId, targetPlayer: target.playerId, tileId: next })
  }

  // 3 로봇 — 두고 가기와 부수기. 점령을 세기 전에 끝난다
  for (const a of actions) {
    const p = byId.get(a.playerId)
    if (!p) continue
    if (a.kind === 'dropRobot') {
      const mine = carriedOf(p.playerId)
      if (mine.length === 0) {
        log.push({ kind: 'smashFailed', playerId: p.playerId, why: '데리고 있는 로봇이 없다.' })
        continue
      }
      mine[0].carriedBy = null
      log.push({ kind: 'robotLeft', playerId: p.playerId, tileId: p.tileId, targetRobot: mine[0].id })
    }
    if (a.kind === 'smashRobot') {
      const fail = (why: string) =>
        log.push({ kind: 'smashFailed', playerId: p.playerId, targetRobot: a.targetRobot, why })
      const enemyHere = people.some((q) => q.tileId === p.tileId && q.team !== p.team)
      if (enemyHere) {
        fail('이 방에 상대 팀 사람이 있다.')
        continue
      }
      const bot = robots.find((r) => r.id === a.targetRobot && r.tileId === p.tileId && r.team !== p.team)
      if (!bot) {
        fail('그 로봇이 여기 없다.')
        continue
      }
      robots = robots.filter((r) => r.id !== bot.id)
      seats.set(p.tileId, (seats.get(p.tileId) ?? 0) - 1)
      log.push({ kind: 'robotSmashed', playerId: p.playerId, tileId: p.tileId, targetRobot: bot.id })
    }
  }

  // 4 방해 — 한 대상에 한 번. 둘이 걸어도 효과는 같다
  const zeroedPeople = new Set<string>()
  const zeroedRobots = new Set<string>()
  for (const a of actions) {
    if (a.kind !== 'disturb') continue
    const p = byId.get(a.playerId)
    if (!p) continue
    const fail = (why: string) => log.push({ kind: 'disturbFailed', playerId: p.playerId, why })
    if (a.targetPlayer) {
      const t = byId.get(a.targetPlayer)
      if (!t || t.tileId !== p.tileId || t.team === p.team) {
        fail('그 사람이 같은 방에 없다.')
        continue
      }
      zeroedPeople.add(t.playerId)
      log.push({ kind: 'disturbed', playerId: p.playerId, targetPlayer: t.playerId, tileId: p.tileId })
    } else if (a.targetRobot) {
      const bot = robots.find((r) => r.id === a.targetRobot && r.tileId === p.tileId && r.team !== p.team)
      if (!bot) {
        fail('그 로봇이 같은 방에 없다.')
        continue
      }
      zeroedRobots.add(bot.id)
      log.push({ kind: 'disturbed', playerId: p.playerId, targetRobot: bot.id, tileId: p.tileId })
    } else fail('대상을 골라야 한다.')
  }

  // 위장은 판정을 바꾸지 않는다. 화면에 보이는 숫자만 바꾼다
  const disguised = actions.filter((a) => a.kind === 'disguise').map((a) => a.playerId)
  for (const id of disguised) log.push({ kind: 'disguised', playerId: id })

  // 5 점령
  const owners: Partial<Record<TileId, TeamId | null>> = { ...state.owners }
  for (const t of TILES) {
    const w: Partial<Record<TeamId, number>> = {}
    for (const p of people) {
      if (p.tileId !== t.id || zeroedPeople.has(p.playerId)) continue
      w[p.team] = (w[p.team] ?? 0) + headOf(p)
    }
    for (const r of robots) {
      if (r.tileId !== t.id || zeroedRobots.has(r.id)) continue
      w[r.team] = (w[r.team] ?? 0) + 1
    }
    const before = state.owners[t.id] ?? null
    const after = ownerOf(w, before)
    owners[t.id] = after
    if (after !== before && after) log.push({ kind: 'captured', tileId: t.id, team: after })
  }

  // 6 연구 완료 — 새 로봇은 이번 판정에 끼어들지 않는다
  let made = 0
  const spawn = (ownerId: string) => {
    const p = byId.get(ownerId)
    if (!p) return
    const room = capacityOf(p.tileId)
    if ((seats.get(p.tileId) ?? 0) + 1 > room) {
      log.push({ kind: 'researchFailed', playerId: ownerId, tileId: p.tileId, why: '방이 꽉 차 로봇이 설 자리가 없다.' })
      return
    }
    made += 1
    const carried = carriedOf(ownerId).length
    robots = [
      ...robots,
      {
        id: `bot-${ownerId}-${state.pendingResearch.length}-${made}`,
        team: p.team,
        tileId: p.tileId,
        // 두 기까지만 데리고 다닌다. 넘치면 그 자리에 선다
        carriedBy: carried < MAX_CARRIED_ROBOTS ? ownerId : null,
      },
    ]
    seats.set(p.tileId, (seats.get(p.tileId) ?? 0) + 1)
    log.push({ kind: 'researchDone', playerId: ownerId, tileId: p.tileId })
  }
  for (const id of state.pendingResearch) spawn(id)

  // 이번 페이즈의 연구. 발전소를 쥔 팀은 그 자리에서 끝난다
  const plantOwner = new Map<TeamId, boolean>()
  for (const t of TILES) {
    if (ROOM_KIND[t.id] === 'plant' && owners[t.id]) plantOwner.set(owners[t.id] as TeamId, true)
  }
  const pendingResearch: string[] = []
  for (const a of actions) {
    if (a.kind !== 'research') continue
    const p = byId.get(a.playerId)
    if (!p) continue
    if (ROOM_KIND[p.tileId] !== 'lab') {
      log.push({ kind: 'researchFailed', playerId: p.playerId, tileId: p.tileId, why: '연구실에서만 연구할 수 있다.' })
      continue
    }
    if (plantOwner.get(p.team)) {
      spawn(p.playerId)
      continue
    }
    pendingResearch.push(p.playerId)
    log.push({ kind: 'researchStarted', playerId: p.playerId, tileId: p.tileId })
  }

  return {
    next: { people, robots, owners, pendingResearch },
    log,
    disguised,
  }
}

/**
 * from 에서 to 쪽으로 한 칸. 최단 경로의 첫 걸음이다.
 *
 * 너비 우선으로 찾는다 — 판이 스물다섯 칸뿐이라 미리 표를 만들 이유가 없고,
 * 표를 만들면 판을 고칠 때 같이 고쳐야 하는 것이 하나 더 는다.
 */
export function stepToward(from: TileId, to: TileId): TileId | null {
  if (from === to) return null
  const prev = new Map<TileId, TileId>()
  const seen = new Set<TileId>([from])
  const queue: TileId[] = [from]
  while (queue.length > 0) {
    const at = queue.shift() as TileId
    for (const next of ADJACENCY[at] ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      prev.set(next, at)
      if (next === to) {
        let cur = to
        while (prev.get(cur) !== from) cur = prev.get(cur) as TileId
        return cur
      }
      queue.push(next)
    }
  }
  return null
}

/** 이 방에 있는 자리 수. 화면이 정원과 나란히 보인다. */
export const seatsUsed = (state: PhaseState, tileId: TileId): number => seatsIn(state, tileId)

/**
 * 남에게 보이는 머릿수. **위장은 여기서만 산다.**
 *
 * 판정은 이 값을 쓰지 않는다. 같은 팀에게는 진짜 숫자가 간다.
 */
export function shownCount(
  state: PhaseState,
  tileId: TileId,
  viewerTeam: TeamId,
  disguised: readonly string[],
): number {
  const wearing = new Set(disguised)
  let n = 0
  for (const p of state.people) {
    if (p.tileId !== tileId) continue
    n += p.team !== viewerTeam && wearing.has(p.playerId) ? DISGUISE_SHOWN_AS : 1
  }
  n += state.robots.filter((r) => r.tileId === tileId).length
  return n
}
