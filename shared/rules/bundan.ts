// 분단 — 화면에서 팀을 부르는 이름.
//
// **안쪽 열쇠(A · B · C · D)는 그대로다.** 저장된 판, 규칙, 무전 채널이
// 전부 그 글자로 서로를 찾는다. 사람 눈에 닿는 곳만 이 이름을 쓴다.
//
// 번호는 완장 색으로 붙였다.
//   파랑(B) 1분단 · 빨강(A) 2분단 · 노랑(D) 3분단 · 초록(C) 4분단
//
// 「분단」은 받침(ㄴ)으로 끝난다 — 「팀」과 같아서 뒤에 붙는 조사(은 · 을 ·
// 이 · 으로)를 바꿀 일이 없다.
import type { TeamId } from './v2'

export const BUNDAN_NO: Readonly<Record<TeamId, number>> = { B: 1, A: 2, D: 3, C: 4 }

/** 화면에 늘어놓는 차례. 1분단부터 */
export const TEAM_ORDER: readonly TeamId[] = ['B', 'A', 'D', 'C']

const isTeam = (t: unknown): t is TeamId => typeof t === 'string' && t in BUNDAN_NO

/** 「1분단」. 모르는 값이면 「?분단」 */
export const teamName = (t: TeamId | string | null | undefined): string => `${isTeam(t) ? BUNDAN_NO[t] : '?'}분단`

/** 작은 칸에 쓰는 번호 하나. 「1」 */
export const teamNo = (t: TeamId | string | null | undefined): string => (isTeam(t) ? String(BUNDAN_NO[t]) : '?')

/** 1분단부터 줄 세운다 */
export const byBundan = (a: TeamId | string, b: TeamId | string): number =>
  (isTeam(a) ? BUNDAN_NO[a] : 9) - (isTeam(b) ? BUNDAN_NO[b] : 9)
