// 텍스트 검수 페이지가 볼 목록. **서버 전용 · 운영자만.**
//
// A에 관한 문장을 전부 한자리에 모아 사건 시간순으로 늘어놓는다.
// 작가가 모순을 찾는 용도다.
import { FRAGMENTS } from './fragments'
import { MEMORIES } from './memories'
import { OPENING, OPENING_CHALK } from './opening'
import {
  FRAGMENT_TIME,
  MEMORY_TIME,
  OPENING_TIME,
  sortForAudit,
  type AuditLine,
} from './timeline'
import { TILE_BY_ID } from '../../../shared/rules/board'

/** 전말의 「때」 글자를 시간 태그로. 표에 적힌 말을 그대로 읽는다. */
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

  for (const [tileId, text] of Object.entries(MEMORIES)) {
    out.push({
      source: 'memory',
      where: TILE_BY_ID[tileId]?.name ?? tileId,
      text,
      tag: MEMORY_TIME,
    })
  }

  return sortForAudit(out)
}
