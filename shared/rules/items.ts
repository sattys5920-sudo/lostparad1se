// 아이템 — 토큰으로는 살 수 없는 것들.
//
// 쓰는 길이 둘이다.
//
//   행동에 딸린 것   use 가 찬 물건. 그 행동을 걸 때 저절로 하나 빠진다
//                    (호루라기 — 팀원을 부른다)
//   손으로 쓰는 것   use 가 빈 물건. 「쓰기」를 눌러야 쓰인다
//                    (자물쇠 · 락픽 · 빈 종이 · 지우개 · 테이프)
import type { ActionKind } from './occupy'

/** 학교에서 주울 만한 것들. 그럴듯한 물건이어야 쓸 때 말이 된다. */
export type ItemKind = 'whistle' | 'lock' | 'lockpick' | 'paper' | 'eraser' | 'tape' | 'trap'

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
  needs?: 'text' | 'scrap' | 'door'
}

export const ITEMS: readonly ItemSpec[] = [
  /*
   * **호루라기는 부르는 데 쓴다.** 불면 같은 팀 한 명이 내 쪽으로 한
   * 칸 온다(호출). 깃발과는 상관없다 — 불러 모아 같이 꽂는 데 쓴다.
   */
  {
    kind: 'whistle',
    name: '호루라기',
    text: '페이즈 중에 불어서 같은 분단 한 명을 내 쪽으로 한 칸 부른다.',
    use: 'summon',
  },
  {
    kind: 'lock',
    name: '자물쇠',
    text: '점령전 중에 이 방 문을 잠근다. 우리 분단만 드나든다. 그 점령전이 끝나면 사라진다.',
  },
  /*
   * **자물쇠를 따는 것.** 가방에서 꺼내 쓰는 단추가 없다 — 잠긴 문에
   * 들어가려다 막히면 그 자리에서 「쓰겠느냐」고 묻는다. 따면 자물쇠가
   * 통째로 풀린다. 연 사람 팀만 들어가는 것이 아니라 누구나 드나든다
   */
  {
    kind: 'lockpick',
    name: '락픽',
    text: '잠긴 문을 딴다. 들어가려다 막히면 쓸지 묻는다. 따면 자물쇠가 풀리고 락픽은 없어진다.',
    needs: 'door',
  },
  {
    kind: 'paper',
    name: '빈 종이',
    text: '한 줄 적어 이 방 바닥에 놓는다. 주인이 안 붙는다.',
    needs: 'text',
  },
  {
    kind: 'eraser',
    name: '지우개',
    text: '오늘 내 이름이 적힌 표를 한 장 지운다.',
  },
  {
    kind: 'tape',
    name: '테이프',
    text: '이 방의 찢긴 조각 한 무더기를 붙인다.',
    needs: 'scrap',
  },
  /*
   * **상점에 없다.** 기술실 제조기에서만 나온다(rules/trap). 여기 있는
   * 것은 손에 든 뒤의 일이다 — 복도에 놓고, 놓으면 안 보인다.
   */
  {
    kind: 'trap',
    name: '덫',
    text: '복도에 놓는다. 안 보인다. 페이즈 중에 다른 분단이 밟으면 10 분 묶인다.',
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

/**
 * 남의 팀 자물쇠에 막혔을 때의 말. **글자 그대로 한 곳에 둔다** —
 * 화면은 이 말을 보고 락픽을 쓰겠느냐고 묻는다. 페이즈 걸음(occupy)과
 * 자유 시간 걸음(roamTo)이 다른 말을 내면 한쪽에서는 안 묻는다.
 */
export const LOCKED_DOOR = '자물쇠로 잠겨 들어갈 수 없다.'

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
