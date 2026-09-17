// 주인 없는 자리를 비운다.
//
// 계정을 지워도 명단은 그대로 둔다 — 돌고 있는 판의 기록이 거기 걸려
// 있어서다. 그런데 **아직 시작 안 한 판에서는 그 자리가 그냥 막힌
// 자리가 된다.** 들어올 사람은 없는데 자리는 차 있어서, 새로 가입한
// 사람이 「자리가 없다」를 듣는다. 실제로 그렇게 막혔다.
//
// 계정 쪽(account.ts)과 로비 쪽(lobby.ts)이 둘 다 이걸 부른다. 한쪽에
// 두고 서로 부르면 두 파일이 서로를 물고 도는 모양이 되므로 따로 낸다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

import { TOTAL_SEATS } from '../../shared/rules/lobby'
import type { GameDoc } from '../../shared/model'
import { accountUids } from './account'
import { gameRef, requireUid } from './index'

const db = getFirestore()

/** 운영자만. 화면이 하는 말을 믿지 않는다. */
function requireHost(auth: { uid?: string; token?: Record<string, unknown> } | undefined): void {
  requireUid(auth)
  if (auth?.token?.admin !== true) throw new HttpsError('permission-denied', '운영자만 할 수 있다.')
}

/**
 * 그 판에서 주인 없는 자리를 비운다. **로비에서만.**
 *
 * 시작한 판은 안 건드린다 — 거기서 자리를 빼면 말도 점수도 주인을
 * 잃는다. 로비가 아니면 null 을 돌려준다.
 */
async function sweepGhosts(gameId: string): Promise<{ freed: string[]; left: number } | null> {
  const ref = gameRef(gameId)
  const snap = await ref.get()
  if (!snap.exists) return null
  const game = snap.data() as GameDoc
  if (game.phase !== 'lobby') return null

  const alive = await accountUids()
  const seats = (game.seats ?? []).filter((s) => alive.has(s.playerId))
  const freed = (game.seats ?? []).filter((s) => !alive.has(s.playerId)).map((s) => s.name || s.playerId)
  if (freed.length > 0) await ref.update({ seats })
  return { freed, left: seats.length }
}

/** 아직 시작 안 한 판에서 주인 없는 자리를 비운다. 운영자만. */
export const sweepSeats = onCall<{ gameId: string }>(async (req) => {
  requireHost(req.auth)
  const ref = gameRef(req.data.gameId)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  if ((snap.data() as GameDoc).phase !== 'lobby') {
    throw new HttpsError('failed-precondition', '이미 시작한 판이다. 시작한 판의 자리는 못 뺀다.')
  }
  const out = await sweepGhosts(req.data.gameId)
  return { freed: out?.freed ?? [], left: out?.left ?? 0, need: TOTAL_SEATS }
})

/**
 * 시작 안 한 판을 전부 훑어 주인 없는 자리를 비운다.
 *
 * 계정을 지운 직후에 부른다. 지운 사람이 앉아 있던 자리를 그대로 두면
 * 다음 사람이 못 앉는데, 그걸 운영자가 따로 기억해서 눌러 줘야 한다면
 * 언젠가 안 누른다.
 */
export async function sweepAllLobbies(): Promise<string[]> {
  const games = await db.collection('games').get()
  const freed: string[] = []
  for (const g of games.docs) {
    if ((g.data() as GameDoc).phase !== 'lobby') continue
    const out = await sweepGhosts(g.id)
    for (const n of out?.freed ?? []) freed.push(n)
  }
  return freed
}

