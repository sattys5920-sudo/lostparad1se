// 답안지 — 마지막에 서로의 역할을 맞힌다.
//
// 감독관이 「답안지 제출」을 누르면 모두의 화면에 답안지가 뜬다. 열넷
// 한 사람 한 사람의 역할을 드롭다운으로 고르고 낸다. 감독관이 「채점하기」를
// 누르면 정답과 점수가 모두에게 간다.
//
// **한 문항은 100 ÷ 문항 수.** 열넷이면 한 문항이 약 7.1 점이다.
import { ROLE_IDS, canonRoleId, type RoleId } from '../missions/roleNames'

/** 점수를 소수 첫째 자리까지. 열네 문항 다 맞히면 100 이다 */
export function scoreOf(correct: number, total: number): number {
  if (total <= 0) return 0
  if (correct >= total) return 100
  return Math.round((correct * 1000) / total) / 10
}

/** 낸 답안을 정답과 맞춘다. 모르는 역할 id 는 틀린 것으로 본다 */
export function gradeSheet(
  answers: Readonly<Record<string, string>>,
  key: Readonly<Record<string, RoleId>>,
): { correct: number; total: number; score: number } {
  const ids = Object.keys(key)
  let correct = 0
  for (const id of ids) if (canonRoleId(answers[id]) === key[id]) correct++
  return { correct, total: ids.length, score: scoreOf(correct, ids.length) }
}

/** 드롭다운에 쓰는 역할 목록 */
export const ANSWER_ROLES: readonly RoleId[] = ROLE_IDS

/** 받은 답안을 정리한다. 명단에 없는 사람 · 없는 역할은 버린다 */
export function cleanAnswers(raw: unknown, people: readonly string[]): Record<string, RoleId> {
  const out: Record<string, RoleId> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const id of people) {
    const v = canonRoleId((raw as Record<string, unknown>)[id] as string)
    if (v) out[id] = v
  }
  return out
}
