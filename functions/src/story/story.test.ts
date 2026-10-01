// 이야기 데이터가 규칙과 어긋나지 않는지.
//
// 문장은 사람이 쓰고 규칙은 코드가 쥔다. 둘이 따로 자라면 날짜가 비거나
// 종이 종류가 어긋난다. 그런 건 아침에야 드러나고, 그때는 늦다.
import { describe, expect, it } from 'vitest'
import { FRAGMENTS, FRAGMENT_BY_DAY } from './fragments'
import { TILE_BY_ID } from '../../../shared/rules/board'
import { TOTAL_DAYS } from '../../../shared/rules/v2'

describe('A의 기록', () => {
  it('날마다 있다', () => {
    expect(FRAGMENTS).toHaveLength(TOTAL_DAYS)
    for (let d = 1; d <= TOTAL_DAYS; d++) expect(FRAGMENT_BY_DAY[d]).toBeDefined()
  })

  // 조각이 칸 하나를 지목해 가치를 +2 올려 주던 때가 있었다.
  // 기록은 이제 읽을 글 한 장이고, 판 위의 무엇도 안 건드린다
  it('판을 건드리는 칸이 안 적혀 있다', () => {
    for (const f of FRAGMENTS) {
      expect((f as Record<string, unknown>).spotTile, `DAY ${f.day}`).toBeUndefined()
    }
  })

  it('종이마다 본문이 있다', () => {
    for (const f of FRAGMENTS) {
      expect(f.papers.length, `DAY ${f.day}`).toBeGreaterThan(0)
      for (const p of f.papers) expect(p.lines.length, `DAY ${f.day}`).toBeGreaterThan(0)
    }
  })

  it('날마다 한 장이다', () => {
    for (const f of FRAGMENTS) {
      expect(f.papers.length, `DAY ${f.day}`).toBe(1)
    }
  })

  it('맨 위 줄은 어느 날에도 없다', () => {
    for (const f of FRAGMENTS) {
      expect(f.papers.some((p) => p.topLines), `DAY ${f.day}`).toBe(false)
    }
  })

  it('종이 종류가 문서대로다 — 1 일기장 / 2 메모 / 3 일기장 / 4 메모', () => {
    const kinds = FRAGMENTS.map((f) => f.papers.map((p) => p.kind).join('+'))
    expect(kinds).toEqual(['diary', 'note', 'diary', 'note'])
  })
})
