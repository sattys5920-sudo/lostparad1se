// 따라잡기를 밖에서 부르는 문.
//
// 화면이 열릴 때, 그리고 Cloud Scheduler가 있으면 정시에 부른다.
// 둘 중 하나만 있어도 판은 굴러간다 — 아무도 안 들어온 채 이틀이
// 지났어도 다음 사람이 들어온 순간 그 사이가 전부 처리된다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import type { GameDoc } from '../../shared/model'
import { catchUp } from './catchup'
import { gameRef, nowOf, requireUid } from './index'

export const tick = onCall<{ gameId: string }>(async (req) => {
  requireUid(req.auth)
  const snap = await gameRef(req.data.gameId).get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  const game = snap.data() as GameDoc
  return catchUp(req.data.gameId, nowOf(game))
})
