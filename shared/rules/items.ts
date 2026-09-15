// 아이템 — 토큰으로는 살 수 없는 것들.
//
// **방해와 위장은 토큰이 아니라 물건이 든다.** 토큰은 누구에게나
// 페이즈마다 똑같이 떨어지는 시간이다. 그것만으로 남을 지우거나
// 남의 눈을 속일 수 있으면, 그 두 가지가 그냥 매 페이즈의 기본기가
// 된다 — 아무도 특별한 일을 한 것이 아니게 된다.
//
// 물건은 상점에서만 나온다. 그래서 상점을 쥔 팀은 값을 받을 뿐
// 아니라, 학교에서 방해와 위장이 몇 번 일어날지를 쥐게 된다.
import type { ActionKind } from './occupy'
import type { TeamId } from './v2'

/** 학교에서 주울 만한 것들. 그럴듯한 물건이어야 쓸 때 말이 된다. */
export type ItemKind = 'whistle' | 'nameTag'

export interface ItemSpec {
  kind: ItemKind
  name: string
  /** 화면에 그대로 나온다. */
  text: string
  /** 이 물건이 있어야 되는 행동. */
  use: ActionKind
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
]

export const ITEM_BY_KIND: Record<ItemKind, ItemSpec> = Object.fromEntries(
  ITEMS.map((i) => [i.kind, i]),
) as Record<ItemKind, ItemSpec>

/** 그 행동에 드는 물건. 없으면 토큰만 드는 행동이다. */
export const ITEM_FOR: Partial<Record<ActionKind, ItemKind>> = Object.fromEntries(
  ITEMS.map((i) => [i.use, i.kind]),
) as Partial<Record<ActionKind, ItemKind>>

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
export type Satchels = Partial<Record<TeamId, Satchel>>
