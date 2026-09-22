// 아이템 — 방해와 위장은 물건이 든다.
import { describe, expect, it } from 'vitest'

import { ITEMS, ITEM_BY_KIND, ITEM_FOR, countOf, isHandItem, putItem, takeItem } from './items'
import { ACT_COST } from './occupy'

describe('물건', () => {
  it('호루라기는 방해, 명찰은 위장에 든다', () => {
    expect(ITEM_FOR.disturb).toBe('whistle')
    expect(ITEM_FOR.disguise).toBe('nameTag')
  })

  it('물건이 드는 행동에는 토큰이 안 든다', () => {
    for (const i of ITEMS) {
      if (i.use === undefined) continue
      expect(ACT_COST[i.use], i.name).toBe(0)
    }
  })

  // **손으로 쓰는 물건은 행동에 딸리지 않는다.** 딸린 것으로 잘못
  // 적으면 ITEM_FOR 가 엉뚱한 행동을 그 물건으로 잠근다
  it('손으로 쓰는 다섯은 어느 행동에도 안 걸려 있다', () => {
    const hand = ITEMS.filter((i) => isHandItem(i.kind)).map((i) => i.kind)
    expect(hand).toEqual(['lock', 'paper', 'eraser', 'tape', 'trap'])
    expect(Object.values(ITEM_FOR)).toEqual(['whistle', 'nameTag'])
  })

  it('이름과 설명이 비어 있지 않다', () => {
    for (const i of ITEMS) {
      expect(i.name.length, i.kind).toBeGreaterThan(0)
      expect(i.text.length, i.kind).toBeGreaterThan(0)
    }
  })

  it('한 행동을 두 물건이 잠그지 않는다', () => {
    const uses = ITEMS.map((i) => i.use).filter((u) => u !== undefined)
    expect(new Set(uses).size).toBe(uses.length)
    expect(Object.keys(ITEM_BY_KIND)).toHaveLength(ITEMS.length)
  })
})

describe('주머니', () => {
  it('넣으면 늘고 꺼내면 준다', () => {
    const one = putItem(undefined, 'whistle')
    expect(countOf(one, 'whistle')).toBe(1)
    const none = takeItem(one, 'whistle')
    expect(countOf(none ?? {}, 'whistle')).toBe(0)
  })

  it('없는 것은 못 꺼낸다', () => {
    expect(takeItem({}, 'whistle')).toBeNull()
    expect(takeItem({ whistle: 0 }, 'whistle')).toBeNull()
  })

  it('꺼내도 원래 주머니는 그대로다', () => {
    const bag = { whistle: 2 }
    takeItem(bag, 'whistle')
    expect(bag.whistle).toBe(2)
  })
})
