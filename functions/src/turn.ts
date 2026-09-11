// 행동 엔드포인트가 함께 쓰는 것들.
//
// 무엇을 하든 먼저 **판을 따라잡는다.** 밀린 아침이나 정산을 안 민 채로
// 행동을 받으면 어제 상태 위에 오늘 행동이 얹힌다.
import { HttpsError } from 'firebase-functions/v2/https'
import type { DocumentSnapshot } from 'firebase-admin/firestore'

import { checkGate } from '../../shared/rules/actions'
import type { TileState } from '../../shared/rules/buildings'
import type { TileId } from '../../shared/rules/board'
import type { GameDoc, PawnDoc, TileDoc } from '../../shared/model'
import { catchUp } from './catchup'
import { gameRef, nowOf, requireUid } from './index'

/** 따라잡은 뒤의 지금. 행동은 전부 이 시각으로 판정한다. */
export async function freshNow(gameId: string): Promise<{ game: GameDoc; nowMs: number }> {
  const first = await gameRef(gameId).get()
  if (!first.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  await catchUp(gameId, nowOf(first.data() as GameDoc))
  const snap = await gameRef(gameId).get()
  const game = snap.data() as GameDoc
  if (game.phase !== 'running') throw new HttpsError('failed-precondition', '지금은 할 수 없다.')
  return { game, nowMs: nowOf(game) }
}

export function tileStates(docs: readonly DocumentSnapshot[]): TileState[] {
  return docs.map((d) => {
    const t = d.data() as TileDoc
    return {
      tileId: d.id as TileId,
      ownerTeam: t.ownerTeam,
      buildings: t.buildings ?? [],
      ...(t.reinforcedBy ? { reinforced: t.reinforcedBy } : {}),
    }
  })
}

/** 요청을 보낸 사람의 말. 없으면 이 판 사람이 아니다. */
export async function myPawn(gameId: string, uid: string): Promise<PawnDoc> {
  const snap = await gameRef(gameId).collection('pawns').doc(uid).get()
  if (!snap.exists) throw new HttpsError('permission-denied', '이 판에 없는 사람이다.')
  return snap.data() as PawnDoc
}

/**
 * 발이 묶였는지만 본다.
 *
 * 잠들었는지는 보지 않는다 — 요청을 보냈다는 건 깨어 있다는 뜻이다.
 * checkGate의 asleep은 화면이 「지금은 못 한다」를 그릴 때 쓴다.
 */
export function requireAwake(pawn: PawnDoc, nowMs: number): void {
  const gate = checkGate({ bound: (pawn.boundUntilMs ?? 0) > nowMs, asleep: false })
  if (!gate.ok) throw new HttpsError('failed-precondition', '발이 묶여 있다.')
}

export { requireUid }
