// 역할과 인연 고리를 나눈다.
//
// 서버에서만 돈다. 결과는 통째로 secret/ 밑에 들어가고, 각자에게는 자기
// 것 한 줄만 views/{playerId}로 내려간다 — 이 파일이 돌려주는 배열이
// 클라이언트에 그대로 닿으면 판이 끝난다.
//
// 씨앗을 받아 같은 씨앗이면 같은 결과가 나오게 했다. 판을 다시 열어도
// 역할이 바뀌지 않아야 하고(한 번 배정하면 끝이다), 시험에서 천 번을
// 돌려 보려면 재현이 돼야 한다.
import { TEAM_SIZES, type TeamId } from '../rules/v2'
import {
  BOND_RING_SIZE,
  FILLER_PATH,
  REQUIRED_PATHS,
  ROLES_BY_PATH,
  validateBondRing,
  type BondAssignment,
  type RoleId,
} from './roles'

export interface Player {
  id: string
  team: TeamId
}

export interface Assignment {
  playerId: string
  team: TeamId
  roleId: RoleId
  /** 이 사람의 인연 대상. 고리에서 다음 사람이다. */
  bondId: string
}

// ── 씨앗 ────────────────────────────────────────────────────────

/** 글자열 씨앗을 32비트로. */
function hashSeed(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** mulberry32. 짧고 재현되면 충분하다 — 암호에 쓰지 않는다. */
export function rngFrom(seed: string): () => number {
  let a = hashSeed(seed)
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled<T>(items: readonly T[], rnd: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// ── 들어온 명단 확인 ────────────────────────────────────────────

function checkRoster(players: readonly Player[]): void {
  if (players.length !== BOND_RING_SIZE) {
    throw new Error(`열네 명이어야 한다 (${players.length}명)`)
  }
  if (new Set(players.map((p) => p.id)).size !== players.length) {
    throw new Error('같은 아이디가 두 번 들어 있다')
  }
  for (const [team, size] of Object.entries(TEAM_SIZES) as [TeamId, number][]) {
    const got = players.filter((p) => p.team === team).length
    if (got !== size) throw new Error(`${team}팀은 ${size}명이어야 한다 (${got}명)`)
  }
}

// ── 역할 ────────────────────────────────────────────────────────

/**
 * 팀마다 팀의 길 하나와 밖의 길 하나를 준다. 남는 자리는 사람의 길로
 * 채운다. 네 팀·네 역할이라 갈래마다 정확히 하나씩 돌아간다.
 */
function dealRoles(players: readonly Player[], rnd: () => number): Map<string, RoleId> {
  const pools: Record<string, RoleId[]> = {}
  for (const path of [...REQUIRED_PATHS, FILLER_PATH]) {
    pools[path] = shuffled(ROLES_BY_PATH[path], rnd)
  }

  const out = new Map<string, RoleId>()
  const teams = shuffled(Object.keys(TEAM_SIZES) as TeamId[], rnd)

  for (const team of teams) {
    const members = shuffled(
      players.filter((p) => p.team === team).map((p) => p.id),
      rnd,
    )
    for (const path of REQUIRED_PATHS) {
      const who = members.shift()
      const role = pools[path].shift()
      if (!who || !role) throw new Error('역할이 모자란다')
      out.set(who, role)
    }
    for (const who of members) {
      const role = pools[FILLER_PATH].shift()
      if (!role) throw new Error('사람의 길이 모자란다')
      out.set(who, role)
    }
  }
  return out
}

// ── 인연 고리 ───────────────────────────────────────────────────

/**
 * 이웃이 같은 팀이 되지 않게 팀 순서를 한 바퀴 늘어놓는다.
 *
 * 남은 수가 많은 팀부터 놓는다 — 4명짜리 팀을 뒤로 미루면 마지막에
 * 같은 팀이 붙어 버린다. 마지막 자리는 첫 자리와도 달라야 한다.
 * 4·4·3·3이면 가장 많은 팀이 절반을 넘지 않으므로 늘 답이 있다.
 */
function teamCycle(rnd: () => number): TeamId[] | null {
  const left: Record<string, number> = { ...TEAM_SIZES }
  const out: TeamId[] = []
  const first = shuffled(Object.keys(TEAM_SIZES) as TeamId[], rnd)[0]

  for (let i = 0; i < BOND_RING_SIZE; i++) {
    const prev = out[out.length - 1]
    const last = i === BOND_RING_SIZE - 1
    const can = (Object.keys(left) as TeamId[]).filter(
      (t) => left[t] > 0 && t !== prev && !(last && t === first),
    )
    if (can.length === 0) return null
    // 남은 수가 가장 많은 팀들 중에서 하나를 고른다
    const most = Math.max(...can.map((t) => left[t]))
    const top = can.filter((t) => left[t] === most)
    const pick = i === 0 ? (left[first] === most ? first : top[0]) : top[Math.floor(rnd() * top.length)]
    out.push(pick)
    left[pick]--
  }
  return out
}

/** 팀 순서에 사람을 끼워 넣어 고리를 만든다. */
function bondRing(players: readonly Player[], rnd: () => number): BondAssignment[] {
  const byTeam = new Map<TeamId, string[]>()
  for (const t of Object.keys(TEAM_SIZES) as TeamId[]) {
    byTeam.set(
      t,
      shuffled(
        players.filter((p) => p.team === t).map((p) => p.id),
        rnd,
      ),
    )
  }
  const cycle = teamCycle(rnd)
  if (!cycle) throw new Error('고리를 만들 수 없다')
  const order = cycle.map((t) => {
    const who = byTeam.get(t)?.shift()
    if (!who) throw new Error('고리에 넣을 사람이 모자란다')
    return who
  })
  return order.map((id, i) => ({ playerId: id, bondId: order[(i + 1) % order.length] }))
}

// ── 배정 ────────────────────────────────────────────────────────

/** 고리를 못 만들면 씨앗을 조금 비틀어 다시 시도한다. 이 횟수 안에 끝난다. */
const MAX_TRIES = 50

/**
 * 열네 명에게 역할과 인연 대상을 한 번에 나눈다.
 *
 * 같은 명단·같은 씨앗이면 늘 같은 결과다. 판을 다시 열어도 역할이
 * 바뀌지 않게 하려면 씨앗을 게임 문서에 적어 두고 그대로 다시 넣으면 된다.
 * 들어온 순서는 결과에 영향을 주지 않는다 — 아이디로 먼저 정렬한다.
 */
export function assignRoles(players: readonly Player[], seed: string): Assignment[] {
  checkRoster(players)
  const roster = [...players].sort((a, b) => a.id.localeCompare(b.id))
  const teamOf = (id: string): TeamId => {
    const found = roster.find((p) => p.id === id)
    if (!found) throw new Error(`명단에 없는 사람이다: ${id}`)
    return found.team
  }

  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const rnd = rngFrom(`${seed}#${attempt}`)
    const roles = dealRoles(roster, rnd)
    let ring: BondAssignment[]
    try {
      ring = bondRing(roster, rnd)
    } catch {
      continue
    }
    const check = validateBondRing(ring, teamOf)
    if (!check.ok) continue

    const bondOf = new Map(ring.map((b) => [b.playerId, b.bondId]))
    return roster.map((p) => ({
      playerId: p.id,
      team: p.team,
      roleId: roles.get(p.id) as RoleId,
      bondId: bondOf.get(p.id) as string,
    }))
  }
  throw new Error('인연 고리를 만들지 못했다')
}

/** 그 사람에게 내려보낼 한 줄. 남의 역할은 절대 들어가지 않는다. */
export function ownAssignment(all: readonly Assignment[], playerId: string): Assignment | null {
  return all.find((a) => a.playerId === playerId) ?? null
}
