// 페이즈 — 자유 시간과 점령전이 번갈아 온다.
//
// **자리가 둘이다.**
//
//   전투 자리(postTile)  직전 페이즈가 끝난 곳. 점령을 여기서 센다.
//   지금 자리(tileId)    자유 시간에 걸어 다니는 곳. 마주침이 여기서 난다.
//
// 자유 시간에는 마음껏 돌아다닌다 — 대화도 거래도 털어놓기도 표도 지금
// 자리에서 일어난다. 그러나 **아무리 멀리 가도 전선은 움직이지 않는다.**
// 페이즈가 열리면 다들 제자리로 돌아오고, 그 뒤로 전선을 옮기는 길은
// 「이동」 행동 하나뿐이다.
//
// 고른 행동은 secret 아래에만 쓴다. 남이 무엇을 골랐는지 보이면
// 동시에 고르는 의미가 없다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

import {
  PHASES_PER_DAY,
  capacityOf,
  resolvePhase,
  type Action,
  type ActionKind,
  type PhaseState,
  type Person,
  type Robot,
} from '../../shared/rules/occupy'
import { ADJACENCY, TILE_BY_ID, type TileId } from '../../shared/rules/board'
import { SHORT_HANDED_TEAMS, TOTAL_DAYS, type TeamId } from '../../shared/rules/v2'
import type { GameDoc, PawnDoc, TileDoc } from '../../shared/model'
import { freshNow } from './turn'
import { refreshViews } from './views'
import { gameRef, requireUid } from './index'

const db = getFirestore()

const ACTION_KINDS: readonly ActionKind[] = [
  'move',
  'research',
  'summon',
  'disturb',
  'disguise',
  'dropRobot',
  'smashRobot',
]

const actionsOf = (gameId: string) => gameRef(gameId).collection('secret').doc('actions').collection('items')
const robotsOf = (gameId: string) => gameRef(gameId).collection('robots')

/** 운영자만. 화면이 하는 말을 믿지 않는다. */
function requireHost(auth: { uid?: string; token?: Record<string, unknown> } | undefined): string {
  const uid = requireUid(auth)
  if (auth?.token?.admin !== true) throw new HttpsError('permission-denied', '운영자만 할 수 있다.')
  return uid
}

// ── 지금 판 위의 것들을 모은다 ──────────────────────────────────

async function loadBoard(gameId: string): Promise<{ state: PhaseState; game: GameDoc }> {
  const ref = gameRef(gameId)
  const [snap, pawns, tiles, bots] = await Promise.all([
    ref.get(),
    ref.collection('pawns').get(),
    ref.collection('tiles').get(),
    robotsOf(gameId).get(),
  ])
  const game = snap.data() as GameDoc

  const people: Person[] = pawns.docs.map((d) => {
    const p = d.data() as PawnDoc
    return {
      playerId: d.id,
      team: p.team,
      // **전투 자리다.** 돌아다니는 자리가 아니다
      tileId: (p.postTile ?? p.tileId ?? `base${p.team}`) as TileId,
      captain: p.captain === true,
    }
  })
  const robots: Robot[] = bots.docs.map((d) => {
    const r = d.data() as Robot
    return { id: d.id, team: r.team, tileId: r.tileId, carriedBy: r.carriedBy ?? null }
  })
  const owners: Partial<Record<TileId, TeamId | null>> = {}
  for (const d of tiles.docs) owners[d.id as TileId] = (d.data() as TileDoc).ownerTeam ?? null

  return {
    game,
    state: { people, robots, owners, pendingResearch: game.pendingResearch ?? [] },
  }
}

// ── 관리자: 페이즈 열기 ─────────────────────────────────────────

/**
 * 페이즈를 연다. 모두 **직전 페이즈가 끝난 자리로 돌아온다.**
 *
 * 자유 시간에 어디까지 갔든 상관없다. 그 시간은 사람을 만나라고 있는
 * 것이지 전선을 옮기라고 있는 것이 아니다.
 */
export const openPhase = onCall<{ gameId: string }>(async (req) => {
  requireHost(req.auth)
  const { gameId } = req.data
  const { game, nowMs } = await freshNow(gameId)
  if (game.phaseNow?.open) throw new HttpsError('failed-precondition', '이미 열려 있다.')
  if ((game.phaseDone ?? 0) >= PHASES_PER_DAY * TOTAL_DAYS) {
    throw new HttpsError('failed-precondition', '닷새가 끝났다.')
  }

  const ref = gameRef(gameId)
  const pawns = await ref.collection('pawns').get()
  const batch = db.batch()

  // 지난 페이즈에 낸 것은 지운다. 남겨 두면 이번 페이즈에 자동으로 나간다
  const stale = await actionsOf(gameId).get()
  for (const d of stale.docs) batch.delete(d.ref)

  let returned = 0
  for (const d of pawns.docs) {
    const p = d.data() as PawnDoc
    const post = (p.postTile ?? p.tileId ?? `base${p.team}`) as TileId
    if (p.tileId !== post) returned += 1
    batch.update(d.ref, { tileId: post, postTile: post, fromTile: null, path: [], arriveAtMs: null })
  }

  const no = (game.phaseDone ?? 0) + 1
  batch.update(ref, {
    phaseNow: { no, day: Math.floor((no - 1) / PHASES_PER_DAY) + 1, open: true, openedAtMs: nowMs },
  })
  await batch.commit()
  await refreshViews(gameId)
  return { no, returned }
})

// ── 각자: 이번 페이즈에 할 일 ───────────────────────────────────

/** 한 페이즈에 하나. 다시 내면 앞의 것을 덮는다 — 닫히기 전까지는 바꿀 수 있다. */
export const submitAction = onCall<{
  gameId: string
  kind: ActionKind
  targetTile?: TileId
  targetPlayer?: string
  targetRobot?: string
}>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, kind } = req.data
  if (!ACTION_KINDS.includes(kind)) throw new HttpsError('invalid-argument', '그런 행동은 없다.')
  const { game, nowMs } = await freshNow(gameId)
  if (!game.phaseNow?.open) throw new HttpsError('failed-precondition', '지금은 페이즈가 아니다.')

  const mine = await gameRef(gameId).collection('pawns').doc(uid).get()
  if (!mine.exists) throw new HttpsError('permission-denied', '이 판에 없는 사람이다.')

  if (kind === 'move') {
    const to = req.data.targetTile
    if (!to || !TILE_BY_ID[to]) throw new HttpsError('invalid-argument', '그런 방은 없다.')
  }
  if ((kind === 'summon' || kind === 'disturb') && !req.data.targetPlayer && !req.data.targetRobot) {
    throw new HttpsError('invalid-argument', '대상을 골라야 한다.')
  }
  if (kind === 'smashRobot' && !req.data.targetRobot) {
    throw new HttpsError('invalid-argument', '부술 로봇을 골라야 한다.')
  }

  const doc = actionsOf(gameId).doc(uid)
  const before = await doc.get()
  await doc.set({
    playerId: uid,
    kind,
    ...(req.data.targetTile ? { targetTile: req.data.targetTile } : {}),
    ...(req.data.targetPlayer ? { targetPlayer: req.data.targetPlayer } : {}),
    ...(req.data.targetRobot ? { targetRobot: req.data.targetRobot } : {}),
    // 바꿔도 처음 낸 순서를 지킨다. 늦게 바꿔서 먼저 낸 사람을
    // 앞지를 수 있으면 「먼저 낸 쪽만」이 의미를 잃는다
    atMs: (before.data()?.atMs as number | undefined) ?? nowMs,
    phaseNo: game.phaseNow.no,
  })
  return { kind }
})

/** 몇 명이 냈는가. 운영자가 닫을 때를 안다. 무엇을 냈는지는 안 나간다. */
export const phaseReady = onCall<{ gameId: string }>(async (req) => {
  requireUid(req.auth)
  const { gameId } = req.data
  const [game, actions, pawns] = await Promise.all([
    gameRef(gameId).get(),
    actionsOf(gameId).get(),
    gameRef(gameId).collection('pawns').get(),
  ])
  const g = game.data() as GameDoc
  return {
    open: g.phaseNow?.open === true,
    no: g.phaseNow?.no ?? 0,
    submitted: actions.size,
    total: pawns.size,
  }
})

// ── 관리자: 페이즈 닫기 ─────────────────────────────────────────

/**
 * 페이즈를 닫고 한꺼번에 처리한다.
 *
 * 판정은 shared/rules/occupy.ts 의 순수 함수가 한다. 여기서는 재료를
 * 모아 주고 결과를 적기만 한다 — 규칙이 서버 안에 흩어지면 시험할 수 없다.
 */
export const closePhase = onCall<{ gameId: string }>(async (req) => {
  requireHost(req.auth)
  const { gameId } = req.data
  const { game, nowMs } = await freshNow(gameId)
  if (!game.phaseNow?.open) throw new HttpsError('failed-precondition', '열린 페이즈가 없다.')

  const { state } = await loadBoard(gameId)
  const rows = await actionsOf(gameId).get()
  const actions: Action[] = rows.docs.map((d) => d.data() as Action)

  const out = resolvePhase(state, actions)
  const ref = gameRef(gameId)
  const batch = db.batch()

  // 전투 자리와 지금 자리를 함께 옮긴다. 페이즈 직후에는 둘이 같다
  for (const p of out.next.people) {
    batch.update(ref.collection('pawns').doc(p.playerId), { postTile: p.tileId, tileId: p.tileId })
  }
  // 로봇은 통째로 다시 쓴다. 열몇 기뿐이라 견줄 이유가 없다
  const had = await robotsOf(gameId).get()
  for (const d of had.docs) batch.delete(d.ref)
  for (const r of out.next.robots) batch.set(robotsOf(gameId).doc(r.id), { ...r })

  for (const [tileId, team] of Object.entries(out.next.owners)) {
    if ((state.owners[tileId as TileId] ?? null) !== (team ?? null)) {
      batch.update(ref.collection('tiles').doc(tileId), { ownerTeam: team ?? null })
    }
  }
  for (const d of rows.docs) batch.delete(d.ref)

  const no = game.phaseNow.no
  batch.set(ref.collection('phaseLog').doc(String(no)), {
    no,
    day: game.phaseNow.day,
    atMs: nowMs,
    lines: out.log,
    // 위장은 이 페이즈 동안만이다. 기록에 남겨 두면 나중에 다 들통난다
  })
  batch.update(ref, {
    phaseNow: { no, day: game.phaseNow.day, open: false, openedAtMs: game.phaseNow.openedAtMs },
    phaseDone: no,
    pendingResearch: out.next.pendingResearch,
    // 위장은 **다음 페이즈가 끝날 때까지** 남에게 2로 보인다.
    //
    // 규칙 원문은 「이번 턴 동안」이지만, 행동을 동시에 숨겨서 고르는
    // 이상 그 턴 안에는 아무도 남의 숫자를 보고 고를 수 없다. 속일
    // 수 있는 유일한 순간은 다음 자유 시간 — 사람들이 방을 훑어보고
    // 다음 행동을 정하는 그때다. 거기까지 끌고 간다.
    disguisedUntil: no + 1,
    disguised: out.disguised,
  })

  await batch.commit()
  await refreshViews(gameId)
  return { no, captured: out.log.filter((l) => l.kind === 'captured').length, lines: out.log.length }
})

// ── 자유 시간의 걸음 ────────────────────────────────────────────

/**
 * 자유 시간에 옆방으로 걸어간다. **즉시 간다.**
 *
 * 전선은 여기서 움직이지 않는다 — postTile 은 그대로 두고 지금 자리만
 * 옮긴다. 정원은 여기서도 지킨다. 열넷이 좁은 방 하나에 들어가면
 * 페이즈가 열릴 때 돌려보낼 자리가 엉킨다.
 */
export const roamTo = onCall<{ gameId: string; tileId: TileId }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, tileId } = req.data
  if (!TILE_BY_ID[tileId]) throw new HttpsError('invalid-argument', '그런 방은 없다.')
  const { game } = await freshNow(gameId)
  if (game.phaseNow?.open) throw new HttpsError('failed-precondition', '페이즈 중에는 함부로 못 움직인다.')

  const ref = gameRef(gameId)
  await db.runTransaction(async (tx) => {
    const [mine, pawns, bots] = await Promise.all([
      tx.get(ref.collection('pawns').doc(uid)),
      tx.get(ref.collection('pawns')),
      tx.get(robotsOf(gameId)),
    ])
    if (!mine.exists) throw new HttpsError('permission-denied', '이 판에 없는 사람이다.')
    const p = mine.data() as PawnDoc
    if (p.tileId === tileId) throw new HttpsError('failed-precondition', '이미 그 방이다.')

    const here = (p.tileId ?? p.postTile) as TileId
    if (!ADJACENCY[here]?.includes(tileId)) throw new HttpsError('failed-precondition', '옆방이 아니다.')

    const seats =
      pawns.docs.filter((d) => d.id !== uid && (d.data() as PawnDoc).tileId === tileId).length +
      bots.docs.filter((d) => (d.data() as Robot).tileId === tileId).length
    if (seats + 1 > capacityOf(tileId)) {
      throw new HttpsError('failed-precondition', `${TILE_BY_ID[tileId].name}이(가) 꽉 찼다.`)
    }
    // postTile 은 건드리지 않는다. 자유 시간은 전선을 옮기지 못한다
    tx.update(mine.ref, { tileId, fromTile: here, arriveAtMs: null, path: [] })
  })
  await refreshViews(gameId)
  return { tileId }
})

/** 주장을 정한다. 세 명뿐인 팀에만 있다. */
export function captainOf(team: TeamId, seatIndex: number): boolean {
  return SHORT_HANDED_TEAMS.includes(team) && seatIndex === 0
}
