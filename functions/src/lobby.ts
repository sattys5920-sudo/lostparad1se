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
import { isShortHanded } from '../../shared/rules/occupy'
import { START_TILE, TILES } from '../../shared/rules/board'
import { ROLE_TITLES, STARTING_RESOURCES, STARTING_TEAM_SIZES, type TeamId } from '../../shared/rules/v2'
import { TEAMS, TOTAL_SEATS, canAssign, canStart, dealTeams, mayPickTeam, timedEvents } from '../../shared/rules/lobby'
import { seedGarden } from './garden'
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
 * 나눠 둔 역할을 지운다.
 *
 * 자리가 바뀌면 배정은 무효다. 역할은 팀 구성에 매여 있어서(팀마다
 * 손 갈래 하나 · ★ 셋은 서로 다른 팀), 한 사람이 빠지면 남은 열셋의
 * 배정도 같이 틀어진다. 옛 배정을 그냥 두면 그때부터 규칙이 안 맞는다.
 *
 * **다시 나누지는 않는다.** 나누는 일은 운영자가 「배정」을 누를 때
 * 딱 한 번 일어난다(assignAll) — 자리가 바뀔 때마다 몰래 다시 나누면,
 * 이미 제 역할을 본 사람의 역할이 뒤에서 바뀐다.
 */
export function clearRoster(
  tx: FirebaseFirestore.Transaction,
  had: FirebaseFirestore.QuerySnapshot,
): void {
  for (const d of had.docs) tx.delete(d.ref)
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
  // 심부름 풀을 깔아 둔다. 운영자가 여기서 지우고 더한다
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

    if (mine < 0 && seats.length >= TOTAL_SEATS) {
      throw new HttpsError('resource-exhausted', '자리가 없다.')
    }

    /*
     * **팀은 앉을 때 안 정해진다.** 운영자가 「배정」을 누를 때
     * 팀과 개인 미션이 한꺼번에 정해진다. 먼저 온 사람이 빈 팀을
     * 메우던 때에는 늦게 온 사람에게 남은 자리가 곧 자기 팀이라,
     * 고르지 못하게 막아 둔 것이 무색했다.
     *
     * 운영자(와 에뮬레이터)만 미리 못 박을 수 있다 — 판을 세워 보는
     * 문이다. 못 박은 자리는 배정이 건드리지 않는다
     */
    const others = seats.filter((s) => s.playerId !== uid)
    const team = wanted ?? (mine >= 0 ? seats[mine].team : null)
    if (team && others.filter((s) => s.team === team).length >= STARTING_TEAM_SIZES[team]) {
      throw new HttpsError('resource-exhausted', `${team}팀은 다 찼다.`)
    }

    const seat: SeatEntry = { playerId: uid, name, team, look }
    if (mine >= 0) seats[mine] = seat
    else seats.push(seat)

    tx.update(ref, { seats })
    // 자리가 바뀌었으니 나눠 둔 것이 있으면 무효다
    clearRoster(tx, hadRoster)
    return { seat, seated: seats.length, need: TOTAL_SEATS, dealt: false }
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
    clearRoster(tx, hadRoster)
    return { seated: seats.length, need: TOTAL_SEATS }
  })
})

// ── 배정 ────────────────────────────────────────────────────────

/**
 * 팀과 개인 미션을 **한꺼번에** 나눈다. 운영자가 누른다.
 *
 * 전에는 둘이 따로 있었다. 팀은 앉을 때 빈 팀을 메우는 식으로 하나씩
 * 정해졌고, 역할은 열넷째가 앉는 순간 몰래 나뉘었다. 둘 다 문제가
 * 있었다 — 늦게 온 사람에게는 남은 자리가 곧 자기 팀이었고, 자리가
 * 한 번 바뀔 때마다 이미 제 역할을 본 사람의 역할이 뒤에서 바뀌었다.
 *
 * 이제 한 순간이다. 열넷이 다 앉으면 운영자가 누르고, 그 한 번의
 * 트랜잭션에서 팀·역할·짝사랑 대상이 다 같이 정해진다.
 *
 * **다시 누르면 거절한다.** 누르는 순간 각자 학생증에 제 역할이
 * 뜬다(paper.ts). 그걸 본 뒤에 다시 굴리면 본 것이 거짓말이 된다.
 * 다시 나누고 싶으면 판을 초기화해야 한다.
 */
export const assignAll = onCall<{ gameId: string }>(async (req) => {
  requireHost(req.auth)
  const gameId = req.data.gameId

  // **얼굴을 먼저 읽는다.** 트랜잭션 안에서 다른 문서를 읽으러
  // 나가면 재시도마다 같이 돈다
  const ref = gameRef(gameId)
  const before = await ref.get()
  if (!before.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  const faced = await freshFaces((before.data() as GameDoc).seats)

  return db.runTransaction(async (tx) => {
    const [snap, hadRoster] = await Promise.all([tx.get(ref), readRoster(tx, gameId)])
    if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
    const game = snap.data() as GameDoc
    if (game.phase !== 'lobby') throw new HttpsError('failed-precondition', '이미 시작한 판이다.')
    if (!hadRoster.empty) throw new HttpsError('failed-precondition', '이미 배정했다. 다시 나누려면 판을 초기화해야 한다.')

    // 트랜잭션이 재시도되는 동안 자리가 바뀌었을 수 있다. 판 문서의
    // 자리를 기준으로 삼고, 얼굴만 미리 읽어 둔 것에서 가져온다
    const lookOf = new Map(faced.map((s) => [s.playerId, s.look]))
    const seats = game.seats.map((s) => ({ ...s, look: lookOf.get(s.playerId) ?? s.look }))

    const ready = canAssign(seats)
    if (!ready.ok) throw new HttpsError('failed-precondition', ready.reason as string)

    const withTeams = dealTeams(seats, game.seed) as SeatEntry[]
    const players: Player[] = withTeams.map((s) => ({ id: s.playerId, team: s.team as TeamId }))
    let dealt
    try {
      dealt = assignRoles(players, game.seed)
    } catch (e) {
      throw new HttpsError('failed-precondition', `역할을 나누지 못했다: ${(e as Error).message}`)
    }

    tx.update(ref, { seats: withTeams })
    for (const a of dealt) {
      tx.set(rosterOf(gameId).doc(a.playerId), {
        playerId: a.playerId,
        team: a.team,
        roleId: a.roleId,
        targetId: a.targetId,
      })
    }
    return { assigned: dealt.length, teams: countByTeam(withTeams) }
  })
})

/** 배정 결과를 운영자 화면에 한 줄로 보여 주려고. 누가 어느 팀인지는 안 담는다. */
const countByTeam = (seats: readonly SeatEntry[]): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const t of TEAMS) out[t] = seats.filter((s) => s.team === t).length
  return out
}

// ── 시작 ────────────────────────────────────────────────────────

/**
 * 판을 시작한다.
 *
 * **여기서는 나누지 않는다.** 팀도 역할도 배정(assignAll)에서 이미
 * 정해졌고, 이 함수는 그것을 읽어 말·팀·칸을 놓을 뿐이다. 전에는
 * 여기서 한 번 더 나눴다 — assignRoles 가 결정적이라 같은 답이
 * 나온다는 이유였는데, 그 사이에 규칙이 바뀌면 사람들이 이미 본
 * 역할과 다른 답이 나온다. 나누는 자리는 하나여야 한다.
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

  const startedAtMs = req.data.startAtMs ?? nowOf(game)
  const batch = db.batch()

  /*
   * 역할은 배정에서 이미 적혔다. 여기서는 있는지만 확인한다 —
   * canStart 가 자리의 팀을 보긴 하지만, 팀만 있고 역할이 없는
   * 판을 시작해 버리면 아무도 제 미션을 못 받는다
   */
  const hadRoster = await ref.collection('secret').doc('roster').collection('items').get()
  if (hadRoster.size !== TOTAL_SEATS) {
    throw new HttpsError('failed-precondition', '아직 배정하지 않았다.')
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
      /*
       * 페이즈 상자. **빈 채로 시작한다.**
       *
       * 전에는 여기에 한 벌을 미리 넣어 두었다 — 첫 페이즈가 열리기
       * 전에도 토큰을 주고받게 하려던 것이다. 1인당 넷씩 곱해 주던
       * 때에는 그 한 벌이 열여섯이라 티가 안 났는데, 지급이 팀당
       * 여섯으로 평평해지면서 **첫 페이즈가 6이 아니라 12로 열렸다.**
       * 「페이즈마다 여섯」이라고 해 놓고 첫 판만 두 배였다.
       *
       * 미리 주는 쪽을 접는다. 토큰은 페이즈가 열릴 때 들어온다 —
       * 그 전에 건넬 것이 없다는 것은 규칙이 시키는 바 그대로다.
       */
      phaseTokens: 0,
      pendingRefund: 0,
      researchTier: 0,
      handCount: 0,
      // 3인 팀만 주장을 둔다. 4인 팀은 직책 넷이 다 찬다
      captainId: members.length < 4 ? members[0].playerId : null,
      publicScore: null,
    })
  }

  /*
   * 칸 — **스물다섯 방이 전부 빈 채로 시작한다.**
   *
   * 기지를 없앴다. 팀마다 제 방을 하나씩 못 박아 두고 붙은 방까지
   * 얹어 주던 것인데, 열넷이 한 교실에서 시작하고 팀 이야기는 무전으로
   * 하는 판에서는 아무도 안 가는 제 방이 있을 이유가 없다. 가진 방은
   * 이제 전부 서서 가져온 것이다.
   */
  for (const tile of TILES) {
    batch.set(ref.collection('tiles').doc(tile.id), { ownerTeam: null })
  }

  // 정원 화분 여덟. 비어 있는 채로 놓는다
  await seedGarden(req.data.gameId)

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
  batch.update(ref, {
    phase: 'running',
    // 다시 읽은 얼굴을 명단에 박아 둔다. 판이 도는 동안은 이것이 정본이다
    seats,
    startedAtMs,
    caughtUpToMs: startedAtMs,
    day: 1,
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
