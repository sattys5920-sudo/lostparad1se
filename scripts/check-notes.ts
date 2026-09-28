// 쪽지 56장 검사 — **빌드 때 돈다**(npm run build).
//
//   1. 데이터 파일이 docs/roles_full.md 와 한 글자도 다르지 않은가
//   2. 역할형에 {이름}이 없는가 · 이름형에 역할 이름이 없는가 · 역할마다 넉 장인가
//
//   npm run check:notes
import { parseNotesMd } from './lib/notesMd'
import { SLIP_NOTES } from '../functions/src/story/slipNotes'
import { checkSlipNotes } from '../functions/src/story/slipNotesCheck'
import { ROLE_NAMES, ROLE_IDS } from '../shared/missions/roleNames'

const errors: string[] = []
const md = parseNotesMd()
const idOfName = new Map(ROLE_IDS.map((id) => [ROLE_NAMES[id], id]))
if (md.length !== SLIP_NOTES.length) errors.push(`문서는 ${md.length}장, 데이터는 ${SLIP_NOTES.length}장이다`)
for (const m of md) {
  const id = `r${String(m.no).padStart(2, '0')}-p${m.pair}-${m.kind}`
  const d = SLIP_NOTES.find((n) => n.id === id)
  if (!d) {
    errors.push(`${id}: 문서에는 있는데 데이터에 없다`)
    continue
  }
  if (d.text !== m.text) errors.push(`${id}: 문안이 문서와 다르다\n    문서: ${m.text}\n    코드: ${d.text}`)
  if (idOfName.get(m.roleName) !== d.roleKey) errors.push(`${id}: 역할이 문서(${m.roleName})와 다르다`)
}
errors.push(...checkSlipNotes(SLIP_NOTES, ROLE_NAMES))

if (errors.length > 0) {
  for (const e of errors) console.log(`  ✗ ${e}`)
  console.log(`\n쪽지 검사 ${errors.length}건 실패.`)
  process.exit(1)
}
console.log(`쪽지 ${SLIP_NOTES.length}장 — 문서와 같고, 세 규칙을 다 지킨다.`)
