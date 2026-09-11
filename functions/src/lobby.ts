// 판 만들기 · 참가 · 시작.
//
// 역할은 **시작할 때 서버가 나눠 secret에만 적는다.** 로비에는 누가
// 어느 팀인지까지만 있다 — 팀은 원래 공개라 숨길 것이 없고, 역할은
// 어떤 경로로도 남에게 내려가지 않는다.
//
// 같은 명단·같은 씨앗이면 역할이 늘 같다. 판을 다시 열어도 바뀌지
// 않도록 씨앗을 판 문서에 적어 둔다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

import { assignRoles, type Player } from '../../shared/missions/assign'
import { BASE_OF, TILES, startingTiles, type TileId } from '../../shared/rules/board'
import { FRAGMENT_BY_DAY } from './story/fragments'
import { initialTokenState } from '../../shared/rules/tokens'
import { CORE_OPENING, ROLE_TITLES, STARTING_RESOURCES, TEAM_SIZES, type TeamId } from '../../shared/rules/v2'
import { TEAMS, TOTAL_SEATS, canStart, openTeams, timedEvents } from '../../shared/rules/lobby'
import { SCHEDULE_ORD, type GameDoc, type ScheduleDoc, type SeatEntry } from '../../shared/model'
import { gameRef, nowOf, requireUid } from './index'
import { refreshViews } from './views'

const db = getFirestore()

/** 운영자만. 확인은 서버에서 한다 — 화면이 하는 말을 믿지 않는다. */
function requireHost(auth: { uid?: string; token?: Record<string, unknown> } | undefined): string {
  const uid = requireUid(auth)
  if (auth?.token?.admin !== true) throw new HttpsError('permission-denied', '운영자만 할 수 있다.')
  return uid
}

// ── 판 만들기 ───────────────────────────────────────────────────

export const createGame = onCall<{ gameId: string; seed?: string }>(async (req) => {
  requireHost(req.auth)
  const { gameId } = req.data
  if (!/^[A-Za-z0-9_-]{3,40}$/.test(gameId ?? '')) {
    throw new HttpsError('invalid-argument', '판 이름이 이상하다.')
  }
  const ref = gameRef(gameId)
  if ((await ref.get()).exists) throw new HttpsError('already-exists', '같은 이름의 판이 있다.')

  const game: GameDoc = {
    phase: 'lobby',
    seed: req.data.seed ?? `${gameId}-${Date.now()}`,
    seats: [],
    startedAtMs: null,
    clock: { anchorRealMs: 0, anchorGameMs: 0, speed: 1 },
    caughtUpToMs: 0,
    day: 0,
    openedTiles: [],
    boostedTiles: [],
    spotlightTeams: [],
    comebackTeams: [],
    lastHours: false,
    invisibleId: null,
    invisibleByDay: {},
    snow: { level: 5, stopped: false },
  }
  await ref.set(game)
  return { gameId, seats: 0, need: TOTAL_SEATS }
})

// ── 참가 ────────────────────────────────────────────────────────

/**
 * 자리에 앉는다. 팀을 고르지 않으면 적게 찬 팀으로 간다.
 *
 * 판이 시작된 뒤에는 앉지도 일어나지도 못한다. 닷새를 함께 사는
 * 판이라 중간에 사람이 바뀌면 인연 고리가 끊긴다.
 */
export const joinGame = onCall<{ gameId: string; name: string; team?: TeamId }>(async (req) => {
  const uid = requireUid(req.auth)
  const name = (req.data.name ?? '').trim()
  if (name.length === 0 || name.length > 12) {
    throw new HttpsError('invalid-argument', '이름은 1~12자다.')
  }

  return db.runTransaction(async (tx) => {
    const ref = gameRef(req.data.gameId)
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
    const game = snap.data() as GameDoc
    if (game.phase !== 'lobby') throw new HttpsError('failed-precondition', '이미 시작한 판이다.')

    const seats = [...game.seats]
    const mine = seats.findIndex((s) => s.playerId === uid)
    const wanted = req.data.team
    if (wanted && !TEAMS.includes(wanted)) throw new HttpsError('invalid-argument', '그런 팀은 없다.')

    // 이미 앉아 있으면 이름·팀만 고친다
    const others = seats.filter((s) => s.playerId !== uid)
    const team = wanted ?? (mine >= 0 ? seats[mine].team : openTeams(others)[0])
    if (!team) throw new HttpsError('resource-exhausted', '자리가 없다.')
    if (others.filter((s) => s.team === team).length >= TEAM_SIZES[team]) {
      throw new HttpsError('resource-exhausted', `${team}팀은 다 찼다.`)
    }

    const seat: SeatEntry = { playerId: uid, name, team }
    if (mine >= 0) seats[mine] = seat
    else seats.push(seat)

    tx.update(ref, { seats })
    return { seat, seated: seats.length, need: TOTAL_SEATS }
  })
})

/** 로비에서 일어난다. 시작한 뒤에는 못 한다. */
export const leaveGame = onCall<{ gameId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  return db.runTransaction(async (tx) => {
    const ref = gameRef(req.data.gameId)
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
    const game = snap.data() as GameDoc
    if (game.phase !== 'lobby') throw new HttpsError('failed-precondition', '이미 시작한 판이다.')
    const seats = game.seats.filter((s) => s.playerId !== uid)
    tx.update(ref, { seats })
    return { seated: seats.length, need: TOTAL_SEATS }
  })
})

// ── 시작 ────────────────────────────────────────────────────────

/**
 * 판을 시작한다.
 *
 * 여기서 역할을 나누고 말·팀·칸을 놓는다. 역할은 secret/roster에만
 * 적고, 각자에게는 views에 자기 한 줄만 간다(3단계).
 */
export const startGame = onCall<{ gameId: string; startAtMs?: number }>(async (req) => {
  requireHost(req.auth)
  const ref = gameRef(req.data.gameId)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  const game = snap.data() as GameDoc
  if (game.phase !== 'lobby') throw new HttpsError('failed-precondition', '이미 시작한 판이다.')

  const seats = game.seats
  const ready = canStart(seats)
  if (!ready.ok) throw new HttpsError('failed-precondition', ready.reason as string)

  const players: Player[] = seats.map((s) => ({ id: s.playerId, team: s.team }))
  let roles
  try {
    roles = assignRoles(players, game.seed)
  } catch (e) {
    throw new HttpsError('failed-precondition', `역할을 나누지 못했다: ${(e as Error).message}`)
  }

  const startedAtMs = req.data.startAtMs ?? nowOf(game)
  const batch = db.batch()

  // 역할과 인연. **여기 말고 어디에도 적지 않는다**
  for (const a of roles) {
    batch.set(ref.collection('secret').doc('roster').collection('items').doc(a.playerId), {
      playerId: a.playerId,
      team: a.team,
      roleId: a.roleId,
      bondId: a.bondId,
      reveal: null,
    })
  }

  // 팀 — 자원과 순위는 공개다. 토큰 충전 상태만 secret으로 간다
  for (const team of TEAMS) {
    const members = seats.filter((s) => s.team === team)
    const tokens = initialTokenState(startedAtMs)
    batch.set(ref.collection('secret').doc('tokens').collection('items').doc(team), tokens)
    batch.set(ref.collection('teams').doc(team), {
      resources: { ...STARTING_RESOURCES },
      tokens: tokens.tokens,
      researchTier: 0,
      handCount: 0,
      // 3인 팀만 주장을 둔다. 4인 팀은 직책 넷이 다 찬다
      captainId: members.length < 4 ? members[0].playerId : null,
      publicScore: null,
      allyTeam: null,
    })
  }

  // 칸 — 기지와 1구역 두 칸을 쥐고 시작한다
  for (const tile of TILES) {
    const owner = TEAMS.find((t) => startingTiles(t).includes(tile.id)) ?? null
    batch.set(ref.collection('tiles').doc(tile.id), { ownerTeam: owner, buildings: [] })
  }

  // 말은 모두 기지에 서 있다. 직책은 팀 안에서 순서대로
  for (const team of TEAMS) {
    const members = seats.filter((s) => s.team === team)
    members.forEach((s, i) => {
      batch.set(ref.collection('pawns').doc(s.playerId), {
        playerId: s.playerId,
        team,
        title: ROLE_TITLES[i % ROLE_TITLES.length],
        tileId: BASE_OF[team] as TileId,
        fromTile: null,
        path: [],
        arriveAtMs: null,
        asleep: false,
        tokensUsedToday: 0,
        votedToday: false,
        peeksToday: 0,
      })
    })
  }

  // 정시 이벤트를 닷새치 깔아 둔다. 따라잡기가 이걸 밀고 간다(2단계)
  for (const e of timedEvents(startedAtMs)) {
    const item: ScheduleDoc = {
      dueAtMs: e.dueAtMs,
      ord: SCHEDULE_ORD[e.kind],
      kind: e.kind,
      payload: { day: e.day },
      doneAtMs: null,
    }
    batch.set(ref.collection('schedule').doc(), item)
  }

  batch.set(ref.collection('events').doc(), {
    atMs: startedAtMs,
    day: 1,
    kind: 'gameStart',
    detail: { seats: seats.length },
  })

  // DAY 1의 08:00은 시작 그 자체라 예정 이벤트가 없다. 그래서 첫날
  // 열리는 핵심 칸과 가치가 오르는 칸을 여기서 직접 놓는다 —
  // 따라잡기에 맡겨 두면 첫날 운동장과 방송실이 영영 안 열린다
  batch.update(ref, {
    phase: 'running',
    startedAtMs,
    caughtUpToMs: startedAtMs,
    day: 1,
    openedTiles: [...(CORE_OPENING[1] ?? [])],
    boostedTiles: FRAGMENT_BY_DAY[1] ? [FRAGMENT_BY_DAY[1].spotTile] : [],
    startedRealMs: FieldValue.serverTimestamp(),
  })

  await batch.commit()

  // 모두 기지에 선 것으로 체류 기록을 연다. 깨달음이 이걸로 센다
  const iv = db.batch()
  for (const s of seats) {
    iv.set(ref.collection('secret').doc('intervals').collection('items').doc(), {
      playerId: s.playerId,
      tileId: BASE_OF[s.team] as TileId,
      startMs: startedAtMs,
      endMs: null,
      state: 'standing',
    })
  }
  await iv.commit()

  // 시작하자마자 각자 몫을 깎아 둔다. 첫 화면이 빈 view를 보면
  // 「아직 안 시작했나」로 보인다
  await refreshViews(req.data.gameId)
  return { startedAtMs, players: seats.length }
})
