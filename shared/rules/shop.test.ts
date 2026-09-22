// 자판기 값 — 누구에게나 같다. 그리고 기계는 복도에 선다.
import { describe, expect, it } from 'vitest'

import { SHOP_ITEMS, VENDINGS, atVending, priceOf, shopItemById, type ShopItem } from './shop'
import { FLOORS, isHallCell, roomOfCell } from './board'
import { ITEM_BY_KIND, ITEM_KINDS, type ItemKind } from './items'

/** 값 규칙은 파는 목록과 상관없이 돌아야 한다. 가짜 물건으로 본다. */
const pen: ShopItem = { id: 'pen', name: '볼펜', text: '[작성 예정]', cost: { money: 5 } }

describe('상점', () => {
  /*
   * **기계는 복도에 선다.** 방 안에 서면 그 방을 차지한 팀이 사고파는
   * 길목을 쥔다 — 자판기를 방에서 내보낸 까닭 자체가 이것이라, 어느
   * 한 대라도 방 안으로 들어가면 규칙이 무너진다.
   */
  it('자판기 셋은 모두 복도에 있고, 어느 방에도 안 속한다', () => {
    expect(VENDINGS).toHaveLength(3)
    for (const v of VENDINGS) {
      expect(roomOfCell(v.cell.x, v.cell.y), v.name).toBeNull()
      expect(isHallCell(v.cell.x, v.cell.y), v.name).toBe(true)
    }
  })

  it('층마다 한 대다 — 옥상만 없다', () => {
    const floors = VENDINGS.map((v) => v.floor)
    expect(new Set(floors).size).toBe(floors.length)
    expect([...floors].sort()).toEqual(FLOORS.filter((f) => f !== 'roof').slice().sort())
  })

  /** 둘레 한 칸까지가 「앞」이다. 딱 그 칸만이면 누가 밟고 섰을 때 못 산다 */
  it('기계 앞 한 칸까지는 그 기계다', () => {
    const v = VENDINGS[0]
    expect(atVending(v.cell)?.id).toBe(v.id)
    expect(atVending({ x: v.cell.x + 1, y: v.cell.y - 1 })?.id).toBe(v.id)
    expect(atVending({ x: v.cell.x + 2, y: v.cell.y })).toBeNull()
    expect(atVending(null)).toBeNull()
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

  it('물건 카탈로그에 있는 것은 모두 어디선가 산다 — 덫만 빼고', () => {
    for (const kind of ITEM_KINDS) {
      // 덫은 파는 것이 아니라 기술실에서 만드는 것이다(rules/trap)
      if (kind === 'trap') continue
      expect(SHOP_ITEMS.some((i) => i.gives === kind), kind).toBe(true)
    }
  })

  it('**덫은 상점에 없다** — 기술실 제조기에서만 나온다', () => {
    expect(SHOP_ITEMS.some((i) => i.gives === 'trap')).toBe(false)
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
