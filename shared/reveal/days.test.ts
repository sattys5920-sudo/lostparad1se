// 「오늘 일어나는 일」 — 사실만, 그리고 미리 알리지 않아야 할 것.
import { describe, expect, it } from 'vitest'
import { dateCardLine, dayName, DAYS, todayItems } from './days'

describe('날 이름', () => {
  it('닷새 모두 이름이 있다', () => {
    for (const d of DAYS) expect(dayName(d).length).toBeGreaterThan(0)
  })

  it('날짜 카드는 「DAY 2 · 소문」 모양이다', () => {
    expect(dateCardLine(2)).toBe('DAY 2 · 소문')
    expect(dateCardLine(5)).toBe('DAY 5 · 마지막 날')
  })
})

describe('그날의 시스템 사건', () => {
  it('DAY 1은 운동장·방송실을 연다', () => {
    const texts = todayItems({ day: 1 }).map((i) => i.text)
    expect(texts.some((t) => t.includes('운동장') && t.includes('방송실'))).toBe(true)
  })

  it('DAY 2는 강당·학생회실과 소문 두 배', () => {
    const kinds = todayItems({ day: 2 }).map((i) => i.kind)
    expect(kinds).toContain('open')
    expect(kinds).toContain('rumor')
  })

  it('DAY 3은 비밀 목표 공개와 중요한 사람', () => {
    const kinds = todayItems({ day: 3 }).map((i) => i.kind)
    expect(kinds).toContain('goal')
    expect(kinds).toContain('chosen')
  })

  it('DAY 4는 동맹 해제', () => {
    expect(todayItems({ day: 4 }).map((i) => i.kind)).toContain('alliance')
  })

  it('DAY 5는 중앙광장과 점수판 소등 시각', () => {
    const items = todayItems({ day: 5 })
    expect(items.map((i) => i.kind)).toContain('scoreboard')
    expect(items.find((i) => i.kind === 'scoreboard')?.text).toContain('15:00')
  })
})

describe('투명인간', () => {
  it('있으면 이름을 적는다', () => {
    const items = todayItems({ day: 2, invisibleName: '한겨울' })
    expect(items.find((i) => i.kind === 'invisible')?.text).toContain('한겨울')
  })

  it('없으면 그 줄이 아예 없다', () => {
    // 「오늘은 아무도 지워지지 않았다」고 굳이 말하지 않는다.
    // 그 말 자체가 어제 표가 갈렸다는 정보다
    expect(todayItems({ day: 2, invisibleName: null }).map((i) => i.kind)).not.toContain('invisible')
    expect(todayItems({ day: 2 }).map((i) => i.kind)).not.toContain('invisible')
  })
})

describe('미리 알리지 않는 것', () => {
  it('다섯 시의 창고는 어느 날에도 나오지 않는다', () => {
    // 알아챈 사람만 피할 수 있어야 한다. 단서는 그날 아침 A의 메모에 있다
    for (const d of DAYS) {
      const text = todayItems({ day: d }).map((i) => i.text).join(' ')
      expect(text, `DAY ${d}`).not.toContain('창고')
      expect(text, `DAY ${d}`).not.toContain('다섯 시')
      expect(text, `DAY ${d}`).not.toContain('17:00')
    }
  })

  // 「해석이나 암시가 없다」는 기계가 못 본다. DAY 2의 이름이 「소문」이고
  // 그날의 규칙도 소문이라, 낱말만 봐서는 분위기인지 사건인지 가를 수
  // 없다. 대신 확실히 없어야 할 것 둘만 못 박는다 — 창고와 역할 이름.

  it('가리키는 역할은 어디에도 없다', () => {
    for (const d of DAYS) {
      const text = todayItems({ day: d }).map((i) => i.text).join(' ')
      for (const role of ['도서부', '단짝', '그림자', '목격자', '고발자', '떠날 아이', '선봉', '거짓말쟁이', '방관자', '편지']) {
        expect(text, `DAY ${d} · ${role}`).not.toContain(role)
      }
    }
  })
})
