import type { ActionKind, ActionLogEntry, RelationshipValue } from '../types'

/** 두 플레이어 사이의 관계 수치를 담는 맵. 키는 pairKey()로 만든다. 플레이어 화면에는 절대 노출하지 않는다. */
export type RelationshipMatrix = Record<string, RelationshipValue>

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}__${b}` : `${b}__${a}`
}

export function getRelationship(matrix: RelationshipMatrix, a: string, b: string): RelationshipValue {
  return matrix[pairKey(a, b)] ?? 0
}

function clamp(n: number): RelationshipValue {
  return Math.max(-5, Math.min(5, n)) as RelationshipValue
}

export function applyRelationshipDelta(matrix: RelationshipMatrix, a: string, b: string, delta: number): RelationshipMatrix {
  if (delta === 0) return matrix
  const key = pairKey(a, b)
  const next = clamp((matrix[key] ?? 0) + delta)
  return { ...matrix, [key]: next }
}

/**
 * 행동 하나가 관계에 주는 기본 증감. actor와 target 모두에게 대칭 적용한다.
 * null인 행동은 관계에 자동으로 반영하지 않는다 — 결과가 그 자리의 대화 내용에 달려 있어
 * 시스템이 함부로 판정하지 않는 편이 이 게임의 원칙(11번: 정답보다 이해)에 맞기 때문이다.
 */
export const ACTION_RELATIONSHIP_DELTA: Partial<Record<ActionKind, number>> = {
  talk: 1,
  visit: 1,
  dm: 1,
  grantFavor: 2,
  rejectFavor: -2,
  spreadRumor: 1, // 소문을 나눈 상대와는 가까워진다 — 소문의 대상이 되는 사람과의 관계는 별도(엔진이 자동 판정하지 않음)
  spendTime: 2,
  publicSupport: 3,
  ignore: -2,
  // checkRumor, lie, tellTruth, beAlone: 자동 판정 없음(진행자·플레이어 재량)
}

/**
 * 관계 수치는 별도로 저장하지 않고, 지금까지 쌓인 행동 로그로부터 매번 다시 계산한다.
 * 그래야 "무슨 행동을 했는가"라는 하나의 사실만 진실로 남고, 관계 수치는 언제나 그 파생값이 된다.
 */
export function computeRelationshipMatrix(actionLog: ActionLogEntry[]): RelationshipMatrix {
  let matrix: RelationshipMatrix = {}
  for (const entry of actionLog) {
    if (!entry.targetId) continue
    const delta = ACTION_RELATIONSHIP_DELTA[entry.kind]
    if (delta === undefined) continue
    matrix = applyRelationshipDelta(matrix, entry.actorId, entry.targetId, delta)
  }
  return matrix
}

export function countRelationshipsAbove(matrix: RelationshipMatrix, playerId: string, others: string[], threshold: number): number {
  return others.filter((otherId) => otherId !== playerId && getRelationship(matrix, playerId, otherId) >= threshold).length
}

export function countRelationshipsBelow(matrix: RelationshipMatrix, playerId: string, others: string[], threshold: number): number {
  return others.filter((otherId) => otherId !== playerId && getRelationship(matrix, playerId, otherId) <= threshold).length
}
