// 아바타가 고른 값. 그림이 아니라 번호만 저장하고, 필요할 때마다 다시 그린다.
//
// 저장 모양이 두 번 바뀌었다.
//   1차: hair/face/color/uniform
//   2차: hairStyle(번호)/hairColor/expression/outfit/bottom
//   지금: styleSet/hairStyle('F00'~'M14')/…/wearStyle/neckwear
// 이미 Firestore에 남아 있는 값이 있으므로 읽을 때 옛 모양도 전부 받아 준다.
import { HAIR_COLORS } from './palette'
import {
  EXPRESSIONS,
  HAIR_BY_ID,
  HAIR_IDS_F,
  HAIR_IDS_M,
  NECKWEAR_NAMES,
  OUTFITS,
  WEAR_STYLE_NAMES,
} from './pixel'
import type { AvatarLook, StyleSet } from '../types'

export const COLOR_COUNT = HAIR_COLORS.length
export const EXPRESSION_COUNT = EXPRESSIONS.length
export const OUTFIT_COUNT = OUTFITS.length
export const WEAR_STYLE_COUNT = WEAR_STYLE_NAMES.length
export const NECKWEAR_COUNT = NECKWEAR_NAMES.length
/** 0 바지 · 1 치마 */
export const BOTTOM_NAMES = ['바지', '치마']

/** 성별 거름망에 걸리는 머리 목록. 「전체 보기」면 둘을 이어 붙인다. */
export function hairIdsFor(set: StyleSet): string[] {
  return set === 'M' ? HAIR_IDS_M : HAIR_IDS_F
}

const wrap = (v: unknown, n: number): number => {
  const i = Math.floor(typeof v === 'number' ? v : 0)
  return Number.isFinite(i) ? ((i % n) + n) % n : 0
}

/**
 * 옛 머리 번호를 새 ID로. 0~13은 여자 머리 그대로였고, 14번
 * 「헝클어진 짧은 머리」는 남자 목록으로 옮겨 M10이 되었다.
 */
function migrateHair(v: number): string {
  if (v === 14) return 'M10'
  return `F${String(wrap(v, 14)).padStart(2, '0')}`
}

/**
 * 옛 옷 번호를 새 복장으로. 셔츠+넥타이→춘추복, 블레이저·세일러복→동복,
 * 가디건→가디건, 후드티→후드집업, 체육복→체육복.
 */
const OUTFIT_FROM_OLD = [1, 2, 2, 3, 4, 5]

export function normalizeLook(raw: unknown): AvatarLook {
  const r = (raw ?? {}) as Record<string, unknown>
  const hairStyle =
    typeof r.hairStyle === 'string' && HAIR_BY_ID[r.hairStyle]
      ? r.hairStyle
      : migrateHair(typeof r.hairStyle === 'number' ? r.hairStyle : wrap(r.hair, 15))
  // 새 저장값에는 wearStyle이 있다. 없으면 옛 옷 번호를 옮겨 온다
  const outfit =
    typeof r.wearStyle === 'number'
      ? wrap(r.outfit, OUTFIT_COUNT)
      : OUTFIT_FROM_OLD[wrap(r.outfit ?? r.uniform, OUTFIT_FROM_OLD.length)]
  const styleSet: StyleSet =
    r.styleSet === 'M' || r.styleSet === 'F' ? r.styleSet : (HAIR_BY_ID[hairStyle]?.set ?? 'F')
  return {
    styleSet,
    hairStyle,
    hairColor: wrap(r.hairColor ?? r.color, COLOR_COUNT),
    expression: wrap(r.expression ?? r.face, EXPRESSION_COUNT),
    outfit,
    // 옛 저장값에는 착용 스타일이 없다 — 전부 「보통」으로 본다
    wearStyle: wrap(r.wearStyle ?? 1, WEAR_STYLE_COUNT),
    bottom: wrap(r.bottom, BOTTOM_NAMES.length),
    neckwear: wrap(r.neckwear, NECKWEAR_COUNT),
  }
}

/** 참가자 id에서 기본 모습을 뽑는다. 아무것도 고르지 않아도 서로 달라 보이게. */
export function defaultLook(seed: string): AvatarLook {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const styleSet: StyleSet = h % 2 === 0 ? 'F' : 'M'
  const ids = hairIdsFor(styleSet)
  return {
    styleSet,
    hairStyle: ids[Math.floor(h / 2) % ids.length],
    hairColor: Math.floor(h / 32) % COLOR_COUNT,
    expression: Math.floor(h / 512) % EXPRESSION_COUNT,
    outfit: Math.floor(h / 4096) % OUTFIT_COUNT,
    wearStyle: 1,
    bottom: styleSet === 'F' ? 1 : 0,
    neckwear: Math.floor(h / 64) % NECKWEAR_COUNT,
  }
}

/** 「랜덤」 단추. 고른 성별 안에서만 굴린다. */
export function randomLook(styleSet: StyleSet): AvatarLook {
  const pick = (n: number) => Math.floor(Math.random() * n)
  const ids = hairIdsFor(styleSet)
  return {
    styleSet,
    hairStyle: ids[pick(ids.length)],
    hairColor: pick(COLOR_COUNT),
    expression: pick(EXPRESSION_COUNT),
    outfit: pick(OUTFIT_COUNT),
    wearStyle: pick(WEAR_STYLE_COUNT),
    // 남자도 치마를 고를 수 있지만 굴릴 때는 드물게만 나온다
    bottom: styleSet === 'F' ? pick(2) : pick(4) === 0 ? 1 : 0,
    neckwear: pick(NECKWEAR_COUNT),
  }
}

/** 성별을 바꾼다 — 머리만 같은 자리의 반대쪽 머리로 옮기고 나머지는 둔다. */
export function withStyleSet(look: AvatarLook, styleSet: StyleSet): AvatarLook {
  if (look.styleSet === styleSet) return look
  const from = hairIdsFor(look.styleSet)
  const to = hairIdsFor(styleSet)
  const i = from.indexOf(look.hairStyle)
  return { ...look, styleSet, hairStyle: to[i < 0 ? 0 : i % to.length] }
}
