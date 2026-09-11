// 아바타가 고른 값. 그림이 아니라 번호만 저장하고, 필요할 때마다 다시 그린다.
//
// 필드 이름이 한 번 바뀌었다(hair/face/color/uniform → hairStyle/…). 이미
// 저장된 값이 Firestore에 남아 있으므로 읽을 때 옛 이름도 받아 준다.
import { HAIR_COLORS } from './palette'
import type { AvatarLook, LegacyAvatarLook } from '../types'

export const HAIR_COUNT = 15
export const COLOR_COUNT = HAIR_COLORS.length
export const EXPRESSION_COUNT = 6
export const OUTFIT_COUNT = 6
/** 0 바지 · 1 치마 */
export const BOTTOM_NAMES = ['바지', '치마']

const wrap = (v: number | undefined, n: number): number => {
  const i = Math.floor(v ?? 0)
  return Number.isFinite(i) ? ((i % n) + n) % n : 0
}

/** 어디서 온 값이든 지금 쓰는 모양으로 맞춘다. */
export function normalizeLook(raw: (Partial<AvatarLook> & LegacyAvatarLook) | null | undefined): AvatarLook {
  const r = raw ?? {}
  return {
    hairStyle: wrap(r.hairStyle ?? r.hair, HAIR_COUNT),
    hairColor: wrap(r.hairColor ?? r.color, COLOR_COUNT),
    expression: wrap(r.expression ?? r.face, EXPRESSION_COUNT),
    outfit: wrap(r.outfit ?? r.uniform, OUTFIT_COUNT),
    bottom: wrap(r.bottom, BOTTOM_NAMES.length),
  }
}

/** 참가자 id에서 기본 모습을 뽑는다. 아무것도 고르지 않아도 서로 달라 보이게. */
export function defaultLook(seed: string): AvatarLook {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return {
    hairStyle: h % HAIR_COUNT,
    hairColor: Math.floor(h / HAIR_COUNT) % COLOR_COUNT,
    expression: Math.floor(h / (HAIR_COUNT * COLOR_COUNT)) % EXPRESSION_COUNT,
    outfit: Math.floor(h / (HAIR_COUNT * COLOR_COUNT * EXPRESSION_COUNT)) % OUTFIT_COUNT,
    bottom: Math.floor(h / 7) % BOTTOM_NAMES.length,
  }
}

/** 「랜덤」 단추. */
export function randomLook(): AvatarLook {
  const pick = (n: number) => Math.floor(Math.random() * n)
  return {
    hairStyle: pick(HAIR_COUNT),
    hairColor: pick(COLOR_COUNT),
    expression: pick(EXPRESSION_COUNT),
    outfit: pick(OUTFIT_COUNT),
    bottom: pick(BOTTOM_NAMES.length),
  }
}
