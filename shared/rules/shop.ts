// 상점. 5행 2열, 옛 이름은 교실.
//
// **파는 것은 여섯이다.** 값은 여기 한 줄씩만 있고, 무엇을 하는
// 물건인지는 items.ts 가 안다 — 같은 문장을 두 군데 적으면 한 군데만
// 고치는 날이 온다.
//
// 값을 매긴 자리: 팀 금고가 돈 8로 시작하고 생산 한 번이 3이다.
// 그러니 3짜리는 「오늘 한 번 마음먹는 것」이고, 6짜리는 하루를
// 통째로 모아야 하는 것이다.
import type { Resource } from './v2'
import type { TileId } from './board'
import { ITEM_BY_KIND, type ItemKind } from './items'

/** 물건을 살 수 있는 방. 여기 서 있어야 산다. */
export const SHOP_TILE: TileId = 'classroom'

export interface ShopItem {
  id: string
  name: string
  /** 화면에 그대로 나온다. 무엇을 하는 물건인지 한 줄로. */
  text: string
  /** 값. 팀 자원에서 빠진다. */
  cost: Partial<Record<Resource, number>>
  /** 사면 팀 주머니에 들어가는 물건. 없으면 사도 아무것도 안 남는다. */
  gives?: ItemKind
  /** 하루에 판 전체에서 이만큼까지만. 없으면 제한 없다. */
  stockPerDay?: number
}

/** 물건 이름과 설명은 카탈로그에서 그대로 가져온다. */
const of = (kind: ItemKind) => ({ name: ITEM_BY_KIND[kind].name, text: ITEM_BY_KIND[kind].text, gives: kind })

/**
 * 파는 물건.
 *
 * 둘은 행동에 딸린 것이고(호루라기 · 명찰), 넷은 손으로 쓰는 것이다.
 * 갈래를 여기서 적지 않는다 — items.ts 의 use 가 그것을 안다.
 */
export const SHOP_ITEMS: readonly ShopItem[] = [
  { id: 'whistle', ...of('whistle'), cost: { money: 3 } },
  { id: 'nameTag', ...of('nameTag'), cost: { money: 3 } },
  { id: 'lock', ...of('lock'), cost: { money: 4 } },
  // 제일 싸다. 종이가 흔해야 바닥에 뭔가 떨어져 있는 학교가 된다
  { id: 'paper', ...of('paper'), cost: { money: 2 } },
  /*
   * **제일 비싸고, 하나뿐이다.**
   *
   * 오늘 내게 적힌 표를 지우는 물건이다. 돈만 있으면 몇 장이든
   * 지울 수 있게 두면 부자 팀은 투명인간 투표 밖에 서게 되고,
   * 그러면 이 게임에서 제일 무서운 규칙이 돈으로 꺼진다.
   */
  { id: 'eraser', ...of('eraser'), cost: { money: 6 }, stockPerDay: 1 },
  { id: 'tape', ...of('tape'), cost: { money: 4 } },
]

export const shopItemById = (id: string): ShopItem | null =>
  SHOP_ITEMS.find((i) => i.id === id) ?? null

// ── 값 ──────────────────────────────────────────────────────────

/**
 * 이 물건이 얼마인가. **누구에게나 같다.**
 *
 * 전에는 상점이 차지할 수 있는 방이었고, 차지한 팀은 무엇이든
 * 1코인이었으며 나머지가 낸 값은 그 팀 금고로 넘어갔다. 자판기가
 * 복도로 나오면서 그 규칙이 통째로 없어졌다 — **복도는 아무도 차지할
 * 수 없다.** 값을 받아 갈 주인이 없으니 낸 돈은 그냥 사라진다.
 *
 * 판에서 돈이 빠져나가는 구멍은 이 기계 하나뿐이다.
 */
export const priceOf = (item: ShopItem): number => item.cost.money ?? 0
