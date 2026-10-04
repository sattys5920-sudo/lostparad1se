// 감독관 — 공사 중인 2-3 교실을 연다 · 다시 닫는다(rules/construction).
import { HttpsError, onCall } from 'firebase-functions/v2/https'

import type { GameDoc } from '../../shared/model'
import { CONSTRUCTION_ROOM } from '../../shared/rules/construction'
import { requireHost } from './host'
import { gameRef, nowOf } from './index'
import { logEvent } from './qaLog'
import { openInterval } from './reveal'
import { pushEveryoneOut } from './seat'
import { refreshViews } from './views'

export const hostSetPlazaOpen = onCall<{ gameId: string; open: boolean }>(async (req) => {
  requireHost(req.auth)
  const { gameId } = req.data
  const open = req.data.open === true
  const ref = gameRef(gameId)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  await ref.update({ plazaOpen: open })
  return { open }
})

/**
 * 감독관 — 공사 중인 2-3 교실 안에 있는 사람을 모두 문 앞 복도로 내보낸다.
 * 페이즈가 열릴 때 모두를 내보내는 것(phase.ts)과 같은 길이다 — 덫에 걸린
 * 사람만 그 자리에 둔다
 */
export const hostEvictPlaza = onCall<{ gameId: string }>(async (req) => {
  requireHost(req.auth)
  const { gameId } = req.data
  const snap = await gameRef(gameId).get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  const game = snap.data() as GameDoc
  const nowMs = nowOf(game)
  const pushedOut = await pushEveryoneOut(gameId, nowMs, CONSTRUCTION_ROOM)
  // 복도로 나온 사람은 그 방 체류를 닫는다(phase.ts 와 같다)
  for (const o of pushedOut) if (!o.walking) await openInterval(gameId, o.playerId, null, nowMs, 'walking')
  await refreshViews(gameId)
  await logEvent(gameId, 'plazaEvict', nowMs, null, { pushedOut }, { day: game.day })
  return { count: pushedOut.length }
})
