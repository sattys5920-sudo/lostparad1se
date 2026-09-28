// docs/roles_full.md 에서 쪽지 표만 읽는다. **문안은 한 글자도 안 고친다.**
//
// 문서 모양:
//   ## 01 반장            ← 역할 번호와 이름. 뒤의 ★ 는 떼고 읽는다
//   | 1 | 역할 | 문안 |    ← 짝 · 종류(역할/이름) · 문안
//
// check-notes 와 시험이 이것으로 문서와 데이터 파일(functions/src/story/
// slipNotes.ts)이 같은지 본다.
import { readFileSync } from 'node:fs'

export interface MdNote {
  no: number
  roleName: string
  pair: number
  kind: 'role' | 'name'
  text: string
}

export const NOTES_MD = new URL('../../docs/roles_full.md', import.meta.url).pathname

export function parseNotesMd(src: string = readFileSync(NOTES_MD, 'utf8')): MdNote[] {
  const out: MdNote[] = []
  let no = 0
  let roleName = ''
  for (const raw of src.split('\n')) {
    const line = raw.trimEnd()
    const head = line.match(/^## (\d{2}) (.+?)(?: ★)?$/)
    if (head) {
      no = Number(head[1])
      roleName = head[2].trim()
      continue
    }
    if (no === 0) continue
    const row = line.match(/^\| (\d) \| (역할|이름) \| (.+) \|$/)
    if (!row) continue
    out.push({ no, roleName, pair: Number(row[1]), kind: row[2] === '역할' ? 'role' : 'name', text: row[3] })
  }
  return out
}
