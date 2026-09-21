// 화분에 심는 것들.
//
// **수치는 전부 여기 있다.** 이름도 값도 자라는 시간도 가중치도 한
// 줄씩이고, 운영자 화면이 이 줄을 그대로 고친다(관리자가 고친 값은
// Firestore 에 얹히고, 여기 있는 것은 그 판의 시작값이다).
//
// 자라는 시간은 **범위**다. 심는 순간 서버가 그 사이에서 하나를 뽑고,
// 그 값은 아무에게도 안 간다 — 심은 사람에게도. 언제 열매가 될지를
// 알면 화분 앞에 서서 기다리는 일이 없어지고, 그러면 정원에 오갈
// 이유도 없어진다.
import type { Cell } from './board'

export interface CropSpec {
  id: string
  name: string
  /** 자판기 매입가. 흥정은 없다. */
  price: number
  /** 다 자라는 데 걸리는 시간(게임 시계, 시간 단위). 이 사이에서 뽑는다. */
  growMin: number
  growMax: number
  /** 열매가 된 뒤 시들기까지(시간). 지나면 사라진다. */
  witherHours: number
  /**
   * 뽑힐 무게. 클수록 자주 나온다.
   *
   * 앞 열다섯은 6, 뒤 다섯은 1이다 — 뒤 다섯은 비싸고, 비싼 것이
   * 흔하면 정원이 곧 은행이 된다.
   */
  weight: number
  /** 판 전체에서 이만큼까지만 나온다. 없으면 제한 없다. */
  maxPerGame?: number
}

export const CROPS: readonly CropSpec[] = [
  { id: 'potato', name: '감자', price: 1, growMin: 1, growMax: 2, witherHours: 3, weight: 6 },
  { id: 'radish', name: '무', price: 1, growMin: 1, growMax: 2, witherHours: 3, weight: 6 },
  { id: 'lettuce', name: '상추', price: 1, growMin: 1, growMax: 3, witherHours: 2, weight: 6 },
  { id: 'tomato', name: '방울토마토', price: 2, growMin: 2, growMax: 3, witherHours: 3, weight: 6 },
  { id: 'pepper', name: '고추', price: 2, growMin: 2, growMax: 4, witherHours: 3, weight: 6 },
  { id: 'strawberry', name: '딸기', price: 2, growMin: 2, growMax: 4, witherHours: 2, weight: 6 },
  { id: 'carrot', name: '당근', price: 2, growMin: 2, growMax: 5, witherHours: 4, weight: 6 },
  { id: 'corn', name: '옥수수', price: 2, growMin: 3, growMax: 5, witherHours: 4, weight: 6 },
  { id: 'pumpkin', name: '호박', price: 3, growMin: 3, growMax: 6, witherHours: 5, weight: 6 },
  { id: 'sunflower', name: '해바라기', price: 3, growMin: 3, growMax: 6, witherHours: 4, weight: 6 },
  { id: 'watermelon', name: '수박', price: 3, growMin: 4, growMax: 7, witherHours: 3, weight: 6 },
  { id: 'sweetPotato', name: '고구마', price: 3, growMin: 4, growMax: 8, witherHours: 5, weight: 6 },
  { id: 'blackTulip', name: '검은 튤립', price: 4, growMin: 4, growMax: 8, witherHours: 2, weight: 6 },
  { id: 'frostMushroom', name: '서리버섯', price: 4, growMin: 2, growMax: 9, witherHours: 1, weight: 6 },
  { id: 'iceFlower', name: '얼음꽃', price: 4, growMin: 5, growMax: 9, witherHours: 1, weight: 6 },
  // ── 여기부터 잘 안 나온다 ────────────────────────────────────
  { id: 'nightGlory', name: '밤에 피는 나팔꽃', price: 4, growMin: 6, growMax: 10, witherHours: 1, weight: 1 },
  { id: 'paperFlower', name: '종이꽃', price: 5, growMin: 6, growMax: 11, witherHours: 2, weight: 1 },
  { id: 'namelessGrass', name: '이름 없는 풀', price: 5, growMin: 1, growMax: 12, witherHours: 1, weight: 1 },
  { id: 'glassBerry', name: '유리 열매', price: 6, growMin: 8, growMax: 12, witherHours: 1, weight: 1 },
  /**
   * **판 전체에서 두 번뿐이다.**
   *
   * 싹이 나서 이름이 보이면 그 방에 선 사람 전원이 짧은 알림을 받는다.
   * 흔하면 그냥 비싼 작물이고, 두 번뿐이라 그 자리에 있었다는 것이
   * 이야기가 된다.
   */
  { id: 'hers', name: '그 애가 심은 것', price: 8, growMin: 10, growMax: 12, witherHours: 1, weight: 1, maxPerGame: 2 },
]

export const CROP_BY_ID: Record<string, CropSpec> = Object.fromEntries(CROPS.map((c) => [c.id, c]))

/** 화분이 놓인 방. 정원 하나다. */
export const GARDEN_TILE = 'garden'

/**
 * 화분 여덟 자리와 씨앗 상자 한 자리. **맵 데이터에 박혀 있다.**
 *
 * 정원은 1층 x21..30, y98..105 다 — **전개도 좌표**이고, board.ts 가
 * 층을 위아래로 쌓아 놓은 자리다. 두 줄로 넷씩 놓고 상자는 구석에
 * 둔다. 들어오자마자 씨앗을 집을 수 있어야 화분까지 걸어가는 일이
 * 「가는 김에」가 된다.
 *
 * 자리가 맞는지는 눈으로 안 본다 — scripts/spot-check.ts 가 지도에
 * 물어본다.
 */
export const POT_CELLS: readonly Cell[] = [
  { x: 23, y: 100 }, { x: 25, y: 100 }, { x: 27, y: 100 }, { x: 29, y: 100 },
  // 아랫줄 첫 자리만 한 칸 왼쪽이다 — 23·24 는 가구가 놓인 자리라
  // 화분이 책상 위에 뜬다. 자리가 맞는지는 시험이 지도에 물어본다
  { x: 22, y: 103 }, { x: 25, y: 103 }, { x: 27, y: 103 }, { x: 29, y: 103 },
]
/**
 * 씨앗 상자. **화분에서 두 칸 넘게 떨어뜨려 둔다.**
 *
 * 처음에는 22,99 였는데 23,100 화분과 대각선으로 붙어 있었다 —
 * 둘 다 「둘레 한 칸」으로 재므로 한 자리에 서서 집고 심을 수 있었고,
 * 그러면 오가는 걸음이 없어진다. 시험이 이 거리를 지킨다.
 */
export const SEED_BOX_CELL: Cell = { x: 21, y: 98 }

/** 한 사람이 들고 다닐 수 있는 수확물. 넘으면 못 딴다. */
export const HARVEST_LIMIT = 5

/**
 * 한 사람이 쥘 수 있는 씨앗. **여덟 자리를 혼자 다 채우지는 못한다.**
 *
 * 상자는 정원 입구에 있고 화분은 안쪽에 있다. 셋씩 집어 오게 두면
 * 오가는 걸음이 셋에 한 번이고, 그동안 남이 와서 심는다.
 */
export const SEED_LIMIT = 3

/** 화분 한 자리의 모습. 흙에서 열매까지 넷, 그리고 시듦. */
export type PotStage = 'empty' | 'soil' | 'sprout' | 'leaf' | 'fruit' | 'withered'

/**
 * 지금 몇 단계인가. **자란 시간으로만 정한다.**
 *
 * 다 자라는 데 걸리는 시간을 셋으로 나눠 넘어간다. 소등 중에 흐른
 * 시간은 grownMs 에 안 쌓인다 — 세는 쪽(서버)이 그만큼 빼고 넘긴다.
 */
export function stageOf(grownMs: number, growMs: number, sinceFruitMs: number, witherMs: number): PotStage {
  if (grownMs >= growMs) return sinceFruitMs >= witherMs ? 'withered' : 'fruit'
  const third = growMs / 3
  if (grownMs < third) return 'soil'
  if (grownMs < third * 2) return 'sprout'
  return 'leaf'
}

/** 이름이 보이는가. **싹이 나야 안다** — 흙만 있을 때는 아무도 모른다. */
export const nameShows = (stage: PotStage): boolean => stage !== 'empty' && stage !== 'soil'

/**
 * 무게를 두고 하나 뽑는다. **다 나간 것은 빼고 뽑는다.**
 *
 * @param roll 0 이상 1 미만. 부르는 쪽이 씨앗을 쥔다 — 같은 씨앗이면
 *             같은 결과라야 다시 돌려 볼 수 있다.
 */
export function pickCrop(roll: number, usedCounts: Readonly<Record<string, number>> = {}): CropSpec {
  const open = CROPS.filter((c) => c.maxPerGame === undefined || (usedCounts[c.id] ?? 0) < c.maxPerGame)
  const pool = open.length > 0 ? open : CROPS.filter((c) => c.maxPerGame === undefined)
  const total = pool.reduce((a, c) => a + c.weight, 0)
  let n = roll * total
  for (const c of pool) {
    n -= c.weight
    if (n < 0) return c
  }
  return pool[pool.length - 1] as CropSpec
}

/** 자라는 데 걸릴 시간을 뽑는다. **범위 안에서 한 번**, 그리고 안 바뀐다. */
export const growHoursOf = (spec: CropSpec, roll: number): number =>
  spec.growMin + Math.floor(roll * (spec.growMax - spec.growMin + 1))
