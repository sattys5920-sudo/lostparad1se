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
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

import {
  ACT_COST,
  ACT_MINUTES,
  ENTER_MINUTES,
  EXIT_MINUTES,
  PHASE_MINUTES,
  TOKENS_PER_PHASE,
  TOKEN_CAP,
  nextWallet,
  roomsOf,
  teamRanks,
  doAct,
  settle,
  type Act,
  type ActionKind,
  type PhaseState,
  type Person,
  type Robot,
  type Vault,
} from '../../shared/rules/occupy'
import type { Satchel, Satchels } from '../../shared/rules/items'
import { TILE_BY_ID, canRoamTo, isHallCell, roomOfCell, type TileId } from '../../shared/rules/board'
import { seatIn } from '../../shared/rules/seat'
import { isFixture } from '../../shared/rules/fixtures'
import { isBlockedCell } from '../../shared/rules/blocked'
import { foldPurses, purseOf } from '../../shared/rules/resources'
import { machineAtSeat } from '../../shared/rules/arcade'
import { LAB_PICK_NO, LAB_TILE, SNARE_MINUTES, atLabMachine, pickLabMachine } from '../../shared/rules/trap'
import type { MadeDoc } from '../../shared/rules/made'
import { springTrap } from './trap'
import type { Cell } from '../../shared/rules/board'
import { teamSizesOf, type TeamId } from '../../shared/rules/v2'
import { TEAMS } from '../../shared/rules/lobby'
import {
  SCHEDULE_ORD,
  type CaptureDoc,
  type GameDoc,
  type PawnDoc,
  type TeamDoc,
  type TileDoc,
} from '../../shared/model'
import { freshNow, refuseIfInvisible, requireFree } from './turn'
import { madeOf, researchTierUp, type Brewing } from './made'
import { FLAGS_PER_PHASE, spendFlags, type FlagBoxes, type FlagMap } from '../../shared/rules/flag'
import { openInterval } from './reveal'
import { refreshViews } from './views'
import { note } from './records'
import { gameRef, nowOf, requireUid } from './index'
import { requireHost } from './host'
import { notify } from './notify'
import { cellsOf, claimSeat, pickSeat, seatPawn, takenFrom } from './seat'
import { checkInvariants } from './invariants'
import { inTx } from './contended'
import { logEvent, logSecret } from './qaLog'

const db = getFirestore()


/** 묶여 있는 동안 화면에 적는 이름. */
const ACT_LABEL: Record<ActionKind, string> = {
  move: '이동',
  research: '연구',
  summon: '호출',
  plant: '깃발 꽂기',
  pull: '깃발 뽑기',
  dropRobot: '로봇 놓기',
  takeRobot: '로봇 수거',
  smashRobot: '로봇 부수기',
}

const ACTION_KINDS: readonly ActionKind[] = [
  'move',
  'research',
  'summon',
  'plant',
  'pull',
  'dropRobot',
  'takeRobot',
  'smashRobot',
]

const robotsOf = (gameId: string) => gameRef(gameId).collection('robots')

/** 로봇 문서 → 규칙의 Robot. **놓은 사람(placedBy)도 옮겨야** 수거가 본인만 된다 */
const robotFrom = (d: { id: string; data(): unknown }): Robot => {
  const r = d.data() as Robot
  return { id: d.id, team: r.team, tileId: r.tileId, carriedBy: r.carriedBy ?? null, placedBy: r.placedBy ?? null }
}

/** 적는 모양. undefined 를 남기지 않는다 */
const robotRow = (r: Robot) => ({ id: r.id, team: r.team, tileId: r.tileId, carriedBy: r.carriedBy, placedBy: r.placedBy ?? null })

/**
 * 이번 페이즈의 감출 것들. **판 문서에 두면 안 된다.**
 *
 * 누가 무엇을 걸어 두었는지가 여기 있다. 판 문서는 누구나 읽을 수 있다.
 */
const hiddenOf = (gameId: string) => gameRef(gameId).collection('secret').doc('phase')

/**
 * 방마다 꽂힌 깃발. **secret 에 둔다.**
 *
 * 주인은 누구에게나 보이지만(tiles), 몇 개 차이로 쥐고 있는지는 그
 * 방에 들어가야 안다 — 판 문서나 tiles 에 적으면 개발자도구로 온
 * 학교의 깃발 수가 다 보인다. 투영이 보이는 방의 것만 떼어 보낸다.
 */
const flagsOf = (gameId: string) => gameRef(gameId).collection('secret').doc('flags')

/** 깃발 문서에서 방마다의 수만 떼어 온다. */
const flagMapOf = (snap: FirebaseFirestore.DocumentSnapshot): FlagMap =>
  ((snap.data() as { tiles?: FlagMap } | undefined)?.tiles ?? {})

/** 같은 문서의 pulls 칸 — 방마다 팀마다, 그 깃발에 손댄 사람들. */
const flagPullHitsOf = (
  snap: FirebaseFirestore.DocumentSnapshot,
): PhaseState['flagPullHits'] => ((snap.data() as { pulls?: PhaseState['flagPullHits'] } | undefined)?.pulls ?? {})

/** 팀 문서에서 깃발 상자만 떼어 온다. 토큰 상자 옆에 있다 — 같은 팀만 읽는다. */
function flagBoxesOf(teams: FirebaseFirestore.QuerySnapshot): FlagBoxes {
  const out: Partial<Record<TeamId, number>> = {}
  for (const d of teams.docs) {
    const t = d.data() as TeamDoc
    out[d.id as TeamId] = (t.flags ?? 0) + (t.boughtFlags ?? 0)
  }
  return out
}

interface HiddenPhase {
  pendingResearch: Brewing[]
  /** 이번 페이즈에 로봇을 부순 사람. 한 사람 한 기까지다. */
  smashedBy: string[]
  /** 이번 페이즈에 무엇이든 한 사람. 결석 보정이 이 목록을 본다. */
  actedBy: string[]
}

/**
 * 걸어 둔 연구를 읽어 온다.
 *
 * **모양이 안 맞는 옛 줄은 버린다.** 연구가 「페이즈 끝에 한꺼번에」
 * 에서 「스무 분 뒤 그 연구실에」로 바뀌면서, 어느 방인지와 언제
 * 익는지가 없으면 처리할 길이 아예 없어졌다. 값을 지어내 놓고
 * 엉뚱한 방에 로봇을 내느니 버리는 편이 낫다.
 */
function queued(raw: unknown): Brewing[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (r): r is Brewing =>
      r !== null &&
      typeof r === 'object' &&
      typeof (r as Brewing).playerId === 'string' &&
      typeof (r as Brewing).tileId === 'string' &&
      typeof (r as Brewing).doneAtMs === 'number',
  )
}

const EMPTY_HIDDEN: HiddenPhase = {
  pendingResearch: [],
  smashedBy: [],
  actedBy: [],
}

/** 운영자만. 화면이 하는 말을 믿지 않는다. */

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
  }
}

/** 팀 문서에서 페이즈 토큰 상자만 떼어 온다. */
function walletsOf(teams: FirebaseFirestore.QuerySnapshot): Partial<Record<TeamId, number>> {
  const out: Partial<Record<TeamId, number>> = {}
  for (const d of teams.docs) out[d.id as TeamId] = (d.data() as TeamDoc).phaseTokens ?? 0
  return out
}

/** 팀 문서에서 금고만 떼어 온다. */
/**
 * 팀 금고를 팀마다 하나씩 모은다. **팀 문서에서 읽는다.**
 *
 * 한때 사람 문서(지갑)에 있었다. 자리를 옮기고 읽는 쪽을 안 고치면
 * **모두 0 인 금고**가 조용히 만들어져서 연구가 영영 「지식이
 * 모자란다」가 된다.
 */
function vaultsOf(teams: FirebaseFirestore.QuerySnapshot): Partial<Record<TeamId, Vault>> {
  const out: Partial<Record<TeamId, Vault>> = {}
  for (const d of teams.docs) out[d.id as TeamId] = purseOf(d.data() as TeamDoc)
  return out
}

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
  for (const id of Object.keys(after) as TeamId[]) {
    const a = after[id]
    const b = before[id]
    if (!a || !b) continue
    if (a.money === b.money && a.knowledge === b.knowledge) continue
    w.update(ref.collection('teams').doc(id), { resources: { money: a.money, knowledge: a.knowledge } })
  }
}

async function loadBoard(gameId: string): Promise<{ state: PhaseState; game: GameDoc }> {
  const ref = gameRef(gameId)
  const [snap, pawns, tiles, bots, hidden, teams, flags] = await Promise.all([
    ref.get(),
    ref.collection('pawns').get(),
    ref.collection('tiles').get(),
    robotsOf(gameId).get(),
    hiddenOf(gameId).get(),
    ref.collection('teams').get(),
    flagsOf(gameId).get(),
  ])
  const game = snap.data() as GameDoc
  const h = { ...EMPTY_HIDDEN, ...(hidden.data() as Partial<HiddenPhase> | undefined) }

  const people: Person[] = pawns.docs.map((d) => personOf(d.id, d.data() as PawnDoc))
  const robots: Robot[] = bots.docs.map(robotFrom)
  const owners: Partial<Record<TileId, TeamId | null>> = {}
  for (const d of tiles.docs) owners[d.id as TileId] = (d.data() as TileDoc).ownerTeam ?? null

  return {
    game,
    state: {
      people,
      robots,
      owners,
      pendingResearch: queued(h.pendingResearch),
      flags: flagMapOf(flags),
      flagBoxes: flagBoxesOf(teams),
      flagPullHits: flagPullHitsOf(flags),
      smashedBy: h.smashedBy,
      actedBy: h.actedBy,
      vaults: vaultsOf(teams),
      satchels: satchelsOf(pawns),
      wallets: walletsOf(teams),
      invisibleId: game.invisibleId ?? null,
      // **살아 있는 것만 담는다.** 순수 함수는 시계를 모른다
      locks: liveLocks(tiles.docs, nowOf(game)),
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

  const ref = gameRef(gameId)
  const [pawns, tiles, teams] = await Promise.all([
    ref.collection('pawns').get(),
    ref.collection('tiles').get(),
    ref.collection('teams').get(),
  ])
  const owners: Partial<Record<TileId, TeamId | null>> = {}
  for (const d of tiles.docs) owners[d.id as TileId] = (d.data() as TileDoc).ownerTeam ?? null
  const batch = db.batch()

  /*
   * **페이즈는 지금 서 있는 그 자리에서 시작한다.** 되돌아가는 이동은 없다.
   *
   * 전에는 「직전 페이즈가 끝난 자리」로 옮겨 세웠다. 자유 시간에 어디까지
   * 갔든 종이 치면 제자리였는데, 그 규칙을 지웠다 — 자유 시간이 페이즈가
   * 끝난 자리에서 이어지듯, 페이즈도 자유 시간이 끝난 자리에서 이어진다.
   * 걷는 중인 사람(tileId === null)은 걷던 대로 도착한다.
   */

  // **이적은 answerTransfer 에서 바로 발효된다.** 수락한 자리에서 팀·
  // 완장이 즉시 바뀌므로, 여기서는 pawns 가 이미 지금 팀을 담고 있다.

  // 지금 인원. 상수를 읽지 않는다 — 이적하면 4·4·3·3이 아니다
  const sizes = teamSizesOf(pawns.docs.map((d) => d.data() as PawnDoc))

  // 아무도 옮기지 않는다. 전선(postTile)만 지금 선 방으로 맞추고, 하던 일을 끊는다 —
  // 종이 치면 「생산 중」 같은 표시가 남아 있으면 그 자리에서 아무것도 못 한다.
  // 걷는 중인 사람은 길(path · arriveAtMs)을 그대로 둔다
  const returned = 0
  for (const d of pawns.docs) {
    const p = d.data() as PawnDoc
    const post = (p.tileId ?? p.postTile ?? `base${p.team}`) as TileId
    batch.update(d.ref, { postTile: post, asleep: false, busyUntilMs: null, busyKind: null })
  }

  /**
   * 팀 상자를 채운다. **팀에 하나다.**
   *
   * **더해 준다.** 남은 토큰을 태우면 거래할 물건이 못 된다.
   *
   * **인원은 안 본다.** 어느 팀이든 여섯씩이다 — 사람 수를 곱하던
   * 때에는 네 명짜리 팀이 한 페이즈에 열여섯을 받아 토큰이 아무것도
   * 조이지 못했다. **합이 12 를 넘지 않는다**(TOKEN_CAP). 보정은 없다
   */
  /*
   * **깃발은 페이즈마다 다시 채운다.** 팀마다 같은 수(rules/flag).
   * 남은 것에 더하지 않는다 — 한 페이즈에 꽂을 수 있는 한도다. 자판기에서
   * 산 것(boughtFlags)은 건드리지 않는다.
   */
  /*
   * **옛 판의 개인 지갑을 팀 금고로 옮긴다.** 돈과 지식이 사람 것이던
   * 때에 시작한 판이면 사람 문서에 resources 가 남아 있다. 그 사람이
   * 지금까지 있던 팀 금고에 더하고 지갑은 지운다 — 두 번 더해지지 않는다.
   */
  const legacy = pawns.docs.filter((d) => (d.data() as PawnDoc).resources)
  for (const d of legacy) batch.update(d.ref, { resources: FieldValue.delete() })
  for (const d of teams.docs) {
    const team = d.id as TeamId
    const t = d.data() as TeamDoc
    const fold = legacy.filter((x) => (x.data() as PawnDoc).team === team)
    batch.update(d.ref, {
      ...(fold.length
        ? { resources: foldPurses(purseOf(t), fold.map((x) => (x.data() as PawnDoc).resources)) }
        : {}),
      flags: FLAGS_PER_PHASE,
      phaseTokens: nextWallet({ held: t.phaseTokens ?? 0 }),
      // 옛 판에 남은 보정 예약은 지운다 — 보정은 없어졌다
      ...(t.pendingRefund !== undefined ? { pendingRefund: FieldValue.delete() } : {}),
    })
  }

  const no = (game.phaseDone ?? 0) + 1
  const endsAtMs = nowMs + PHASE_MINUTES * 60_000
  // **날짜는 운영자가 넘긴 달력을 따른다.** 하루에 몇 교시를 여는지는
  // 날마다 다르므로 교시 번호로 날을 셈하지 않는다
  const day = game.day

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
  // **무전에는 아무 알림도 안 적는다.** 무전은 사람끼리 하는 말만 오간다
  const everyone = game.seats.map((s) => s.playerId)
  // 지난 페이즈의 기록은 여기서 지운다. 연구 대기는 남긴다 —
  // 이번 페이즈가 닫힐 때 로봇이 될 것들이다
  batch.set(hiddenOf(gameId), { ...EMPTY_HIDDEN, pendingResearch: queued(game.pendingResearch) })

  await batch.commit()
  /*
   * 칸이 없는 사람만 세운다(칸을 나눠 주기 전에 시작한 판). 복도에 선 사람도
   * 방 안 사람도 **그 자리 그대로다** — 여는 순간 아무도 옮기지 않는다
   */
  for (const d of pawns.docs) {
    const p = d.data() as PawnDoc
    if (p.tileId && !p.at) await seatPawn(gameId, d.id, p.tileId as TileId, nowMs)
  }
  // 열넷 모두에게 — 결과는 없다, 열렸다는 것뿐
  await notify(gameId, everyone, 'phaseStart', `phaseStart:${no}`)
  // 이적은 answerTransfer 가 그 자리에서 teamMoved 를 남긴다 — 여기서는 안 짚는다
  // 아무도 안 옮겼으니 체류도 그대로다 — 서 있던 방의 체류가 이어진다
  await refreshViews(gameId)
  await logEvent(gameId, 'phaseOpen', nowMs, null, { no, day, endsAtMs, returned }, { day })
  // allInAtMs 는 남겨 둔다 — 이제는 늘 지금이다. 아무도 걷지 않는다
  /*
   * **granted 는 실제로 나눠 준 토큰이다.** 여기에 팀 인원수(sizes)가
   * 들어가 있었다 — 운영자 화면에 「A:4 B:4 C:3 D:3」이 지급량으로
   * 보였고, 그게 지급량이 아니라 머릿수라는 것을 아무 데도 안 적었다.
   */
  return { no, returned, endsAtMs, allInAtMs: nowMs, granted: TOKENS_PER_PHASE, sizes, cap: TOKEN_CAP }
})

// ── 각자: 지금 당장 하는 행동 ───────────────────────────────────

/**
 * 행동 하나를 지금 처리한다. 토큰이 줄고 판이 바로 바뀐다.
 *
 * 통째로 트랜잭션 안에서 한다. 좁은 방에 둘이 동시에 들어가려 하면
 * **먼저 들어간 쪽만** 들어가야 하는데, 읽고 쓰는 사이가 벌어지면
 * 둘 다 들어간다. 판이 스물다섯 칸에 열넷뿐이라 통째로 읽어도 싸다.
 */
/** 서 있는 방에 하는 일. 복도에서는 못 한다 */
const IN_ROOM_KINDS: ReadonlySet<ActionKind> = new Set(['summon', 'plant', 'pull', 'dropRobot', 'takeRobot', 'smashRobot'])

export const phaseAct = onCall<{
  gameId: string
  kind: ActionKind
  targetTile?: TileId
  targetPlayer?: string
  targetRobot?: string
  targetTeam?: TeamId
  /** 연구할 기계 번호. 없으면 옆에 선 빈 기계 */
  machine?: number
}>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, kind } = req.data
  if (!ACTION_KINDS.includes(kind)) throw new HttpsError('invalid-argument', '그런 행동은 없다.')
  const { game, nowMs } = await freshNow(gameId)
  if (!game.phaseNow?.open) throw new HttpsError('failed-precondition', '지금은 페이즈가 아니다.')
  if (!phaseAlive(game, nowMs)) throw new HttpsError('failed-precondition', '이 페이즈는 시간이 끝났다.')

  /*
   * **호출은 지워진 사람을 비껴간다.** 부르는 쪽도 불리는 쪽도다.
   *
   * 점령전 자체에는 참여한다 — 서 있는 자리로 방을 겨루는 일은 그대로
   * 된다. 다만 호출은 사람을 불러 옮기는 대인 행동이고, 어느 쪽으로
   * 통하든 **위치가 드러난다**: 지워진 사람이 부르면 불린 사람이 그
   * 자리로 끌려와 거기 누가 있는지 알게 되고, 남이 지워진 사람을
   * 부르면 안 보이는 말이 제 쪽으로 다가온다.
   *
   * 나머지 행동(이동·연구·깃발·로봇)은 규칙 엔진이 가른다.
   */
  if (kind === 'summon') {
    refuseIfInvisible(game.invisibleId, uid, req.data.targetPlayer ?? null, '호출할')
  }
  /*
   * **연구는 연구 기계 앞에서.** 방 안이면 되던 것을 자리로 좁힌다 —
   * 기술실 제조기와 같은 자다. 규칙 엔진은 방만 보므로 여기서 한 번
   * 더 본다. 화면이 보내는 자리를 믿지 않고 pawns 의 at 을 본다
   */
  if (kind === 'research') {
    const meSnap = await gameRef(gameId).collection('pawns').doc(uid).get()
    const me = meSnap.data() as PawnDoc | undefined
    if (me?.tileId !== LAB_TILE || !atLabMachine((me.at ?? null) as Cell | null)) {
      throw new HttpsError('failed-precondition', '연구 기계 옆에 서야 한다.')
    }
  }

  /*
   * **방 안에서 하는 일은 방 안에 서서 한다.** 복도로 나와도 tileId 는
   * 마지막 방으로 남는다 — 그걸 믿으면 문 밖 복도에 서서 그 방에 깃발을
   * 꽂고 로봇을 놓았다. 서 있는 칸(at)이 그 방 바닥인지 본다
   */
  if (IN_ROOM_KINDS.has(kind)) {
    const me = (await gameRef(gameId).collection('pawns').doc(uid).get()).data() as PawnDoc | undefined
    if (me?.tileId && me.at && roomOfCell(me.at.x, me.at.y) !== me.tileId) {
      throw new HttpsError('failed-precondition', '방 안에 들어가 있어야 한다.')
    }
  }

  const ref = gameRef(gameId)
  const act: Act = {
    kind,
    ...(req.data.targetTile ? { targetTile: req.data.targetTile } : {}),
    ...(req.data.targetPlayer ? { targetPlayer: req.data.targetPlayer } : {}),
    ...(req.data.targetRobot ? { targetRobot: req.data.targetRobot } : {}),
    ...(req.data.targetTeam ? { targetTeam: req.data.targetTeam } : {}),
  }

  /** 내가 방을 떠났다면 그 방. 체류 기록을 닫아야 한다. */
  let leftFor: TileId | null = null
  /** 내가 걷는 분 — 들어서기만이면 5, 방에서 곧장이면 10 */
  let myMinutes: number | null = null
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
    /** ofTeam 은 **부서진 짝의 주인 팀**이다. 기술부의 「남의 팀 짝」이 이 칸으로 갈린다 */
    smashed: { id: string; byTeam: TeamId; tileId: TileId; ofTeam: TeamId | null } | null
    /** 아무도 안 부쉈는데 사라진 것들. 이적으로 한도가 넘친 자리다 */
    gone: { id: string; team: TeamId }[]
  } = { made: null, smashed: null, gone: [] }
  /** 연구를 건 기계. 연구일 때만 정해진다 */
  let labMachine: number | null = null
  /** 연구를 맡긴 사람 — 팀과 방. 맡긴 순간 「만든 로봇」 한 줄을 남긴다 */
  let commissioned: { team: TeamId; tileId: TileId } | null = null
  await inTx(async (tx) => {
    const [pawns, bots, tiles, hidden, teams, flagSnap, madeSnap, papers] = await Promise.all([
      tx.get(ref.collection('pawns')),
      tx.get(robotsOf(gameId)),
      tx.get(ref.collection('tiles')),
      tx.get(hiddenOf(gameId)),
      tx.get(ref.collection('teams')),
      tx.get(flagsOf(gameId)),
      kind === 'research' ? tx.get(madeOf(gameId)) : Promise.resolve(null),
      // 계단으로 곧바로 설 때 빈 칸을 고른다 — 바닥 종이 칸은 못 선다
      kind === 'move' ? tx.get(ref.collection('secret').doc('quiz').collection('floor').where('heldBy', '==', null)) : Promise.resolve(null),
    ])
    const h = { ...EMPTY_HIDDEN, ...(hidden.data() as Partial<HiddenPhase> | undefined) }
    /*
     * **연구 기계 한 대에 한 건.** 돌고 있는 연구와, 다 됐는데 안 치운
     * 완성품이 기계를 차지한다. 트랜잭션 안에서 가려야 둘이 한 기계에
     * 동시에 거는 것을 막는다
     */
    if (kind === 'research') {
      const busy = new Set<number>()
      for (const r of queued(h.pendingResearch)) if (typeof r.machine === 'number') busy.add(r.machine)
      for (const d of madeSnap?.docs ?? []) {
        const m = d.data() as MadeDoc
        if (typeof m.machine === 'number') busy.add(m.machine)
      }
      const meAt = (pawns.docs.find((d) => d.id === uid)?.data() as PawnDoc | undefined)?.at ?? null
      const want = typeof req.data.machine === 'number' ? Math.floor(req.data.machine) : null
      const pick = pickLabMachine(meAt as Cell | null, busy, want)
      if (typeof pick !== 'number') throw new HttpsError('failed-precondition', `${LAB_PICK_NO[pick]}.`)
      labMachine = pick
    }
    const before: PhaseState = {
      people: pawns.docs.map((d) => personOf(d.id, d.data() as PawnDoc)),
      robots: bots.docs.map(robotFrom),
      owners: Object.fromEntries(tiles.docs.map((d) => [d.id, (d.data() as TileDoc).ownerTeam ?? null])),
      pendingResearch: queued(h.pendingResearch),
      flags: flagMapOf(flagSnap),
      flagBoxes: flagBoxesOf(teams),
      flagPullHits: flagPullHitsOf(flagSnap),
      smashedBy: h.smashedBy,
      actedBy: h.actedBy,
      vaults: vaultsOf(teams),
      satchels: satchelsOf(pawns),
      wallets: walletsOf(teams),
      invisibleId: game.invisibleId ?? null,
      // **살아 있는 것만 담는다.** 지난 자물쇠를 지우러 다시 오는
      // 일이 없게, 시각만 보고 살았는지를 판단한다
      locks: liveLocks(tiles.docs, nowMs),
    }

    /*
     * **하던 일이 안 끝났으면 아무것도 못 한다.**
     *
     * 생산·공부·호출은 시간이 든다. 그동안 다른 것을 걸 수 있으면
     * 시간을 물린 뜻이 없다 — 10분짜리 일을 걸어 놓고 그 10분에
     * 세 가지를 더 한다.
     */
    const mineDoc = pawns.docs.find((d) => d.id === uid)
    if (mineDoc) requireFree(mineDoc.data() as PawnDoc, nowMs)
    // **덫에 걸렸거나 하던 일이 있는 사람은 불러낼 수 없다.** 호루라기가 덫을 푸는 길이 되면 안 된다
    if (kind === 'summon' && act.targetPlayer) {
      const theirs = pawns.docs.find((d) => d.id === act.targetPlayer)?.data() as PawnDoc | undefined
      if (theirs && (theirs.busyUntilMs ?? 0) > nowMs) throw new HttpsError('failed-precondition', '그 사람은 지금 움직일 수 없다.')
    }

    const out = doAct(before, uid, act)
    if (!out.ok) throw new HttpsError('failed-precondition', out.why)
    commissioned = null
    if (kind === 'research') {
      const who = before.people.find((p) => p.playerId === uid) as Person
      if (who.tileId) commissioned = { team: who.team, tileId: who.tileId as TileId }
    }
    bot.made = null
    bot.smashed = null
    if (out.log.kind === 'researchDone' && out.log.tileId) {
      const fresh = out.next.robots.find((r) => !before.robots.some((b) => b.id === r.id))
      if (fresh) bot.made = { id: fresh.id, team: fresh.team, tileId: fresh.tileId }
    }
    if (out.log.kind === 'robotSmashed' && out.log.targetRobot && out.log.tileId) {
      const who = before.people.find((p) => p.playerId === uid) as Person
      const victim = before.robots.find((r) => r.id === out.log.targetRobot)
      bot.smashed = {
        id: out.log.targetRobot,
        byTeam: who.team,
        tileId: out.log.tileId,
        ofTeam: victim?.team ?? null,
      }
    }

    /*
     * 사람 — 바뀐 것만 쓴다.
     *
     * **들어서는 데 5분, 나서는 데 5분.** 복도에 나와 있던 사람은 이미
     * 나서는 5분을 치렀으니(standAt) 들어서는 5분만 걷는다. 방 안에서 곧장
     * 다른 방으로 가거나 불려 가면 둘을 합친 10분이다
     */
    const minutesFor = (id: string): number => {
      // 호루라기로 불려 가는 사람은 나서고 들어서는 것까지 호출 한 번 값이다
      if (kind === 'summon') return ACT_MINUTES.summon
      const d = pawns.docs.find((x) => x.id === id)?.data() as PawnDoc | undefined
      const inHall = !!d?.at && roomOfCell(d.at.x, d.at.y) === null
      return inHall ? ENTER_MINUTES : ENTER_MINUTES + EXIT_MINUTES
    }
    const wasAt = new Map(before.people.map((p) => [p.playerId, p]))
    /** 이번에 세운 칸. 한 번에 둘이 계단을 타도 겹치지 않게 */
    const seated: Cell[] = []
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
        // **그 방의 빈 칸에 선다.** 앞 층의 칸을 들고 가면 엉뚱한 자리에 선 것이 된다
        const cell = seatIn(p.tileId, takenFrom(pawns.docs, papers?.docs ?? [], p.playerId, seated, game.invisibleId ?? null))
        if (cell) seated.push(cell)
        claimSeat(tx, gameId, p.playerId, cell, nowMs)
        tx.update(doc.ref, {
          tileId: p.tileId,
          fromTile: was.tileId,
          path: [],
          arriveAtMs: null,
          asleep: false,
          visitedTiles: [...been],
          at: cell,
        })
        if (p.playerId === uid) steppedTo = p.tileId
        continue
      }

      // 문을 넘었다. 걷는 동안 어느 방에도 없다
      const to = p.toTile as TileId
      const mins = minutesFor(p.playerId)
      const arriveAt = nowMs + mins * 60_000
      if (p.playerId === uid) myMinutes = mins
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

    /*
     * **시간이 드는 행동은 손을 묶는다.**
     *
     * 호출은 부른 쪽과 불린 쪽이 둘 다 묶인다 — 부르는 것도 오는 것도
     * 시간이 든다. 불린 사람만 묶으면 부르는 쪽이 공짜로 남의 10분을
     * 쓴다.
     *
     * 로봇 부수기는 순식간이라 0분이고, 그때는 아무도 안 묶인다.
     */
    /*
     * **이동과 연구는 여기서 안 묶는다.**
     *
     * 이동의 10분은 이미 걷는 중(arriveAtMs)으로 흐르고 있다. 여기서
     * 또 묶으면 도착하고도 10분을 더 서 있는다.
     *
     * 연구의 20분은 맡겨 두는 시간이다 — 걸어 놓고 돌아다닌다.
     * 대신 찾으러 다시 들어와야 한다(아직 안 붙였다).
     */
    const mins = kind === 'summon' ? ACT_MINUTES[kind] : 0
    if (mins > 0) {
      const until = nowMs + mins * 60_000
      const busy = { busyUntilMs: until, busyKind: ACT_LABEL[kind] }
      const both = kind === 'summon' && act.targetPlayer ? [uid, act.targetPlayer] : [uid]
      for (const id of both) {
        const d = pawns.docs.find((x) => x.id === id)
        if (d) tx.update(d.ref, busy)
      }
    }

    // 팀 상자 — 값을 치른 팀만 쓴다. 토큰과 깃발
    for (const d of teams.docs) {
      const team = d.id as TeamId
      const patch: Record<string, number> = {}
      const after = out.next.wallets[team] ?? 0
      if (after !== (before.wallets[team] ?? 0)) patch.phaseTokens = after
      const flagsLeft = out.next.flagBoxes[team] ?? 0
      if (flagsLeft !== (before.flagBoxes[team] ?? 0)) {
        // 페이즈 몫부터 뺀다. 산 것은 다음 페이즈까지 남아야 한다
        const t = d.data() as TeamDoc
        const box = spendFlags({ given: t.flags ?? 0, bought: t.boughtFlags ?? 0 }, flagsLeft)
        patch.flags = box.given
        patch.boughtFlags = box.bought
      }
      if (Object.keys(patch).length > 0) tx.update(d.ref, patch)
    }
    /*
     * 꽂히거나 뽑힌 깃발, 그리고 **뽑기에 손댄 사람(pulls).** 바뀐 때만 쓴다.
     * 전에는 tiles 만 통째로 써서 pulls 가 한 번도 안 남았다 — 손댈 때마다
     * 늘 첫 손(1/2)이라 두 사람이 손대도 깃발이 영영 안 뽑혔다
     */
    const flagsMoved = JSON.stringify(out.next.flags) !== JSON.stringify(before.flags)
    const pullsMoved = JSON.stringify(out.next.flagPullHits) !== JSON.stringify(before.flagPullHits)
    if (flagsMoved || pullsMoved) {
      tx.set(flagsOf(gameId), { tiles: out.next.flags, pulls: out.next.flagPullHits })
    }
    left = out.next.wallets[(before.people.find((p) => p.playerId === uid) as Person).team] ?? 0

    // 금고 — 연구가 지식을 뺐으면 여기서 적는다
    writeVaults(tx, ref, before.vaults, out.next.vaults)
    writeSatchels(tx, ref, before.satchels, out.next.satchels)

    // 로봇 — 통째로 다시 쓴다. 열몇 기뿐이라 견줄 이유가 없다
    const now = new Set(out.next.robots.map((r) => r.id))
    for (const d of bots.docs) {
      if (now.has(d.id)) continue
      tx.delete(d.ref)
      // 일부러 부순 것 말고 그냥 사라진 것만 따로 센다
      if (d.id !== bot.smashed?.id) {
        const was = before.robots.find((r) => r.id === d.id)
        bot.gone.push({ id: d.id, team: was?.team ?? ('A' as TeamId) })
      }
    }
    for (const r of out.next.robots) tx.set(robotsOf(gameId).doc(r.id), robotRow(r))

    tx.set(hiddenOf(gameId), {
      /*
       * **익는 시각은 서버가 찍는다.** 규칙은 시계를 안 본다 —
       * 어느 연구실에 걸었는지까지가 규칙의 몫이고, 언제 익는지는
       * 시계를 쥔 쪽의 몫이다. 이미 찍힌 것은 그대로 둔다
       */
      pendingResearch: out.next.pendingResearch.map((r) =>
        typeof (r as Brewing).doneAtMs === 'number'
          ? (r as Brewing)
          : {
              ...r,
              doneAtMs: nowMs + ACT_MINUTES.research * 60_000,
              ...(labMachine !== null ? { machine: labMachine } : {}),
            },
      ),
      smashedBy: out.next.smashedBy,
      actedBy: out.next.actedBy,
    })
  })

  // 로봇이 나거나 부서졌으면 한 줄 남긴다. **개인 미션이 이것을 본다** —
  // 과학부의 「3기 이상 만든다」와 기술부의 「남의 팀 것 3기 이상 부순다」가
  // 여기서 나온다. 기술부는 robotGone 을 안 센다 — 아무도 안 부순 것이다
  if (bot.made) {
    await note(gameId, 'robotBorn', nowMs, { id: uid, team: bot.made.team }, {
      tileId: bot.made.tileId,
      subjectId: bot.made.id,
      ownerId: uid,
    })
    await researchTierUp(gameId, bot.made.team)
  }
  if (bot.smashed) {
    await note(gameId, 'robotSmashed', nowMs, { id: uid, team: bot.smashed.byTeam }, {
      tileId: bot.smashed.tileId,
      subjectId: bot.smashed.id,
      // **누구 것을 부쉈나.** 이게 없으면 「남의 팀 짝」을 셀 수 없다
      ...(bot.smashed.ofTeam ? { otherTeam: bot.smashed.ofTeam } : {}),
    })
  }
  for (const g of bot.gone) {
    // 부순 사람이 없으므로 actor 는 이 페이즈를 민 사람이다. 판정은
    // 이 종류를 안 세므로 누구로 적히든 셈에 안 든다
    await note(gameId, 'robotGone', nowMs, { id: uid, team: g.team }, { subjectId: g.id })
  }

  /*
   * **연구를 맡긴 순간이 「만든 것」이다.** 과학부 미션이 이 줄을 센다 —
   * 완성품을 누가 가져가든, 아무도 안 가져가든 맡긴 사람이 만든 것이다
   */
  const job = commissioned as { team: TeamId; tileId: TileId } | null
  if (job) {
    await note(gameId, 'researchStart', nowMs, { id: uid, team: job.team }, {
      tileId: job.tileId,
      ...(labMachine !== null ? { subjectId: `machine${labMachine}` } : {}),
    })
  }

  // 떠나는 순간 그 방의 체류가 끝난다. 걷는 10분 동안은 어느 방에도
  // 없고, 도착하면 따라잡기가 새 방의 체류를 연다
  if (leftFor) await openInterval(gameId, uid, null, nowMs, 'walking')
  // 계단은 0분이라 걷는 중이 없다. 앞 방의 체류를 닫고 계단의 체류를
  // 곧바로 연다 — 안 열면 계단에 서서 떠난 방의 말을 계속 듣는다
  if (steppedTo) await openInterval(gameId, uid, steppedTo, nowMs)
  await refreshViews(gameId)
  // 비밀 기록 — 페이즈 중 행동은 닫힐 때까지 숨긴다. events 는 참가자가 읽는다
  await logSecret(gameId, 'phaseAct', nowMs, uid, { kind, ...(req.data.targetTile ? { targetTile: req.data.targetTile } : {}) }, { day: game.day })
  return { kind, tokens: left, walking: leftFor !== null, ...(myMinutes !== null ? { minutes: myMinutes } : {}) }
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
 * 페이즈를 닫는다. **꽂힌 깃발과 로봇으로 주인을 정한다.**
 *
 * 행동은 이미 그때그때 처리됐다. 여기서 하는 일은 깃발을 세는 것뿐이다.
 * 깃발은 판정이 끝나면 걷는다. 로봇은 그대로 남는다.
 *
 * 판정은 shared/rules/occupy.ts 의 순수 함수가 한다. 여기서는 재료를
 * 모아 주고 결과를 적기만 한다 — 규칙이 서버 안에 흩어지면 시험할 수 없다.
 */
export const closePhase = onCall<{ gameId: string }>(async (req) => {
  requireHost(req.auth)
  const { gameId } = req.data
  const { game, nowMs } = await freshNow(gameId)
  // 한 시간이 다 돼 따라잡기가 먼저 닫았으면 그것으로 답한다 — 오류가 아니다
  if (!game.phaseNow?.open) return { no: game.phaseDone ?? 0, captured: 0, lines: 0, alreadyClosed: true }
  return closePhaseNow(gameId, game, nowMs)
})

/**
 * 페이즈를 닫는다 — 운영자가 닫든, **한 시간이 지나 저절로 닫히든** 같은 길이다.
 * 따라잡기(catchup)가 endsAtMs 를 지나면 그 시각으로 부른다. 그 순간 각 방의
 * 깃발과 로봇으로 주인이 정해지고, 걷는 중이던 사람은 어느 방에도 안 센다.
 */
export async function closePhaseNow(gameId: string, game: GameDoc, nowMs: number) {
  if (!game.phaseNow?.open) throw new HttpsError('failed-precondition', '열린 페이즈가 없다.')
  // **한 번만 닫는다.** 끝 시각 직후에 두 요청이 함께 들어와도 먼저 적은 쪽만
  // 판정한다 — 둘 다 닫으면 무전 줄이 두 번 적히고 기록이 빈 채로 덮인다
  const claimNo = game.phaseNow.no
  const won = await db.runTransaction(async (tx) => {
    const g = (await tx.get(gameRef(gameId))).data() as (GameDoc & { closingNo?: number }) | undefined
    if (!g?.phaseNow?.open || g.phaseNow.no !== claimNo || g.closingNo === claimNo) return false
    tx.update(gameRef(gameId), { closingNo: claimNo })
    return true
  })
  if (!won) return { no: claimNo, captured: 0, lines: 0, alreadyClosed: true }

  const { state } = await loadBoard(gameId)
  const out = settle(state)
  const ref = gameRef(gameId)
  const batch = db.batch()

  // 전투 자리를 지금 자리로 옮긴다. 다음 자유 시간에 아무리 멀리 가도
  // 다음 페이즈에는 여기로 돌아온다. **토큰은 그대로 둔다** — 들고 간다
  for (const p of out.next.people) {
    // 걷는 중이었으면 자리가 없다. 떠난 방을 전선으로 남긴다 —
    // 문 사이에서 페이즈가 끝나면 아무 방도 못 가져간다
    const where = p.tileId ?? (p.toTile as TileId | null)
    // 종이 치면 하던 일도 끝난다. 자유 시간까지 묶여 있을 까닭이 없다
    if (where) {
      batch.update(ref.collection('pawns').doc(p.playerId), {
        postTile: where,
        busyUntilMs: null,
        busyKind: null,
      })
    }
  }

  // 팀 상자. 결석 보정은 없다 — 달라진 것만 옮겨 적는다
  for (const team of TEAMS) {
    const after = out.next.wallets[team] ?? 0
    if (after !== (state.wallets[team] ?? 0)) batch.update(ref.collection('teams').doc(team), { phaseTokens: after })
  }
  // 불발된 연구는 지식을 못 돌려받는다 — vaults 는 그대로 옮겨 적을 뿐이다
  writeVaults(batch, ref, state.vaults, out.next.vaults)
  writeSatchels(batch, ref, state.satchels, out.next.satchels)

  // **꽂힌 깃발은 판정이 끝나면 걷는다.** 로봇은 남는다(아래에서 그대로 옮겨 적는다)
  // **자물쇠도 이 페이즈와 함께 사라진다.** 한 번 건 것은 다시 못 걷는다 — 소모품이다
  for (const tileId of Object.keys(state.locks ?? {})) {
    batch.update(ref.collection('tiles').doc(tileId), { lockedBy: FieldValue.delete(), lockUntilMs: FieldValue.delete() })
  }
  batch.set(flagsOf(gameId), { tiles: out.next.flags, pulls: out.next.flagPullHits })

  const had = await robotsOf(gameId).get()
  for (const d of had.docs) batch.delete(d.ref)
  for (const r of out.next.robots) batch.set(robotsOf(gameId).doc(r.id), robotRow(r))

  for (const [tileId, team] of Object.entries(out.next.owners)) {
    const was = state.owners[tileId as TileId] ?? null
    const now = team ?? null
    if (was === now) continue
    batch.update(ref.collection('tiles').doc(tileId), { ownerTeam: now })
    // 주인이 바뀐 것은 맵(방 색)으로만 안다. 무전에는 안 적는다
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
  /*
   * **누가 무엇을 했는지는 끝나도 안 나온다.** 모두가 읽는 기록에는 방의
   * 결과(어느 분단이 가져갔다)만 남기고, 사람이 적힌 줄은 감독관만 읽는
   * secret 쪽에만 둔다 — 몰래 한 배신이 결과 기록으로 새면 안 된다
   */
  batch.set(ref.collection('phaseLog').doc(String(no)), {
    no,
    day: game.phaseNow.day,
    atMs: nowMs,
    lines: out.log
      .filter((l) => l.kind === 'captured')
      .map((l) => ({ kind: l.kind, ...(l.tileId ? { tileId: l.tileId } : {}), ...(l.team ? { team: l.team } : {}) })),
  })
  batch.set(ref.collection('secret').doc('phaseLog').collection('items').doc(String(no)), {
    no,
    day: game.phaseNow.day,
    atMs: nowMs,
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
  // 이번 페이즈의 기록은 페이즈와 함께 끝난다
  batch.set(hiddenOf(gameId), EMPTY_HIDDEN)

  await batch.commit()
  // 열넷 모두에게 — **결과는 안 싣는다.** 끝났다는 것뿐
  await notify(gameId, game.seats.map((s) => s.playerId), 'phaseEnd', `phaseEnd:${no}`)
  // 내일의 투명인간은 여기서 안 고른다. 하루에 몇 교시를 열지는 날마다
  // 달라서, 운영자가 그날 정산을 넘길 때 센다(ballot.announceBallots)

  /*
   * **제조기에 남은 덫과 연구실의 완성품은 그대로 둔다.** 페이즈 동안은
   * 만든 사람 것이었고, 이제부터는 누구든 가져간다(rules/made · trap)
   */
  /*
   * **문제 종이도 쪽지도 여기서 안 뿌린다.** 운영자가 손으로 놓는다(drop.ts).
   * 펴 둔 것을 도로 접는 일도 없다 — 이제 펴는 물건이 아니라 줍는
   * 물건이고, 주운 사람 손패에 그대로 남는다.
   */
  await refreshViews(gameId)
  await logEvent(gameId, 'phaseClose', nowMs, null, { no, day: game.phaseNow.day, captured: out.log.filter((l) => l.kind === 'captured').length, lines: out.log.length }, { day: game.phaseNow.day })
  // 불변 조건 — 페이즈가 닫힐 때마다 판을 훑어 어긋난 것을 secret/qa 에 남긴다
  try { await checkInvariants(gameId, nowMs) } catch (e) { console.warn('invariants', e) }
  return {
    no,
    captured: out.log.filter((l) => l.kind === 'captured').length,
    lines: out.log.length,
  }
}

// ── 자유 시간의 걸음 ────────────────────────────────────────────

/**
 * 자유 시간에 옆방으로 걸어간다. **즉시 가고 토큰도 안 든다.**
 *
 * 전선은 여기서 움직이지 않는다 — postTile 은 그대로 두고 지금 자리만
 * 옮긴다. 정원은 여기서도 지킨다. 열넷이 좁은 방 하나에 들어가면
 * 페이즈가 열릴 때 돌려보낼 자리가 엉킨다.
 */
/** 지금 잠겨 있는 방과 잠근 팀. 시각이 지난 자물쇠는 없는 것이다. */
function liveLocks(
  docs: readonly FirebaseFirestore.QueryDocumentSnapshot[],
  nowMs: number,
): Partial<Record<TileId, TeamId>> {
  const out: Partial<Record<TileId, TeamId>> = {}
  for (const d of docs) {
    const t = d.data() as TileDoc
    if (!t.lockedBy || (t.lockUntilMs ?? 0) <= nowMs) continue
    out[d.id as TileId] = t.lockedBy
  }
  return out
}

export const roamTo = onCall<{ gameId: string; tileId: TileId; at?: { x: number; y: number } }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, tileId } = req.data
  /*
   * **걸어 들어온 자리.** 화면은 문을 넘어 방 안 한 칸에 선 채로 이것을
   * 부른다. 그 칸이 비었으면 거기, 아니면 거기서 가장 가까운 빈 칸에 세운다 —
   * 그 방 안 칸이 아니면 안 믿고 문 바로 안쪽에서 고른다
   */
  const hx = Math.floor(Number(req.data.at?.x))
  const hy = Math.floor(Number(req.data.at?.y))
  const near = Number.isFinite(hx) && Number.isFinite(hy) ? { x: hx, y: hy } : null
  if (!TILE_BY_ID[tileId]) throw new HttpsError('invalid-argument', '그런 방은 없다.')
  const { game, nowMs } = await freshNow(gameId)
  if (game.phaseNow?.open) throw new HttpsError('failed-precondition', '페이즈 중에는 토큰을 써서 움직인다.')

  const ref = gameRef(gameId)
  let seat: Cell | null = null
  await inTx(async (tx) => {
    const mine = await tx.get(ref.collection('pawns').doc(uid))
    // 페이즈가 닫히면 하던 일도 끊기지만, 그 사이에 이 문으로 들어올
    // 수 있다. 여기서도 한 번 본다
    if (mine.exists) requireFree(mine.data() as PawnDoc, nowMs)
    if (!mine.exists) throw new HttpsError('permission-denied', '이 판에 없는 사람이다.')
    const p = mine.data() as PawnDoc
    if (p.tileId === tileId) throw new HttpsError('failed-precondition', '이미 그 방이다.')

    const here = (p.tileId ?? p.postTile) as TileId
    // **복도로 닿으면 들어간다.** 옆방만 허용하면, 복도 한복판에서
    // 눈앞의 문을 못 여는 일이 생긴다 — 복도는 층을 통째로 잇는다.
    // 어차피 자유 시간 걸음은 공짜고 즉시라, 옆방씩 몇 번 눌러 가는
    // 것과 결과가 같다
    if (!canRoamTo(here, tileId)) throw new HttpsError('failed-precondition', '거기까지는 복도가 안 이어진다.')

    // **자물쇠는 자유 시간을 막지 않는다.** 걸린 자물쇠는 그 페이즈가 끝날 때 사라진다

    /*
     * **자유 시간에는 정원이 없다.**
     *
     * 정원은 페이즈의 규칙이다 — 좁은 방에 몰려 서서 머릿수로 미는
     * 것을 막자고 둔 것이고, 판정이 없는 시간에는 막을 것이 없다.
     * 열넷이 한 교실에 들어가 떠드는 것은 이 놀이가 하라는 일이다.
     * 페이즈 중의 걸음은 여전히 정원을 본다(occupy.ts 의 step).
     */
    // postTile 은 건드리지 않는다. 자유 시간은 전선을 옮기지 못한다.
    // 다만 **발은 들였으니** 지도에는 남는다
    const been = new Set(p.visitedTiles ?? [])
    been.add(tileId)
    /*
     * **앞 방의 칸은 버리고 이 방의 빈 칸에 선다.** 앞 방의 좌표를 들고 가면
     * 새 방에서 엉뚱한 자리에 선 것이 된다. 전에는 비워 두고(null) 화면이
     * 고르게 했는데, 같은 문으로 들어온 여럿이 문 앞 한 칸에 겹쳐 섰다
     */
    const cell = await pickSeat(tx, gameId, uid, tileId, near)
    // **든 로봇은 가방 속이라 같이 간다.** 안 옮기면 앞 방에 남았다가 페이즈 걸음 때 순간이동한다
    const held = await tx.get(robotsOf(gameId).where('carriedBy', '==', uid))
    claimSeat(tx, gameId, uid, cell, nowMs)
    for (const d of held.docs) tx.update(d.ref, { tileId })
    seat = cell
    tx.update(mine.ref, {
      tileId,
      fromTile: here,
      arriveAtMs: null,
      path: [],
      at: cell,
      visitedTiles: [...been],
    })
  })
  // 방을 옮긴 순간 앞 방의 체류가 끝나고 이 방의 체류가 시작된다.
  // 이것이 없으면 옮겨 다녀도 채팅은 처음 방에 머문다 — 늦게 들어온
  // 방의 지난 말까지 읽히거나, 떠난 방의 말이 계속 들린다
  await openInterval(gameId, uid, tileId, nowMs)
  await refreshViews(gameId)
  await logSecret(gameId, 'roamTo', nowMs, uid, { at: seat }, { day: game.day, tileId })
  return { tileId, at: seat }
})

export { ACT_COST, TOKENS_PER_PHASE }

/**
 * 거절당한 사람이 **서 있을 칸.** 화면은 이 칸으로 도로 선다.
 *
 * 서버가 아는 칸이 지금 방(또는 복도) 안이면 그 칸이다. 칸이 없거나(칸을
 * 나눠 주기 전에 시작한 판) 앞 방의 칸이면, 가려던 칸에서 가장 가까운
 * 빈 칸에 세운다 — 칸 없는 사람을 그대로 두면 화면이 돌아갈 곳이 없어서
 * 남의 칸 위에 선 채로 남는다.
 */
async function keepSeat(gameId: string, uid: string, p: PawnDoc, want: Cell): Promise<Cell | null> {
  const room = p.tileId as TileId | null
  if (!room) return p.at ?? null
  const at = p.at ?? null
  if (at && (roomOfCell(at.x, at.y) === room || (roomOfCell(at.x, at.y) === null && isHallCell(at.x, at.y)))) return at
  const { nowMs } = await freshNow(gameId)
  return seatPawn(gameId, uid, room, nowMs, want)
}

/**
 * 방 안 어디에 섰는지 적는다.
 *
 * **걸음마다 적지 않는다.** 화면이 멈춰 설 때 한 번만 보낸다 — 한 칸에
 * 160ms 인 걸음을 칸마다 적으면 열넷이 종일 서버를 두드린다.
 *
 * 서버는 **그 칸이 정말 그 사람이 선 방 안인지**만 본다. 방 안 어디라고
 * 우기는 것까지는 막지 않는다 — 그래 봐야 예전 규칙(같은 방이면 된다)
 * 만큼이고, 그 이상은 벽과 가구를 서버가 다 들고 있어야 한다.
 */
export const standAt = onCall<{ gameId: string; x: number; y: number; via?: { x: number; y: number }[] }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const x = Math.floor(Number(req.data.x))
  const y = Math.floor(Number(req.data.y))
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new HttpsError('invalid-argument', '그런 칸은 없다.')
  /*
   * **지나온 칸들.** 화면은 멈춘 뒤에 한 번만 적어 보내므로, 그 사이
   * 밟고 지나간 복도 칸은 여기에 실려 온다 — 덫은 그 칸들에서 걸린다.
   * 복도 칸만 본다. 방 안에는 덫이 없다
   */
  const via: Cell[] = (Array.isArray(req.data.via) ? req.data.via : [])
    .slice(0, 200)
    .map((c) => ({ x: Math.floor(Number(c?.x)), y: Math.floor(Number(c?.y)) }))
    .filter((c) => Number.isFinite(c.x) && Number.isFinite(c.y) && isHallCell(c.x, c.y))

  const ref = gameRef(gameId).collection('pawns').doc(uid)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('permission-denied', '이 판에 없는 사람이다.')
  const p = snap.data() as PawnDoc
  // 걷는 중에는 어느 칸도 아니다. 도착해서 다시 보낸다
  if (p.tileId === null) return { ok: false, why: '걷는 중이다.' }
  /*
   * **복도 칸도 적는다.**
   *
   * 전에는 「내가 있는 방 안의 칸」만 받았다. 그러면 복도로 나선
   * 사람의 자리가 방 안 어딘가에 멎은 채로 남고, 복도에서 마주친
   * 둘은 서로 옆에 선 것으로 안 쳐진다 — 거래도 못 한다.
   *
   * 방 안이면 **내 방이라야** 하고(남의 방 칸이라고 우길 수는 없다),
   * 복도면 어디든 된다. 복도는 아무의 자리도 아니다.
   */
  const room = roomOfCell(x, y)
  if (room !== null ? room !== p.tileId : !isHallCell(x, y)) {
    throw new HttpsError('failed-precondition', '거기에는 설 수 없다.')
  }
  /*
   * **기물 위에는 못 선다.** 게시판과 자판기가 선 칸이다.
   *
   * 화면도 같은 자로 재서(isWalkable) 애초에 그리로 못 걷지만, 여기서
   * 한 번 더 본다 — 화면이 보내는 값을 믿으면 손으로 부른 요청 하나로
   * 기계 안에 서 있는 사람이 생긴다.
   */
  if (isFixture(x, y)) return { ok: false, code: 'blocked', why: '거기에는 물건이 있다.', at: await keepSeat(gameId, uid, p, { x, y }) }
  /*
   * **가구 · 팻말 위에도 못 선다.** 화면은 가구 배치(furniture.ts)로 막는데
   * 서버는 그 그림 파일을 못 불러서, 한동안 손으로 부른 요청 하나로 책상
   * 위에 설 수 있었다. 막힌 칸을 뽑아 둔 데이터(rules/blocked)를 본다 —
   * 빌드 때 check-map 이 화면과 같은지 맞춰 본다
   */
  if (isBlockedCell(x, y)) return { ok: false, code: 'blocked', why: '거기에는 물건이 있다.', at: await keepSeat(gameId, uid, p, { x, y }) }
  /*
   * **오락기 앞자리는 한 사람이다.** 그 칸에 선 것이 곧 앉은 것이라
   * (rules/arcade), 둘이 한 칸에 서면 한 기계에 둘이 앉는다. 화면은
   * 남이 선 칸으로 안 걷지만, 화면이 보내는 값만 믿으면 끼어 앉는다.
   */
  if (machineAtSeat({ x, y }) !== null && !(p.at?.x === x && p.at?.y === y)) {
    const there = await gameRef(gameId).collection('pawns').where('at.x', '==', x).where('at.y', '==', y).get()
    if (there.docs.some((d) => d.id !== uid)) throw new HttpsError('failed-precondition', '그 기계에는 누가 앉아 있다.')
  }
  /*
   * **덫에 걸려 있으면 그 자리다.** 걸린 칸 말고 다른 칸을 적어 오면
   * 거절한다 — 화면은 pin 으로 도로 세운다
   */
  const { game, nowMs } = await freshNow(gameId)
  /*
   * **투명인간은 칸을 막지 않는다.** 남에게는 안 보이는 사람이라, 그 칸에
   * 서려다 「누가 서 있다」로 튕기면 거기 누가 있는지가 드러난다. 그 사람은
   * 없는 것으로 치고 선다 — 투명이 풀릴 때 겹쳐 있으면 서버가 비켜 세운다
   */
  const ghost = game.invisibleId ?? null
  const blocks = (id: string, d: PawnDoc) => id !== uid && id !== ghost && d.tileId !== null
  if (p.busyKind === '덫' && (p.busyUntilMs ?? 0) > nowMs && !(p.at?.x === x && p.at?.y === y)) {
    throw new HttpsError('failed-precondition', `덫에 걸려 있다. ${Math.ceil(((p.busyUntilMs ?? 0) - nowMs) / 60_000)} 분 남았다.`)
  }
  /*
   * **문제 종이 위에도 못 선다.** 종이는 운영자가 아무 칸에나 놓으므로
   * 규칙 파일에 없다 — 판의 바닥 문서를 본다. **아직 아무도 안 주운
   * 종이만** 자리를 차지한다. 주워 간 자리는 그냥 바닥이다.
   */
  const papers = await gameRef(gameId).collection('secret').doc('quiz').collection('floor').where('heldBy', '==', null).get()
  for (const d of papers.docs) {
    const q = d.data() as { x?: number; y?: number }
    if (q.x === x && q.y === y) throw new HttpsError('failed-precondition', '거기에는 종이가 있다.')
  }
  /*
   * **같은 칸이면 옮길 것이 없다.** 다만 지나온 복도 칸이 실려 왔으면 덫은
   * 본다 — 방에 들어서면 서버가 먼저 칸을 정해 두므로(rules/seat), 복도를
   * 밟고 들어온 사람이 멈춰 적어 보내는 칸이 그 칸과 같을 수 있다
   */
  const same = p.at?.x === x && p.at?.y === y
  if (same && via.length === 0) return { ok: true, same: true }

  /*
   * **한 칸에 한 사람.** 누가 서 있는 칸에는 못 선다.
   *
   * 먼저 지금 그 칸에 선 사람을 본다 — 서버가 세운 자리(시작 자리 등)는
   * 칸 표시 없이도 여기서 걸린다. 그다음 **칸 표시(secret/cells)를 트랜잭션으로
   * 잡는다.** 둘이 같은 칸으로 동시에 오면 같은 표시 문서를 두고 다투므로
   * 먼저 닿은 한 사람만 선다. 진 쪽은 원래 자리에 남는다 — 걸음은 토큰이
   * 안 드므로 잃는 것도 없다. 표시는 그 사람이 아직 그 칸에 있을 때만 유효하다
   * — 떠난 사람의 표시는 덮어쓴다
   */
  if (!same) {
    const there = await gameRef(gameId).collection('pawns').where('at.x', '==', x).where('at.y', '==', y).get()
    if (there.docs.some((d) => blocks(d.id, d.data() as PawnDoc))) {
      return { ok: false, code: 'occupied', why: '누가 서 있다.', at: await keepSeat(gameId, uid, p, { x, y }) }
    }
    const cellRef = cellsOf(gameId).doc(`${x}_${y}`)
    const oldRef = p.at ? cellsOf(gameId).doc(`${p.at.x}_${p.at.y}`) : null
    const took = await inTx(async (tx) => {
      const [claim, old] = await Promise.all([tx.get(cellRef), oldRef ? tx.get(oldRef) : null])
      const by = claim.exists ? (claim.data() as { by: string }).by : null
      if (by && by !== uid && by !== ghost) {
        const o = (await tx.get(gameRef(gameId).collection('pawns').doc(by))).data() as PawnDoc | undefined
        if (o && o.tileId !== null && o.at?.x === x && o.at?.y === y) return false
      }
      tx.set(cellRef, { by: uid, atMs: nowMs })
      if (old?.exists && (old.data() as { by: string }).by === uid) tx.delete(old.ref)
      // **자리도 같은 트랜잭션에서 옮긴다.** 따로 적으면 그 사이에 온 사람이
      // 「표시는 있는데 그 사람이 아직 그 칸에 없다」를 보고 덮어쓴다
      tx.update(ref, { at: { x, y } })
      return true
    })
    if (!took) return { ok: false, code: 'occupied', why: '누가 먼저 섰다.', at: await keepSeat(gameId, uid, p, { x, y }) }
  }

  /*
   * **덫.** 지나온 복도 칸과 지금 선 칸 중 다른 팀 덫이 있는 첫 칸에서
   * 걸린다. 걸리면 거기 선 것으로 적히고 열 분 동안 묶인다 — 걸음도
   * 행동도 requireFree 가 막는다. 밟은 덫은 사라진다.
   *
   * **페이즈 중에만 문다.** 자유 시간에는 덫 위를 지나가도 아무 일이
   * 없고 덫도 그대로 남는다 — 덫은 점령전의 물건이다.
   */
  const snared = game.phaseNow?.open ? await springTrap(gameId, p.team as TeamId, [...via, { x, y }]) : null
  if (snared) {
    const until = nowMs + SNARE_MINUTES * 60_000
    /*
     * **걸린 칸에 누가 서 있으면 그 칸으로 옮기지 않는다.** 덫을 놓은 팀
     * 사람은 제 덫 위에 서도 안 걸리므로, 남의 팀이 지나가다 걸리면 한 칸에
     * 둘이 선다. 그때는 방금 선 칸(x,y)에서 묶인다 — 한 칸에 한 사람은 지킨다
     */
    const onIt = await gameRef(gameId).collection('pawns').where('at.x', '==', snared.x).where('at.y', '==', snared.y).get()
    const free = !onIt.docs.some((d) => blocks(d.id, d.data() as PawnDoc))
    const stay = free ? snared : { x, y }
    await ref.update({ at: stay, busyUntilMs: until, busyKind: '덫' })
    if (free && (snared.x !== x || snared.y !== y)) {
      await cellsOf(gameId).doc(`${snared.x}_${snared.y}`).set({ by: uid, atMs: nowMs })
      await cellsOf(gameId).doc(`${x}_${y}`).delete()
    }
    await gameRef(gameId).collection('notices').doc().set({
      toPlayerId: uid,
      text: `덫에 걸렸다. ${SNARE_MINUTES} 분 동안 못 움직인다.`,
      atMs: nowMs,
    })
    await logSecret(gameId, 'standAt', nowMs, uid, { x, y }, { tileId: p.tileId })
    await refreshViews(gameId)
    return { ok: true, same: false, snared: { ...stay, untilMs: until } }
  }

  /*
   * **점령전 중 방에서 복도로 나서면 5분 묶인다.** 들어서는 5분(phaseAct)과
   * 짝이다 — 나서는 것도 시간이 든다. 자유 시간에는 드나드는 데 시간이 없다
   */
  const leftRoom =
    game.phaseNow?.open === true && !!p.at && p.tileId !== null && roomOfCell(p.at.x, p.at.y) === p.tileId && roomOfCell(x, y) === null
  if (leftRoom) {
    const until = nowMs + EXIT_MINUTES * 60_000
    await ref.update({ busyUntilMs: until, busyKind: '방에서 나가는' })
  }

  await logSecret(gameId, 'standAt', nowMs, uid, { x, y }, { tileId: p.tileId })
  await refreshViews(gameId)
  return { ok: true, same: false, ...(leftRoom ? { leaving: EXIT_MINUTES } : {}) }
})
