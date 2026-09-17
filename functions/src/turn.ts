// 행동 엔드포인트가 함께 쓰는 것들.
//
// 무엇을 하든 먼저 **판을 따라잡는다.** 밀린 아침이나 정산을 안 민 채로
// 행동을 받으면 어제 상태 위에 오늘 행동이 얹힌다.
import { HttpsError } from 'firebase-functions/v2/https'
import type { DocumentSnapshot } from 'firebase-admin/firestore'

import { checkGate } from '../../shared/rules/actions'
import type { TileState } from '../../shared/rules/resources'
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

/** 무엇을 하느라 묶였을 때 몇 분 남았는가. 안 묶였으면 0. */
export function busyLeft(pawn: PawnDoc, nowMs: number): number {
  const until = pawn.busyUntilMs ?? 0
  return until > nowMs ? Math.ceil((until - nowMs) / 60_000) : 0
}

/**
 * 하던 일이 안 끝났으면 아무것도 못 한다.
 *
 * **손이 묶인 것과 발이 묶인 것은 다르다.** 발 묶기는 남이 나에게 건
 * 것이고, 이쪽은 내가 고른 일이다 — 거절하는 말도 그래서 다르다.
 * 판정에서는 둘 다 그대로 센다. 그 자리에 몸이 있기 때문이다.
 */
export function requireFree(pawn: PawnDoc, nowMs: number): void {
  const left = busyLeft(pawn, nowMs)
  if (left > 0) {
    const what = pawn.busyKind ? `${pawn.busyKind} 중이다` : '하던 일이 안 끝났다'
    throw new HttpsError('failed-precondition', `${what}. ${left}분 남았다.`)
  }
}

export { requireUid }

/**
 * 같은 자리에 서 있는 사람들.
 *
 * 설계 원칙 4 — **모든 행동에는 몸이 있다.** 뺏으려면 걸어가야 하고
 * 막으려면 서 있어야 한다. 사람과 사람 사이의 일도 마찬가지라,
 * 표도 교역도 털어놓기도 그 자리에서 만나야 한다.
 *
 * 걷는 사람은 어느 자리에도 없다. 말하는 쪽도 듣는 쪽도 그렇다 —
 * 문과 문 사이에 있는 사람과는 아무것도 할 수 없다.
 */
/**
 * 투명인간은 이 일을 할 수 없다. **양쪽 다 막는다.**
 *
 * 사람과 얽히는 일이 전부 막힌다 — 거래, 표, 쪽지 건네기, 호출.
 * 내가 투명인간이어도 막히고, 상대가 투명인간이어도 막힌다. 한쪽만
 * 막으면 「말을 걸 수는 없는데 받을 수는 있는」 이상한 자리가 생긴다.
 *
 * 혼자 하는 일은 그대로 된다 — 걷기, 짝 만들기, 시험지, 쪽지를 줍고
 * 읽고 찢고 **바닥에 두는 것.** 두고 가는 것만은 되는데, 그것이
 * 보이지 않는 사람이 남에게 무언가를 남기는 유일한 통로다.
 */
export function refuseIfInvisible(
  invisibleId: string | null | undefined,
  meId: string,
  otherId: string | null,
  what: string,
): void {
  if (!invisibleId) return
  if (invisibleId === meId) {
    throw new HttpsError('failed-precondition', `보이지 않는 동안에는 ${what} 수 없다.`)
  }
  if (otherId && invisibleId === otherId) {
    throw new HttpsError('failed-precondition', '그런 사람이 없다.')
  }
}

export async function standingWith(
  gameId: string,
  uid: string,
): Promise<{ tileId: string; here: Map<string, { team: string }> }> {
  const pawn = await myPawn(gameId, uid)
  if (pawn.tileId === null) {
    throw new HttpsError('failed-precondition', '걷는 중이다. 어딘가에 서야 한다.')
  }
  const all = await gameRef(gameId).collection('pawns').get()
  const here = new Map<string, { team: string }>()
  for (const d of all.docs) {
    const p = d.data() as PawnDoc
    if (d.id !== uid && p.tileId === pawn.tileId) here.set(d.id, { team: p.team })
  }
  return { tileId: pawn.tileId, here }
}
