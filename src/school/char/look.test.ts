import { describe, expect, it } from 'vitest'
import { COLOR_COUNT, EXPRESSION_COUNT, hairIdsFor, normalizeLook } from './look'
import { HAIR_BY_ID, OLD_HAIR } from './pixel'

describe('아바타 목록', () => {
  it('머리 여자 스물 · 남자 스물 · 머리색 열다섯 · 표정 열', () => {
    expect(hairIdsFor('F')).toHaveLength(20)
    expect(hairIdsFor('M')).toHaveLength(20)
    expect(COLOR_COUNT).toBe(15)
    expect(EXPRESSION_COUNT).toBe(10)
  })

  it('새 ID는 옛 ID와 번호대가 겹치지 않는다', () => {
    for (const id of [...hairIdsFor('F'), ...hairIdsFor('M')]) expect(OLD_HAIR[id]).toBeUndefined()
  })
})

describe('옛 머리 저장값 옮기기', () => {
  it('옛 ID 서른 개가 전부 새 목록의 같은 성별 머리로 간다', () => {
    for (const [old, now] of Object.entries(OLD_HAIR)) {
      expect(HAIR_BY_ID[now]).toBeDefined()
      expect(now[0]).toBe(old[0])
    }
  })

  it('뜻을 따라 옮긴다 — 번호가 아니라', () => {
    expect(HAIR_BY_ID[normalizeLook({ hairStyle: 'F01' }).hairStyle].name).toBe('긴 생머리')
    expect(HAIR_BY_ID[normalizeLook({ hairStyle: 'F14' }).hairStyle].name).toBe('똥머리')
    expect(HAIR_BY_ID[normalizeLook({ hairStyle: 'M14' }).hairStyle].name).toBe('눈 가린 앞머리')
  })

  it('더 옛날 숫자 머리도 새 ID로', () => {
    expect(normalizeLook({ hairStyle: 1 }).hairStyle).toBe('F23')
    expect(normalizeLook({ hair: 14 }).hairStyle).toBe('M32')
  })

  it('새 ID는 그대로 둔다', () => {
    expect(normalizeLook({ hairStyle: 'M35', styleSet: 'M' }).hairStyle).toBe('M35')
  })
})
