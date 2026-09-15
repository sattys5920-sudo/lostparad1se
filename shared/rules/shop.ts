// 상점. 5행 2열, 옛 이름은 교실.
//
// **품목은 아직 비어 있다.** 무엇을 파는지는 사용자가 직접 채운다 —
// 값과 효과가 정해지기 전에 아무 물건이나 넣어 두면, 나중에 지우는
// 것보다 남아 있는 것이 더 큰 일이 된다. 빈 채로 두면 화면에도
// 「아직 파는 것이 없다」로 정직하게 나온다.
//
// 상점 기능을 붙일 때 여기만 채우면 되도록, 파는 쪽 규칙(어디서
// 살 수 있나)은 미리 적어 둔다.
import type { Resource } from './v2'
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
