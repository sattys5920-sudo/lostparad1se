// 쪽지 56장 검사. **빌드 때 돈다**(scripts/check-notes.ts) — 시험도 같은 것을 본다.
//
// 퍼즐은 두 장이 맞물려야 풀린다. 한 장에 이름과 역할이 같이 나오면
// 그 한 장으로 풀려 버린다. 그래서 세 가지를 막는다.
//
//   1. 역할형에 {이름}이 있으면 안 된다
//   2. 이름형에 역할 이름 열넷 중 하나라도 있으면 안 된다
//   3. 역할마다 정확히 네 장 — 1짝·2짝에 역할형 하나, 이름형 하나씩
import type { RoleId } from '../../../shared/missions/roleNames'
import type { SlipNote } from './slipNotes'

export const NAME_MARK = '{이름}'
export const PER_ROLE = 4

export function checkSlipNotes(
  notes: readonly SlipNote[],
  roleNames: Readonly<Record<RoleId, string>>,
): string[] {
  const errors: string[] = []
  const names = Object.entries(roleNames) as [RoleId, string][]
  const seen = new Set<string>()
  for (const n of notes) {
    if (seen.has(n.id)) errors.push(`${n.id}: 번호가 겹친다`)
    seen.add(n.id)
    if (!/^r\d{2}-p[12]-(role|name)$/.test(n.id)) errors.push(`${n.id}: 번호 모양이 r01-p1-role 이 아니다`)
    if (!n.id.endsWith(`-p${n.pair}-${n.kind}`)) errors.push(`${n.id}: 번호와 짝·종류가 안 맞는다`)
    if (n.kind === 'role' && n.text.includes(NAME_MARK)) errors.push(`${n.id}: 역할형에 ${NAME_MARK}이 있다`)
    if (n.kind === 'name') {
      if (!n.text.includes(NAME_MARK)) errors.push(`${n.id}: 이름형에 ${NAME_MARK}이 없다`)
      for (const [, name] of names) {
        if (n.text.includes(name)) errors.push(`${n.id}: 이름형에 역할 이름 「${name}」이 있다`)
      }
    }
  }
  for (const [id, name] of names) {
    const mine = notes.filter((n) => n.roleKey === id)
    if (mine.length !== PER_ROLE) errors.push(`${name}: ${mine.length}장이다 — ${PER_ROLE}장이어야 한다`)
    for (const pair of [1, 2] as const) {
      for (const kind of ['role', 'name'] as const) {
        const c = mine.filter((n) => n.pair === pair && n.kind === kind).length
        if (c !== 1) errors.push(`${name}: ${pair}짝 ${kind === 'role' ? '역할형' : '이름형'}이 ${c}장이다 — 한 장이어야 한다`)
      }
    }
  }
  const stray = notes.filter((n) => !(n.roleKey in roleNames))
  for (const n of stray) errors.push(`${n.id}: 모르는 역할 ${n.roleKey}`)
  return errors
}
