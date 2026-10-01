// 개인 역할 14종. **서버 전용.**
//
// 기준 문서는 docs/roles_full.md 다. 이름 · 서사 · 상황 글 · 조건 수치 ·
// 쪽지 문안은 전부 데이터 파일(roleData.ts)에 있고, 판정 엔진은 조항 종류마다
// 세는 법 하나씩만 안다. **난이도를 조정할 때 고치는 파일은 roleData.ts 하나다.**
//
// 미션 하나를 여러 조항으로 쪼갠다. 조항마다 진행도를 어디까지 보여 줄지가
// 다르기 때문이다. 전학생의 「다른 세 팀 방에 서 있기」는 실시간으로 보여
// 줘도 되지만 「우리 팀이 1위가 아님」은 끝나야 안다. 한 덩어리로 다루면
// 둘 다 감추거나 둘 다 새게 된다.
//
// **점수는 없다.** 미션마다 달성이냐 아니냐만 남긴다.
export type { RoleId, MissionBranch } from './roleNames'
export {
  ASTRAY_BRANCH,
  BRANCHES,
  ROLES_BY_BRANCH,
  ROLE_BRANCH,
  ROLE_IDS,
  ROLE_NAMES,
  roleName,
} from './roleNames'
import { type MissionBranch, type RoleId } from './roleNames'

/** 판에 들어가는 사람 수. */
export const ROSTER_SIZE = 14

// ── 모양 ────────────────────────────────────────────────────────

// 공개 시점 · 조항 종류 · 조항 모양은 roleTypes.ts 에 있다 — 데이터 파일과 같이 쓴다
export type { Clause, ClauseKind, Disclosure, RoleData, RoleNote } from './roleTypes'
export { clauseText } from './roleTypes'
import type { Clause, RoleData } from './roleTypes'
import { ROLE_DATA } from './roleData'

/*
 * 상태 네 가지는 **roleNames.ts 에 있다.** 화면도 읽어야 하는데
 * 이 파일은 화면이 부르면 안 되기 때문이다. 여기서는 도로 내보내
 * 주기만 한다 — 판정 쪽 코드가 roles 하나만 보고도 되게.
 */
export type { MissionStatus } from './roleNames'
export { STATUS_LABEL } from './roleNames'

export interface MissionSpec {
  /** 미션 요약. **문서 원문 그대로다.** */
  text: string
  clauses: readonly Clause[]
}

export interface RoleSpec {
  id: RoleId
  name: string
  branch: MissionBranch
  /** ★ — 팀 이익과 부딪힌다 */
  star: boolean
  /** 학생증 앞면 한 줄. **문서 원문 그대로다.** */
  flavor: string
  /** 학생증 뒷면 「그해 겨울, 나는」 문단들 */
  situation: readonly string[]
  /** 미션 한 줄 — 「이번에는 …」 */
  line: string
  main: MissionSpec
  /** 조건 표 아래 단서. 없으면 null. */
  footnote: string | null
}

// ── 역할 ────────────────────────────────────────────────────────

/**
 * 열네 역할. **데이터는 roleData.ts 에 있다**(docs/roles_full.md 에서 뽑은
 * 것). 여기서는 판정이 읽는 모양으로 옮기기만 한다 — 수치도 문장도 여기
 * 없다.
 */
const specOf = (d: RoleData): RoleSpec => ({
  id: d.key,
  name: d.name,
  branch: d.branch,
  star: d.star,
  flavor: d.intro,
  situation: d.situation,
  line: d.line,
  main: { text: d.goal, clauses: d.clauses },
  footnote: d.footnote,
})

export const ROLES: readonly RoleSpec[] = ROLE_DATA.map(specOf)

export const ROLE_BY_ID: Record<RoleId, RoleSpec> = Object.fromEntries(
  ROLES.map((r) => [r.id, r]),
) as Record<RoleId, RoleSpec>

// ── 배정 규칙 ───────────────────────────────────────────────────

// 네 갈래를 팀에 어떻게 흩을지 정하던 배정 규칙(ASSIGN_RULES)은 없앴다 —
// 운영자가 한 사람씩 팀과 역할을 고른다(functions/src/lobby.ts 의 hostAssignSeat).

/** 갈래별 인원. 문서의 배정 표와 같아야 한다. */
export const BRANCH_COUNT: Record<MissionBranch, number> = {
  people: 3,
  slip: 3,
  hand: 5,
  astray: 3,
}
