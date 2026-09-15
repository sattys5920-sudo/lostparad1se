// 아이템 — 방해와 위장은 물건이 든다.
import { describe, expect, it } from 'vitest'

import { ITEMS, ITEM_BY_KIND, ITEM_FOR, countOf, putItem, takeItem } from './items'
import { ACT_COST } from './occupy'

describe('물건', () => {
  it('호루라기는 방해, 명찰은 위장에 든다', () => {
    expect(ITEM_FOR.disturb).toBe('whistle')
    expect(ITEM_FOR.disguise).toBe('nameTag')
  })

  it('물건이 드는 행동에는 토큰이 안 든다', () => {
    for (const i of ITEMS) expect(ACT_COST[i.use], i.name).toBe(0)
  })

  it('이름과 설명이 비어 있지 않다', () => {
    for (const i of ITEMS) {
      expect(i.name.length, i.kind).toBeGreaterThan(0)
      expect(i.text.length, i.kind).toBeGreaterThan(0)
    }
  })

  it('물건 종류마다 쓰이는 행동이 하나씩이다', () => {
    expect(new Set(ITEMS.map((i) => i.use)).size).toBe(ITEMS.length)
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
