import type { TeamId, TeamSpec } from '../types'

export const TEAMS: TeamSpec[] = [
  { id: 'A', name: 'A팀', color: 'var(--team-a)', baseTileId: 'baseA' },
  { id: 'B', name: 'B팀', color: 'var(--team-b)', baseTileId: 'baseB' },
  { id: 'C', name: 'C팀', color: 'var(--team-c)', baseTileId: 'baseC' },
  { id: 'D', name: 'D팀', color: 'var(--team-d)', baseTileId: 'baseD' },
]

export const teamById: Record<TeamId, TeamSpec> = Object.fromEntries(TEAMS.map((t) => [t.id, t])) as Record<
  TeamId,
  TeamSpec
>

/** 14명을 4/4/3/3으로 나눈다. A·B팀이 4명, C·D팀이 3명이다. */
export const TEAM_SIZES: Record<TeamId, number> = { A: 4, B: 4, C: 3, D: 3 }
