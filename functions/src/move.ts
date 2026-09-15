// 이동과 깃발.
//
// 서버는 걸음을 초 단위로 따라가지 않는다. 출발할 때 칸마다 도착 시각을
// 예정 이벤트로 적어 두고, 따라잡기가 지난 것을 한꺼번에 민다. 앱을 꺼도
// 말은 걷는다. 앱을 꺼 둬도 계속 걷는다.
//
// 깃발도 같다. 꽂는 순간 완료 시각을 적어 두고, 그 시각에 그 칸에 서
// 있던 말로 판정한다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

import { arrivals, checkCommutePlan, planWalk, type Walk } from '../../shared/rules/movement'
import { ATHLETIC_MOVE_FACTOR } from '../../shared/rules/v2'
import { TILE_BY_ID, type TileId } from '../../shared/rules/board'
import { SCHEDULE_ORD, type ScheduleDoc } from '../../shared/model'
import { refreshViews } from './views'
import { openInterval } from './reveal'
import { freshNow, myPawn, requireAwake } from './turn'
import { gameRef, requireUid } from './index'

const db = getFirestore()

/** 그 사람의 아직 안 온 도착 예정을 지운다. 길을 바꾸면 옛 길은 없던 것이다. */
export async function clearArrivals(gameId: string, playerId: string): Promise<void> {
  const snap = await gameRef(gameId)
    .collection('schedule')
    .where('kind', '==', 'arrive')
    .get()
  const batch = db.batch()
  for (const d of snap.docs) {
    const s = d.data() as ScheduleDoc
    if (s.doneAtMs !== null) continue
    if ((s.payload as { playerId?: string }).playerId !== playerId) continue
    batch.delete(d.ref)
  }
  await batch.commit()
}

/** 걸음을 예정 이벤트로 적는다. 칸마다 한 건이다. */
export function writeWalk(gameId: string, walk: Walk, batch: FirebaseFirestore.WriteBatch): number {
  const steps = arrivals(walk)
  steps.forEach((step, i) => {
    const item: ScheduleDoc = {
      dueAtMs: step.atMs,
      ord: SCHEDULE_ORD.arrive,
      kind: 'arrive',
      payload: {
        playerId: walk.playerId,
        tileId: step.tileId,
        rest: steps.slice(i + 1).map((s) => s.tileId),
        nextAtMs: steps[i + 1]?.atMs ?? null,
      },
      doneAtMs: null,
    }
    batch.set(gameRef(gameId).collection('schedule').doc(), item)
  })
  return steps[0]?.atMs ?? walk.startedAtMs
}

// ── 이동 ────────────────────────────────────────────────────────

/**
 * 목적지를 찍는다. 최단 경로로 걷는다 — 길을 고르게 하지 않는다.
 *
 * 출발하는 순간 원래 칸을 떠난 것으로 본다. 걷는 말은 어느 칸 판정에도
 * 세지 않는다.
 */
export const moveTo = onCall<{ gameId: string; tileId: TileId }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, tileId } = req.data
  const { nowMs } = await freshNow(gameId)
  if (!TILE_BY_ID[tileId]) throw new HttpsError('invalid-argument', '그런 칸은 없다.')

  const pawnRef = gameRef(gameId).collection('pawns').doc(uid)
  const pawn = await myPawn(gameId, uid)
  requireAwake(pawn, nowMs)
  if (pawn.tileId === null) throw new HttpsError('failed-precondition', '이미 걷는 중이다.')

  const factor = pawn.title === 'athleticDirector' ? ATHLETIC_MOVE_FACTOR : 1
  const plan = planWalk(uid, pawn.tileId, tileId, nowMs, factor)
  if (!plan.ok || !plan.walk) {
    throw new HttpsError('invalid-argument', plan.reason === 'sameTile' ? '이미 그 칸이다.' : '그런 칸은 없다.')
  }

  await clearArrivals(gameId, uid)
  const batch = db.batch()
  const firstAt = writeWalk(gameId, plan.walk, batch)
  batch.update(pawnRef, {
    tileId: null,
    fromTile: pawn.tileId,
    path: [...plan.walk.path],
    arriveAtMs: firstAt,
    asleep: false,
  })
  batch.set(gameRef(gameId).collection('events').doc(), {
    atMs: nowMs,
    day: (await gameRef(gameId).get()).get('day'),
    kind: 'move',
    playerId: uid,
    team: pawn.team,
    // 목적지는 기록에도 남기지 않는다. events는 판정 근거이지 관전석이 아니다
    detail: { steps: plan.walk.path.length },
  })
  await batch.commit()
  // 떠나는 순간 그 칸의 체류가 끝난다. 걷는 동안은 어느 칸에도 없다
  await openInterval(gameId, uid, null, nowMs, 'walking')
  await refreshViews(gameId)
  return { steps: plan.walk.path.length, arriveAtMs: arrivals(plan.walk).slice(-1)[0]?.atMs ?? firstAt }
})

/**
 * 목적지 예약. 찍어 두면 하루가 열릴 때(자정) 모든 팀이 동시에 출발한다.
 *
 * **소등이 없어진 뒤로는 쓸 일이 줄었다.** 본래는 밤새 멈춰 있는
 * 동안 찍어 두는 자리였다. 지금도 「자정에 함께 출발」로는 쓰인다.
 *
 * 예약 내용은 누구에게도 보이지 않는다 — secret에 두고, 걸음으로
 * 바뀐 뒤에야 안개 규칙대로 드러난다.
 */
export const planCommute = onCall<{ gameId: string; tileId: TileId | null }>(
  async (req) => {
    const uid = requireUid(req.auth)
    const { gameId, tileId } = req.data
    const { nowMs } = await freshNow(gameId)
    const planRef = gameRef(gameId).collection('secret').doc('plans').collection('items').doc(uid)

    // null이면 예약 취소
    if (tileId === null) {
      await planRef.delete()
      await refreshViews(gameId)
      return { cleared: true }
    }

    const pawn = await myPawn(gameId, uid)
    const from = pawn.tileId ?? pawn.path[pawn.path.length - 1] ?? null
    if (from === null) throw new HttpsError('failed-precondition', '지금 어디 있는지 알 수 없다.')

    const check = checkCommutePlan(from, tileId)
    if (!check.ok) {
      const why =
        check.reason === 'tooFar' ? '예약은 두 칸까지다.' : check.reason === 'sameTile' ? '이미 그 칸이다.' : '그런 칸은 없다.'
      throw new HttpsError('invalid-argument', why)
    }

    await planRef.set({ playerId: uid, path: [tileId], atMs: nowMs })
    await refreshViews(gameId)
    return { to: tileId }
  },
)
