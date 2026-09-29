// 역할 열넷 검사의 몸통. scripts/check-roles.ts 와 시험이 부른다.
import { REVEAL, barOf, parseRolesMd } from './rolesMd'
import { ROLE_DATA } from '../../shared/missions/roleData'
import type { RoleData } from '../../shared/missions/roleTypes'
import { ROLE_BRANCH, ROLE_IDS, ROLE_NAMES } from '../../shared/missions/roleNames'
import { DAY4_CHOICES } from '../../shared/rules/choices'

const BRANCH_WORD = { people: '사람', slip: '쪽지', hand: '손', astray: '어긋남' } as const

export function checkRoles(data: readonly RoleData[] = ROLE_DATA): { errors: string[]; notices: string[] } {
  const errors: string[] = []
  const notices: string[] = []
  const { roles, common } = parseRolesMd()
  const same = (where: string, doc: string, code: string) => {
    if (doc !== code) errors.push(`${where}: 문서와 다르다\n    문서: ${doc}\n    코드: ${code}`)
  }

  if (roles.length !== data.length) errors.push(`문서는 ${roles.length}역할, 데이터는 ${data.length}역할이다`)
  if (ROLE_IDS.length !== data.length) errors.push(`roleNames 는 ${ROLE_IDS.length}역할이다`)

  for (const m of roles) {
    const d = data.find((r) => r.no === m.no)
    const tag = `${String(m.no).padStart(2, '0')} ${m.name}`
    if (!d) {
      errors.push(`${tag}: 데이터에 없다`)
      continue
    }
    same(`${tag} 이름`, m.name, d.name)
    same(`${tag} 화면용 이름(roleNames)`, d.name, ROLE_NAMES[d.key] ?? '')
    if (ROLE_BRANCH[d.key] !== d.branch) errors.push(`${tag}: roleNames 의 갈래가 데이터와 다르다`)
    same(`${tag} 갈래`, m.branch, BRANCH_WORD[d.branch])
    if (m.star !== d.star) errors.push(`${tag}: ★ 가 문서와 다르다`)
    same(`${tag} 한 줄 소개`, m.intro, d.intro)
    if (m.situation.length !== d.situation.length) errors.push(`${tag}: 상황 문단이 문서는 ${m.situation.length}개, 데이터는 ${d.situation.length}개다`)
    m.situation.forEach((p, i) => same(`${tag} 상황 ${i + 1}`, p, d.situation[i] ?? ''))
    same(`${tag} 미션 요약`, m.goal, d.goal)
    same(`${tag} 미션 한 줄`, m.line, d.line)
    same(`${tag} 단서`, m.footnote ?? '(없음)', d.footnote ?? '(없음)')

    if (m.clauses.length !== d.clauses.length) {
      errors.push(`${tag}: 조건이 문서는 ${m.clauses.length}줄, 데이터는 ${d.clauses.length}줄이다`)
    }
    m.clauses.forEach((mc, i) => {
      const dc = d.clauses[i]
      if (!dc) return
      const bar = barOf(mc.bar)
      // 세는 것 — {분} 은 문서 값으로 채워 맞대어 본다(수치를 고쳐도 말은 같아야 한다)
      const innerMin = mc.counts.match(/(\d+)분 이상/)
      same(`${tag} 조건 ${i + 1} 세는 것`, mc.counts, dc.text.replace(/\{분\}/g, innerMin ? innerMin[1] : String(dc.minutes ?? '')))
      if (REVEAL[mc.reveal] !== dc.disclosure) errors.push(`${tag} 조건 ${i + 1}: 공개가 문서(${mc.reveal})와 다르다`)
      const want = { ...bar, ...(innerMin && bar.minutes === undefined ? { minutes: Number(innerMin[1]) } : {}) }
      for (const k of ['need', 'limit', 'minutes'] as const) {
        if (want[k] !== dc[k]) notices.push(`${tag} 조건 ${i + 1} ${k}: 문서 ${want[k] ?? '-'} · 데이터 ${dc[k] ?? '-'}`)
      }
    })

    if (m.notes.length !== d.notes.length) errors.push(`${tag}: 쪽지가 문서는 ${m.notes.length}장, 데이터는 ${d.notes.length}장이다`)
    for (const mn of m.notes) {
      const dn = d.notes.find((n) => n.slot === mn.slot)
      if (dn && dn.kind !== mn.kind) errors.push(`${tag} 쪽지 ${mn.slot}번: 종류가 문서(${mn.kind === 'role' ? '역할' : '이름'})와 데이터(${dn.kind === 'role' ? '역할' : '이름'})가 다르다`)
      same(`${tag} 쪽지 ${mn.slot}번`, mn.text, dn?.text ?? '(없음)')
    }
  }

  // 공통 — 마지막 선택. 쪽지 미션은 없앴다 — 문서에 다시 생기면 막는다
  if (common.slipMissions.length > 0) errors.push('문서에 「## 쪽지 미션」이 남아 있다 — 쪽지 미션은 없앴다')
  if (common.choices.length !== DAY4_CHOICES.length) errors.push(`마지막 선택이 문서는 ${common.choices.length}개다`)
  common.choices.forEach((c, i) => {
    same(`마지막 선택 ${i + 1} 이름`, c.label, DAY4_CHOICES[i]?.label ?? '')
    same(`마지막 선택 ${i + 1} 조건`, c.text, DAY4_CHOICES[i]?.text ?? '')
  })
  return { errors, notices }
}

