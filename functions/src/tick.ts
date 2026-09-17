// 따라잡기를 밖에서 부르는 문.
//
// 화면이 열릴 때, 그리고 Cloud Scheduler가 있으면 정시에 부른다.
// 둘 중 하나만 있어도 판은 굴러간다 — 아무도 안 들어온 채 이틀이
// 지났어도 다음 사람이 들어온 순간 그 사이가 전부 처리된다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import type { GameDoc } from '../../shared/model'
import { catchUp, peekByHand, pushByHand } from './catchup'
import { gameRef, nowOf, requireUid } from './index'

/** 운영자만. 화면이 하는 말을 믿지 않는다. */
function requireHost(auth: { uid?: string; token?: Record<string, unknown> } | undefined): string {
  const uid = requireUid(auth)
  if (auth?.token?.admin !== true) throw new HttpsError('permission-denied', '운영자만 할 수 있다.')
  return uid
}

export const tick = onCall<{ gameId: string }>(async (req) => {
  requireUid(req.auth)
  const snap = await gameRef(req.data.gameId).get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  const game = snap.data() as GameDoc
  return catchUp(req.data.gameId, nowOf(game))
})

/**
 * 달력 한 칸을 손으로 넘긴다. 운영자만.
 *
 * **시계가 판을 끝내지 않는다.** 세워 두고 며칠 지나면 아무도 안
 * 들어온 사이에 닷새가 지나가서, 다음에 들어온 사람은 엔딩만 봤다.
 * 날이 바뀌는 것도 정산도 끝나는 것도 이제 여기서 민다.
 */
export const pushDay = onCall<{ gameId: string }>(async (req) => {
  requireHost(req.auth)
  return pushByHand(req.data.gameId)
})

/** 다음에 무엇을 넘기게 되는가. 누르기 전에 알아야 누를 수 있다. */
export const peekDay = onCall<{ gameId: string }>(async (req) => {
  requireHost(req.auth)
  return { next: await peekByHand(req.data.gameId) }
})
