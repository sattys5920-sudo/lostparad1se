// 상점 값 — 차지한 팀과 나머지가 다른 값을 낸다.
import { describe, expect, it } from 'vitest'

import { SHOP_ITEMS, SHOP_TILE, priceOf, shopItemById, type ShopItem } from './shop'
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

describe('자판기 값', () => {
  /*
   * **주인이 없다.** 전에는 상점이 차지할 수 있는 방이라 차지한 팀은
   * 무엇이든 1코인이었고 나머지가 낸 값은 그 팀 금고로 갔다. 자판기가
   * 복도로 나오면서 차지할 수가 없어졌다 — 값은 하나고 낸 돈은 사라진다.
   */
  it('값은 붙은 그대로다', () => {
    expect(priceOf(pen)).toBe(5)
    for (const i of SHOP_ITEMS) expect(priceOf(i), i.id).toBe(i.cost.money)
  })

  it('누가 사도 같은 값이다 — 깎아 주는 자리가 없다', () => {
    const seen = new Set(SHOP_ITEMS.map((i) => `${i.id}:${priceOf(i)}`))
    expect(seen.size).toBe(SHOP_ITEMS.length)
  })
})
