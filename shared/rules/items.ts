// 아이템 — 토큰으로는 살 수 없는 것들.
//
// **방해와 위장은 토큰이 아니라 물건이 든다.** 토큰은 누구에게나
// 페이즈마다 똑같이 떨어지는 시간이다. 그것만으로 남을 지우거나
// 남의 눈을 속일 수 있으면, 그 두 가지가 그냥 매 페이즈의 기본기가
// 된다 — 아무도 특별한 일을 한 것이 아니게 된다.
//
// 물건은 상점에서만 나온다. 그래서 상점을 쥔 팀은 값을 받을 뿐
// 아니라, 학교에서 방해와 위장이 몇 번 일어날지를 쥐게 된다.
//
// 쓰는 길이 둘이다.
//
//   행동에 딸린 것   use 가 찬 물건. 그 행동을 걸 때 저절로 하나 빠진다
//                    (호루라기 · 남의 명찰)
//   손으로 쓰는 것   use 가 빈 물건. 「쓰기」를 눌러야 쓰인다
//                    (자물쇠 · 빈 종이 · 지우개 · 테이프)
import type { ActionKind } from './occupy'

/** 학교에서 주울 만한 것들. 그럴듯한 물건이어야 쓸 때 말이 된다. */
export type ItemKind = 'whistle' | 'nameTag' | 'lock' | 'paper' | 'eraser' | 'tape' | 'trap'

export interface ItemSpec {
  kind: ItemKind
  name: string
  /** 화면에 그대로 나온다. */
  text: string
  /**
   * 이 물건이 있어야 되는 행동. **비어 있으면 손으로 쓰는 물건이다** —
   * 페이즈 행동에 딸리지 않고 「쓰기」한 번으로 그 자리에서 쓰인다.
   */
  use?: ActionKind
  /** 손으로 쓸 때 같이 적어 내야 하는 것. 화면이 무엇을 물을지 안다. */
  needs?: 'text' | 'scrap'
}

export const ITEMS: readonly ItemSpec[] = [
  {
    kind: 'whistle',
    name: '호루라기',
    text: '한 번 불면 같은 방 한 사람이 그쪽을 본다. 이번 판정에서 그 사람은 0명이다.',
    use: 'disturb',
  },
  {
    kind: 'nameTag',
    name: '남의 명찰',
    text: '가슴에 달면 다른 팀에게는 내가 둘로 보인다. 판정은 그대로다.',
    use: 'disguise',
  },
  {
    kind: 'lock',
    name: '자물쇠',
    text: '선 방 문에 건다. 한 시간 동안 우리 팀 말고는 들어오지 못한다.',
  },
  {
    kind: 'paper',
    name: '빈 종이',
    text: '한 줄 적어 선 방 바닥에 놓는다. 누구의 비밀도 아닌 종이라, 주운 사람에게 주인이 안 붙는다.',
    needs: 'text',
  },
  {
    kind: 'eraser',
    name: '지우개',
    text: '오늘 내 이름이 적힌 표를 한 장 지운다. 몇 장이었는지는 알려 주지 않는다.',
  },
  {
    kind: 'tape',
    name: '테이프',
    text: '이 방에 남은 찢긴 조각을 한 무더기 붙인다. 접힌 채로 내 손에 온다.',
    needs: 'scrap',
  },
  /*
   * **상점에 없다.** 기술실 제조기에서만 나온다(rules/trap). 여기 있는
   * 것은 손에 든 뒤의 일이다 — 복도에 놓고, 놓으면 안 보인다.
   */
  {
    kind: 'trap',
    name: '덫',
    text: '선 복도 칸에 놓는다. 놓으면 아무에게도 안 보인다. 다른 팀이 밟으면 10분 동안 못 움직인다. 우리 팀은 밟아도 안 걸린다.',
  },
]

/** 물건 종류를 한 줄로 훑을 때. 목록이 원본이라 빠뜨릴 수가 없다. */
export const ITEM_KINDS: readonly ItemKind[] = ITEMS.map((i) => i.kind)

export const ITEM_BY_KIND: Record<ItemKind, ItemSpec> = Object.fromEntries(
  ITEMS.map((i) => [i.kind, i]),
) as Record<ItemKind, ItemSpec>

/** 그 행동에 드는 물건. 없으면 토큰만 드는 행동이다. */
export const ITEM_FOR: Partial<Record<ActionKind, ItemKind>> = Object.fromEntries(
  ITEMS.filter((i) => i.use !== undefined).map((i) => [i.use as ActionKind, i.kind]),
) as Partial<Record<ActionKind, ItemKind>>

/** 손으로 쓰는 물건인가. 화면이 「쓰기」를 붙일지 여기서 본다. */
export const isHandItem = (kind: ItemKind): boolean => ITEM_BY_KIND[kind]?.use === undefined

/** 빈 종이 한 장에 적을 수 있는 길이. 운영자 메모와 같은 값이다. */
export const PAPER_MAX = 300

/** 자물쇠가 버티는 시간. **게임 시계로** 한 시간 — 페이즈 하나와 같다. */
export const LOCK_MS = 60 * 60 * 1000

/** 팀이 함께 가진 물건. 누가 사 오든 팀 누구나 쓴다 — 금고와 같다. */
export type Satchel = Partial<Record<ItemKind, number>>

export const EMPTY_SATCHEL: Satchel = {}

export const countOf = (bag: Satchel | undefined, kind: ItemKind): number => bag?.[kind] ?? 0

/** 하나 꺼낸다. 없으면 null — 부르는 쪽이 거절한다. */
export function takeItem(bag: Satchel | undefined, kind: ItemKind): Satchel | null {
  const have = countOf(bag, kind)
  if (have <= 0) return null
  return { ...(bag ?? {}), [kind]: have - 1 }
}

/** 하나 넣는다. 상점에서 사 오면 여기로 들어간다. */
export function putItem(bag: Satchel | undefined, kind: ItemKind, n = 1): Satchel {
  return { ...(bag ?? {}), [kind]: countOf(bag, kind) + n }
}

/** 팀별 주머니 전부. 페이즈 상태와 팀 문서가 같은 모양을 쓴다. */
/**
 * 사람마다 하나인 주머니. **키는 사람이다.**
 *
 * 한때 팀마다 하나였다. 그러면 상점에 다녀온 사람과 물건을 쓰는
 * 사람이 달라도 되어서, 멀리 나간 한 사람이 사 온 것을 가만히 앉아
 * 있던 사람이 쓴다. 산 사람이 가진다 — 물건을 쓰려면 그 사람이 거기
 * 있어야 하고, 없으면 거래로 건네받아야 한다.
 */
export type Satchels = Partial<Record<string, Satchel>>
