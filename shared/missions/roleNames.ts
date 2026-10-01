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

/**
 * 진행도 한 줄에 뜨는 네 가지 상태.
 *
 * **여기 있는 이유는 화면이 읽어야 하기 때문이다.** 판정은 roles·judge
 * 쪽에서 하지만, 그 결과를 적는 말은 「나」 탭이 그대로 쓴다. 두 군데에
 * 따로 적어 두면 한 군데만 고치는 날이 온다.
 *
 * 감출 것이 없는 말이다 — 어느 역할의 상태인지는 여기에 없다.
 */
export type MissionStatus = 'running' | 'met' | 'failed' | 'endOnly'

export const STATUS_LABEL: Record<MissionStatus, string> = {
  running: '진행 중',
  met: '달성',
  failed: '실패',
  endOnly: '끝날 때 판정',
}

export type RoleId =
  // 사람
  | 'classlead' | 'model' | 'treasurer'
  // 쪽지
  | 'deskmate' | 'bookclub' | 'cleanup'
  // 손
  | 'duty' | 'gardener' | 'science' | 'tech' | 'topstudent'
  // 어긋남 ★
  | 'crush' | 'newcomer' | 'backseat'

export const ROLE_NAMES: Record<RoleId, string> = {
  classlead: '반장',
  model: '모범생',
  treasurer: '총무',
  deskmate: '짝꿍',
  bookclub: '도서부',
  cleanup: '미화부',
  duty: '주번',
  gardener: '원예부',
  science: '과학부',
  tech: '기술부',
  topstudent: '전교 1 등',
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
  treasurer: 'people',
  deskmate: 'slip',
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

export const BRANCHES: readonly MissionBranch[] = ['people', 'slip', 'hand', 'astray']

export const ROLES_BY_BRANCH: Record<MissionBranch, readonly RoleId[]> = {
  people: ROLE_IDS.filter((id) => ROLE_BRANCH[id] === 'people'),
  slip: ROLE_IDS.filter((id) => ROLE_BRANCH[id] === 'slip'),
  hand: ROLE_IDS.filter((id) => ROLE_BRANCH[id] === 'hand'),
  astray: ROLE_IDS.filter((id) => ROLE_BRANCH[id] === 'astray'),
}

/** ★ — 팀 이익과 부딪히는 역할. 셋은 반드시 서로 다른 팀에 간다. */
export const ASTRAY_BRANCH: MissionBranch = 'astray'

/**
 * 이름을 바꾸기 전의 역할 id.
 *
 * 총무는 snacker, 옆자리는 locker 였다. **그 전에 배정한 판의 명단
 * (secret/roster)에는 옛 id 가 그대로 적혀 있다** — 배정은 한 번 적고
 * 다시 안 쓰기 때문이다. 옛 id 로 ROLE_BY_ID 를 찾으면 비어서, 「나」
 * 탭이 「역할을 찾지 못했다」를 띄웠다. 읽는 쪽에서 새 id 로 옮긴다.
 */
const LEGACY_ROLE_ID: Readonly<Record<string, RoleId>> = {
  snacker: 'treasurer',
  locker: 'deskmate',
}

/** 명단에서 읽은 역할 id 를 지금 이름으로. 모르는 id 면 null. */
export function canonRoleId(id: string | null | undefined): RoleId | null {
  if (!id) return null
  // in 이 아니라 제 칸만 본다 — 'toString' 같은 것이 역할로 통과하면 안 된다
  if (Object.prototype.hasOwnProperty.call(ROLE_NAMES, id)) return id as RoleId
  return Object.prototype.hasOwnProperty.call(LEGACY_ROLE_ID, id) ? LEGACY_ROLE_ID[id] : null
}
