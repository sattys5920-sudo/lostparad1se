import type { RevealKind, RoleSpec } from '../types'

export interface RevealOption {
  kind: RevealKind
  label: string
  /** 고르는 순간 본인에게 보여주는, 실제로 나갈 문장. */
  preview: (role: RoleSpec) => string
  /** 한 번 공개하면 되돌릴 수 없다는 경고가 특히 필요한 항목. */
  heavy: boolean
}

export const REVEAL_OPTIONS: RevealOption[] = [
  {
    kind: 'role',
    label: '내가 누구인지',
    preview: (role) => `나는 ${role.name}이다.`,
    heavy: false,
  },
  {
    kind: 'privateFact',
    label: '아무에게도 말하지 않은 사실',
    preview: (role) => role.privateFact,
    heavy: true,
  },
  {
    kind: 'hiddenGoal',
    label: '숨겨진 목표',
    preview: (role) => role.mission.hiddenGoal,
    heavy: true,
  },
  {
    kind: 'custom',
    label: '직접 쓰기',
    preview: () => '',
    heavy: false,
  },
]

export function revealText(kind: RevealKind, role: RoleSpec, custom: string): string {
  if (kind === 'custom') return custom.trim()
  const option = REVEAL_OPTIONS.find((o) => o.kind === kind)
  return option ? option.preview(role) : custom.trim()
}

export const REVEAL_LABEL: Record<RevealKind, string> = {
  role: '정체',
  privateFact: '숨겨온 사실',
  hiddenGoal: '진짜 목적',
  custom: '고백',
}
