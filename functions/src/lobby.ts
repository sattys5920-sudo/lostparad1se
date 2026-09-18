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
import { DEAL_TOKENS_PER_DAY, grantFor, isShortHanded } from '../../shared/rules/occupy'
import { START_TILE, TILES, startingTiles } from '../../shared/rules/board'
import { FRAGMENT_BY_DAY } from './story/fragments'
import { CORE_OPENING, ROLE_TITLES, STARTING_RESOURCES, STARTING_TEAM_SIZES, type TeamId } from '../../shared/rules/v2'
import { TEAMS, TOTAL_SEATS, canStart, openTeams, timedEvents } from '../../shared/rules/lobby'
import { SCHEDULE_ORD, type GameDoc, type ScheduleDoc, type SeatEntry } from '../../shared/model'
import { lookOfAccount, looksByUid } from './account'
import { gameRef, nowOf, requireUid } from './index'
import { refreshViews } from './views'

const db = getFirestore()

/** 운영자만. 확인은 서버에서 한다 — 화면이 하는 말을 믿지 않는다. */
function requireHost(auth: { uid?: string; token?: Record<string, unknown> } | undefined): string {
  const uid = requireUid(auth)
  if (auth?.token?.admin !== true) throw new HttpsError('permission-denied', '운영자만 할 수 있다.')
  return uid
}

/**
 * 팀은 고르는 것이 아니라 **받는 것**이다.
 *
 * 빈 팀 중 첫 번째를 주면 A가 찰 때까지 A만 준다. 같이 들어온 친구들이
 * 한 팀에 몰리고, 그러면 팀 사이의 거래도 의심도 처음부터 김이 빠진다.
 *
 * 씨앗에 사람을 섞어 고른다. 같은 사람이 다시 들어와도 같은 팀이다 —
 * 새로고침할 때마다 팀이 바뀌면 그게 더 이상하다.
 */
function randomOpenTeam(others: readonly SeatEntry[], seed: string): TeamId | undefined {
  const open = openTeams(others)
  if (open.length === 0) return undefined
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return open[Math.abs(h) % open.length]
}

// ── 판 만들기 ───────────────────────────────────────────────────

/**
 * 아직 아무 일도 없었던 판 하나.
 *
 * 만들 때와 되돌릴 때가 같은 모양이어야 한다. 두 군데서 따로 적으면
 * 언젠가 한쪽에만 칸이 늘고, 되돌린 판에서만 없는 값이 생긴다.
 */
function freshLobby(seed: string, seats: readonly SeatEntry[]): GameDoc {
  return {
    phase: 'lobby',
    seed,
    seats: [...seats],
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
}

export const createGame = onCall<{ gameId: string; seed?: string }>(async (req) => {
  requireHost(req.auth)
  const { gameId } = req.data
  if (!/^[A-Za-z0-9_-]{3,40}$/.test(gameId ?? '')) {
    throw new HttpsError('invalid-argument', '판 이름이 이상하다.')
  }
  const ref = gameRef(gameId)
  if ((await ref.get()).exists) throw new HttpsError('already-exists', '같은 이름의 판이 있다.')

  await ref.set(freshLobby(req.data.seed ?? `${gameId}-${Date.now()}`, []))
  return { gameId, seats: 0, need: TOTAL_SEATS }
})

/**
 * 명단의 얼굴을 계정에서 다시 읽는다.
 *
 * **자리에 앉을 때 한 번 찍어 두는 것만으로는 모자랐다.**
 * 얼굴을 만들기 전에 앉은 사람, 앉고 나서 얼굴을 바꾼 사람, 얼굴이
 * 명단에 적히기 전에 앉은 옛 자리 — 전부 영영 점으로 남았다. 되돌리기는
 * 자리를 그대로 들고 오므로 그 점이 다음 판까지 따라온다.
 *
 * 계정에 얼굴이 없으면 명단에 있던 것을 그대로 둔다. 지우는 쪽이 아니라
 * 채우는 쪽이다 — QA 로 앉힌 자리를 빈 얼굴로 덮어쓰면 안 된다.
 */
async function freshFaces(seats: readonly SeatEntry[]): Promise<SeatEntry[]> {
  const found = await looksByUid(seats.map((s) => s.playerId))
  return seats.map((s) => ({ ...s, look: found[s.playerId] ?? s.look ?? null }))
}

/**
 * 명단의 얼굴만 다시 읽어 적는다. 운영자만.
 *
 * 돌고 있는 판을 되돌리지 않고 고칠 수 있어야 한다 — 얼굴 하나 때문에
 * 닷새치를 지우는 것은 말이 안 된다.
 */
export const refreshFaces = onCall<{ gameId: string }>(async (req) => {
  requireHost(req.auth)
  const ref = gameRef(req.data.gameId)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  const game = snap.data() as GameDoc
  const seats = await freshFaces(game.seats ?? [])
  await ref.update({ seats })
  return { seats: seats.length, faces: seats.filter((s) => s.look).length }
})

// ── 되돌리기 ────────────────────────────────────────────────────

/**
 * **판을 첫날로 되돌린다. 자리는 그대로 둔다.**
 *
 * 닷새가 끝나 버린 판에서 다시 하려면 판을 새로 만들고 열넷이 다시
 * 들어와 앉아야 했다. 같은 사람들이 같은 이름으로 다시 앉는 일이라
 * 아무 뜻이 없다 — 앉은 것은 남기고 나머지를 쓸어 낸다.
 *
 * 하위 컬렉션을 손으로 세지 않는다. 이름을 적어 두면 나중에 하나가
 * 늘었을 때 그것만 살아남아 다음 판을 조용히 더럽힌다. 문서 아래를
 * 통째로 지운다.
 *
 * 되돌린 뒤에는 로비다. 「닷새 시작」을 다시 눌러야 돈다 — 지우는
 * 것과 시작하는 것을 한 번에 하면, 잘못 눌렀을 때 되돌릴 틈이 없다.
 */
export const resetGame = onCall<{ gameId: string }>(async (req) => {
  requireHost(req.auth)
  const ref = gameRef(req.data.gameId)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  const game = snap.data() as GameDoc

  // 자리는 들고 있는다. 지우고 나서 그대로 다시 앉힌다
  // 얼굴은 여기서 다시 읽는다. 옛 자리의 빈 얼굴을 그대로 들고 오면
  // 새 판에서도 그 사람만 점으로 남는다
  const seats = await freshFaces(game.seats ?? [])
  await db.recursiveDelete(ref)
  await ref.set(freshLobby(`${req.data.gameId}-${Date.now()}`, seats))
  return { seats: seats.length, need: TOTAL_SEATS }
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

  // 트랜잭션 밖에서 읽는다. 계정은 판과 무관해서 같이 묶을 것이 없다
  const look = await lookOfAccount(req.auth?.token?.accountId as string | undefined)

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
    const team = wanted ?? (mine >= 0 ? seats[mine].team : randomOpenTeam(others, game.seed + uid))
    if (!team) throw new HttpsError('resource-exhausted', '자리가 없다.')
    if (others.filter((s) => s.team === team).length >= STARTING_TEAM_SIZES[team]) {
      throw new HttpsError('resource-exhausted', `${team}팀은 다 찼다.`)
    }

    const seat: SeatEntry = { playerId: uid, name, team, look }
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

  // **시작할 때 얼굴을 다시 읽는다.** 앉을 때 찍어 둔 것만 믿으면,
  // 앉고 나서 얼굴을 만든 사람은 닷새 내내 점으로 남는다
  const seats = await freshFaces(game.seats)
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

  // 팀 — 자원과 순위는 공개다.
  // **주장은 판 문서에도 적는다** — 팀 문서는 제 팀 것만 읽을 수 있는데,
  // 팀장은 투명인간 투표에서 못 적는 사람이라 모두가 미리 알아야 한다
  const captains: Partial<Record<TeamId, string | null>> = {}
  for (const team of TEAMS) {
    const members = seats.filter((s) => s.team === team)
    captains[team] = members.length < 4 ? (members[0]?.playerId ?? null) : null
    batch.set(ref.collection('teams').doc(team), {
      resources: { ...STARTING_RESOURCES },
      // 페이즈 상자. **첫 페이즈가 열리기 전에도 거래는 한다** —
      // 빈손으로 시작하면 첫날 아침에는 아무도 아무것도 못 건넨다
      phaseTokens: grantFor(members.length) * members.length,
      pendingRefund: 0,
      researchTier: 0,
      handCount: 0,
      // 3인 팀만 주장을 둔다. 4인 팀은 직책 넷이 다 찬다
      captainId: members.length < 4 ? members[0].playerId : null,
      publicScore: null,
    })
  }

  // 칸 — 기지와 1구역 두 칸을 쥐고 시작한다
  for (const tile of TILES) {
    const owner = TEAMS.find((t) => startingTiles(t).includes(tile.id)) ?? null
    batch.set(ref.collection('tiles').doc(tile.id), { ownerTeam: owner })
  }

  // 말은 모두 2-3 교실에 서 있다. 직책은 팀 안에서 순서대로
  for (const team of TEAMS) {
    const members = seats.filter((s) => s.team === team)
    members.forEach((s, i) => {
      batch.set(ref.collection('pawns').doc(s.playerId), {
        playerId: s.playerId,
        team,
        title: ROLE_TITLES[i % ROLE_TITLES.length],
        tileId: START_TILE,
        // 전투 자리. 처음에는 서 있는 자리와 같다
        postTile: START_TILE,
        // 세 명뿐인 팀의 첫 사람이 주장이다. 점령 판정에서 둘로 센다 —
        // 네 명인 팀과 머릿수를 맞추는 유일한 장치다
        captain: isShortHanded(members.length) && i === 0,
        // 처음부터 이 팀이었다. 오늘 오간 무전은 다 내 것이다
        teamSinceMs: startedAtMs,
        // 2-3 교실은 이미 가 본 곳이다. 지도는 여기서부터 채워진다
        visitedTiles: [START_TILE],
        fromTile: null,
        path: [],
        arriveAtMs: null,
        asleep: false,
        tokensUsedToday: 0,
        // 거래를 거는 개인 토큰. 자정에 다시 찬다
        dealTokens: DEAL_TOKENS_PER_DAY,
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

  // DAY 1의 시작 시각은 시작 그 자체라 예정 이벤트가 없다. 그래서 첫날
  // 열리는 핵심 칸과 가치가 오르는 칸을 여기서 직접 놓는다 —
  // 따라잡기에 맡겨 두면 첫날 운동장과 방송실이 영영 안 열린다
  batch.update(ref, {
    phase: 'running',
    // 다시 읽은 얼굴을 명단에 박아 둔다. 판이 도는 동안은 이것이 정본이다
    seats,
    startedAtMs,
    caughtUpToMs: startedAtMs,
    day: 1,
    openedTiles: [...(CORE_OPENING[1] ?? [])],
    boostedTiles: FRAGMENT_BY_DAY[1] ? [FRAGMENT_BY_DAY[1].spotTile] : [],
    startedRealMs: FieldValue.serverTimestamp(),
    captains,
  })

  await batch.commit()

  // 모두 2-3 교실에 선 것으로 체류 기록을 연다. 깨달음이 이걸로 센다
  const iv = db.batch()
  for (const s of seats) {
    iv.set(ref.collection('secret').doc('intervals').collection('items').doc(), {
      playerId: s.playerId,
      tileId: START_TILE,
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
