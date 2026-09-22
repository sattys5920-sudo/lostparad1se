// 역할 이름만. **화면이 import 해도 되는 유일한 역할 파일이다.**
//
// roles.ts에는 열네 역할의 미션 조건과 수치가 들어 있다. 화면에서 이름
// 하나를 쓰려고 그 파일을 부르면 조건이 통째로 번들에 실린다. 실제로
// 그렇게 새어 나간 적이 있어서 이 파일을 따로 뒀다.
//
// 이름과 갈래는 공개다. 감춰야 하는 것은 **누가 무엇인지**다.

/**
 * 네 갈래.
 *
 *   사람    만나고 주고받는다
 *   쪽지    남의 비밀을 다룬다
 *   손      벌고, 만들고, 부순다
 *   어긋남  팀 이익과 부딪힌다 (★)
 */
export type MissionBranch = 'people' | 'slip' | 'hand' | 'astray'

export type RoleId =
  // 사람
  | 'classlead' | 'model' | 'snacker'
  // 쪽지
  | 'locker' | 'bookclub' | 'cleanup'
  // 손
  | 'duty' | 'gardener' | 'science' | 'tech' | 'topstudent'
  // 어긋남 ★
  | 'crush' | 'newcomer' | 'backseat'

export const ROLE_NAMES: Record<RoleId, string> = {
  classlead: '반장',
  model: '모범생',
  snacker: '매점 단골',
  locker: '사물함',
  bookclub: '도서부',
  cleanup: '미화부',
  duty: '주번',
  gardener: '원예부',
  science: '과학부',
  tech: '기술부',
  topstudent: '전교 1등',
  crush: '짝사랑',
  newcomer: '전학생',
  backseat: '뒷자리',
}

export const ROLE_IDS: readonly RoleId[] = Object.keys(ROLE_NAMES) as RoleId[]

export function roleName(id: RoleId): string {
  return ROLE_NAMES[id]
}

export const ROLE_BRANCH: Record<RoleId, MissionBranch> = {
  classlead: 'people',
  model: 'people',
  snacker: 'people',
  locker: 'slip',
  bookclub: 'slip',
  cleanup: 'slip',
  duty: 'hand',
  gardener: 'hand',
  science: 'hand',
  tech: 'hand',
  topstudent: 'hand',
  crush: 'astray',
  newcomer: 'astray',
  backseat: 'astray',
}

export const BRANCH_LABEL: Record<MissionBranch, string> = {
  people: '사람',
  slip: '쪽지',
  hand: '손',
  astray: '어긋남',
}

export const BRANCHES: readonly MissionBranch[] = ['people', 'slip', 'hand', 'astray']

export const ROLES_BY_BRANCH: Record<MissionBranch, readonly RoleId[]> = {
  people: ROLE_IDS.filter((id) => ROLE_BRANCH[id] === 'people'),
  slip: ROLE_IDS.filter((id) => ROLE_BRANCH[id] === 'slip'),
  hand: ROLE_IDS.filter((id) => ROLE_BRANCH[id] === 'hand'),
  astray: ROLE_IDS.filter((id) => ROLE_BRANCH[id] === 'astray'),
}

/** ★ — 팀 이익과 부딪히는 역할. 셋은 반드시 서로 다른 팀에 간다. */
export const ASTRAY_BRANCH: MissionBranch = 'astray'
