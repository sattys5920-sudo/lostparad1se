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
  KNOWLEDGE_PER_RESEARCH,
  MOVE_MINUTES,
  PHASES_PER_DAY,
  PHASE_MINUTES,
  TOKENS_PER_PHASE,
  TOKEN_CAP,
  absenceRefunds,
  capacityOf,
  nextWallet,
  roomsOf,
  teamRanks,
  doAct,
  settle,
  type Act,
  type ActionKind,
  type PendingResearch,
  type PhaseState,
  type Person,
  type Robot,
  type Vault,
} from '../../shared/rules/occupy'
import type { Satchel, Satchels } from '../../shared/rules/items'
import { TILE_BY_ID, canRoamTo, type TileId } from '../../shared/rules/board'
import { INVISIBLE_TEAM_TOKEN_BONUS, TOTAL_DAYS, teamSizesOf, type TeamId } from '../../shared/rules/v2'
import { TEAMS } from '../../shared/rules/lobby'
import {
  SCHEDULE_ORD,
  type CaptureDoc,
  type GameDoc,
  type PawnDoc,
  type TeamDoc,
  type TileDoc,
} from '../../shared/model'
import { freshNow } from './turn'
import { clearArrivals } from './move'
import { openInterval } from './reveal'
import { refreshViews } from './views'
import { scatterSlips } from './slips'
import { foldQuizzes, scatterQuizzes } from './quiz'
import { settleBallots } from './ballot'
import { ANNOUNCE_NOBODY, INVISIBLE_NOTICE, announceInvisible } from '../../shared/story/vote'
import { drawForTeam } from './card'
import { note, noteAll } from './records'
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
  pendingResearch: PendingResearch[]
  /** 이번 페이즈에 로봇을 부순 사람. 한 사람 한 기까지다. */
  smashedBy: string[]
  /** 이번 페이즈에 무엇이든 한 사람. 결석 보정이 이 목록을 본다. */
  actedBy: string[]
}

/**
 * 걸어 둔 연구를 읽어 온다.
 *
 * **옛 판은 사람 이름만 적어 두었다.** 연구값이 연구실 주인에 따라
 * 갈리기 전에는 값을 적을 필요가 없었다. 그때 저장된 것을 만나면
 * 「아무에게도 안 낸 두 점」으로 친다 — 그래야 불발 환급이 터지지
 * 않는다.
 */
function queued(raw: unknown): PendingResearch[] {
  if (!Array.isArray(raw)) return []
  return raw.map((r) =>
    typeof r === 'string' ?
      { playerId: r, knowledge: KNOWLEDGE_PER_RESEARCH, paidTo: null }
    : (r as PendingResearch),
  )
}

const EMPTY_HIDDEN: HiddenPhase = {
  disguised: [],
  zeroedPeople: [],
  zeroedRobots: [],
  pendingResearch: [],
  smashedBy: [],
  actedBy: [],
}

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
    // 지금 서 있는 자리. **걷는 중이면 null 이다** — 여기서 postTile 로
    // 메우면 문 사이에 있는 사람이 전선에 서 있는 것으로 세어진다
    tileId: (p.tileId ?? null) as TileId | null,
    toTile: (p.path?.[0] ?? null) as TileId | null,
    captain: p.captain === true,
  }
}

/** 팀 문서에서 페이즈 토큰 상자만 떼어 온다. */
function walletsOf(teams: FirebaseFirestore.QuerySnapshot): Partial<Record<TeamId, number>> {
  const out: Partial<Record<TeamId, number>> = {}
  for (const d of teams.docs) out[d.id as TeamId] = (d.data() as TeamDoc).phaseTokens ?? 0
  return out
}

/** 팀 문서에서 금고만 떼어 온다. */
function vaultsOf(teams: FirebaseFirestore.QuerySnapshot): Partial<Record<TeamId, Vault>> {
  const out: Partial<Record<TeamId, Vault>> = {}
  for (const d of teams.docs) {
    const t = d.data() as { resources?: Partial<Vault> }
    out[d.id as TeamId] = { money: t.resources?.money ?? 0, knowledge: t.resources?.knowledge ?? 0 }
  }
  return out
}

/** 팀 주머니. 금고와 같은 자리에서 읽고 쓴다. */
/** 주머니는 **사람마다** 하나다. 말 문서에서 떼어 온다. */
function satchelsOf(pawns: FirebaseFirestore.QuerySnapshot): Satchels {
  const out: Satchels = {}
  for (const d of pawns.docs) out[d.id] = (d.data() as { items?: Satchel }).items ?? {}
  return out
}

/** 바뀐 주머니만 적는다. */
function writeSatchels(
  w: { update: (ref: FirebaseFirestore.DocumentReference, data: Record<string, unknown>) => unknown },
  ref: FirebaseFirestore.DocumentReference,
  before: Satchels,
  after: Satchels,
): void {
  for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[id] ?? {}) === JSON.stringify(after[id] ?? {})) continue
    w.update(ref.collection('pawns').doc(id), { items: after[id] ?? {} })
  }
}

/** 바뀐 금고만 적는다. 안 바뀐 팀 문서는 건드리지 않는다. */
function writeVaults(
  w: { update: (ref: FirebaseFirestore.DocumentReference, data: Record<string, unknown>) => unknown },
  ref: FirebaseFirestore.DocumentReference,
  before: Readonly<Partial<Record<TeamId, Vault>>>,
  after: Readonly<Partial<Record<TeamId, Vault>>>,
): void {
  for (const team of TEAMS) {
    const a = after[team]
    const b = before[team]
    if (!a || !b) continue
    if (a.money === b.money && a.knowledge === b.knowledge) continue
    w.update(ref.collection('teams').doc(team), { resources: { money: a.money, knowledge: a.knowledge } })
  }
}

async function loadBoard(gameId: string): Promise<{ state: PhaseState; game: GameDoc }> {
  const ref = gameRef(gameId)
  const [snap, pawns, tiles, bots, hidden, teams] = await Promise.all([
    ref.get(),
    ref.collection('pawns').get(),
    ref.collection('tiles').get(),
    robotsOf(gameId).get(),
    hiddenOf(gameId).get(),
    ref.collection('teams').get(),
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
      pendingResearch: queued(h.pendingResearch),
      zeroedPeople: h.zeroedPeople,
      zeroedRobots: h.zeroedRobots,
      disguised: h.disguised,
      smashedBy: h.smashedBy,
      actedBy: h.actedBy,
      vaults: vaultsOf(teams),
      satchels: satchelsOf(pawns),
      wallets: walletsOf(teams),
      openedTiles: (game.openedTiles ?? []) as TileId[],
      invisibleId: game.invisibleId ?? null,
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
 * 토큰은 여기서 **더해** 준다(TOKEN_CAP 까지). 남은 것을 태우지 않는다 —
 * 토큰은 거래할 수 있는 물건이고, 페이즈마다 사라지면 「토큰을 받고
 * 무엇을 준다」가 성립하지 않는다.
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
  const [pawns, tiles, teams] = await Promise.all([
    ref.collection('pawns').get(),
    ref.collection('tiles').get(),
    ref.collection('teams').get(),
  ])
  const owners: Partial<Record<TileId, TeamId | null>> = {}
  for (const d of tiles.docs) owners[d.id as TileId] = (d.data() as TileDoc).ownerTeam ?? null
  const batch = db.batch()

  // **자유 시간에 어디까지 갔든 종이 치면 제자리다.**
  //
  // 전에는 걸어서 돌아왔다. 한 칸에 15분이라, 2층 끝에서 1층 끝까지
  // 다섯 칸이면 75분 — 한 시간짜리 페이즈가 끝나고도 못 닿는다.
  // 자유 시간에 멀리 가는 것이 그대로 그 페이즈를 버리는 일이 되니
  // 아무도 제 전선을 안 떠났고, 돌아다니라고 만든 시간이 죽었다.
  //
  // 그래서 옮겨 세운다. 자유 시간은 만나는 시간이고, 페이즈는 서 있는
  // 자리로 겨루는 시간이다 — 둘을 걸음으로 잇지 않는다.
  const returning: { ref: FirebaseFirestore.DocumentReference; post: TileId }[] = []
  for (const d of pawns.docs) {
    const p = d.data() as PawnDoc
    const post = (p.postTile ?? p.tileId ?? `base${p.team}`) as TileId
    // 걷는 중(tileId === null)인 사람도 데려온다. 자유 시간에 찍어 둔
    // 길이 남아 있으면 페이즈 한복판에 엉뚱한 도착이 떨어진다
    if (p.tileId !== post) returning.push({ ref: d.ref, post })
  }
  await Promise.all(returning.map((m) => clearArrivals(gameId, m.ref.id)))

  // 지금 인원. 상수를 읽지 않는다 — 이적하면 4·4·3·3이 아니다
  const sizes = teamSizesOf(pawns.docs.map((d) => d.data() as PawnDoc))

  /**
   * 투명인간이 나온 팀이 더 받는 몫. **상자에 통째로 들어간다.**
   *
   * 세 명짜리 팀에서 한 명이 빠지면 판정 머릿수가 반토막 나는데,
   * 지워진 것은 한 사람인데 팀이 무너지면 이 투표가 사람이 아니라
   * 팀을 겨누는 것이 된다. 지갑이 사람마다이던 때에는 사람 수로
   * 나눠 얹느라 나머지가 버려졌다 — 상자 하나가 되면서 그 문제도 없다
   */
  const invisibleShare = game.invisibleTeam ? INVISIBLE_TEAM_TOKEN_BONUS : 0

  let returned = 0
  for (const d of pawns.docs) {
    const p = d.data() as PawnDoc
    const post = (p.postTile ?? p.tileId ?? `base${p.team}`) as TileId
    const came = returning.some((m) => m.ref.id === d.id)
    if (!came) {
      // 제 전선에 그대로 서 있었다. 자리는 안 건드린다
      batch.update(d.ref, { postTile: post, fromTile: null, path: [], arriveAtMs: null })
      continue
    }
    returned += 1
    batch.update(d.ref, {
      tileId: post,
      postTile: post,
      fromTile: p.tileId ?? null,
      path: [],
      arriveAtMs: null,
      asleep: false,
    })
  }

  /**
   * 팀 상자를 채운다. **팀에 하나다.**
   *
   * **더해 준다.** 남은 토큰을 태우면 거래할 물건이 못 된다.
   *
   * 인원은 지금 센다 — 이적이 그날 아침에 이미 발효돼 있으므로 옮겨
   * 간 사람은 새 팀 인원수로 친다. 한도는 얹기 **전에** 깎는다: 결석
   * 보정으로 넘긴 팀이 여기서 정리되고, 얹은 다음에 깎으면 보정이 그
   * 자리에서 사라져 아무 뜻이 없어진다
   */
  for (const d of teams.docs) {
    const team = d.id as TeamId
    const t = d.data() as TeamDoc
    batch.update(d.ref, {
      phaseTokens: nextWallet({
        held: t.phaseTokens ?? 0,
        teamSize: sizes[team],
        // 결석 보정에 투명인간 보정을 더한다. 둘 다 이때만 한도를
        // 넘고, 넘긴 것은 그다음 지급에서 정리된다
        refund: (t.pendingRefund ?? 0) + (team === game.invisibleTeam ? invisibleShare : 0),
      }),
      // 보정은 한 번만 쓰인다
      pendingRefund: 0,
    })
  }

  const no = (game.phaseDone ?? 0) + 1
  const endsAtMs = nowMs + PHASE_MINUTES * 60_000
  const day = Math.floor((no - 1) / PHASES_PER_DAY) + 1

  // 그날 첫 페이즈에 순위를 찍어 하루 동안 고정한다. 이적이 이 수를
  // 보는데, 페이즈마다 움직이면 어제 합의한 이적이 오늘 아침 말없이
  // 불발된다 — 협상해 놓고 조건이 사라지는 것은 규칙이 아니라 버그다
  const freeze =
    game.dayRanks?.day !== day
      ? {
          dayRanks: {
            day,
            rooms: Object.fromEntries(TEAMS.map((t) => [t, roomsOf(owners, t)])) as Record<TeamId, number>,
            rank: teamRanks(owners, TEAMS),
          },
        }
      : {}

  batch.update(ref, {
    phaseNow: { no, day, open: true, openedAtMs: nowMs, endsAtMs },
    ...freeze,
  })
  // 지난 페이즈의 위장·방해는 여기서 지운다. 연구 대기는 남긴다 —
  // 이번 페이즈가 닫힐 때 로봇이 될 것들이다
  batch.set(hiddenOf(gameId), { ...EMPTY_HIDDEN, pendingResearch: queued(game.pendingResearch) })

  await batch.commit()
  // 돌아다니던 방의 체류가 끝나고 전선의 체류가 열린다. 안 열면
  // 페이즈 내내 아까 있던 방의 말이 계속 들린다
  await Promise.all(returning.map((m) => openInterval(gameId, m.ref.id, m.post, nowMs)))
  await refreshViews(gameId)
  // allInAtMs 는 남겨 둔다 — 이제는 늘 지금이다. 아무도 걷지 않는다
  return { no, returned, endsAtMs, allInAtMs: nowMs, granted: sizes, cap: TOKEN_CAP }
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

  /** 내가 방을 떠났다면 그 방. 체류 기록을 닫아야 한다. */
  let leftFor: TileId | null = null
  // 계단으로 곧바로 선 자리. 0분이라 도착 예약 없이 여기서 끝난다
  let steppedTo: TileId | null = null
  let left = 0
  /**
   * 이번 행동으로 난 로봇·부서진 로봇. **트랜잭션 밖에서 기록한다** —
   * 안에서 적으면 재시도될 때마다 같은 줄이 두 번 쌓인다.
   *
   * 한 덩이로 묶은 것은 타입 때문이다. 그냥 let 으로 두면 콜백 안의
   * 대입을 컴파일러가 못 보고 바깥에서 never 로 좁혀 버린다.
   */
  const bot: {
    made: { id: string; team: TeamId; tileId: TileId } | null
    smashed: { id: string; byTeam: TeamId; tileId: TileId } | null
  } = { made: null, smashed: null }
  await db.runTransaction(async (tx) => {
    const [pawns, bots, tiles, hidden, teams] = await Promise.all([
      tx.get(ref.collection('pawns')),
      tx.get(robotsOf(gameId)),
      tx.get(ref.collection('tiles')),
      tx.get(hiddenOf(gameId)),
      tx.get(ref.collection('teams')),
    ])
    const h = { ...EMPTY_HIDDEN, ...(hidden.data() as Partial<HiddenPhase> | undefined) }
    const before: PhaseState = {
      people: pawns.docs.map((d) => personOf(d.id, d.data() as PawnDoc)),
      robots: bots.docs.map((d) => {
        const r = d.data() as Robot
        return { id: d.id, team: r.team, tileId: r.tileId, carriedBy: r.carriedBy ?? null }
      }),
      owners: Object.fromEntries(tiles.docs.map((d) => [d.id, (d.data() as TileDoc).ownerTeam ?? null])),
      pendingResearch: queued(h.pendingResearch),
      zeroedPeople: h.zeroedPeople,
      zeroedRobots: h.zeroedRobots,
      disguised: h.disguised,
      smashedBy: h.smashedBy,
      actedBy: h.actedBy,
      vaults: vaultsOf(teams),
      satchels: satchelsOf(pawns),
      wallets: walletsOf(teams),
      openedTiles: (game.openedTiles ?? []) as TileId[],
      invisibleId: game.invisibleId ?? null,
    }

    const out = doAct(before, uid, act)
    if (!out.ok) throw new HttpsError('failed-precondition', out.why)
    bot.made = null
    bot.smashed = null
    if (out.log.kind === 'researchDone' && out.log.tileId) {
      const fresh = out.next.robots.find((r) => !before.robots.some((b) => b.id === r.id))
      if (fresh) bot.made = { id: fresh.id, team: fresh.team, tileId: fresh.tileId }
    }
    if (out.log.kind === 'robotSmashed' && out.log.targetRobot && out.log.tileId) {
      const who = before.people.find((p) => p.playerId === uid) as Person
      bot.smashed = { id: out.log.targetRobot, byTeam: who.team, tileId: out.log.tileId }
    }

    // 사람 — 바뀐 것만 쓴다
    const arriveAt = nowMs + MOVE_MINUTES * 60_000
    const wasAt = new Map(before.people.map((p) => [p.playerId, p]))
    for (const p of out.next.people) {
      const was = wasAt.get(p.playerId) as Person
      const sameSpot = was.tileId === p.tileId && (was.toTile ?? null) === (p.toTile ?? null)
      // 토큰은 팀 상자에 있다. 사람 문서는 자리가 바뀔 때만 쓴다
      if (sameSpot) continue
      const doc = pawns.docs.find((d) => d.id === p.playerId)
      if (!doc) continue
      // 계단으로 갔다. **0분이라 걷는 중을 거치지 않는다** — 그 자리에
      // 곧바로 서니 도착 예약도, 체류를 닫는 일도 없다. 발은 들였으니
      // 지도에는 남는다
      if (p.tileId !== null) {
        const been = new Set((doc.data() as PawnDoc).visitedTiles ?? [])
        been.add(p.tileId)
        tx.update(doc.ref, {
          tileId: p.tileId,
          fromTile: was.tileId,
          path: [],
          arriveAtMs: null,
          asleep: false,
          visitedTiles: [...been],
        })
        if (p.playerId === uid) steppedTo = p.tileId
        continue
      }

      // 문을 넘었다. 나가는 데 5분, 들어가는 데 5분 — 그동안 어느 방에도 없다
      const to = p.toTile as TileId
      tx.update(doc.ref, {
        tileId: null,
        fromTile: was.tileId,
        path: [to],
        arriveAtMs: arriveAt,
        asleep: false,
      })
      // 도착은 따라잡기가 시킨다. 앱을 꺼도 도착한다
      tx.set(ref.collection('schedule').doc(), {
        dueAtMs: arriveAt,
        ord: SCHEDULE_ORD.arrive,
        kind: 'arrive',
        payload: { playerId: p.playerId, tileId: to, rest: [], nextAtMs: null },
        doneAtMs: null,
      })
      if (p.playerId === uid) leftFor = was.tileId
    }

    // 팀 상자 — 값을 치른 팀만 쓴다
    for (const d of teams.docs) {
      const team = d.id as TeamId
      const after = out.next.wallets[team] ?? 0
      if (after === (before.wallets[team] ?? 0)) continue
      tx.update(d.ref, { phaseTokens: after })
    }
    left = out.next.wallets[(before.people.find((p) => p.playerId === uid) as Person).team] ?? 0

    // 금고 — 연구가 지식을 뺐으면 여기서 적는다
    writeVaults(tx, ref, before.vaults, out.next.vaults)
    writeSatchels(tx, ref, before.satchels, out.next.satchels)

    // 로봇 — 통째로 다시 쓴다. 열몇 기뿐이라 견줄 이유가 없다
    const now = new Set(out.next.robots.map((r) => r.id))
    for (const d of bots.docs) if (!now.has(d.id)) tx.delete(d.ref)
    for (const r of out.next.robots) tx.set(robotsOf(gameId).doc(r.id), { ...r })

    tx.set(hiddenOf(gameId), {
      disguised: out.next.disguised,
      zeroedPeople: out.next.zeroedPeople,
      zeroedRobots: out.next.zeroedRobots,
      pendingResearch: out.next.pendingResearch,
      smashedBy: out.next.smashedBy,
      actedBy: out.next.actedBy,
    })
  })

  // 로봇이 나거나 부서졌으면 한 줄 남긴다. **개인 미션이 이것을 본다** —
  // 과학부의 「3기 이상 만든다」와 기술부의 「3기 이상 부순다」,
  // 심부름꾼의 「내가 만든 로봇이 남의 팀에」가 전부 여기서 나온다
  if (bot.made) {
    await note(gameId, 'robotBorn', nowMs, { id: uid, team: bot.made.team }, {
      tileId: bot.made.tileId,
      subjectId: bot.made.id,
      ownerId: uid,
    })
    await researchLanded(gameId, bot.made.team, uid, game.phaseNow.day)
  }
  if (bot.smashed) {
    await note(gameId, 'robotSmashed', nowMs, { id: uid, team: bot.smashed.byTeam }, {
      tileId: bot.smashed.tileId,
      subjectId: bot.smashed.id,
    })
  }

  // 떠나는 순간 그 방의 체류가 끝난다. 걷는 10분 동안은 어느 방에도
  // 없고, 도착하면 따라잡기가 새 방의 체류를 연다
  if (leftFor) await openInterval(gameId, uid, null, nowMs, 'walking')
  // 계단은 0분이라 걷는 중이 없다. 앞 방의 체류를 닫고 계단의 체류를
  // 곧바로 연다 — 안 열면 계단에 서서 떠난 방의 말을 계속 듣는다
  if (steppedTo) await openInterval(gameId, uid, steppedTo, nowMs)
  await refreshViews(gameId)
  return { kind, tokens: left, walking: leftFor !== null }
})

/**
 * 연구가 하나 끝났다. **팀의 연구 단계를 올리고 카드를 한 장 준다.**
 *
 * 전에는 이 둘이 자유 시간의 연구에 붙어 있었다. 연구를 페이즈로
 * 옮기면서 같이 왔다 — 안 옮겼으면 연구 단계는 영영 0이고(점수판의
 * 「발전」 줄과 「학구파」 목표가 죽는다) 카드는 나올 데가 없어진다.
 */
async function researchLanded(gameId: string, team: TeamId, playerId: string, day: number) {
  const ref = gameRef(gameId).collection('teams').doc(team)
  const snap = await ref.get()
  const tier = ((snap.data()?.researchTier as number | undefined) ?? 0) + 1
  await ref.update({ researchTier: tier })
  // 손패가 차 있으면 그대로 사라진다
  await drawForTeam(gameId, team, playerId, day)
}

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
  // 보정은 settle 전에 센다 — settle 이 actedBy 를 비운다
  const refunds = absenceRefunds(state, TEAMS)
  const out = settle(state)
  const ref = gameRef(gameId)
  const batch = db.batch()

  // 전투 자리를 지금 자리로 옮긴다. 다음 자유 시간에 아무리 멀리 가도
  // 다음 페이즈에는 여기로 돌아온다. **토큰은 그대로 둔다** — 들고 간다
  for (const p of out.next.people) {
    // 걷는 중이었으면 자리가 없다. 떠난 방을 전선으로 남긴다 —
    // 문 사이에서 페이즈가 끝나면 아무 방도 못 가져간다
    const where = p.tileId ?? (p.toTile as TileId | null)
    if (where) batch.update(ref.collection('pawns').doc(p.playerId), { postTile: where })
  }

  // 팀 상자 — 불발된 연구가 값을 돌려주고, 결석한 팀은 보정을 예약한다.
  //
  // 우리 팀에서 아무도 안 움직였으면 안 쓴 토큰의 절반을 다음 페이즈에
  // 얹어 준다. 못 한 일을 돌려주지는 못해도, 접속한 날 조금 더 움직일
  // 수는 있게 한다
  for (const team of TEAMS) {
    const patch: Record<string, unknown> = {}
    const after = out.next.wallets[team] ?? 0
    if (after !== (state.wallets[team] ?? 0)) patch.phaseTokens = after
    const back = refunds[team] ?? 0
    if (back > 0) patch.pendingRefund = back
    if (Object.keys(patch).length > 0) batch.update(ref.collection('teams').doc(team), patch)
  }
  // 불발된 연구는 지식을 도로 넣는다
  writeVaults(batch, ref, state.vaults, out.next.vaults)
  writeSatchels(batch, ref, state.satchels, out.next.satchels)

  const had = await robotsOf(gameId).get()
  for (const d of had.docs) batch.delete(d.ref)
  for (const r of out.next.robots) batch.set(robotsOf(gameId).doc(r.id), { ...r })

  for (const [tileId, team] of Object.entries(out.next.owners)) {
    if ((state.owners[tileId as TileId] ?? null) !== (team ?? null)) {
      batch.update(ref.collection('tiles').doc(tileId), { ownerTeam: team ?? null })
    }
  }

  // **누가 어디 서서 무엇을 가져갔는지 남긴다.** 개인 미션의
  // 「방어 참여」·「공격 참여」·「인연이 선 칸을 가져감」이 이것만
  // 본다. 깃발이 있던 시절에는 깃발 기록이 그 자리였다
  for (const [tileId, team] of Object.entries(out.next.owners)) {
    const before = state.owners[tileId as TileId] ?? null
    const standing = state.people.filter((p) => p.tileId === tileId).map((p) => p.playerId)
    if (standing.length === 0 && (team ?? null) === before) continue
    const rec: CaptureDoc = {
      tileId,
      team: team ?? null,
      ownerBefore: before,
      standing,
      atMs: nowMs,
      day: game.phaseNow.day,
      phaseNo: game.phaseNow.no,
    }
    batch.set(ref.collection('captures').doc(`${game.phaseNow.no}-${tileId}`), rec)
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
  const batch2 = db.batch()
  // 한 페이즈가 지날 때마다 쪽지가 몇 장 더 떨어진다. 자유 시간에
  // 주우러 다닐 것이 있어야 자유 시간이 시간이 된다
  // 걸어 둔 연구가 이제 로봇이 됐다. 지금 난 것도 만든 것이다 —
  // 그 자리에서 난 것만 세면 발전소 없는 팀의 과학부는 영영 못 채운다
  await noteAll(
    gameId,
    out.log
      .filter((l) => l.kind === 'researchDone' && l.playerId)
      .map((l) => {
        const who = state.people.find((p) => p.playerId === l.playerId) as Person
        const fresh = out.next.robots.find((r) => !state.robots.some((b) => b.id === r.id) && r.team === who.team)
        return {
          kind: 'robotBorn' as const,
          atMs: nowMs,
          actorId: l.playerId as string,
          actorTeam: who.team,
          tileId: l.tileId ?? null,
          subjectId: fresh?.id ?? null,
          ownerId: l.playerId as string,
        }
      }),
  )

  // 걸어 둔 연구가 끝났다. 단계를 올리고 카드를 준다
  for (const l of out.log) {
    if (l.kind !== 'researchDone' || !l.playerId) continue
    const who = state.people.find((p) => p.playerId === l.playerId)
    if (who) await researchLanded(gameId, who.team, l.playerId, game.phaseNow.day)
  }

  // 그날 마지막 페이즈면 내일의 투명인간을 고른다. **득표수는 남기지
  // 않는다** — 발표되는 것은 결과 한 줄뿐이다
  const erased = await settleBallots(gameId, game, no)
  if (erased) {
    const name = game.seats.find((s) => s.playerId === erased.invisibleId)?.name ?? null
    batch2.set(ref.collection('notices').doc(), {
      toPlayerId: null,
      text: name ? announceInvisible(name) : ANNOUNCE_NOBODY,
      atMs: nowMs,
    })
    if (erased.invisibleId) {
      batch2.set(ref.collection('notices').doc(), {
        toPlayerId: erased.invisibleId,
        text: INVISIBLE_NOTICE,
        atMs: nowMs,
      })
    }
    await batch2.commit()
  }

  const dropped = await scatterSlips(gameId, no, nowMs)
  // 펴 둔 문제는 도로 접히고, 새 종이가 몇 장 떨어진다
  await foldQuizzes(gameId)
  const papers = await scatterQuizzes(gameId, no, nowMs)
  await refreshViews(gameId)
  return {
    no,
    captured: out.log.filter((l) => l.kind === 'captured').length,
    lines: out.log.length,
    slips: dropped,
    quizzes: papers,
  }
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
    const [mine, pawns] = await Promise.all([
      tx.get(ref.collection('pawns').doc(uid)),
      tx.get(ref.collection('pawns')),
    ])
    if (!mine.exists) throw new HttpsError('permission-denied', '이 판에 없는 사람이다.')
    const p = mine.data() as PawnDoc
    if (p.tileId === tileId) throw new HttpsError('failed-precondition', '이미 그 방이다.')

    const here = (p.tileId ?? p.postTile) as TileId
    // **복도로 닿으면 들어간다.** 옆방만 허용하면, 복도 한복판에서
    // 눈앞의 문을 못 여는 일이 생긴다 — 복도는 층을 통째로 잇는다.
    // 어차피 자유 시간 걸음은 공짜고 즉시라, 옆방씩 몇 번 눌러 가는
    // 것과 결과가 같다
    if (!canRoamTo(here, tileId)) throw new HttpsError('failed-precondition', '거기까지는 복도가 안 이어진다.')

    // **정원은 사람만 센다.** 로봇은 방마다 따로 헤아린다 — 여기서
    // 같이 세면 로봇 둘이 선 좁은 방에 아무도 못 들어가고, 들어가야
    // 부술 수 있으니 그 방이 영영 그 팀 것이 된다. 규칙 쪽은 고쳤는데
    // 자유 시간 걸음만 옛 셈이 남아 있었다
    const seats = pawns.docs.filter((d) => d.id !== uid && (d.data() as PawnDoc).tileId === tileId).length
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

export { ACT_COST, TOKENS_PER_PHASE }
