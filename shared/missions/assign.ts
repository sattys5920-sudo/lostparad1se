// 역할과 짝사랑 대상을 나눈다.
//
// 서버에서만 돈다. 결과는 통째로 secret/ 밑에 들어가고, 각자에게는 자기
// 것 한 줄만 views/{playerId}로 내려간다 — 이 파일이 돌려주는 배열이
// 클라이언트에 그대로 닿으면 판이 끝난다.
//
// 씨앗을 받아 같은 씨앗이면 같은 결과가 나오게 했다. 판을 다시 열어도
// 역할이 바뀌지 않아야 하고(**배정은 한 번뿐이다**), 시험에서 천 번을
// 돌려 보려면 재현이 돼야 한다.
//
// 규칙 수치는 roles.ts의 ASSIGN_RULES에 있다. 여기서는 읽기만 한다.
import { STARTING_TEAM_SIZES, type TeamId } from '../rules/v2'
import {
  ASSIGN_RULES,
  ASTRAY_BRANCH,
  BRANCHES,
  ROLE_BRANCH,
  ROLE_IDS,
  ROSTER_SIZE,
  type MissionBranch,
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
  /**
   * 짝사랑의 대상. 다른 역할은 null이다.
   *
   * 다른 팀 사람 중 무작위로 고른다. **대상에게는 알리지 않는다** —
   * 본인에게도 이름만 주고 어디 있는지는 주지 않는다.
   */
  targetId: string | null
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
  if (players.length !== ROSTER_SIZE) {
    throw new Error(`열네 명이어야 한다 (${players.length}명)`)
  }
  if (new Set(players.map((p) => p.id)).size !== players.length) {
    throw new Error('같은 아이디가 두 번 들어 있다')
  }
  for (const [team, size] of Object.entries(STARTING_TEAM_SIZES) as [TeamId, number][]) {
    const got = players.filter((p) => p.team === team).length
    if (got !== size) throw new Error(`${team}팀은 ${size}명이어야 한다 (${got}명)`)
  }
}

// ── 배정이 규칙을 지키는가 ──────────────────────────────────────

/** 4인 팀. ★ 둘이 여기 먼저 들어간다. */
const bigTeams = (): TeamId[] => {
  const sizes = Object.entries(STARTING_TEAM_SIZES) as [TeamId, number][]
  const most = Math.max(...sizes.map(([, n]) => n))
  return sizes.filter(([, n]) => n === most).map(([t]) => t)
}

export interface DealtRole {
  playerId: string
  team: TeamId
  roleId: RoleId
}

/**
 * 나눠 준 역할이 배정 규칙을 지키는지. 배정 코드와 시험이 같이 쓴다.
 *
 * 왜 어겼는지를 말로 돌려준다 — 시험이 「안 된다」만 보고는 어느
 * 규칙이 빡빡한지 알 수 없다.
 */
export function validateDeal(dealt: readonly DealtRole[]): { ok: true } | { ok: false; reason: string } {
  if (dealt.length !== ROSTER_SIZE) return { ok: false, reason: `열네 명이어야 한다 (${dealt.length}명)` }
  if (new Set(dealt.map((d) => d.roleId)).size !== ROSTER_SIZE) {
    return { ok: false, reason: '같은 역할이 두 번 나갔다' }
  }

  const teams = [...new Set(dealt.map((d) => d.team))]
  const branchesIn = (team: TeamId): MissionBranch[] =>
    dealt.filter((d) => d.team === team).map((d) => ROLE_BRANCH[d.roleId])

  for (const team of teams) {
    const got = branchesIn(team)
    const hands = got.filter((b) => b === 'hand').length
    if (hands < ASSIGN_RULES.handPerTeamAtLeast) {
      return { ok: false, reason: `${team}팀에 손 갈래가 없다` }
    }
    for (const b of BRANCHES) {
      if (got.filter((x) => x === b).length > ASSIGN_RULES.sameBranchPerTeamAtMost) {
        return { ok: false, reason: `${team}팀에 같은 갈래가 너무 많다 (${b})` }
      }
    }
  }

  const astrayTeams = dealt.filter((d) => ROLE_BRANCH[d.roleId] === ASTRAY_BRANCH).map((d) => d.team)
  if (ASSIGN_RULES.astrayOnePerTeam && new Set(astrayTeams).size !== astrayTeams.length) {
    return { ok: false, reason: '★ 둘이 같은 팀에 들어갔다' }
  }
  const big = new Set(bigTeams())
  if (astrayTeams.filter((t) => big.has(t)).length < ASSIGN_RULES.astrayInBigTeams) {
    return { ok: false, reason: '★ 이 4인 팀에 덜 들어갔다' }
  }
  return { ok: true }
}

// ── 배정 ────────────────────────────────────────────────────────

/**
 * 열네 명에게 역할을 나눈다.
 *
 * 조건을 만족할 때까지 무작위로 다시 섞는다. 규칙을 하나씩 끼워 맞춰
 * 넣으면 특정 자리에 특정 역할이 몰리는 편향이 생긴다 — 섞고 버리는
 * 쪽이 고르다.
 *
 * 같은 명단·같은 씨앗이면 늘 같은 결과다. 들어온 순서는 결과에 영향을
 * 주지 않는다 — 아이디로 먼저 정렬한다.
 */
export function assignRoles(players: readonly Player[], seed: string): Assignment[] {
  checkRoster(players)
  const roster = [...players].sort((a, b) => a.id.localeCompare(b.id))

  for (let attempt = 0; attempt < ASSIGN_RULES.maxTries; attempt++) {
    const rnd = rngFrom(`${seed}#${attempt}`)
    const roles = shuffled(ROLE_IDS, rnd)
    const dealt: DealtRole[] = roster.map((p, i) => ({ playerId: p.id, team: p.team, roleId: roles[i] }))
    if (!validateDeal(dealt).ok) continue

    return dealt.map((d) => ({
      playerId: d.playerId,
      team: d.team,
      roleId: d.roleId,
      targetId: d.roleId === 'crush' ? pickTarget(d, roster, rnd) : null,
    }))
  }
  throw new Error('배정 규칙을 만족하는 짝을 찾지 못했다')
}

/** 짝사랑의 대상. 다른 팀 사람 중 하나. */
function pickTarget(me: DealtRole, roster: readonly Player[], rnd: () => number): string {
  const others = roster.filter((p) => p.team !== me.team).map((p) => p.id)
  if (others.length === 0) throw new Error('다른 팀 사람이 없다')
  return shuffled(others, rnd)[0]
}

/** 그 사람에게 내려보낼 한 줄. 남의 역할은 절대 들어가지 않는다. */
export function ownAssignment(all: readonly Assignment[], playerId: string): Assignment | null {
  return all.find((a) => a.playerId === playerId) ?? null
}
