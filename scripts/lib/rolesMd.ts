// docs/roles_full.md 를 읽는다. **문장은 한 글자도 안 고친다.**
//
// 문서 모양(역할 하나):
//
//   # 사람 쪽 · 만나고 주고받는다        ← 갈래
//   ## 01 반장                           ← 번호 · 이름 (★ 가 붙으면 어긋남)
//   > 이름을 못 외우는 애가 없다.        ← 한 줄 소개
//   **상황**                             ← 아래 줄마다 한 문단, 빈 줄까지
//   **미션** — 서로 다른 사람 …          ← 미션 요약
//   이번에는 한 바퀴 다 돈다.            ← 미션 한 줄
//   | 세는 것 | 기준 | 공개 |            ← 조건 표
//   (표 뒤 한 줄)                         ← 단서. 없을 수 있다
//   | 짝 | 종류 | 쪽지 |                  ← 쪽지 넉 장
//
// 공통: 「## 마지막 선택」 표(선택 · 달성 조건). 「## 쪽지 미션」은 없앴다 — 남아 있으면
// 읽어 두기만 하고 검사(checkRoles)가 막는다.
//
// check-roles 와 시험과 gen-roles 가 이것으로 문서와 데이터 파일이 같은지 본다.
import { readFileSync } from 'node:fs'

import type { Disclosure } from '../../shared/missions/roleTypes'

export const ROLES_MD = new URL('../../docs/roles_full.md', import.meta.url).pathname

export interface MdClause {
  counts: string
  bar: string
  reveal: string
}

export interface MdNote {
  pair: number
  kind: 'role' | 'name'
  text: string
}

export interface MdRole {
  no: number
  name: string
  star: boolean
  /** 갈래 머리글의 앞말 — 사람 · 쪽지 · 손 · 어긋남 */
  branch: string
  intro: string
  situation: string[]
  goal: string
  line: string
  clauses: MdClause[]
  footnote: string | null
  notes: MdNote[]
}

export interface MdCommon {
  slipMissions: MdClause[]
  choices: { label: string; text: string }[]
}

const cells = (line: string): string[] =>
  line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())

const isRule = (line: string) => /^\|[-|\s]+\|$/.test(line)

export function parseRolesMd(src: string = readFileSync(ROLES_MD, 'utf8')): { roles: MdRole[]; common: MdCommon } {
  const roles: MdRole[] = []
  const common: MdCommon = { slipMissions: [], choices: [] }
  let branch = ''
  let cur: MdRole | null = null
  /** 지금 읽고 있는 덩어리 */
  let block: 'none' | 'situation' | 'mission' | 'clauses' | 'afterClauses' | 'notes' | 'slipMissions' | 'choices' = 'none'

  for (const raw of src.split('\n')) {
    const line = raw.trimEnd()
    const top = line.match(/^# (\S+)/)
    if (top && !line.startsWith('## ')) {
      branch = top[1]
      cur = null
      block = 'none'
      continue
    }
    const head = line.match(/^## (\d{2}) (.+?)(\s★)?$/)
    if (head) {
      cur = {
        no: Number(head[1]),
        name: head[2].trim(),
        star: !!head[3],
        branch,
        intro: '',
        situation: [],
        goal: '',
        line: '',
        clauses: [],
        footnote: null,
        notes: [],
      }
      roles.push(cur)
      block = 'none'
      continue
    }
    if (line.startsWith('## ')) {
      cur = null
      block = line === '## 쪽지 미션' ? 'slipMissions' : line === '## 마지막 선택' ? 'choices' : 'none'
      continue
    }
    if (line === '---') {
      block = 'none'
      continue
    }

    if (!cur) {
      if (!line.startsWith('|') || isRule(line)) continue
      const c = cells(line)
      if (block === 'slipMissions' && c[0] !== '조건') common.slipMissions.push({ counts: c[0], bar: c[1], reveal: c[2] })
      if (block === 'choices' && c[0] !== '선택') common.choices.push({ label: c[0], text: c[1] })
      continue
    }

    if (line.startsWith('> ') && !cur.intro) {
      cur.intro = line.slice(2).trim()
      continue
    }
    if (line === '**상황**') {
      block = 'situation'
      continue
    }
    const goal = line.match(/^\*\*미션\*\* — (.+)$/)
    if (goal) {
      cur.goal = goal[1].trim()
      block = 'mission'
      continue
    }
    if (line === '') {
      if (block === 'situation' || block === 'mission') block = 'none'
      if (block === 'clauses') block = 'afterClauses'
      continue
    }
    if (block === 'situation') {
      cur.situation.push(line)
      continue
    }
    if (block === 'mission') {
      cur.line = line
      continue
    }
    if (line.startsWith('|')) {
      if (isRule(line)) continue
      const c = cells(line)
      if (c[0] === '세는 것') {
        block = 'clauses'
        continue
      }
      if (c[0] === '짝') {
        block = 'notes'
        continue
      }
      if (block === 'clauses') cur.clauses.push({ counts: c[0], bar: c[1], reveal: c[2] })
      if (block === 'notes') cur.notes.push({ pair: Number(c[0]), kind: c[1] === '역할' ? 'role' : 'name', text: c[2] })
      continue
    }
    if (block === 'afterClauses') {
      cur.footnote = cur.footnote ? `${cur.footnote} ${line}` : line
    }
  }
  return { roles, common }
}

/** 문서의 「공개」 칸 → 공개 시점 */
export const REVEAL: Record<string, Disclosure> = {
  바로: 'realtime',
  '하루가 바뀔 때': 'daily',
  '발표 뒤': 'afterBallot',
  '끝날 때': 'endOnly',
}

/** 「9 이상」 「2 이하」 「30분」 「3팀 · 각 10분」 「예 / 아니오」 */
export function barOf(bar: string): { need?: number; limit?: number; minutes?: number } {
  let m = bar.match(/^(\d+) 이상$/)
  if (m) return { need: Number(m[1]) }
  m = bar.match(/^(\d+) 이하$/)
  if (m) return { limit: Number(m[1]) }
  m = bar.match(/^(\d+)분$/)
  if (m) return { minutes: Number(m[1]) }
  m = bar.match(/^(\d+)팀 · 각 (\d+)분$/)
  if (m) return { need: Number(m[1]), minutes: Number(m[2]) }
  if (bar === '예 / 아니오') return {}
  throw new Error(`기준을 못 읽는다: ${bar}`)
}

