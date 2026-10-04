// 기념사진 — 2-3 교실에서 열넷이 정해진 자리에 서서 찍는다.
//
// 감독관이 「기념사진」을 켜면(게임 문서 photo) 2-3 교실의 기물이 치워지고
// 위 벽에 현수막이 걸린다. 바닥에는 열넷의 이름이 적힌 자리가 생기고,
// **자기 이름 자리에 서면** 자세를 고를 수 있다. 고른 자세는 모두에게 보인다.
//
// 자리는 세 줄 엇갈림 — 뒤 5 · 가운데 4 · 앞 5. 줄 사이를 한 칸 띄워
// 이름표가 얼굴을 안 가리고, 가운데 줄은 앞뒤 줄 틈에 선다.
import type { TileId } from './board'
import { BUNDAN_NO } from './bundan'
import type { TeamId } from './v2'

export const PHOTO_ROOM: TileId = 'centralPlaza'
export const PHOTO_BANNER = '2-3 모두 즐거웠지?'
export const PHOTO_BANNER_MAX = 24

/** 열넷의 자리. 왼쪽부터 · 같은 열이면 위부터 — 이 순서로 사람을 채운다 */
export const PHOTO_SPOTS: readonly { x: number; y: number }[] = [
  { x: 14, y: 22 }, { x: 14, y: 26 },
  { x: 15, y: 24 },
  { x: 16, y: 22 }, { x: 16, y: 26 },
  { x: 17, y: 24 },
  { x: 18, y: 22 }, { x: 18, y: 26 },
  { x: 19, y: 24 },
  { x: 20, y: 22 }, { x: 20, y: 26 },
  { x: 21, y: 24 },
  { x: 22, y: 22 }, { x: 22, y: 26 },
]

/**
 * 잔치 장식 중 **바닥에 놓여 사람이 못 서는 것.** 자리(PHOTO_SPOTS)와 문 앞
 * (18,28)을 비켜 둔다. 풍선 · 가랜드 · 색종이는 그림뿐이라 여기 없다
 */
export const PHOTO_ROBOT = { x: 23, y: 24 } as const
export const PHOTO_TABLE: readonly { x: number; y: number }[] = [{ x: 12, y: 27 }, { x: 13, y: 27 }]
export const PHOTO_GIFTS = { x: 24, y: 27 } as const
export const PHOTO_ROBOT_NAME = '오투모'
const DECOR = new Set([PHOTO_ROBOT, ...PHOTO_TABLE, PHOTO_GIFTS].map((c) => `${c.x},${c.y}`))
export const isPhotoDecor = (x: number, y: number): boolean => DECOR.has(`${x},${y}`)

export type PhotoPose = 'stand' | 'v' | 'wave' | 'cheer' | 'chest' | 'hips'
export const PHOTO_POSE_IDS: readonly PhotoPose[] = ['stand', 'v', 'wave', 'cheer', 'chest', 'hips']
export const PHOTO_POSE_NAME: Record<PhotoPose, string> = {
  stand: '차렷',
  v: '브이',
  wave: '손 흔들기',
  cheer: '만세',
  chest: '손하트',
  hips: '허리에 손',
}
export const isPhotoPose = (v: unknown): v is PhotoPose => typeof v === 'string' && (PHOTO_POSE_IDS as readonly string[]).includes(v)

/**
 * 누가 어느 자리에 서는가. **분단끼리 모아** 왼쪽부터 — 1 · 2 · 3 · 4 분단,
 * 분단 안에서는 이름순. 열다섯 이상이면 남는 사람은 자리가 없다
 */
export function photoSpots(seats: readonly { playerId: string; name: string; team?: TeamId | null }[]): Map<string, { x: number; y: number }> {
  const order = [...seats].sort(
    (a, b) =>
      (a.team ? BUNDAN_NO[a.team] : 9) - (b.team ? BUNDAN_NO[b.team] : 9) || a.name.localeCompare(b.name, 'ko') || a.playerId.localeCompare(b.playerId),
  )
  const out = new Map<string, { x: number; y: number }>()
  order.forEach((s, i) => {
    const c = PHOTO_SPOTS[i]
    if (c) out.set(s.playerId, c)
  })
  return out
}
