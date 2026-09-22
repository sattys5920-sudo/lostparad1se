// 텍스트 검수 — 태그가 빠진 문장이 없는지, 시간선이 맞는지.
import { describe, expect, it } from 'vitest'
import { auditLines } from './audit'
import { placesIn, TIME_ORDER, untagged } from './timeline'

const lines = auditLines()

describe('모으기', () => {
  // 숨긴 사실과 A의 시선은 역할에 매여 있었다. 추리 층을 걷어내면서
  // 같이 나갔다 — 남은 것은 오프닝·A의 기록·A의 기억 셋이다
  it('세 갈래를 다 모은다', () => {
    const sources = new Set(lines.map((l) => l.source))
    expect([...sources].sort()).toEqual(['fragment', 'memory', 'opening'].sort())
  })

  it('A의 기억 열둘이 다 있다', () => {
    expect(lines.filter((l) => l.source === 'memory')).toHaveLength(12)
  })

  it('숨긴 사실과 목격담은 이제 없다', () => {
    expect(lines.filter((l) => l.source === 'secret')).toHaveLength(0)
    expect(lines.filter((l) => l.source === 'sight')).toHaveLength(0)
  })

})

describe('시간 태그', () => {
  it('빠진 문장이 없다', () => {
    const missing = untagged(lines)
    expect(missing.map((l) => `${l.source}/${l.where}`)).toEqual([])
  })

  it('시간순으로 정렬돼 있다', () => {
    const at = (t: string | null) => (t === null ? -1 : TIME_ORDER.indexOf(t as never))
    for (let i = 1; i < lines.length; i++) {
      expect(at(lines[i].tag)).toBeGreaterThanOrEqual(at(lines[i - 1].tag))
    }
  })

})

describe('장소', () => {
  it('문장 안의 장소를 찾는다', () => {
    expect(placesIn('창고 앞에서 기다리다가 보냈어')).toContain('창고')
    expect(placesIn('음악실 앞에서, 같이 선생님께')).toContain('음악실')
    expect(placesIn('아무 데도 나오지 않는 문장')).toEqual([])
  })

  it('창고가 나오는 문장은 전부 그날 저녁이거나 학기 중이다', () => {
    // 창고는 그날 저녁의 자리다. 엉뚱한 시각에 나오면 시간선이 어긋난 것이다
    const storage = lines.filter((l) => placesIn(l.text).includes('창고'))
    expect(storage.length).toBeGreaterThan(0)
    for (const l of storage) {
      expect(
        ['term', 't1650', 't1700', 't1710', 't1730', 't1800', 't1900', 't2100', 'nextDay', 'anytime'],
        `${l.where}: ${l.text.slice(0, 24)}`,
      ).toContain(l.tag)
    }
  })
})
