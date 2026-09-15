// 상점. 5행 2열, 옛 이름은 교실.
//
// **품목은 아직 비어 있다.** 무엇을 파는지는 사용자가 직접 채운다 —
// 값과 효과가 정해지기 전에 아무 물건이나 넣어 두면, 나중에 지우는
// 것보다 남아 있는 것이 더 큰 일이 된다. 빈 채로 두면 화면에도
// 「아직 파는 것이 없다」로 정직하게 나온다.
//
// 상점 기능을 붙일 때 여기만 채우면 되도록, 파는 쪽 규칙(어디서
// 살 수 있나)은 미리 적어 둔다.
import type { Resource, TeamId } from './v2'
import type { TileId } from './board'

/** 물건을 살 수 있는 방. 여기 서 있어야 산다. */
export const SHOP_TILE: TileId = 'classroom'

export interface ShopItem {
  id: string
  name: string
  /** 화면에 그대로 나온다. 무엇을 하는 물건인지 한 줄로. */
  text: string
  /** 값. 팀 자원에서 빠진다. */
  cost: Partial<Record<Resource, number>>
  /** 하루에 판 전체에서 이만큼까지만. 없으면 제한 없다. */
  stockPerDay?: number
}

/** [작성 예정] 파는 물건. 사용자가 채운다. */
export const SHOP_ITEMS: readonly ShopItem[] = []

export const shopItemById = (id: string): ShopItem | null =>
  SHOP_ITEMS.find((i) => i.id === id) ?? null

// ── 값 ──────────────────────────────────────────────────────────

/** 상점을 차지한 팀이 내는 값. 무엇을 사든 이만큼이다. */
export const SHOP_OWNER_PRICE = 1

export interface ShopPrice {
  /** 실제로 내는 것. */
  cost: Partial<Record<Resource, number>>
  /** 그 값을 받는 팀. 아무도 상점을 안 쥐고 있으면 없다. */
  payTo: TeamId | null
  /** 상점을 차지한 팀이라 헐값인가. 화면이 「우리 상점」이라고 적는다. */
  owned: boolean
}

/**
 * 이 물건이 나에게 얼마인가.
 *
 * **상점을 차지한 팀은 무엇이든 1코인이다.** 값이 싼 것이 아니라
 * 제 가게라서 그렇다 — 그 1코인은 아무 데도 가지 않는다.
 *
 * **나머지는 붙은 값을 그대로, 그리고 상점 주인 팀에게 낸다.** 돈이
 * 판에서 사라지는 것이 아니라 남의 금고로 넘어간다. 상점을 쥔다는
 * 것은 학교 전체의 씀씀이를 받아 먹는다는 뜻이다.
 *
 * 아무도 안 쥐고 있으면 값은 그대로지만 받을 팀이 없어 사라진다.
 */
export function shopPriceFor(
  item: ShopItem,
  buyer: TeamId,
  owner: TeamId | null,
): ShopPrice {
  if (owner === buyer) return { cost: { money: SHOP_OWNER_PRICE }, payTo: null, owned: true }
  return { cost: { ...item.cost }, payTo: owner, owned: false }
}
