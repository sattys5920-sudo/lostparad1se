// 판 만들기 · 참가 · 시작.
//
// 역할은 **열넷이 차는 순간 서버가 나눠 secret에만 적는다.** 전에는
// 운영자가 시작을 눌러야 나눠졌는데, 그러면 자리가 다 찬 뒤로 아무도
// 자기가 누구인지 모르는 시간이 생겼다.
//
// 공개 범위는 둘로 갈린다.
//   팀      games/{id}.seats 에 있고 로그인한 모두가 읽는다. **전체 공개**
//   역할·인연·숨긴 사실·개인 미션
//           secret/roster 에만 있고 규칙이 클라이언트를 통째로 막는다
//           (firestore.rules). 본인조차 myPaper 를 거쳐야 본다. **개인 공개**
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
import { TEAMS, TOTAL_SEATS, canStart, mayPickTeam, openTeams, timedEvents } from '../../shared/rules/lobby'
import { SCHEDULE_ORD, type GameDoc, type ScheduleDoc, type SeatEntry } from '../../shared/model'
import { lookOfAccount, looksByUid } from './account'
import { gameRef, nowOf, requireUid } from './index'
import { refreshViews } from './views'
import { requireHost } from './host'

const db = getFirestore()

/** 운영자만. 확인은 서버에서 한다 — 화면이 하는 말을 믿지 않는다. */

/**
 * 팀은 고르는 것이 아니라 **받는 것**이다.
 *
 * 빈 팀 중 첫 번째를 주면 A가 찰 때까지 A만 준다. 같이 들어온 친구들이
 * 한 팀에 몰리고, 그러면 팀 사이의 거래도 의심도 처음부터 김이 빠진다.
 *
 * 씨앗에 사람을 섞어 고른다. 같은 사람이 다시 들어와도 같은 팀이다 —
 * 새로고침할 때마다 팀이 바뀌면 그게 더 이상하다.
 */
const rosterOf = (gameId: string) =>
  gameRef(gameId).collection('secret').doc('roster').collection('items')

/** 자리가 바뀔 때마다 부른다. 읽기가 있으니 **트랜잭션의 쓰기보다 먼저** 부른다. */
export const readRoster = (
  tx: FirebaseFirestore.Transaction,
  gameId: string,
): Promise<FirebaseFirestore.QuerySnapshot> => tx.get(rosterOf(gameId))

/**
 * 자리가 열넷이면 역할을 나누고, 아니면 나눠 둔 것을 지운다.
 *
 * **자리가 바뀌면 다시 나눈다.** 역할은 팀 구성에 매여 있어서(팀의 길
 * 하나 · 밖의 길 하나), 한 사람이 팀을 옮기면 남은 열셋의 배정도 같이
 * 틀어진다. 한 명이 나갔다가 다른 사람이 들어온 판에서 옛 배정을 그냥
 * 두면 그때부터 규칙이 안 맞는다.
 *
 * assignRoles 는 (명단·씨앗)에 대해 늘 같은 답을 낸다. 그래서 이미
 * 적힌 것이 지금 나올 답과 같으면 **한 줄도 안 건드린다** — 이름만
 * 고치러 다시 들어온 사람 때문에 열넷의 역할 문서가 매번 새로 쓰이면,
 * 그 쓰기 하나하나가 「배정이 바뀌었다」는 신호로 보인다.
 */
export function settleRoster(
  tx: FirebaseFirestore.Transaction,
  gameId: string,
  had: FirebaseFirestore.QuerySnapshot,
  seats: readonly SeatEntry[],
  seed: string,
): void {
  const col = rosterOf(gameId)
  if (seats.length !== TOTAL_SEATS) {
    for (const d of had.docs) tx.delete(d.ref)
    return
  }
  const players: Player[] = seats.map((s) => ({ id: s.playerId, team: s.team }))
  let dealt
  try {
    dealt = assignRoles(players, seed)
  } catch {
    // 나눌 수 없는 명단이면(팀 정원이 안 맞는 등) 옛것을 지우고 만다.
    // 시작할 때 canStart 가 같은 이유로 막아 세운다
    for (const d of had.docs) tx.delete(d.ref)
    return
  }

  const same =
    had.size === dealt.length &&
    dealt.every((a) => {
      const was = had.docs.find((d) => d.id === a.playerId)?.data() as RosterRow | undefined
      return was?.team === a.team && was?.roleId === a.roleId && was?.bondId === a.bondId
    })
  if (same) return

  for (const d of had.docs) tx.delete(d.ref)
  for (const a of dealt) {
    tx.set(col.doc(a.playerId), {
      playerId: a.playerId,
      team: a.team,
      roleId: a.roleId,
      bondId: a.bondId,
      reveal: null,
    })
  }
}

interface RosterRow {
  team: TeamId
  roleId: string
  bondId: string
}

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

  // 팀을 찍을 수 있는 사람은 규칙이 정한다(shared/rules/lobby.ts).
  // 진짜 서버에서는 운영자뿐이다
  const canPick = mayPickTeam({
    host: req.auth?.token?.admin === true,
    emulator: process.env.FUNCTIONS_EMULATOR === 'true',
  })

  return db.runTransaction(async (tx) => {
    const ref = gameRef(req.data.gameId)
    // **읽기가 먼저다.** 트랜잭션은 쓰기 뒤에 읽을 수 없다
    const [snap, hadRoster] = await Promise.all([tx.get(ref), readRoster(tx, req.data.gameId)])
    if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
    const game = snap.data() as GameDoc
    if (game.phase !== 'lobby') throw new HttpsError('failed-precondition', '이미 시작한 판이다.')

    const seats = [...game.seats]
    const mine = seats.findIndex((s) => s.playerId === uid)
    const wanted = canPick ? req.data.team : undefined
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
    // 열넷째가 앉는 순간 역할이 나뉜다. 시작을 기다리지 않는다
    settleRoster(tx, req.data.gameId, hadRoster, seats, game.seed)
    return { seat, seated: seats.length, need: TOTAL_SEATS, dealt: seats.length === TOTAL_SEATS }
  })
})

/** 로비에서 일어난다. 시작한 뒤에는 못 한다. */
export const leaveGame = onCall<{ gameId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  return db.runTransaction(async (tx) => {
    const ref = gameRef(req.data.gameId)
    const [snap, hadRoster] = await Promise.all([tx.get(ref), readRoster(tx, req.data.gameId)])
    if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
    const game = snap.data() as GameDoc
    if (game.phase !== 'lobby') throw new HttpsError('failed-precondition', '이미 시작한 판이다.')
    const seats = game.seats.filter((s) => s.playerId !== uid)
    tx.update(ref, { seats })
    // 한 자리가 비면 나눠 둔 역할을 **통째로 지운다.** 남은 열셋의
    // 배정도 빈 자리에 매여 있어서, 그냥 두면 규칙이 안 맞는다
    settleRoster(tx, req.data.gameId, hadRoster, seats, game.seed)
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

  /*
   * 역할과 인연. **여기 말고 어디에도 적지 않는다.**
   *
   * 보통은 열넷이 찰 때 이미 나뉘어 있다(settleRoster). 그때 적힌
   * 것과 여기서 나오는 답은 같다 — assignRoles 가 (명단·씨앗)에
   * 대해 결정적이고, 자리는 그 뒤로 안 바뀌었다. 그래도 한 번 더
   * 쓰는 것은 **이 줄 하나가 배정을 보장하는 마지막 자리**여서다.
   * 배정이 아직 없는 옛 판도 여기서 채워진다.
   *
   * 털어놓은 기록은 지키고 간다. 로비에서 털어놓을 길은 없지만,
   * 있었던 것을 덮어쓰는 코드는 언젠가 덮어쓴다
   */
  const hadRoster = await ref.collection('secret').doc('roster').collection('items').get()
  const revealOf = new Map(
    hadRoster.docs.map((d) => [d.id, (d.data() as { reveal?: unknown }).reveal ?? null]),
  )
  for (const a of roles) {
    batch.set(ref.collection('secret').doc('roster').collection('items').doc(a.playerId), {
      playerId: a.playerId,
      team: a.team,
      roleId: a.roleId,
      bondId: a.bondId,
      reveal: revealOf.get(a.playerId) ?? null,
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
      // **자원은 팀 것이 아니다.** 돈도 지식도 사람 지갑에 있다 —
      // 아래 pawns 에 STARTING_RESOURCES 가 사람마다 하나씩 들어간다
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
        /** 내 지갑. **팀 금고가 아니다** — 번 사람이 가진다 */
        resources: { ...STARTING_RESOURCES },
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
