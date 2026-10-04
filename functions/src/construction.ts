// 감독관 — 공사 중인 2-3 교실을 연다 · 다시 닫는다(rules/construction).
import { HttpsError, onCall } from 'firebase-functions/v2/https'

import { requireHost } from './host'
import { gameRef } from './index'

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
