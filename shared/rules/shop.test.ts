// 상점 값 — 차지한 팀과 나머지가 다른 값을 낸다.
import { describe, expect, it } from 'vitest'

import { SHOP_ITEMS, SHOP_OWNER_PRICE, SHOP_TILE, shopItemById, shopPriceFor, type ShopItem } from './shop'
import { TILE_BY_ID } from './board'

/** 품목이 아직 비어 있어서 값 규칙은 가짜 물건으로 확인한다. */
const pen: ShopItem = { id: 'pen', name: '볼펜', text: '[작성 예정]', cost: { money: 5 } }

describe('상점', () => {
  it('상점은 한 칸이고 그 칸은 판에 있다', () => {
    expect(TILE_BY_ID[SHOP_TILE]).toBeDefined()
    expect(TILE_BY_ID[SHOP_TILE].name).toBe('상점')
  })

  it('품목은 아직 비어 있다 — 사용자가 채운다', () => {
    expect(SHOP_ITEMS).toEqual([])
    expect(shopItemById('pen')).toBeNull()
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
