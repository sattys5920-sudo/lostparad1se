// docs/roles_full.md → shared/missions/roleData.ts 를 한 번 뽑는다.
//
// **뽑은 뒤로는 데이터 파일이 정본이다.** 수치(기준)를 고칠 때는 데이터
// 파일만 고친다 — check-roles 가 문장은 문서와 한 글자도 같은지 보고,
// 수치가 문서와 달라지면 알려만 준다(빌드는 안 막는다).
//
// 문서 문장을 고쳤으면 다시 뽑는다. 그때는 데이터 파일에서 손본 수치도
// 문서 값으로 돌아가니, 수치를 고친 적이 있으면 문서도 같이 고친다.
//
//   npx vite-node scripts/gen-roles.ts
import { writeFileSync } from 'node:fs'

import { REVEAL, barOf, parseRolesMd, type MdClause } from './lib/rolesMd'
import type { ClauseKind } from '../shared/missions/roleTypes'
import type { MissionBranch, RoleId } from '../shared/missions/roleNames'

const KEYS: RoleId[] = [
  'classlead', 'model', 'treasurer',
  'deskmate', 'bookclub', 'cleanup',
  'duty', 'gardener', 'science', 'tech', 'topstudent',
  'crush', 'newcomer', 'backseat',
]

/** 조건 표 줄 순서대로 세는 법. 문서의 「세는 것」 말과 짝이 맞는지는 check-roles 가 본다 */
const KINDS: Record<RoleId, ClauseKind[]> = {
  classlead: ['sameRoomPeople'],
  model: ['trustReceived', 'trustTeams'],
  treasurer: ['vendBuys', 'dealsWithOtherTeam'],
  deskmate: ['slipsRead'],
  bookclub: ['slipsRead', 'slipsGiven'],
  cleanup: ['slipsTorn'],
  duty: ['errandsDone'],
  gardener: ['harvests'],
  science: ['robotsMade'],
  tech: ['robotsSmashedOfOthers'],
  topstudent: ['quizzesSolved'],
  crush: ['targetSlipRead', 'coStayWithTarget'],
  newcomer: ['teamNotFirstAtEnd', 'otherTeamRoomsStood'],
  backseat: ['invisibleHits'],
}

const BRANCH: Record<string, MissionBranch> = { 사람: 'people', 쪽지: 'slip', 손: 'hand', 어긋남: 'astray' }
/** 「세는 것」 안에 박힌 분(반장의 「1분 이상」)은 {분} 로 빼고 minutes 로 옮긴다 */
function clauseOf(kind: ClauseKind, c: MdClause) {
  const bar = barOf(c.bar)
  let text = c.counts
  const inner = text.match(/(\d+)분 이상/)
  if (inner && bar.minutes === undefined) {
    text = text.replace(inner[0], '{분}분 이상')
    Object.assign(bar, { minutes: Number(inner[1]) })
  }
  const disclosure = REVEAL[c.reveal]
  if (!disclosure) throw new Error(`공개 시점을 못 읽는다: ${c.reveal}`)
  return { kind, text, ...bar, disclosure }
}

const q = (s: string) => JSON.stringify(s)

function main() {
  const { roles } = parseRolesMd()
  if (roles.length !== KEYS.length) throw new Error(`역할이 ${roles.length}개다`)
  const out: string[] = []
  for (const r of roles) {
    const key = KEYS[r.no - 1]
    const kinds = KINDS[key]
    if (kinds.length !== r.clauses.length) throw new Error(`${r.name}: 조건이 ${r.clauses.length}줄인데 세는 법은 ${kinds.length}개다`)
    const clauses = r.clauses.map((c, i) => clauseOf(kinds[i], c))
    const cl = clauses
      .map((c) => {
        const nums = (['need', 'limit', 'minutes'] as const)
          .filter((k) => c[k] !== undefined)
          .map((k) => `${k}: ${c[k]}`)
          .join(', ')
        return `      { kind: ${q(c.kind)}, text: ${q(c.text)}${nums ? `, ${nums}` : ''}, disclosure: ${q(c.disclosure)} },`
      })
      .join('\n')
    const notes = r.notes.map((n) => `      { pair: ${n.pair}, kind: ${q(n.kind)}, text: ${q(n.text)} },`).join('\n')
    out.push(`  {
    key: ${q(key)},
    no: ${r.no},
    name: ${q(r.name)},
    branch: ${q(BRANCH[r.branch])},
    star: ${r.star},
    intro: ${q(r.intro)},
    situation: [
${r.situation.map((p) => `      ${q(p)},`).join('\n')}
    ],
    goal: ${q(r.goal)},
    line: ${q(r.line)},
    clauses: [
${cl}
    ],
    footnote: ${r.footnote ? q(r.footnote) : 'null'},
    notes: [
${notes}
    ],
  },`)
  }

  const file = `// 역할 열넷 — **데이터 파일. 서버 전용.** (번들 누출 검사 대상)
//
// docs/roles_full.md 에서 뽑았다(scripts/gen-roles.ts). **문장은 문서와
// 한 글자도 다르지 않아야 한다** — 빌드 때 check-roles 가 본다.
//
// **수치를 고칠 때는 이 파일만 고친다.** need(이상) · limit(이하) ·
// minutes(분). 「세는 것」 말 안의 {분} 은 minutes 로 채워 보인다.
// 판정 코드(judge.ts)에는 숫자가 한 개도 없다.
//
//   key        역할 키. 판 안에서만 쓰고 어떤 응답에도 안 싣는다
//   intro      학생증 앞면 한 줄 소개
//   situation  학생증 뒷면 「그해 겨울, 나는」 문단들
//   goal       미션 요약(운영자 화면)
//   line       미션 한 줄(「이번에는 …」)
//   clauses    세는 것 · 기준 · 공개 시점
//   footnote   조건 표 아래 단서
//   notes      쪽지 넉 장. {이름}은 읽는 순간 서버가 그 역할을 받은 사람 이름으로
import type { RoleData } from './roleTypes'

export const ROLE_DATA: readonly RoleData[] = [
${out.join('\n')}
]
`
  writeFileSync(new URL('../shared/missions/roleData.ts', import.meta.url), file)
  console.log(`역할 ${roles.length}개를 shared/missions/roleData.ts 에 적었다.`)
}

main()
