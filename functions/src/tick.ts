// 따라잡기를 밖에서 부르는 문.
//
// 화면이 열릴 때, 그리고 Cloud Scheduler가 있으면 정시에 부른다.
// 둘 중 하나만 있어도 판은 굴러간다 — 아무도 안 들어온 채 이틀이
// 지났어도 다음 사람이 들어온 순간 그 사이가 전부 처리된다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import type { GameDoc } from '../../shared/model'
import { sweepErrands } from './errand'
import { sweepGarden } from './garden'
import { refreshViews } from './views'
import { catchUp, peekByHand, pushByHand } from './catchup'
import { gameRef, nowOf, requireUid } from './index'
import { requireHost } from './host'

/** 운영자만. 화면이 하는 말을 믿지 않는다. */

export const tick = onCall<{ gameId: string }>(async (req) => {
  requireUid(req.auth)
  const snap = await gameRef(req.data.gameId).get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  const game = snap.data() as GameDoc
  const nowMs = nowOf(game)
  /*
   * **제한 시간이 지난 심부름을 떼어낸다.**
   *
   * 시계를 보는 일이라 누가 두드릴 때 같이 한다. 아무도 안 두드리면
   * 아무 일도 안 일어나는데, 그때는 볼 사람도 없다. 화면이 몇 초마다
   * 이 문을 두드리므로 실제로는 제때 떨어진다.
   */
  // 화분도 같이 본다 — 싹이 난 「그 애가 심은 것」을 그때 알린다
  const swept = await sweepErrands(req.data.gameId, nowMs)
  const grew = await sweepGarden(req.data.gameId, nowMs)
  if (swept || grew) await refreshViews(req.data.gameId)
  return catchUp(req.data.gameId, nowMs)
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
