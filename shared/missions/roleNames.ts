// 역할 이름만. **화면이 import 해도 되는 유일한 역할 파일이다.**
//
// roles.ts에는 열네 역할의 숨긴 사실과 미션 조건이 들어 있다. 화면에서
// 이름 하나를 쓰려고 그 파일을 부르면 숨긴 사실 열넷이 통째로 번들에
// 실린다. 실제로 그렇게 새어 나간 적이 있어서 이 파일을 따로 뒀다.
//
// 이름 자체는 공개다. 열네 역할이 있다는 것과 그 이름은 규칙서에 적혀
// 있고, 추리 노트의 태그 목록에도 필요하다. 감춰야 하는 것은
// **누가 무엇인지**와 **각 역할이 무엇을 숨기고 있는지**다.

export type RolePath = 'team' | 'people' | 'outside'

export type RoleId =
  // 팀의 길
  | 'guard' | 'vanguard' | 'librarian' | 'shadow'
  // 사람의 길
  | 'buddy' | 'witness' | 'liar' | 'accuser' | 'notebook' | 'letter'
  // 밖의 길
  | 'leaver' | 'mediator' | 'transfer' | 'bystander'

export const ROLE_NAMES: Record<RoleId, string> = {
  guard: '지킴이',
  vanguard: '선봉',
  librarian: '도서부',
  shadow: '그림자',
  buddy: '단짝',
  witness: '목격자',
  liar: '거짓말쟁이',
  accuser: '고발자',
  notebook: '수첩',
  letter: '편지',
  leaver: '떠날 아이',
  mediator: '중재자',
  transfer: '전학생',
  bystander: '방관자',
}

export const ROLE_IDS: readonly RoleId[] = Object.keys(ROLE_NAMES) as RoleId[]

export function roleName(id: RoleId): string {
  return ROLE_NAMES[id]
}

export const ROLE_PATH_LABEL: Record<RolePath, string> = {
  team: '팀의 길',
  people: '사람의 길',
  outside: '밖의 길',
}
