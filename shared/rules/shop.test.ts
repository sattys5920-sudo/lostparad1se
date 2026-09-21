// 상점 값 — 차지한 팀과 나머지가 다른 값을 낸다.
import { describe, expect, it } from 'vitest'

import { SHOP_ITEMS, SHOP_OWNER_PRICE, SHOP_TILE, shopItemById, shopPriceFor, type ShopItem } from './shop'
import { TILE_BY_ID } from './board'
import { ITEM_BY_KIND, ITEM_KINDS, type ItemKind } from './items'

/** 값 규칙은 파는 목록과 상관없이 돌아야 한다. 가짜 물건으로 본다. */
const pen: ShopItem = { id: 'pen', name: '볼펜', text: '[작성 예정]', cost: { money: 5 } }

describe('상점', () => {
  it('상점은 한 칸이고 그 칸은 판에 있다', () => {
    expect(TILE_BY_ID[SHOP_TILE]).toBeDefined()
    expect(TILE_BY_ID[SHOP_TILE].name).toBe('상점')
  })

  it('방해와 위장에 쓸 물건이 있다 — 없으면 그 두 행동이 판에서 사라진다', () => {
    for (const kind of ['whistle', 'nameTag'] as const) {
      const item = SHOP_ITEMS.find((i) => i.gives === kind)
      expect(item, kind).toBeDefined()
      expect(ITEM_BY_KIND[kind].use, kind).toBeTruthy()
    }
  })

  it('없는 물건은 못 찾는다', () => {
    expect(shopItemById('pen')).toBeNull()
  })

  it('여섯 가지를 팔고, 파는 것은 모두 물건을 남긴다', () => {
    expect(SHOP_ITEMS.map((i) => i.id)).toEqual(['whistle', 'nameTag', 'lock', 'paper', 'eraser', 'tape'])
    // gives 가 없으면 사도 아무것도 안 남는다. 값만 받는 물건은 없다
    for (const i of SHOP_ITEMS) expect(i.gives, i.id).toBeTruthy()
  })

  it('이름과 설명을 카탈로그에서 그대로 가져온다', () => {
    for (const i of SHOP_ITEMS) {
      const spec = ITEM_BY_KIND[i.gives as ItemKind]
      expect(i.name, i.id).toBe(spec.name)
      expect(i.text, i.id).toBe(spec.text)
    }
  })

  it('물건 카탈로그에 있는 것은 모두 어디선가 산다', () => {
    for (const kind of ITEM_KINDS) {
      expect(SHOP_ITEMS.some((i) => i.gives === kind), kind).toBe(true)
    }
  })

  it('**지우개만 하루 몫이 걸려 있다**', () => {
    const limited = SHOP_ITEMS.filter((i) => i.stockPerDay !== undefined)
    expect(limited.map((i) => i.id)).toEqual(['eraser'])
    expect(limited[0]?.stockPerDay).toBe(1)
  })

  it('값은 모두 돈이고, 0원짜리는 없다', () => {
    for (const i of SHOP_ITEMS) {
      expect(Object.keys(i.cost), i.id).toEqual(['money'])
      expect(i.cost.money ?? 0, i.id).toBeGreaterThan(0)
    }
  })
})

describe('상점 값', () => {
  it('차지한 팀은 무엇이든 1코인이고, 그 값은 아무 데도 안 간다', () => {
    const p = shopPriceFor(pen, 'A', 'A')
    expect(p.cost).toEqual({ money: SHOP_OWNER_PRICE })
    expect(p.payTo).toBeNull()
    expect(p.owned).toBe(true)
  })

  it('남은 붙은 값을 그대로, 그리고 **주인 팀에게** 낸다', () => {
    const p = shopPriceFor(pen, 'B', 'A')
    expect(p.cost).toEqual({ money: 5 })
    expect(p.payTo).toBe('A')
    expect(p.owned).toBe(false)
  })

  it('아무도 안 쥐고 있으면 값은 그대로지만 받을 팀이 없다', () => {
    const p = shopPriceFor(pen, 'B', null)
    expect(p.cost).toEqual({ money: 5 })
    expect(p.payTo).toBeNull()
    expect(p.owned).toBe(false)
  })

  it('값을 돌려주면서 물건의 값을 건드리지 않는다', () => {
    shopPriceFor(pen, 'B', 'A').cost.money = 999
    expect(pen.cost.money).toBe(5)
  })
})
