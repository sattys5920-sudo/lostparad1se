// 페이즈 — 자유 시간과 점령전이 번갈아 온다.
//
// **페이즈는 한 시간짜리 라이브 판이다.** 관리자가 열면 PHASE_MINUTES 만큼
// 흐르고, 그동안 각자 토큰만큼 움직이고 행동한다. 한 시간이 끝나거나
// 관리자가 닫으면, 그 순간 각 방에 서 있는 머릿수로 주인이 정해진다.
//
// **자리가 둘이다.**
//
//   전투 자리(postTile)  직전 페이즈가 끝난 곳. 페이즈가 열리면 여기로 돌아온다.
//   지금 자리(tileId)    실제로 서 있는 곳. 마주침도 점령도 여기서 난다.
//
// 자유 시간에는 마음껏 돌아다닌다 — 대화도 거래도 털어놓기도 표도 지금
// 자리에서 일어난다. 그러나 **아무리 멀리 가도 전선은 움직이지 않는다.**
// 페이즈가 열리면 다들 제자리로 걸어 돌아오고, 그 뒤로 전선을 옮기려면
// 토큰을 써야 한다.
//
// 감출 것은 secret 아래에만 쓴다. 위장한 사람과 방해받은 사람이 판
// 문서에 적혀 있으면 개발자도구로 다 보인다 — **실제로 그랬다.**
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

import {
  ACT_COST,
  PHASES_PER_DAY,
  PHASE_MINUTES,
  TOKENS_PER_PHASE,
  capacityOf,
  doAct,
  settle,
  type Act,
  type ActionKind,
  type PhaseState,
  type Person,
  type Robot,
} from '../../shared/rules/occupy'
import { ADJACENCY, TILE_BY_ID, type TileId } from '../../shared/rules/board'
import { arrivals, planWalk } from '../../shared/rules/movement'
import { SHORT_HANDED_TEAMS, TOTAL_DAYS, type TeamId } from '../../shared/rules/v2'
import type { GameDoc, PawnDoc, TileDoc } from '../../shared/model'
import { freshNow } from './turn'
import { clearArrivals, writeWalk } from './move'
import { openInterval } from './reveal'
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

const robotsOf = (gameId: string) => gameRef(gameId).collection('robots')

/**
 * 이번 페이즈의 감출 것들. **판 문서에 두면 안 된다.**
 *
 * 누가 위장했는지, 누가 방해받았는지가 여기 있다. 판 문서는 누구나
 * 읽을 수 있어서, 거기 적으면 위장이라는 것이 아예 성립하지 않는다.
 */
const hiddenOf = (gameId: string) => gameRef(gameId).collection('secret').doc('phase')

interface HiddenPhase {
  disguised: string[]
  zeroedPeople: string[]
  zeroedRobots: string[]
  pendingResearch: string[]
}

const EMPTY_HIDDEN: HiddenPhase = { disguised: [], zeroedPeople: [], zeroedRobots: [], pendingResearch: [] }

/** 운영자만. 화면이 하는 말을 믿지 않는다. */
function requireHost(auth: { uid?: string; token?: Record<string, unknown> } | undefined): string {
  const uid = requireUid(auth)
  if (auth?.token?.admin !== true) throw new HttpsError('permission-denied', '운영자만 할 수 있다.')
  return uid
}

/** 페이즈가 지금 살아 있는가. 시간이 지났으면 열려 있어도 아무도 못 움직인다. */
function phaseAlive(game: GameDoc, nowMs: number): boolean {
  if (!game.phaseNow?.open) return false
  const ends = game.phaseNow.endsAtMs
  return ends == null || nowMs < ends
}

// ── 지금 판 위의 것들을 모은다 ──────────────────────────────────

function personOf(id: string, p: PawnDoc): Person {
  return {
    playerId: id,
    team: p.team,
    // **지금 서 있는 자리다.** 페이즈 중에는 이것이 곧 전선이다
    tileId: (p.tileId ?? p.postTile ?? `base${p.team}`) as TileId,
    captain: p.captain === true,
    tokens: p.tokens ?? 0,
  }
}

async function loadBoard(gameId: string): Promise<{ state: PhaseState; game: GameDoc }> {
  const ref = gameRef(gameId)
  const [snap, pawns, tiles, bots, hidden] = await Promise.all([
    ref.get(),
    ref.collection('pawns').get(),
    ref.collection('tiles').get(),
    robotsOf(gameId).get(),
    hiddenOf(gameId).get(),
  ])
  const game = snap.data() as GameDoc
  const h = { ...EMPTY_HIDDEN, ...(hidden.data() as Partial<HiddenPhase> | undefined) }

  const people: Person[] = pawns.docs.map((d) => personOf(d.id, d.data() as PawnDoc))
  const robots: Robot[] = bots.docs.map((d) => {
    const r = d.data() as Robot
    return { id: d.id, team: r.team, tileId: r.tileId, carriedBy: r.carriedBy ?? null }
  })
  const owners: Partial<Record<TileId, TeamId | null>> = {}
  for (const d of tiles.docs) owners[d.id as TileId] = (d.data() as TileDoc).ownerTeam ?? null

  return {
    game,
    state: {
      people,
      robots,
      owners,
      pendingResearch: h.pendingResearch,
      zeroedPeople: h.zeroedPeople,
      zeroedRobots: h.zeroedRobots,
      disguised: h.disguised,
    },
  }
}

// ── 관리자: 페이즈 열기 ─────────────────────────────────────────

/**
 * 페이즈를 연다. 모두 **직전 페이즈가 끝난 자리로 돌아온다.**
 *
 * 자유 시간에 어디까지 갔든 상관없다. 그 시간은 사람을 만나라고 있는
 * 것이지 전선을 옮기라고 있는 것이 아니다.
 *
 * **돌아오는 데는 시간이 걸린다.** 멀리 나가 있었으면 그만큼 걸어야
 * 하고, 걷는 동안은 맵에서 사라진다 — 그 시간은 한 시간에서 그냥
 * 깎인다. 자유 시간에 어디까지 나갈지가 그래서 도박이 된다.
 *
 * 토큰은 여기서 준다. 남은 것은 없다 — 아껴 두는 전략이 생기면
 * 「지금 갈 것인가」가 질문이 아니게 된다.
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

  // 걸어서 돌아와야 하는 사람들. 옛 도착 예정을 먼저 걷어낸다 —
  // 자유 시간에 찍어 둔 길이 남아 있으면 돌아오는 길과 엉킨다
  const marching: { ref: FirebaseFirestore.DocumentReference; from: TileId; post: TileId }[] = []
  for (const d of pawns.docs) {
    const p = d.data() as PawnDoc
    const post = (p.postTile ?? p.tileId ?? `base${p.team}`) as TileId
    if (p.tileId !== null && p.tileId !== post) marching.push({ ref: d.ref, from: p.tileId as TileId, post })
  }
  await Promise.all(marching.map((m) => clearArrivals(gameId, m.ref.id)))

  let returned = 0
  let allInAtMs = nowMs
  for (const d of pawns.docs) {
    const p = d.data() as PawnDoc
    const post = (p.postTile ?? p.tileId ?? `base${p.team}`) as TileId
    const march = marching.find((m) => m.ref.id === d.id)
    const purse = { tokens: TOKENS_PER_PHASE }
    if (!march) {
      // 제자리에 있었거나 이미 걷는 중이다. 걷는 중이면 그 걸음이
      // 끝나기를 기다린다 — 여기서 자리를 빼앗으면 도착 예정과 어긋난다
      batch.update(d.ref, {
        postTile: post,
        ...purse,
        ...(p.tileId === post ? { fromTile: null, path: [], arriveAtMs: null } : {}),
      })
      continue
    }
    returned += 1
    const plan = planWalk(d.id, march.from, post, nowMs, 1)
    if (!plan.ok || !plan.walk) {
      // 길이 없다. 억지로 세우느니 그냥 세워 둔다
      batch.update(d.ref, { tileId: post, postTile: post, fromTile: null, path: [], arriveAtMs: null, ...purse })
      continue
    }
    const firstAt = writeWalk(gameId, plan.walk, batch)
    const lastAt = arrivals(plan.walk).slice(-1)[0]?.atMs ?? firstAt
    if (lastAt > allInAtMs) allInAtMs = lastAt
    batch.update(d.ref, {
      tileId: null,
      postTile: post,
      fromTile: march.from,
      path: [...plan.walk.path],
      arriveAtMs: firstAt,
      asleep: false,
      ...purse,
    })
  }

  const no = (game.phaseDone ?? 0) + 1
  const endsAtMs = nowMs + PHASE_MINUTES * 60_000
  batch.update(ref, {
    phaseNow: {
      no,
      day: Math.floor((no - 1) / PHASES_PER_DAY) + 1,
      open: true,
      openedAtMs: nowMs,
      endsAtMs,
    },
  })
  // 지난 페이즈의 위장·방해는 여기서 지운다. 연구 대기는 남긴다 —
  // 이번 페이즈가 닫힐 때 로봇이 될 것들이다
  batch.set(hiddenOf(gameId), { ...EMPTY_HIDDEN, pendingResearch: game.pendingResearch ?? [] })

  await batch.commit()
  // 떠나는 순간 그 방의 체류가 끝난다. 걷는 동안은 어느 방에도 없다 —
  // 안 그러면 떠난 방의 말이 계속 들린다
  await Promise.all(marching.map((m) => openInterval(gameId, m.ref.id, null, nowMs, 'walking')))
  await refreshViews(gameId)
  return { no, returned, endsAtMs, allInAtMs, tokens: TOKENS_PER_PHASE }
})

// ── 각자: 지금 당장 하는 행동 ───────────────────────────────────

/**
 * 행동 하나를 지금 처리한다. 토큰이 줄고 판이 바로 바뀐다.
 *
 * 통째로 트랜잭션 안에서 한다. 좁은 방에 둘이 동시에 들어가려 하면
 * **먼저 들어간 쪽만** 들어가야 하는데, 읽고 쓰는 사이가 벌어지면
 * 둘 다 들어간다. 판이 스물다섯 칸에 열넷뿐이라 통째로 읽어도 싸다.
 */
export const phaseAct = onCall<{
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
  if (!phaseAlive(game, nowMs)) throw new HttpsError('failed-precondition', '이 페이즈는 시간이 끝났다.')

  const ref = gameRef(gameId)
  const act: Act = {
    kind,
    ...(req.data.targetTile ? { targetTile: req.data.targetTile } : {}),
    ...(req.data.targetPlayer ? { targetPlayer: req.data.targetPlayer } : {}),
    ...(req.data.targetRobot ? { targetRobot: req.data.targetRobot } : {}),
  }

  let moved: TileId | null = null
  let left = 0
  await db.runTransaction(async (tx) => {
    const [pawns, bots, tiles, hidden] = await Promise.all([
      tx.get(ref.collection('pawns')),
      tx.get(robotsOf(gameId)),
      tx.get(ref.collection('tiles')),
      tx.get(hiddenOf(gameId)),
    ])
    const h = { ...EMPTY_HIDDEN, ...(hidden.data() as Partial<HiddenPhase> | undefined) }
    const before: PhaseState = {
      people: pawns.docs.map((d) => personOf(d.id, d.data() as PawnDoc)),
      robots: bots.docs.map((d) => {
        const r = d.data() as Robot
        return { id: d.id, team: r.team, tileId: r.tileId, carriedBy: r.carriedBy ?? null }
      }),
      owners: Object.fromEntries(tiles.docs.map((d) => [d.id, (d.data() as TileDoc).ownerTeam ?? null])),
      pendingResearch: h.pendingResearch,
      zeroedPeople: h.zeroedPeople,
      zeroedRobots: h.zeroedRobots,
      disguised: h.disguised,
    }

    const out = doAct(before, uid, act)
    if (!out.ok) throw new HttpsError('failed-precondition', out.why)

    // 사람 — 바뀐 것만 쓴다
    const wasAt = new Map(before.people.map((p) => [p.playerId, p]))
    for (const p of out.next.people) {
      const was = wasAt.get(p.playerId) as Person
      if (was.tileId === p.tileId && was.tokens === p.tokens) continue
      const doc = pawns.docs.find((d) => d.id === p.playerId)
      if (!doc) continue
      const been = new Set((doc.data() as PawnDoc).visitedTiles ?? [])
      been.add(p.tileId)
      tx.update(doc.ref, {
        tileId: p.tileId,
        tokens: p.tokens,
        ...(was.tileId === p.tileId ? {} : { fromTile: was.tileId, visitedTiles: [...been] }),
      })
      if (p.playerId === uid) {
        left = p.tokens
        if (was.tileId !== p.tileId) moved = p.tileId
      }
    }

    // 로봇 — 통째로 다시 쓴다. 열몇 기뿐이라 견줄 이유가 없다
    const now = new Set(out.next.robots.map((r) => r.id))
    for (const d of bots.docs) if (!now.has(d.id)) tx.delete(d.ref)
    for (const r of out.next.robots) tx.set(robotsOf(gameId).doc(r.id), { ...r })

    tx.set(hiddenOf(gameId), {
      disguised: out.next.disguised,
      zeroedPeople: out.next.zeroedPeople,
      zeroedRobots: out.next.zeroedRobots,
      pendingResearch: out.next.pendingResearch,
    })
  })

  // 방을 옮겼으면 앞 방의 체류가 끝나고 이 방의 체류가 시작된다.
  // 채팅이 방을 따라가는 것이 여기에 걸려 있다
  if (moved) await openInterval(gameId, uid, moved, nowMs)
  await refreshViews(gameId)
  return { kind, tokens: left, tileId: moved }
})

/** 페이즈가 지금 어떤지. **무엇을 했는지는 안 나간다.** */
export const phaseNow = onCall<{ gameId: string }>(async (req) => {
  requireUid(req.auth)
  const { game, nowMs } = await freshNow(req.data.gameId)
  const p = game.phaseNow
  return {
    open: p?.open === true,
    alive: phaseAlive(game, nowMs),
    no: p?.no ?? 0,
    day: p?.day ?? 0,
    endsAtMs: p?.endsAtMs ?? null,
    msLeft: p?.endsAtMs ? Math.max(0, p.endsAtMs - nowMs) : null,
  }
})

// ── 관리자: 페이즈 닫기 ─────────────────────────────────────────

/**
 * 페이즈를 닫는다. **서 있는 자리로 주인을 정한다.**
 *
 * 행동은 이미 그때그때 처리됐다. 여기서 하는 일은 머릿수를 세는 것과,
 * 지난 페이즈에 걸어 둔 연구를 로봇으로 만드는 것뿐이다.
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
  const out = settle(state)
  const ref = gameRef(gameId)
  const batch = db.batch()

  // 전투 자리를 지금 자리로 옮긴다. 다음 자유 시간에 아무리 멀리 가도
  // 다음 페이즈에는 여기로 돌아온다
  for (const p of out.next.people) {
    batch.update(ref.collection('pawns').doc(p.playerId), { postTile: p.tileId, tileId: p.tileId, tokens: 0 })
  }
  const had = await robotsOf(gameId).get()
  for (const d of had.docs) batch.delete(d.ref)
  for (const r of out.next.robots) batch.set(robotsOf(gameId).doc(r.id), { ...r })

  for (const [tileId, team] of Object.entries(out.next.owners)) {
    if ((state.owners[tileId as TileId] ?? null) !== (team ?? null)) {
      batch.update(ref.collection('tiles').doc(tileId), { ownerTeam: team ?? null })
    }
  }

  const no = game.phaseNow.no
  batch.set(ref.collection('phaseLog').doc(String(no)), {
    no,
    day: game.phaseNow.day,
    atMs: nowMs,
    // 페이즈 중에는 누가 무엇을 했는지 안 보인다. 닫힐 때 한꺼번에 나온다 —
    // 점령전의 결과는 숨길 것이 아니라 다음 페이즈를 위한 재료다
    lines: out.log,
  })
  batch.update(ref, {
    phaseNow: {
      no,
      day: game.phaseNow.day,
      open: false,
      openedAtMs: game.phaseNow.openedAtMs,
      endsAtMs: game.phaseNow.endsAtMs ?? null,
    },
    phaseDone: no,
    pendingResearch: out.next.pendingResearch,
  })
  // 위장도 방해도 페이즈와 함께 끝난다. **남겨 두면 나중에 다 들통난다**
  batch.set(hiddenOf(gameId), EMPTY_HIDDEN)

  await batch.commit()
  await refreshViews(gameId)
  return { no, captured: out.log.filter((l) => l.kind === 'captured').length, lines: out.log.length }
})

// ── 자유 시간의 걸음 ────────────────────────────────────────────

/**
 * 자유 시간에 옆방으로 걸어간다. **즉시 가고 토큰도 안 든다.**
 *
 * 전선은 여기서 움직이지 않는다 — postTile 은 그대로 두고 지금 자리만
 * 옮긴다. 정원은 여기서도 지킨다. 열넷이 좁은 방 하나에 들어가면
 * 페이즈가 열릴 때 돌려보낼 자리가 엉킨다.
 */
export const roamTo = onCall<{ gameId: string; tileId: TileId }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, tileId } = req.data
  if (!TILE_BY_ID[tileId]) throw new HttpsError('invalid-argument', '그런 방은 없다.')
  const { game, nowMs } = await freshNow(gameId)
  if (game.phaseNow?.open) throw new HttpsError('failed-precondition', '페이즈 중에는 토큰을 써서 움직인다.')

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
    // postTile 은 건드리지 않는다. 자유 시간은 전선을 옮기지 못한다.
    // 다만 **발은 들였으니** 지도에는 남는다
    const been = new Set(p.visitedTiles ?? [])
    been.add(tileId)
    tx.update(mine.ref, { tileId, fromTile: here, arriveAtMs: null, path: [], visitedTiles: [...been] })
  })
  // 방을 옮긴 순간 앞 방의 체류가 끝나고 이 방의 체류가 시작된다.
  // 이것이 없으면 옮겨 다녀도 채팅은 처음 방에 머문다 — 늦게 들어온
  // 방의 지난 말까지 읽히거나, 떠난 방의 말이 계속 들린다
  await openInterval(gameId, uid, tileId, nowMs)
  await refreshViews(gameId)
  return { tileId }
})

/** 주장을 정한다. 세 명뿐인 팀에만 있다. */
export function captainOf(team: TeamId, seatIndex: number): boolean {
  return SHORT_HANDED_TEAMS.includes(team) && seatIndex === 0
}

export { ACT_COST, TOKENS_PER_PHASE }
