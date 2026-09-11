// 텍스트 검수 페이지가 볼 목록. **서버 전용 · 운영자만.**
//
// A에 관한 문장을 전부 한자리에 모아 사건 시간순으로 늘어놓는다.
// 작가가 모순을 찾는 용도다.
import { FRAGMENTS } from './fragments'
import { MEMORIES } from './memories'
import { SIGHTS } from './sights'
import { AFTERMATH } from './aftermath'
import { TORN_LINES } from './torn'
import { OPENING, OPENING_CHALK, COMMON_ENDING } from './mirror'
import {
  COMMON_ENDING_TIME,
  FRAGMENT_TIME,
  MEMORY_TIME,
  OPENING_TIME,
  SECRET_TIME,
  SIGHT_TIME,
  TORN_TIME,
  sortForAudit,
  type AuditLine,
  type TimeTag,
} from './timeline'
import { ROLES } from '../../../shared/missions/roles'
import { ROLE_NAMES } from '../../../shared/missions/roleNames'
import { TILE_BY_ID } from '../../../shared/rules/board'

/** 전말의 「때」 글자를 시간 태그로. 표에 적힌 말을 그대로 읽는다. */
const AFTERMATH_TAG: Record<string, TimeTag> = {
  '학기 초': 'term',
  가을: 'term',
  겨울: 'term',
  '마지막 금요일': 'term',
  '방학식 전날': 't1650',
  '17:10': 't1710',
  '17:30': 't1730',
  '18:00': 't1800',
  '19:00': 't1900',
  '21:00': 't2100',
  '다음 날 아침': 'nextDay',
  '그 뒤': 'nextDay',
}

/** 검수 페이지에 실을 줄 전부. */
export function auditLines(): AuditLine[] {
  const out: AuditLine[] = []

  for (const line of OPENING) {
    out.push({ source: 'opening', where: '오프닝', text: line, tag: OPENING_TIME })
  }
  out.push({ source: 'opening', where: '칠판', text: OPENING_CHALK, tag: OPENING_TIME })

  for (const f of FRAGMENTS) {
    for (const p of f.papers) {
      for (const line of p.lines) {
        out.push({
          source: 'fragment',
          where: `DAY ${f.day}`,
          text: line,
          tag: FRAGMENT_TIME[f.day] ?? null,
        })
      }
      for (const line of p.topLines ?? []) {
        // 맨 위 줄은 창고에 갇히기 전, 기다리던 순간에 쓰였다
        out.push({ source: 'fragment', where: `DAY ${f.day} 맨 위`, text: line, tag: 't1700' })
      }
    }
  }

  for (const r of ROLES) {
    out.push({
      source: 'secret',
      where: ROLE_NAMES[r.id],
      text: r.secret,
      tag: SECRET_TIME[r.id] ?? null,
    })
  }

  for (const [tileId, text] of Object.entries(MEMORIES)) {
    out.push({
      source: 'memory',
      where: TILE_BY_ID[tileId]?.name ?? tileId,
      text,
      tag: MEMORY_TIME,
    })
  }

  for (const s of SIGHTS) {
    out.push({
      source: 'sight',
      where: ROLE_NAMES[s.role],
      text: s.text,
      tag: SIGHT_TIME[s.role] ?? null,
    })
  }

  for (const row of AFTERMATH) {
    out.push({
      source: 'aftermath',
      where: row.who.map((r) => ROLE_NAMES[r]).join(' · '),
      text: `${row.when} · ${row.what}`,
      tag: AFTERMATH_TAG[row.when] ?? null,
    })
  }

  for (const line of TORN_LINES) {
    out.push({ source: 'torn', where: '찢긴 한 장', text: line, tag: TORN_TIME })
  }

  for (const key of ['snowStopped', 'snowKept'] as const) {
    out.push({
      source: 'commonEnding',
      where: COMMON_ENDING[key].title,
      text: COMMON_ENDING[key].text,
      tag: COMMON_ENDING_TIME,
    })
  }

  return sortForAudit(out)
}
