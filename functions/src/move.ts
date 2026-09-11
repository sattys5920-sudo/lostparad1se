// 이동과 깃발.
//
// 서버는 걸음을 초 단위로 따라가지 않는다. 출발할 때 칸마다 도착 시각을
// 예정 이벤트로 적어 두고, 따라잡기가 지난 것을 한꺼번에 민다. 앱을 꺼도
// 말은 걷고, 소등이 오면 그 자리에서 멈췄다가 08:00에 마저 걷는다.
//
// 깃발도 같다. 꽂는 순간 완료 시각을 적어 두고, 그 시각에 그 칸에 서
// 있던 말로 판정한다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

import { arrivals, checkCommutePlan, planWalk, type Walk } from '../../shared/rules/movement'
import { addActiveSeconds } from '../../shared/rules/clock'
import { ACTION_TOKEN_COST, canPlantFlag, checkGate, checkStand, ownerLookup } from '../../shared/rules/actions'
import { flagDurationSec, flagTargetOf } from '../../shared/rules/flag'
import { defenseOf, type TileState } from '../../shared/rules/buildings'
import { spendToken } from '../../shared/rules/tokens'
import { ATHLETIC_MOVE_FACTOR, type TeamId } from '../../shared/rules/v2'
import { TILE_BY_ID, type TileId } from '../../shared/rules/board'
import { SCHEDULE_ORD, type FlagDoc, type GameDoc, type PawnDoc, type ScheduleDoc, type TileDoc, type TokenStateDoc } from '../../shared/model'
import { catchUp } from './catchup'
import { refreshViews } from './views'
import { gameRef, nowOf, requireUid } from './index'

const db = getFirestore()

/** 판을 따라잡은 뒤의 지금. 행동은 전부 이 시각으로 판정한다. */
async function freshNow(gameId: string): Promise<{ game: GameDoc; nowMs: number }> {
  const first = await gameRef(gameId).get()
  if (!first.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  await catchUp(gameId, nowOf(first.data() as GameDoc))
  const snap = await gameRef(gameId).get()
  const game = snap.data() as GameDoc
  if (game.phase !== 'running') throw new HttpsError('failed-precondition', '지금은 움직일 수 없다.')
  return { game, nowMs: nowOf(game) }
}

function tileStates(docs: { id: string; data: () => unknown }[]): TileState[] {
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

/** 그 사람의 아직 안 온 도착 예정을 지운다. 길을 바꾸면 옛 길은 없던 것이다. */
async function clearArrivals(gameId: string, playerId: string): Promise<void> {
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
function writeWalk(gameId: string, walk: Walk, batch: FirebaseFirestore.WriteBatch): number {
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
  const snap = await pawnRef.get()
  if (!snap.exists) throw new HttpsError('permission-denied', '이 판에 없는 사람이다.')
  const pawn = snap.data() as PawnDoc

  // 요청을 보냈으니 깨어 있다. 발 묶기만 본다
  const gate = checkGate({ bound: (pawn.boundUntilMs ?? 0) > nowMs, asleep: false })
  if (!gate.ok) throw new HttpsError('failed-precondition', '발이 묶여 있다.')
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
  await refreshViews(gameId)
  return { steps: plan.walk.path.length, arriveAtMs: arrivals(plan.walk).slice(-1)[0]?.atMs ?? firstAt }
})

/**
 * 등교 예약. 소등 중에 찍어 두면 08:00에 모든 팀이 동시에 출발한다.
 *
 * 예약 내용은 누구에게도 보이지 않는다 — secret에 두고, 걸음으로
 * 바뀐 뒤에야 안개 규칙대로 드러난다.
 */
export const planCommute = onCall<{ gameId: string; tileId: TileId | null; plantFlag?: boolean }>(
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

    const snap = await gameRef(gameId).collection('pawns').doc(uid).get()
    if (!snap.exists) throw new HttpsError('permission-denied', '이 판에 없는 사람이다.')
    const pawn = snap.data() as PawnDoc
    const from = pawn.tileId ?? pawn.path[pawn.path.length - 1] ?? null
    if (from === null) throw new HttpsError('failed-precondition', '지금 어디 있는지 알 수 없다.')

    const check = checkCommutePlan(from, tileId)
    if (!check.ok) {
      const why =
        check.reason === 'tooFar' ? '예약은 두 칸까지다.' : check.reason === 'sameTile' ? '이미 그 칸이다.' : '그런 칸은 없다.'
      throw new HttpsError('invalid-argument', why)
    }

    await planRef.set({ playerId: uid, path: [tileId], plantFlag: req.data.plantFlag === true, atMs: nowMs })
    await refreshViews(gameId)
    return { to: tileId, plantFlag: req.data.plantFlag === true }
  },
)

// ── 깃발 ────────────────────────────────────────────────────────

/**
 * 깃발을 꽂는다.
 *
 * 토큰은 꽂을 때 쓴다. 자원은 **성공하는 순간** 낸다 — 그 사이에 칸이
 * 늘었으면 더 비싸지고, 모자라면 실패한다. 토큰은 돌려받지 못한다.
 */
export const plantFlag = onCall<{ gameId: string; tileId: TileId }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, tileId } = req.data
  const { game, nowMs } = await freshNow(gameId)
  if (!TILE_BY_ID[tileId]) throw new HttpsError('invalid-argument', '그런 칸은 없다.')

  const ref = gameRef(gameId)
  const [pawnSnap, tileSnap, flagSnap] = await Promise.all([
    ref.collection('pawns').doc(uid).get(),
    ref.collection('tiles').get(),
    ref.collection('flags').doc(tileId).get(),
  ])
  if (!pawnSnap.exists) throw new HttpsError('permission-denied', '이 판에 없는 사람이다.')
  const pawn = pawnSnap.data() as PawnDoc
  const tiles = tileStates(tileSnap.docs)
  const ownerOf = ownerLookup(tiles)

  const gate = checkGate({ bound: (pawn.boundUntilMs ?? 0) > nowMs, asleep: false })
  if (!gate.ok) throw new HttpsError('failed-precondition', '발이 묶여 있다.')

  const stand = checkStand({ kind: 'flag', standingOn: pawn.tileId, targetTile: tileId, team: pawn.team, ownerOf })
  if (!stand.ok) {
    throw new HttpsError('failed-precondition', stand.reason === 'walking' ? '걷는 중이다.' : '그 칸에 서 있어야 한다.')
  }

  const tier = TILE_BY_ID[tileId].tier
  const place = canPlantFlag({
    tileId,
    team: pawn.team,
    ownerOf,
    hasFlag: flagSnap.exists,
    coreOpen: game.openedTiles.includes(tileId),
    blockaded: false,
  })
  if (!place.ok) {
    const why: Record<string, string> = {
      baseTile: '기지에는 꽂을 수 없다.',
      notTouchingUs: '우리 영역과 맞닿아 있어야 한다.',
      flagHere: '이미 깃발이 있다.',
      coreClosed: '아직 열리지 않은 칸이다.',
      blockaded: '봉쇄되어 있다.',
    }
    throw new HttpsError('failed-precondition', why[place.reason as string] ?? '꽂을 수 없다.')
  }

  // 토큰은 꽂을 때 쓴다
  const boxRef = ref.collection('secret').doc('tokens').collection('items').doc(pawn.team)
  const box = await boxRef.get()
  const spent = spendToken(box.data() as TokenStateDoc, uid, ACTION_TOKEN_COST.flag)
  if (!spent.ok) {
    throw new HttpsError(
      'failed-precondition',
      spent.reason === 'playerDailyLimit' ? '오늘 쓸 수 있는 몫을 다 썼다.' : '토큰이 모자라다.',
    )
  }

  const target = flagTargetOf(tileId, ownerOf(tileId))
  const here = tiles.find((t) => t.tileId === tileId) as TileState
  const durationSec = flagDurationSec({
    target,
    defense: defenseOf(here),
    ownerSpotlighted: target === 'enemy' && game.spotlightTeams.includes(ownerOf(tileId) as TeamId),
    classPresident: pawn.title === 'classPresident',
    ambush: false,
    lastHours: game.lastHours,
  })
  // 소등을 건너뛰어 센다. 밤에는 깃발도 익지 않는다
  const dueAtMs = addActiveSeconds(nowMs, durationSec)

  const flag: FlagDoc = {
    tileId,
    team: pawn.team,
    planterId: uid,
    startedAtMs: nowMs,
    durationSec,
    pausedSec: 0,
    dueAtMs,
  }
  const batch = db.batch()
  batch.set(boxRef, spent.state)
  batch.update(ref.collection('teams').doc(pawn.team), { tokens: spent.state.tokens })
  batch.set(ref.collection('flags').doc(tileId), flag)
  const item: ScheduleDoc = {
    dueAtMs,
    ord: SCHEDULE_ORD.flag,
    kind: 'flag',
    payload: { tileId, team: pawn.team, planterId: uid, target, tier },
    doneAtMs: null,
  }
  batch.set(ref.collection('schedule').doc(), item)
  batch.set(ref.collection('events').doc(), {
    atMs: nowMs,
    day: game.day,
    kind: 'flagPlanted',
    playerId: uid,
    team: pawn.team,
    tileId,
    detail: { durationSec, dueAtMs },
  })
  await batch.commit()
  await refreshViews(gameId)
  return { tileId, durationSec, dueAtMs }
})
