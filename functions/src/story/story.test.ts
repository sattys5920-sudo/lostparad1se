// 이야기 데이터가 규칙과 어긋나지 않는지.
//
// 문장은 사람이 쓰고 규칙은 코드가 쥔다. 둘이 따로 자라면 A의 기억이
// 열두 칸만 있거나, 전말에 이름이 빠진 역할이 생긴다. 그런 건 엔딩에서야
// 드러나고, 그때는 판이 이미 끝나 있다.
import { describe, expect, it } from 'vitest'
import { FRAGMENTS, FRAGMENT_BY_DAY } from './fragments'
import { OPENING } from './opening'
import { MEMORIES, MEMORY_TILE_IDS } from './memories'
import { HOST_RULES } from './hostRules'
import { MEMORY_TILES } from '../../../shared/rules/memory'
import { TILE_BY_ID } from '../../../shared/rules/board'
import { TOTAL_DAYS } from '../../../shared/rules/v2'

describe('A의 기록', () => {
  it('닷새 모두 있다', () => {
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

  it('종이 종류가 문서대로다 — 1 일기장 / 2 메모 / 3 일기장 / 4 메모 / 5 메모', () => {
    const kinds = FRAGMENTS.map((f) => f.papers.map((p) => p.kind).join('+'))
    expect(kinds).toEqual(['diary', 'note', 'diary', 'note', 'note'])
  })

  it('DAY 3은 창고 앞에서 보낸 것으로 고쳐져 있다', () => {
    // v3 본문은 음악실 피아노 뒤였다. 그러면 고발자의 숨긴 사실과 어긋난다
    const text = (FRAGMENT_BY_DAY[3]?.papers ?? []).flatMap((p) => p.lines).join(' ')
    expect(text).toContain('창고 앞에서 기다리다가')
    expect(text).not.toContain('피아노 뒤')
  })

  it('DAY 5에 철컥 줄이 있다', () => {
    const text = (FRAGMENT_BY_DAY[5]?.papers ?? []).flatMap((p) => p.lines).join(' ')
    expect(text).toContain('철컥')
  })
})

describe('A의 기억', () => {
  it('규칙이 세는 열두 칸과 정확히 같다', () => {
    expect([...MEMORY_TILE_IDS].sort()).toEqual([...MEMORY_TILES].sort())
  })

  it('열두 장면 모두 문장이 있다', () => {
    expect(Object.keys(MEMORIES)).toHaveLength(12)
    for (const [tile, text] of Object.entries(MEMORIES)) {
      expect(text.length, tile).toBeGreaterThan(10)
    }
  })
})

describe('오프닝', () => {
  it('네 줄이다', () => {
    expect(OPENING).toHaveLength(4)
  })

  it('칠판 글씨로 이어진다', () => {
    expect(OPENING.join(' ')).toContain('칠판')
  })
})

describe('운영자 수칙', () => {
  it('세 줄이 있다', () => {
    expect(HOST_RULES).toHaveLength(3)
    expect(HOST_RULES[0]).toContain('진상을 설명하지 않는다')
  })
})
