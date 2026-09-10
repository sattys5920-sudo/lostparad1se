import type { EndingKey, PlayerProfile } from '../types'
import { countRelationshipsAbove, countRelationshipsBelow, type RelationshipMatrix } from './relationships'
import { missionCompleteCount, type MissionItemProgress } from './missionProgress'

export interface EndingSuggestion {
  key: EndingKey
  reason: string
}

/**
 * DAY 5에 참고용으로 띄워주는 "제안"일 뿐, 확정이 아니다.
 * 실제로 그 자리에서 무슨 말을 하고 무슨 선택을 했는지는 앱이 관찰할 수 없으므로,
 * 최종 엔딩은 언제나 플레이어 본인이 고른다(engine이 아니라 화면에서 확정한다).
 * 그래도 지금까지 쌓인 신호(관계 극성, 미션 진행, 숨겨진 목표 대면 여부)로
 * "지금 이 사람에게 제일 가까워 보이는 엔딩"을 하나 계산해 둔다.
 */
export function suggestEnding(
  player: PlayerProfile,
  matrix: RelationshipMatrix,
  otherPlayerIds: string[],
  missionProgress: MissionItemProgress[],
  missionTotal: number,
): EndingSuggestion {
  const positive = countRelationshipsAbove(matrix, player.id, otherPlayerIds, 3)
  const negative = countRelationshipsBelow(matrix, player.id, otherPlayerIds, -3)
  const total = otherPlayerIds.length
  const completed = missionCompleteCount(missionProgress)
  const facedHiddenGoal = Boolean(player.hiddenGoalResolution && player.hiddenGoalResolution.trim().length > 0)

  if (total > 0 && negative >= Math.ceil(total * 0.6)) {
    return { key: 'alone', reason: '남은 사람 대부분과 관계가 틀어졌다.' }
  }
  if (facedHiddenGoal && /사과|미안/.test(player.hiddenGoalResolution ?? '')) {
    return { key: 'apologized', reason: '숨겨둔 목표를 마주하며 사과를 선택했다.' }
  }
  if (positive === 0 && completed === 0) {
    return { key: 'nothingHappened', reason: '누구와도 특별히 가까워지지 않고 닷새를 보냈다.' }
  }
  if (!facedHiddenGoal && positive >= Math.ceil(total * 0.5)) {
    return { key: 'stayed', reason: '많은 사람과 관계를 유지했지만, 속마음은 거의 꺼내지 않았다.' }
  }
  if (facedHiddenGoal && completed >= missionTotal) {
    return { key: 'left', reason: '할 일을 다 마치고, 지난 관계를 정리하기로 했다.' }
  }
  if (!facedHiddenGoal) {
    return { key: 'shouldHaveSaid', reason: '끝까지 진짜 마음은 꺼내지 못했다.' }
  }
  if (positive >= 2 && positive === countRelationshipsAbove(matrix, player.id, otherPlayerIds, 4)) {
    return { key: 'wereWeFriends', reason: '여러 사람과 가까워졌지만, 누가 진짜인지는 스스로도 모른다.' }
  }
  return { key: 'newFriend', reason: 'A와 상관없던 사람과 새로운 관계가 생겼다.' }
}
