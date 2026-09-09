import type { PlayerProfile, RoleSpec } from '../types'

/**
 * 개인 미션은 시스템이 자동으로 판정하지 않는다. 실제 대화·행동이 판정 기준이라
 * 앱이 관찰할 수 없기 때문이다 — 본인이 직접 체크하는 자기 신고 방식이며,
 * 이 체크는 본인과 진행자에게만 보인다(10번 원칙: 남의 미션을 볼 수 없다).
 */
export function toggleMissionCheck(player: PlayerProfile, index: number): boolean[] {
  const next = [...player.missionChecks]
  next[index] = !next[index]
  return next
}

export function missionCompleteCount(player: PlayerProfile): number {
  return player.missionChecks.filter(Boolean).length
}

export function missionTotalCount(role: RoleSpec): number {
  return role.mission.checklist.length
}

export function isMissionComplete(player: PlayerProfile, role: RoleSpec): boolean {
  return missionCompleteCount(player) >= missionTotalCount(role)
}
