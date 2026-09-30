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
// 배정 규칙(갈래 · ★)은 없앴다. 운영자가 고른다.
import { STARTING_TEAM_SIZES, type TeamId } from '../rules/v2'
import { ROLE_IDS, ROSTER_SIZE, type RoleId } from './roles'

export interface Player {
  id: string
  team: TeamId
}

export interface Assignment {
  playerId: string
  team: TeamId
  roleId: RoleId
  /**
   * **더는 여기서 안 정한다.** 짝사랑의 대상은 이제 매일 밤 운영자가
   * 고른다(functions/src/missionDays.ts 의 secret/crush 문서) — 배정
   * 시점에는 늘 null이다. 필드는 옛 판의 문서 모양과 맞추려고 남겨 둔다.
   */
  targetId: string | null
}

// ── 씨앗 ────────────────────────────────────────────────────────

// 주사위는 shared/rand 에 있다. 이 파일을 거쳐 가져가던 곳이 있어 그대로 내보낸다
import { rngFrom } from '../rand'
import { teamName } from '../rules/bundan'
export { rngFrom }

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
    throw new Error(`열네 명이어야 한다 (${players.length} 명)`)
  }
  if (new Set(players.map((p) => p.id)).size !== players.length) {
    throw new Error('같은 아이디가 두 번 들어 있다')
  }
  for (const [team, size] of Object.entries(STARTING_TEAM_SIZES) as [TeamId, number][]) {
    const got = players.filter((p) => p.team === team).length
    if (got !== size) throw new Error(`${teamName(team)}은 ${size} 명이어야 한다 (${got} 명)`)
  }
}

// ── 배정이 맞는가(열넷 · 한 역할은 한 사람) ──────────────────────────────────────

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
  /*
   * **배정 규칙은 없다.** 전에는 팀마다 손 갈래 하나 · ★ 셋은 서로 다른
   * 팀 · 같은 갈래 셋 금지를 지켰는데, 이제 운영자가 한 사람씩 고른다
   * (lobby.ts 의 hostAssignSeat). 남은 것은 「열넷 · 한 역할은 한 사람」뿐이다
   */
  if (dealt.length !== ROSTER_SIZE) return { ok: false, reason: `열네 명이어야 한다 (${dealt.length} 명)` }
  if (new Set(dealt.map((d) => d.roleId)).size !== ROSTER_SIZE) {
    return { ok: false, reason: '같은 역할이 두 번 나갔다' }
  }
  return { ok: true }
}

// ── 배정 ────────────────────────────────────────────────────────

/**
 * 열네 명에게 역할을 무작위로 나눈다. **시험 대본과 봇 시뮬레이션용이다** —
 * 실제 판은 운영자가 한 사람씩 고른다(hostAssignSeat).
 *
 * 같은 명단·같은 씨앗이면 늘 같은 결과다. 들어온 순서는 결과에 영향을
 * 주지 않는다 — 아이디로 먼저 정렬한다.
 */
export function assignRoles(players: readonly Player[], seed: string): Assignment[] {
  checkRoster(players)
  const roster = [...players].sort((a, b) => a.id.localeCompare(b.id))

  const roles = shuffled(ROLE_IDS, rngFrom(`${seed}#0`))
  return roster.map((p, i) => ({ playerId: p.id, team: p.team, roleId: roles[i], targetId: null }))
}

/** 그 사람에게 내려보낼 한 줄. 남의 역할은 절대 들어가지 않는다. */
export function ownAssignment(all: readonly Assignment[], playerId: string): Assignment | null {
  return all.find((a) => a.playerId === playerId) ?? null
}
