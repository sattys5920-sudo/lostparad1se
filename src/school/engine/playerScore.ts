import type { EndingKey, PlayerScoreBreakdown, TerritoryState, VoteEntry } from '../types'
import { missionCompleteCount, type MissionItemProgress } from './missionProgress'

/**
 * 개인 점수. 팀의 승패와 별개로 각자에게 남는 숫자다.
 * 팀 점수와 일부러 어긋나게 만들어 뒀다 — 팀을 위해 지도만 팠던 사람은
 * 표를 못 받고, 사람만 만나고 다닌 사람은 기여 점수가 비는 식이다.
 */
const WEIGHT = {
  mission: 5,
  trust: 3,
  liking: 1,
  suspicion: -2,
  secret: 2,
  contribution: 1,
} as const

export function scorePlayer(
  playerId: string,
  missionProgress: MissionItemProgress[],
  votes: VoteEntry[],
  territory: TerritoryState,
): PlayerScoreBreakdown {
  const distinctVoters = (category: VoteEntry['category']) =>
    new Set(votes.filter((v) => v.targetId === playerId && v.category === category).map((v) => v.voterId)).size

  const missions = missionCompleteCount(missionProgress) * WEIGHT.mission
  const trust = distinctVoters('trust') * WEIGHT.trust
  const liking = distinctVoters('liking') * WEIGHT.liking
  const suspicion = distinctVoters('suspicion') * WEIGHT.suspicion
  const secrets = territory.leverage.filter((l) => l.holderId === playerId).length * WEIGHT.secret
  const contribution = territory.actionLog.filter((e) => e.playerId === playerId).length * WEIGHT.contribution

  return {
    missions,
    trust,
    liking,
    suspicion,
    secrets,
    contribution,
    total: missions + trust + liking + suspicion + secrets + contribution,
  }
}

/**
 * 엔딩은 고르는 게 아니라 남은 숫자에서 나온다.
 * 어떤 엔딩도 더 낫지 않다 — 다만 닷새 동안 실제로 한 일이 무엇이었는지를 말해 줄 뿐이다.
 */
export function deriveEnding(score: PlayerScoreBreakdown, facedHiddenGoal: boolean): EndingKey {
  const trustCount = score.trust / 3
  const likingCount = score.liking / 1
  const suspicionCount = Math.abs(score.suspicion) / 2
  const missionsDone = score.missions / 5
  const connected = trustCount + likingCount

  if (suspicionCount >= 3 && connected <= 1) return 'alone'
  if (facedHiddenGoal && suspicionCount >= 2) return 'apologized'
  if (connected === 0 && missionsDone === 0) return 'nothingHappened'
  if (!facedHiddenGoal && trustCount >= 3) return 'stayed'
  if (facedHiddenGoal && missionsDone >= 3) return 'left'
  if (!facedHiddenGoal && connected >= 2) return 'shouldHaveSaid'
  if (trustCount >= 2 && likingCount >= 2) return 'wereWeFriends'
  return 'newFriend'
}
