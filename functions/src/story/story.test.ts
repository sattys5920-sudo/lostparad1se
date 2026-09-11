// 이야기 데이터가 규칙과 어긋나지 않는지.
//
// 문장은 사람이 쓰고 규칙은 코드가 쥔다. 둘이 따로 자라면 A의 기억이
// 열두 칸만 있거나, 전말에 이름이 빠진 역할이 생긴다. 그런 건 엔딩에서야
// 드러나고, 그때는 판이 이미 끝나 있다.
import { describe, expect, it } from 'vitest'
import { FRAGMENTS, FRAGMENT_BY_DAY } from './fragments'
import { AFTERMATH } from './aftermath'
import { MIRROR, COMMON_ENDING, OPENING } from './mirror'
import { SIGHTS, SIGHT_BY_ROLE, placeOf } from './sights'
import { MEMORIES, MEMORY_TILE_IDS } from './memories'
import { TORN_INTRO, TORN_LINES, tornIntro } from './torn'
import { CLUE_MAP, LINKS, HOST_RULES } from './clues'
import { HINT_SCHEDULE, NEVER_HINTED, ROLE_IDS } from '../../../shared/missions/roles'
import { MEMORY_TILES } from '../../../shared/rules/memory'
import { TILE_BY_ID } from '../../../shared/rules/board'
import { TOTAL_DAYS } from '../../../shared/rules/v2'

describe('A의 기록', () => {
  it('닷새 모두 있다', () => {
    expect(FRAGMENTS).toHaveLength(TOTAL_DAYS)
    for (let d = 1; d <= TOTAL_DAYS; d++) expect(FRAGMENT_BY_DAY[d]).toBeDefined()
  })

  it('가리키는 역할이 힌트 일정과 같다', () => {
    for (const f of FRAGMENTS) {
      expect([...f.implicated].sort(), `DAY ${f.day}`).toEqual([...HINT_SCHEDULE[f.day]].sort())
    }
  })

  it('가리켜지지 않는 넷은 기록에 없다', () => {
    const named = FRAGMENTS.flatMap((f) => f.implicated)
    for (const id of NEVER_HINTED) expect(named, id).not.toContain(id)
  })

  it('지목 칸이 실제 칸이고 기지가 아니다', () => {
    for (const f of FRAGMENTS) {
      const tile = TILE_BY_ID[f.spotTile]
      expect(tile, f.spotTile).toBeDefined()
      expect(tile.tier, f.spotTile).not.toBe('base')
    }
  })

  it('지목 칸이 겹치지 않는다', () => {
    expect(new Set(FRAGMENTS.map((f) => f.spotTile)).size).toBe(TOTAL_DAYS)
  })

  it('네 팀 1구역에 한 번씩, 관문에 한 번 떨어진다', () => {
    const tiers = FRAGMENTS.map((f) => TILE_BY_ID[f.spotTile].tier)
    expect(tiers.filter((t) => t === 'zone1')).toHaveLength(4)
    expect(tiers.filter((t) => t === 'gate')).toHaveLength(1)
  })

  it('종이마다 본문이 있다', () => {
    for (const f of FRAGMENTS) {
      expect(f.papers.length, `DAY ${f.day}`).toBeGreaterThan(0)
      for (const p of f.papers) expect(p.lines.length, `DAY ${f.day}`).toBeGreaterThan(0)
    }
  })

  it('DAY 2만 두 장이다', () => {
    for (const f of FRAGMENTS) {
      expect(f.papers.length, `DAY ${f.day}`).toBe(f.day === 2 ? 2 : 1)
    }
  })

  it('맨 위 줄은 DAY 5에만 있다', () => {
    for (const f of FRAGMENTS) {
      const hasTop = f.papers.some((p) => p.topLines)
      expect(hasTop, `DAY ${f.day}`).toBe(f.day === 5)
    }
  })

  it('종이 종류가 문서대로다 — 1 일기장 / 2 일기장+메모 / 3 일기장 / 4 메모 / 5 메모', () => {
    const kinds = FRAGMENTS.map((f) => f.papers.map((p) => p.kind).join('+'))
    expect(kinds).toEqual(['diary', 'diary+note', 'diary', 'note', 'note'])
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

describe('그날의 전말', () => {
  it('열네 역할이 모두 한 번 이상 나온다', () => {
    const named = new Set(AFTERMATH.flatMap((l) => l.who))
    for (const id of ROLE_IDS) expect(named, id).toContain(id)
  })

  it('두 사람이 함께 한 줄은 선봉과 거짓말쟁이뿐이다', () => {
    const pairs = AFTERMATH.filter((l) => l.who.length > 1)
    expect(pairs).toHaveLength(1)
    expect([...pairs[0].who].sort()).toEqual(['liar', 'vanguard'])
  })

  it('그날 저녁이 시간순이다', () => {
    const evening = ['17:10', '17:30', '17:30', '18:00', '19:00', '21:00']
    const got = AFTERMATH.map((l) => l.when).filter((w) => /^\d\d:\d\d$/.test(w))
    expect(got).toEqual(evening)
  })

  it('자물쇠를 채운 것과 연 것이 같은 역할이다', () => {
    const locked = AFTERMATH.find((l) => l.what.includes('자물쇠를 채운다'))
    const opened = AFTERMATH.find((l) => l.what.includes('자물쇠를 연다'))
    expect(locked?.who).toEqual(['guard'])
    expect(opened?.who).toEqual(['guard'])
  })

  it('문을 닫은 사람과 잠근 사람이 다르다 — DAY 5 반전의 뿌리다', () => {
    const closed = AFTERMATH.find((l) => l.what.includes('문을 닫는다'))
    const locked = AFTERMATH.find((l) => l.what.includes('자물쇠를 채운다'))
    expect(closed?.who).toEqual(['liar'])
    expect(locked?.who).toEqual(['guard'])
    expect(closed?.who).not.toEqual(locked?.who)
  })
})

describe('A의 시선과 그 자리', () => {
  it('열네 역할 모두에게 있다', () => {
    expect(SIGHTS).toHaveLength(14)
    for (const id of ROLE_IDS) expect(SIGHT_BY_ROLE[id], id).toBeDefined()
  })

  it('그 자리가 실제 칸이다', () => {
    for (const s of SIGHTS) expect(TILE_BY_ID[s.tile], s.role).toBeDefined()
  })

  it('지킴이와 거짓말쟁이는 그 자리가 같다', () => {
    expect(placeOf('guard')).toBe('storage')
    expect(placeOf('liar')).toBe('storage')
  })

  it('방관자의 그 자리는 중앙광장이다', () => {
    expect(placeOf('bystander')).toBe('centralPlaza')
  })

  it('문장이 비어 있지 않다', () => {
    for (const s of SIGHTS) expect(s.text.length, s.role).toBeGreaterThan(10)
  })
})

describe('A의 기억', () => {
  it('규칙이 세는 열세 칸과 정확히 같다', () => {
    expect([...MEMORY_TILE_IDS].sort()).toEqual([...MEMORY_TILES].sort())
  })

  it('열세 장면 모두 문장이 있다', () => {
    expect(Object.keys(MEMORIES)).toHaveLength(13)
    for (const [tile, text] of Object.entries(MEMORIES)) {
      expect(text.length, tile).toBeGreaterThan(10)
    }
  })
})

describe('찢긴 한 장', () => {
  it('도서부가 털어놓았는지로 소개가 갈린다', () => {
    expect(tornIntro(true)).toBe(TORN_INTRO.revealed)
    expect(tornIntro(false)).toBe(TORN_INTRO.hidden)
    expect(TORN_INTRO.revealed).not.toBe(TORN_INTRO.hidden)
  })

  it('네 줄이다', () => {
    expect(TORN_LINES).toHaveLength(4)
  })

  it('도서관 창가 자리를 가리킨다 — DAY 1과 이어진다', () => {
    expect(TORN_LINES.join(' ')).toContain('창가 자리')
  })
})

describe('거울 규칙과 공동 엔딩', () => {
  it('여덟 줄이다', () => {
    expect(MIRROR).toHaveLength(8)
  })

  it('양쪽이 다 차 있다', () => {
    for (const m of MIRROR) {
      expect(m.rule.length).toBeGreaterThan(0)
      expect(m.lived.length).toBeGreaterThan(0)
    }
  })

  it('공동 엔딩이 둘이고 칠판 글씨가 다르다', () => {
    expect(COMMON_ENDING.snowStopped.chalk).not.toBe(COMMON_ENDING.snowKept.chalk)
  })

  it('오프닝이 칠판 글씨로 이어진다', () => {
    expect(OPENING.length).toBeGreaterThan(0)
    expect(OPENING.join(' ')).toContain('칠판')
  })
})

describe('추리 지도', () => {
  it('열네 역할이 모두 한 줄씩 있다', () => {
    expect(CLUE_MAP).toHaveLength(14)
    expect(new Set(CLUE_MAP.map((c) => c.role)).size).toBe(14)
  })

  it('가리켜지지 않는 넷은 기록 단서가 없거나 이름이 없다', () => {
    for (const id of NEVER_HINTED) {
      const row = CLUE_MAP.find((c) => c.role === id)
      expect(row, id).toBeDefined()
      // 지킴이만 DAY 5 「철컥」이 있지만 누구인지는 적혀 있지 않다
      if (row?.inRecord) expect(row.inRecord, id).toContain('누구인지는 없음')
      expect(row?.exposure, id).toBe('onlyByOwnReveal')
    }
  })

  it('연결 단서가 넷이다', () => {
    expect(LINKS).toHaveLength(4)
    expect(new Set(LINKS.map((l) => l.id)).size).toBe(4)
  })

  it('운영자 수칙 세 줄이 있다', () => {
    expect(HOST_RULES).toHaveLength(3)
    expect(HOST_RULES[0]).toContain('진상을 설명하지 않는다')
  })
})
