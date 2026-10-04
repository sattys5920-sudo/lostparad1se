// 기념사진 — 감독관이 켜고 끈다. 각자 자기 이름 자리에 서서 자세를 고른다(rules/photo).
import { HttpsError, onCall } from 'firebase-functions/v2/https'

import type { GameDoc, PawnDoc } from '../../shared/model'
import { PHOTO_BANNER, PHOTO_BANNER_MAX, PHOTO_ROOM, isPhotoPose, photoSpots } from '../../shared/rules/photo'
import { roomOfCell } from '../../shared/rules/board'
import { requireHost } from './host'
import { gameRef, requireUid } from './index'

/** 감독관 — 켠다(현수막 문구와 함께) · 끈다. 켤 때마다 자세는 비운다 */
export const hostPhoto = onCall<{ gameId: string; on: boolean; banner?: string }>(async (req) => {
  requireHost(req.auth)
  const { gameId } = req.data
  const snap = await gameRef(gameId).get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  if (!req.data.on) {
    await gameRef(gameId).update({ photo: null })
    return { on: false }
  }
  const banner = String(req.data.banner ?? PHOTO_BANNER).trim().slice(0, PHOTO_BANNER_MAX) || PHOTO_BANNER
  await gameRef(gameId).update({ photo: { on: true, atMs: Date.now(), banner, poses: {} } })
  return { on: true, banner }
})

/** 각자 — 자세를 고른다. **자기 이름 자리에 서 있어야 한다** */
export const setPhotoPose = onCall<{ gameId: string; pose: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, pose } = req.data
  if (!isPhotoPose(pose)) throw new HttpsError('invalid-argument', '그런 자세는 없다.')
  const ref = gameRef(gameId)
  const [snap, pawnSnap] = await Promise.all([ref.get(), ref.collection('pawns').doc(uid).get()])
  const game = snap.data() as GameDoc | undefined
  if (!game?.photo?.on) throw new HttpsError('failed-precondition', '기념사진 시간이 아니다.')
  const spot = photoSpots(game.seats).get(uid)
  if (!spot) throw new HttpsError('failed-precondition', '자리가 없다.')
  const at = (pawnSnap.data() as PawnDoc | undefined)?.at ?? null
  if (!at || at.x !== spot.x || at.y !== spot.y) throw new HttpsError('failed-precondition', '내 이름이 적힌 자리에 서야 고를 수 있다.')
  await ref.update({ [`photo.poses.${uid}`]: pose })
  return { pose }
})

/** 기념사진 중에는 2-3 교실 기물이 치워진다 — 그 칸에도 설 수 있다 */
export function photoClears(game: Pick<GameDoc, 'photo'> | undefined, x: number, y: number): boolean {
  return !!game?.photo?.on && roomOfCell(x, y) === PHOTO_ROOM
}
