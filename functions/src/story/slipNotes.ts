// 쪽지 56장. **서버 전용.** 번들 누출 검사가 이 파일의 문장을 본다.
//
// 기준은 docs/roles_full.md 다. 문안은 문서 원문 그대로 역할 데이터 파일에
// 있고, 문서와 같은지는 `npm run check:notes`(빌드 때도 돈다)가 본다.
//
// 역할마다 네 장, 두 장씩 짝이다. 짝의 두 장은 같은 행동을 말한다.
//
//   role   역할 이름 + 행동. 누구인지는 안 나온다
//   name   {이름} + 행동. 무슨 역할인지는 안 나온다
//
// {이름}은 **읽는 순간** 서버가 그 역할을 받은 사람의 이름으로 바꿔
// 보낸다(views). 화면에는 바뀐 문장만 간다 — 원문 틀과 roleKey 는 어떤
// 응답에도 안 실린다. roleKey 가 새면 이름형 한 장으로 역할이 드러난다.
import type { RoleId } from '../../../shared/missions/roleNames'
import { ROLE_DATA } from '../../../shared/missions/roleData'

export type SlipNoteKind = 'role' | 'name'

export interface SlipNote {
  /** r01-p1-role — 역할 번호 · 짝 · 종류 */
  id: string
  /** 이 쪽지가 가리키는 역할. **쪽지의 주인은 이 역할을 받은 사람이다** */
  roleKey: RoleId
  kind: SlipNoteKind
  /** 1짝(습관) · 2짝(그날). 2짝은 세다 — DAY 3 이후에 뿌린다 */
  pair: 1 | 2
  /** 문안 원문. 이름형은 {이름}을 그대로 둔다 */
  text: string
}

/**
 * 쉰여섯 장. **데이터는 역할 데이터 파일(shared/missions/roleData.ts)에 있다** —
 * 역할마다 넉 장이 그 역할과 같이 적혀 있다. 여기서는 번호만 붙인다.
 */
export const SLIP_NOTES: readonly SlipNote[] = ROLE_DATA.flatMap((r) =>
  r.notes.map((n) => ({
    id: `r${String(r.no).padStart(2, '0')}-p${n.pair}-${n.kind}`,
    roleKey: r.key,
    kind: n.kind,
    pair: n.pair,
    text: n.text,
  })),
)

export const SLIP_NOTE_BY_ID: Readonly<Record<string, SlipNote>> = Object.fromEntries(SLIP_NOTES.map((n) => [n.id, n]))
