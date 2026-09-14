// 점령 — 방은 사람이 많은 팀의 것이다.
//
// 깃발을 꽂아 시간을 채우던 방식을 걷어내고, **그 방에 서 있는 머릿수**로
// 주인을 정한다. 뺏으려면 몰려가야 하고, 지키려면 남아 있어야 한다.
//
// **페이즈는 한 시간짜리 라이브 판이다.** 관리자가 열면 한 시간이 흐르고,
// 그동안 각자 토큰만큼 움직이고 행동한다. 토큰을 다 쓰면 그 자리에 서
// 있는 수밖에 없다. 한 시간이 끝난 순간 각 방에 서 있는 머릿수로 주인이
// 정해진다 — 그래서 「어디에서 끝낼 것인가」가 유일한 질문이다.
//
// 전에는 모두가 행동 하나를 몰래 고르고 한꺼번에 까는 방식이었다. 그것도
// 되는 게임이지만, 한 시간을 살아 움직이는 쪽을 골랐다. 판이 넓고 안개가
// 있어서 남이 어디 있는지는 어차피 대부분 안 보인다.
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

/**
 * 한 페이즈가 열려 있는 시간(분). 게임 시계로 잰다.
 *
 * 관리자가 이보다 일찍 닫을 수는 있어도 늦게까지 끌 수는 없다 — 시간이
 * 지나면 아무도 더 못 움직인다. 안 그러면 늦게 닫히는 페이즈에서 토큰이
 * 남은 사람만 계속 유리하다.
 */
export const PHASE_MINUTES = 60

/**
 * 페이즈가 열릴 때 한 사람에게 주는 토큰.
 *
 * 이것이 한 페이즈에 할 수 있는 일의 전부다. 한 칸 움직이는 데 하나,
 * 행동에 따라 하나나 둘. 남은 토큰은 페이즈가 닫히면 사라진다 —
 * 아껴 두는 전략이 생기면 「지금 갈 것인가」가 질문이 아니게 된다.
 */
export const TOKENS_PER_PHASE = 6

/** 옆방으로 한 칸. */
export const MOVE_COST = 1

/** 사람 한 명이 데리고 다닐 수 있는 로봇. */
export const MAX_CARRIED_ROBOTS = 2
/** 위장한 사람이 남에게 보이는 머릿수. 판정은 이 값을 쓰지 않는다. */
export const DISGUISE_SHOWN_AS = 2
/** 연구가 로봇이 되기까지 걸리는 페이즈. 발전소를 쥐면 그 자리에서 된다. */
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
  /** 이번 페이즈에 남은 토큰. */
  tokens: number
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
  /** 이번 페이즈에 방해당한 사람·로봇. 점령 판정에서 0으로 센다. */
  zeroedPeople: readonly string[]
  zeroedRobots: readonly string[]
  /** 이번 페이즈에 위장한 사람. 남에게 보이는 숫자만 바뀐다. */
  disguised: readonly string[]
}

export type ActionKind = 'move' | 'research' | 'summon' | 'disturb' | 'disguise' | 'dropRobot' | 'smashRobot'

/** 행동에 드는 토큰. 이동은 MOVE_COST 다. */
export const ACT_COST: Record<ActionKind, number> = {
  move: MOVE_COST,
  research: 2,
  summon: 1,
  disturb: 1,
  disguise: 1,
  // 들고 있던 것을 내려놓는 것뿐이다. 값을 물리면 아무도 안 둔다
  dropRobot: 0,
  smashRobot: 1,
}

export interface Act {
  kind: ActionKind
  /** 이동의 목적지. */
  targetTile?: TileId
  /** 호출·방해의 대상이 사람일 때. */
  targetPlayer?: string
  /** 방해·부수기의 대상이 로봇일 때. */
  targetRobot?: string
}

export type LogKind =
  | 'moved'
  | 'summoned'
  | 'disturbed'
  | 'disguised'
  | 'robotLeft'
  | 'robotSmashed'
  | 'researchStarted'
  | 'researchDone'
  | 'captured'

export interface LogLine {
  kind: LogKind
  playerId?: string
  tileId?: TileId
  team?: TeamId
  targetPlayer?: string
  targetRobot?: string
}

// ── 머릿수 ──────────────────────────────────────────────────────

/** 점령 판정에서 이 사람이 몇으로 세는가. 주장은 둘이다. */
export const headOf = (p: Person): number => (p.captain ? CAPTAIN_HEAD_COUNT : 1)

/** 세 명뿐인 팀인가. 주장을 두는 쪽이다. */
export const isShortHanded = (team: TeamId): boolean => SHORT_HANDED_TEAMS.includes(team)

/** 방을 차지하는 자리 수. 사람도 로봇도 하나씩이다 — 정원은 머릿수가 아니라 자리다. */
export function seatsUsed(state: PhaseState, tileId: TileId): number {
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

// ── 행동 하나 ───────────────────────────────────────────────────

export type ActResult =
  | { ok: true; next: PhaseState; log: LogLine; spent: number }
  | { ok: false; why: string }

const no = (why: string): ActResult => ({ ok: false, why })

/**
 * 행동 하나를 지금 당장 처리한다.
 *
 * 라이브라서 순서가 곧 먼저 한 사람 순이다. 꽉 찬 방에 둘이 들어가려 하면
 * 먼저 누른 쪽만 들어간다 — 동시 제출 때처럼 낸 시각을 따로 견줄 필요가 없다.
 *
 * **토큰이 모자라면 아무 일도 일어나지 않는다.** 먼저 되는지 보고, 되는
 * 경우에만 깎는다. 반쯤 되고 토큰만 빠지는 일은 없어야 한다.
 */
export function doAct(state: PhaseState, playerId: string, act: Act): ActResult {
  const me = state.people.find((p) => p.playerId === playerId)
  if (!me) return no('이 판에 없는 사람이다.')

  const cost = ACT_COST[act.kind]
  if (me.tokens < cost) return no(`토큰이 모자란다. ${cost}개가 든다.`)

  const people = state.people.map((p) => ({ ...p }))
  let robots = state.robots.map((r) => ({ ...r }))
  const byId = new Map(people.map((p) => [p.playerId, p]))
  const mine = byId.get(playerId) as Person

  const seats = (tileId: TileId) =>
    people.filter((p) => p.tileId === tileId).length + robots.filter((r) => r.tileId === tileId).length
  const carriedOf = (id: string) => robots.filter((r) => r.carriedBy === id)

  /** 사람 하나를 옆방으로 옮긴다. 데리고 있는 로봇도 같이 간다. */
  function step(p: Person, to: TileId): string | null {
    if (!ADJACENCY[p.tileId]?.includes(to)) return '옆방이 아니다.'
    const party = 1 + carriedOf(p.playerId).length
    const room = capacityOf(to)
    if (seats(to) + party > room) return `${TILE_BY_ID[to].name}이(가) 꽉 찼다. 정원 ${room}.`
    const moving = carriedOf(p.playerId)
    p.tileId = to
    for (const r of moving) r.tileId = to
    return null
  }

  let log: LogLine

  switch (act.kind) {
    case 'move': {
      const to = act.targetTile
      if (!to || !TILE_BY_ID[to]) return no('그런 방은 없다.')
      const bad = step(mine, to)
      if (bad) return no(bad)
      log = { kind: 'moved', playerId, tileId: to, team: mine.team }
      break
    }

    case 'summon': {
      // 같은 팀 한 명을 내 쪽으로 한 칸 끌어온다. 멀리 있는 사람을
      // 부르는 데 여러 페이즈가 걸린다 — 그래서 뭉치는 것이 비싸다
      const target = act.targetPlayer ? byId.get(act.targetPlayer) : undefined
      if (!target) return no('그런 사람이 없다.')
      if (target.team !== mine.team) return no('같은 팀만 부를 수 있다.')
      if (target.tileId === mine.tileId) return no('이미 같은 방에 있다.')
      const next = stepToward(target.tileId, mine.tileId)
      if (!next) return no('길이 없다.')
      const bad = step(target, next)
      if (bad) return no(bad)
      log = { kind: 'summoned', playerId, targetPlayer: target.playerId, tileId: next }
      break
    }

    case 'disturb': {
      // 같은 방의 상대 하나를 이번 페이즈 점령 판정에서 0으로 만든다.
      // 쫓아내지는 못한다 — 사람은 그대로 서 있고 숫자만 빠진다
      if (act.targetPlayer) {
        const t = byId.get(act.targetPlayer)
        if (!t || t.tileId !== mine.tileId || t.team === mine.team) return no('그 사람이 같은 방에 없다.')
        if (state.zeroedPeople.includes(t.playerId)) return no('이미 방해받고 있다.')
        log = { kind: 'disturbed', playerId, targetPlayer: t.playerId, tileId: mine.tileId }
        return {
          ok: true,
          spent: cost,
          log,
          next: {
            ...state,
            people: people.map((p) => (p.playerId === playerId ? { ...p, tokens: p.tokens - cost } : p)),
            zeroedPeople: [...state.zeroedPeople, t.playerId],
          },
        }
      }
      if (act.targetRobot) {
        const bot = robots.find((r) => r.id === act.targetRobot && r.tileId === mine.tileId && r.team !== mine.team)
        if (!bot) return no('그 로봇이 같은 방에 없다.')
        if (state.zeroedRobots.includes(bot.id)) return no('이미 방해받고 있다.')
        log = { kind: 'disturbed', playerId, targetRobot: bot.id, tileId: mine.tileId }
        return {
          ok: true,
          spent: cost,
          log,
          next: {
            ...state,
            people: people.map((p) => (p.playerId === playerId ? { ...p, tokens: p.tokens - cost } : p)),
            zeroedRobots: [...state.zeroedRobots, bot.id],
          },
        }
      }
      return no('대상을 골라야 한다.')
    }

    case 'disguise': {
      if (state.disguised.includes(playerId)) return no('이미 위장하고 있다.')
      mine.tokens -= cost
      return {
        ok: true,
        spent: cost,
        log: { kind: 'disguised', playerId },
        next: { ...state, people, robots, disguised: [...state.disguised, playerId] },
      }
    }

    case 'dropRobot': {
      const held = carriedOf(playerId)
      if (held.length === 0) return no('데리고 있는 로봇이 없다.')
      held[0].carriedBy = null
      log = { kind: 'robotLeft', playerId, tileId: mine.tileId, targetRobot: held[0].id }
      break
    }

    case 'smashRobot': {
      if (people.some((q) => q.tileId === mine.tileId && q.team !== mine.team)) {
        return no('이 방에 상대 팀 사람이 있다.')
      }
      const bot = robots.find((r) => r.id === act.targetRobot && r.tileId === mine.tileId && r.team !== mine.team)
      if (!bot) return no('그 로봇이 여기 없다.')
      robots = robots.filter((r) => r.id !== bot.id)
      log = { kind: 'robotSmashed', playerId, tileId: mine.tileId, targetRobot: bot.id }
      break
    }

    case 'research': {
      if (ROOM_KIND[mine.tileId] !== 'lab') return no('연구실에서만 연구할 수 있다.')
      if (state.pendingResearch.includes(playerId)) return no('이미 연구를 걸어 두었다.')
      // 발전소를 쥔 팀은 그 자리에서 로봇이 나온다
      const hasPlant = TILES.some((t) => ROOM_KIND[t.id] === 'plant' && state.owners[t.id] === mine.team)
      if (!hasPlant) {
        mine.tokens -= cost
        return {
          ok: true,
          spent: cost,
          log: { kind: 'researchStarted', playerId, tileId: mine.tileId },
          next: { ...state, people, robots, pendingResearch: [...state.pendingResearch, playerId] },
        }
      }
      if (seats(mine.tileId) + 1 > capacityOf(mine.tileId)) return no('방이 꽉 차 로봇이 설 자리가 없다.')
      robots = [...robots, born(mine, robots, `now-${playerId}-${state.robots.length}`)]
      log = { kind: 'researchDone', playerId, tileId: mine.tileId }
      break
    }
  }

  mine.tokens -= cost
  return { ok: true, spent: cost, log, next: { ...state, people, robots } }
}

/** 새로 나온 로봇 하나. 두 기까지만 데리고 다닌다 — 넘치면 그 자리에 선다. */
function born(owner: Person, robots: readonly Robot[], id: string): Robot {
  const carried = robots.filter((r) => r.carriedBy === owner.playerId).length
  return {
    id: `bot-${id}`,
    team: owner.team,
    tileId: owner.tileId,
    carriedBy: carried < MAX_CARRIED_ROBOTS ? owner.playerId : null,
  }
}

// ── 페이즈 닫기 ─────────────────────────────────────────────────

export interface SettleResult {
  next: PhaseState
  log: readonly LogLine[]
}

/**
 * 한 시간이 끝났다. **서 있는 자리로 주인을 정한다.**
 *
 * 행동은 이미 그때그때 처리됐다. 여기서 하는 일은 두 가지뿐이다 —
 * 머릿수를 세는 것과, 지난 페이즈에 걸어 둔 연구를 로봇으로 만드는 것.
 *
 * 연구로 새로 난 로봇은 **이번 판정에 끼어들지 않는다.** 페이즈가 끝나는
 * 순간에 머릿수가 하나 느는 것은 아무도 대응할 수 없다.
 */
export function settle(state: PhaseState): SettleResult {
  const log: LogLine[] = []
  const zeroedPeople = new Set(state.zeroedPeople)
  const zeroedRobots = new Set(state.zeroedRobots)

  const owners: Partial<Record<TileId, TeamId | null>> = { ...state.owners }
  for (const t of TILES) {
    const w: Partial<Record<TeamId, number>> = {}
    for (const p of state.people) {
      if (p.tileId !== t.id || zeroedPeople.has(p.playerId)) continue
      w[p.team] = (w[p.team] ?? 0) + headOf(p)
    }
    for (const r of state.robots) {
      if (r.tileId !== t.id || zeroedRobots.has(r.id)) continue
      w[r.team] = (w[r.team] ?? 0) + 1
    }
    const before = state.owners[t.id] ?? null
    const after = ownerOf(w, before)
    owners[t.id] = after
    if (after !== before && after) log.push({ kind: 'captured', tileId: t.id, team: after })
  }

  // 지난 페이즈의 연구가 이제 로봇이 된다
  let robots = [...state.robots]
  const seats = (tileId: TileId) =>
    state.people.filter((p) => p.tileId === tileId).length + robots.filter((r) => r.tileId === tileId).length
  let made = 0
  for (const id of state.pendingResearch) {
    const p = state.people.find((q) => q.playerId === id)
    if (!p) continue
    if (seats(p.tileId) + 1 > capacityOf(p.tileId)) continue
    made += 1
    robots = [...robots, born(p, robots, `${id}-${made}`)]
    log.push({ kind: 'researchDone', playerId: id, tileId: p.tileId })
  }

  return {
    next: {
      people: state.people,
      robots,
      owners,
      pendingResearch: [],
      zeroedPeople: [],
      zeroedRobots: [],
      disguised: [],
    },
    log,
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
