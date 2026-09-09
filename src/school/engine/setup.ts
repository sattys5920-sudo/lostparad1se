import { MAX_PLAYERS, MIN_PLAYERS, ROLE_INCLUDE_ORDER } from '../data/roles'
import type { RoleId } from '../types'

function shuffled<T>(arr: T[]): T[] {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/**
 * 참가자 수(8~14명)에 맞춰 역할을 자동으로 골라 무작위 배정한다.
 * 인원이 14명 미만이면 data/roles.ts의 ROLE_INCLUDE_ORDER 뒤쪽 역할부터 제외한다.
 */
export function assignRoles(playerIds: string[]): Record<string, RoleId> {
  const count = playerIds.length
  if (count < MIN_PLAYERS || count > MAX_PLAYERS) {
    throw new Error(`참가자는 ${MIN_PLAYERS}~${MAX_PLAYERS}명이어야 한다. (현재 ${count}명)`)
  }
  const roles = ROLE_INCLUDE_ORDER.slice(0, count)
  const shuffledPlayers = shuffled(playerIds)
  const shuffledRoles = shuffled(roles)
  const assignment: Record<string, RoleId> = {}
  shuffledPlayers.forEach((playerId, i) => {
    assignment[playerId] = shuffledRoles[i]
  })
  return assignment
}
