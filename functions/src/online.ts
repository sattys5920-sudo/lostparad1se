// 앱을 켜 두었다는 신호(ping). 규칙은 shared/rules/online.
//
// 화면이 떠 있는 동안 1 분마다 부른다. 말 문서에 실제 시각을 적을 뿐이라
// 값이 싸다(읽기 하나 · 쓰기 하나). **5 분 넘게 꺼져 있다가 돌아왔으면** 그
// 사이 누가 내 칸에 섰을 수 있으니 비켜 세우고, 남의 맵에 다시 그려지게
// 화면 몫을 새로 쓴다.
import { onCall } from 'firebase-functions/v2/https'

import type { GameDoc, PawnDoc } from '../../shared/model'
import { isAway } from '../../shared/rules/online'
import { gameRef, nowOf, requireUid } from './index'
import { reseatIfShared } from './seat'
import { refreshViewsSoon } from './views'
import { CONSTRUCTION_ROOM, isUnderConstruction } from '../../shared/rules/construction'
import { roomOfCell } from '../../shared/rules/board'
import { evictPlaza } from './construction'

export const ping = onCall<{ gameId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const gameId = String(req.data?.gameId ?? '')
  if (!gameId) return { ok: false }
  const ref = gameRef(gameId).collection('pawns').doc(uid)
  const snap = await ref.get()
  // 앉지 않은 사람(운영자 · 시작 전)은 적을 말이 없다
  if (!snap.exists) return { ok: false }
  const p = snap.data() as PawnDoc
  const now = Date.now()
  const wasAway = isAway(p.seenMs, now)
  await ref.update({ seenMs: now })
  /*
   * **공사 중인 2-3 교실 안에 서 있으면 복도로 내보낸다.** 닫힌 뒤에도 안에 남은
   * 사람이다 — 1 분마다 오는 이 문에서 본다. 안에 선 사람만 게임 문서를 읽는다
   */
  if (p.tileId === CONSTRUCTION_ROOM && p.at && roomOfCell(p.at.x, p.at.y) === CONSTRUCTION_ROOM) {
    const game = (await gameRef(gameId).get()).data() as GameDoc | undefined
    if (game && isUnderConstruction(game, CONSTRUCTION_ROOM)) {
      await evictPlaza(gameId, game, 'auto')
      return { ok: true, back: wasAway }
    }
  }
  if (wasAway) {
    const game = (await gameRef(gameId).get()).data() as GameDoc | undefined
    if (game) await reseatIfShared(gameId, uid, nowOf(game))
    await refreshViewsSoon(gameId)
  }
  return { ok: true, back: wasAway }
})
