// 문서의 게임 속 문장이 코드와 같은가.
//
// **규칙은 하나다 — 문서에 적힌 게임 속 문장은 코드에 있는 것과 한
// 글자도 달라서는 안 된다.** 역할 소개도, 미션도, 선택지도 그렇다.
//
// 어긋나면 사람이 문서를 읽고 판을 돌릴 때 화면과 다른 것을 기대하게
// 된다. 실제로 원예부 미션이 문서에서만 한 문장 길었던 적이 있다 —
// 「그중 1번 이상은 남이 심은 화분이어야 한다」였는데, 심는 것은
// 운영자만 하므로 채울 방법이 없는 조건이었다.
//
//   npm run check:doc
import { readFileSync } from 'node:fs'

import { ROLES, SLIP_MISSIONS } from '../shared/missions/roles'
import { DAY4_CHOICES } from '../shared/rules/choices'

const DOC = 'docs/personal_missions_v3.md'
const doc = readFileSync(new URL(`../${DOC}`, import.meta.url), 'utf8')

let bad = 0

/**
 * 문서의 줄들. **줄 단위로 맞대어 본다.**
 *
 * 처음에는 doc.includes(문장) 하나로 봤는데, 그러면 문서가 코드보다
 * **길어진 경우를 못 잡는다** — 「화분에서 5번 이상 수확한다.」 뒤에
 * 한 문장을 더 붙여도 includes 는 여전히 참이다. 실제로 그 상태를
 * 만들어 놓고 돌려 봤더니 통과했다.
 *
 * 그래서 줄에서 장식(**미션:** · 인용 표시 · 굵은 글씨)을 벗겨 낸 뒤
 * **같은지**를 본다.
 */
const LINES = new Set<string>()
for (const raw of doc.split('\n')) {
  // 표는 칸마다 한 조각으로 쪼갠다 — 「팀을 지킨다 | 우리 팀이 …」는 둘이다
  const pieces = raw.includes('|') ? raw.split('|') : [raw]
  for (const piece of pieces) {
    const line = piece
      .replace(/^[>\s]+/, '')
      .replace(/\*\*미션:\*\*\s*/, '')
      .replace(/\*\*/g, '')
      .trim()
    if (line.length > 0) LINES.add(line)
  }
}

/** 이 문장이 문서에 **한 줄로 그대로** 있는가. */
function has(line: string, what: string): void {
  if (LINES.has(line.trim())) return
  console.error(`  ✗ ${what}`)
  console.error(`    코드: ${line}`)
  bad += 1
}

for (const r of ROLES) {
  has(r.flavor, `${r.name} — 소개 한 줄`)
  has(r.main.text, `${r.name} — 미션`)
  if (r.footnote) has(r.footnote, `${r.name} — 각주`)
}
for (const s of SLIP_MISSIONS) has(s.text, `쪽지 미션 ${s.id}`)
for (const c of DAY4_CHOICES) {
  has(c.label, `마지막 선택 ${c.id} — 이름`)
  has(c.text, `마지막 선택 ${c.id} — 조건`)
}

const n = ROLES.length * 2 + ROLES.filter((r) => r.footnote).length + SLIP_MISSIONS.length + DAY4_CHOICES.length * 2
if (bad === 0) {
  console.log(`${DOC} — 게임 속 문장 ${n}개가 코드와 같다.`)
} else {
  console.error(`\n${bad}개가 어긋났다. 문서를 코드에 맞추거나, 바꿀 것이면 둘 다 바꾼다.`)
  process.exitCode = 1
}
