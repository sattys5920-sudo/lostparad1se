// 자판기. 복도에 선 기계 셋.
//
// **파는 것은 여섯이다.** 값은 여기 한 줄씩만 있고, 무엇을 하는
// 물건인지는 items.ts 가 안다 — 같은 문장을 두 군데 적으면 한 군데만
// 고치는 날이 온다.
//
// 값을 매긴 자리: 팀 금고가 돈 8로 시작하고 생산 한 번이 3이다.
// 그러니 3짜리는 「오늘 한 번 마음먹는 것」이고, 6짜리는 하루를
// 통째로 모아야 하는 것이다.
import type { Resource } from './v2'
import type { Cell, Floor } from './board'
import { ITEM_BY_KIND, type ItemKind } from './items'

/**
 * 자판기 한 대가 선 자리.
 *
 * **방이 아니라 복도 칸이다.** 전에는 「상점」이라는 방 안에서 샀다 —
 * 그러면 그 방을 차지한 팀이 사고파는 길목을 쥔다. 사고파는 것은
 * 판을 돌리는 바탕이지 다툴 거리가 아니어서, 아무도 차지할 수 없는
 * 자리로 내보냈다. 복도는 어느 방에도 안 속한다.
 */
export interface VendingSpot {
  id: string
  /** 사람에게 보이는 자리 이름. 기계 간판에 그대로 뜬다 */
  name: string
  floor: Floor
  /** 전개도 좌표. **복도 칸이다** — spot-check 가 확인한다. */
  cell: Cell
}

/**
 * 층마다 하나씩 셋. 옥상에는 없다 — 복도가 없다.
 *
 * **복도 한가운데다.** 게시판은 끝에 둬서 보러 가게 했는데, 기계는
 * 반대로 지나다니다 마주치는 편이 낫다. 살 생각이 없던 사람이 앞을
 * 지나며 값을 보는 일이 이 기계가 하는 일의 절반이다.
 *
 * 좌표는 눈으로 찍지 않았다 — scripts/spot-check.ts 가 이 세 칸이
 * 정말 복도인지, 게시판과 겹치지 않는지 지도에 물어본다.
 */
export const VENDINGS: readonly VendingSpot[] = [
  { id: 'b1', name: '지하 복도', floor: 'b1', cell: { x: 25, y: 124 } },
  { id: 'f1', name: '1층 복도', floor: 'f1', cell: { x: 25, y: 80 } },
  { id: 'f2', name: '2층 복도', floor: 'f2', cell: { x: 32, y: 31 } },
]

export const VENDING_BY_ID: Record<string, VendingSpot> = Object.fromEntries(VENDINGS.map((v) => [v.id, v]))

/**
 * 어느 기계 앞에 서 있는가. 아니면 null.
 *
 * **한 칸 옆까지 친다** — 게시판과 같은 자다. 딱 그 칸에만 서야 하면
 * 기계가 선 칸을 누가 밟고 있을 때 아무도 못 산다.
 */
export const atVending = (me: Cell | null | undefined): VendingSpot | null => {
  if (me === null || me === undefined) return null
  return VENDINGS.find((v) => Math.abs(me.x - v.cell.x) <= 1 && Math.abs(me.y - v.cell.y) <= 1) ?? null
}

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
