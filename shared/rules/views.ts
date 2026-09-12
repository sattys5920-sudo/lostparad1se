// views 투영 — 그 사람이 봐도 되는 만큼만 깎는다.
//
// **이 파일이 누출을 막는 유일한 자리다.**
//
// 규칙(firestore.rules)은 views/{playerId}를 본인에게만 열어 준다.
// 그 안에 무엇이 들어가는지는 규칙이 모른다. 그래서 담는 쪽이 틀리면
// 규칙이 아무리 단단해도 새어 나간다.
//
// 세 가지를 지킨다.
//
//   1. 못 보는 것은 **담지 않는다.** 「못 봄」 표시를 붙여 담지 않는다 —
//      제목 한 줄, 아이디 하나로도 새어 나간다.
//   2. 남의 것은 **애초에 들어오지 않는다.** 열넷 몫을 한 번에 만들되
//      사람마다 따로 판단한다.
//   3. 걷는 말의 **목적지는 어느 view에도 없다.** 본인 팀 것도.
//
// 순수 함수다. Firestore를 모른다 — 그래야 시험할 수 있다.
import { DISGUISE_SHOWN_AS } from './occupy'
import { visiblePawns, visibleTiles, type PawnPosition, type PawnView } from './fog'
import type { CardKind, GoalKind, TeamId, VoteKind } from './v2'
import { TILE_BY_ID, type TileId } from './board'
import { canSeeConfession, canSeeMemory } from '../reveal/archive'
import { noticesFor, type Notice } from '../reveal/notice'

// ── 서버가 쥐고 있는 것 ─────────────────────────────────────────

export interface WorldPawn extends PawnPosition {
  /** 정보부장이면 우리 팀 시야가 한 겹 넓어진다. */
  intelOfficer: boolean
  /** 걷는 중이면 도착 시각. 본인 몫에만 실린다. */
  arriveAtMs?: number | null
  /** 전투 자리. 본인 몫에만 실린다 — 남의 전선 계획까지 보일 이유가 없다. */
  postTile?: TileId | null
}

export interface WorldTile {
  tileId: TileId
  ownerTeam: TeamId | null
  buildings: readonly { kind: string; level: number }[]
}

export interface WorldRoster {
  playerId: string
  team: TeamId
  roleId: string
  bondId: string
}

export interface WorldConfession {
  id: string
  speakerId: string
  scope: 'class' | 'private'
  listenerIds: readonly string[]
  text: string
  atMs: number
}

export interface World {
  nowMs: number
  /** 끝났으면 A의 기억 열셋이 전원에게 열린다. */
  over: boolean
  /**
   * 오늘 지워진 사람. 없으면 null.
   *
   * 이름은 아침에 모두가 안다. 숨기는 것은 **위치**다. 안개보다
   * 먼저 걸러서, 다른 사람에게는 위치 데이터 자체를 보내지 않는다 —
   * 잠복은 「안 보인다」이고 투명인간은 「없는 사람」이다.
   */
  invisibleId: string | null
  pawns: readonly WorldPawn[]
  /** 판 위의 로봇. 사람처럼 안개를 거친다 — 보이는 방의 것만 내려간다. */
  robots?: readonly { id: string; team: TeamId; tileId: TileId; carriedBy: string | null }[]
  /** 지금 위장하고 있는 사람들. 남에게 보이는 숫자를 서버가 부풀린다. */
  disguised?: readonly string[]
  tiles: readonly WorldTile[]
  /** 열넷의 역할. **자기 한 줄만 나간다.** */
  roster: readonly WorldRoster[]
  hands: readonly { id: string; team: TeamId; kind: CardKind; targetTeam?: TeamId }[]
  goals: readonly { id: string; team: TeamId; kind: GoalKind; rivalTeam?: TeamId; revealed: boolean }[]
  plans: readonly { playerId: string; path: readonly TileId[]; plantFlag: boolean }[]
  /** 가짜 깃발. 꽂은 팀만 안다. */
  flagTruth: readonly { tileId: TileId; team: TeamId; fake: boolean }[]
  /** 정보부장이 들여다본 결과. 본 사람만 안다. */
  peeks: readonly { playerId: string; voteKind: VoteKind; voterNickname: string }[]
  /** 교역 제안. 관련된 두 팀만 본다. */
  trades: readonly {
    id: string
    fromTeam: TeamId
    toTeam: TeamId
    give: Record<string, number>
    want: Record<string, number>
    note: string
    status: string
    createdAtMs: number
  }[]
  /** 동맹 제안. 관련된 두 팀만 본다. */
  proposals: readonly { id: string; fromTeam: TeamId; toTeam: TeamId; status: string; createdAtMs: number }[]
  /**
   * DAY 3·4의 선택. **본인 것만 나간다.**
   *
   * 「누가 나를 중요한 사람으로 골랐나」가 보이면 그걸 노리고 서로
   * 붙어 다니게 된다. 고르는 일이 마음이 아니라 수가 된다.
   */
  choices: readonly { playerId: string; chosenId: string | null; day4: string | null }[]
  // ── 진상 공개 흐름 ──
  releasedDays: readonly number[]
  progress: readonly { playerId: string; handledDays: readonly number[]; readDays: readonly number[] }[]
  confessions: readonly WorldConfession[]
  memories: readonly { tileId: TileId; team: TeamId; atMs: number }[]
  /** 깨달음에 이른 시각. A의 시선이 그때 열린다. */
  awakenedAtMs: Readonly<Record<string, number>>
  notices: readonly Notice[]
}

// ── 내려보내는 것 ───────────────────────────────────────────────

export interface View {
  updatedAtMs: number
  visiblePawns: PawnView[]
  /** 보이는 방에 있는 로봇. 머릿수로만 센다. */
  visibleRobots: { id: string; team: TeamId; tileId: TileId }[]
  /**
   * 방마다 **내게 보이는** 머릿수. 미니맵이 이 숫자를 그대로 쓴다.
   *
   * 위장이 여기서 산다. 남의 팀 사람이 위장했으면 둘로 세어 보낸다 —
   * 진짜 수를 보내 놓고 화면에서 부풀리면 개발자도구로 다 보인다.
   * 우리 팀 사람은 위장해도 내게는 하나다.
   */
  roomCounts: Record<TileId, number>
  visibleTiles: TileId[]
  hand: { id: string; kind: CardKind; targetTeam?: TeamId }[]
  goals: { id: string; kind: GoalKind; rivalTeam?: TeamId; revealed: boolean }[]
  commutePlan: { path: TileId[]; plantFlag: boolean } | null
  fakeFlagTiles: TileId[]
  peeked: { voteKind: VoteKind; voterNickname: string }[]
  trades: World['trades'][number][]
  proposals: World['proposals'][number][]
  /** 내가 고른 것. 남이 무엇을 골랐는지는 없다. */
  myChoice: { chosenId: string | null; day4: string | null } | null
  own: { roleId: string; bondId: string } | null
  /**
   * 내 말이 걷는 중이면 도착 시각. 서 있으면 null.
   *
   * **내 것만 넣는다.** 남이 언제 도착하는지까지 알면, 문 앞에서
   * 기다렸다 덮치는 것이 추측이 아니라 계산이 된다. 걷고 있다는
   * 사실은 보이지만(visiblePawns.walking) 몇 분 남았는지는 안 보인다.
   */
  myArriveAtMs: number | null
  /** 내 전투 자리. 자유 시간에 여기서 떨어져 있으면 페이즈 때 돌아온다. */
  myPost: TileId | null
  handledDays: number[]
  readDays: number[]
  confessions: WorldConfession[]
  memories: { tileId: TileId; team: TeamId; atMs: number }[]
  sightAtMs: number | null
  notices: { id: string; text: string; atMs: number }[]
}

/**
 * 방마다 보이는 머릿수. 안 보이는 방은 아예 넣지 않는다.
 *
 * 걷는 사람은 어느 방에도 없다. 위장한 남은 둘로 센다 — 판정이 아니라
 * **보이는 숫자**라서, 여기만 거짓말을 한다.
 */
function countRooms(
  pawns: readonly { playerId: string; team: TeamId; tileId: TileId | null }[],
  robots: readonly { team: TeamId; tileId: TileId }[],
  visible: ReadonlySet<TileId>,
  viewerTeam: TeamId,
  disguised: readonly string[],
): Record<TileId, number> {
  const wearing = new Set(disguised)
  const out: Record<TileId, number> = {}
  for (const p of pawns) {
    if (p.tileId === null || !visible.has(p.tileId)) continue
    const n = p.team !== viewerTeam && wearing.has(p.playerId) ? DISGUISE_SHOWN_AS : 1
    out[p.tileId] = (out[p.tileId] ?? 0) + n
  }
  for (const r of robots) {
    if (!visible.has(r.tileId)) continue
    out[r.tileId] = (out[r.tileId] ?? 0) + 1
  }
  return out
}

/** 관측소를 찾는다. 개조하면 사거리가 두 배다. */
function observatoriesOf(tiles: readonly WorldTile[], team: TeamId) {
  return tiles
    .filter((t) => t.ownerTeam === team)
    .flatMap((t) =>
      t.buildings
        .filter((b) => b.kind === 'observatory')
        .map((b) => ({ tileId: t.tileId, level: b.level })),
    )
}

/**
 * 한 사람 몫.
 *
 * 명단에 없는 사람(구경꾼)이 물어도 터지지 않는다 — 아무것도 없는
 * view가 나간다. 자리에 없는 사람에게 남의 것을 보여 줄 이유가 없다.
 */
export function projectView(world: World, viewerId: string): View {
  const me = world.roster.find((r) => r.playerId === viewerId) ?? null
  const team = me?.team ?? null

  // 지워진 사람은 **남의 시야 계산에 들어가기 전에** 빠진다
  const seenPawns = world.pawns.filter((p) => p.playerId === viewerId || p.playerId !== world.invisibleId)

  // 팀이 없으면 안개도 없다. 빈 view를 돌려준다
  if (team === null) {
    return {
      updatedAtMs: world.nowMs,
      visiblePawns: [],
      visibleRobots: [],
      roomCounts: {},
      visibleTiles: [],
      hand: [],
      goals: [],
      commutePlan: null,
      fakeFlagTiles: [],
      peeked: [],
      trades: [],
      proposals: [],
      myChoice: null,
      own: null,
      myArriveAtMs: null,
      myPost: null,
      handledDays: [],
      readDays: [],
      confessions: [],
      memories: [],
      sightAtMs: null,
      notices: noticesFor(world.notices, viewerId).map((n) => ({ id: n.id, text: n.text, atMs: n.atMs })),
    }
  }

  const ours = seenPawns.filter((p) => p.team === team)
  // 걷는 말은 다음 칸을 기준으로 본다. 목적지가 아니다
  const myPawnTiles = ours
    .map((p) => p.tileId ?? p.toTile)
    .filter((id): id is TileId => id !== null && Boolean(TILE_BY_ID[id]))

  const visible = visibleTiles({
    ownedTiles: world.tiles.filter((t) => t.ownerTeam === team).map((t) => t.tileId),
    myPawnTiles,
    observatories: observatoriesOf(world.tiles, team),
    intelOfficer: ours.some((p) => p.intelOfficer),
  })

  const plan = world.plans.find((p) => p.playerId === viewerId) ?? null

  return {
    updatedAtMs: world.nowMs,
    // 안개 밖의 말은 목록에 없다. 목적지는 어느 말에도 붙지 않는다
    roomCounts: countRooms(seenPawns, world.robots ?? [], visible, team, world.disguised ?? []),

    // 로봇도 안개를 거친다. 보이지 않는 방의 로봇은 아예 안 보낸다
    visibleRobots: (world.robots ?? [])
      .filter((r) => visible.has(r.tileId))
      .map((r) => ({ id: r.id, team: r.team, tileId: r.tileId })),

    visiblePawns: visiblePawns({
      viewerId,
      viewerTeam: team,
      pawns: seenPawns,
      visible,
      nowMs: world.nowMs,
    }),
    visibleTiles: [...visible].sort(),

    // 우리 팀 것
    hand: world.hands
      .filter((c) => c.team === team)
      .map((c) => ({ id: c.id, kind: c.kind, ...(c.targetTeam ? { targetTeam: c.targetTeam } : {}) })),
    goals: world.goals
      .filter((g) => g.team === team)
      .map((g) => ({ id: g.id, kind: g.kind, ...(g.rivalTeam ? { rivalTeam: g.rivalTeam } : {}), revealed: g.revealed })),
    fakeFlagTiles: world.flagTruth.filter((f) => f.team === team && f.fake).map((f) => f.tileId),

    // 내 것
    commutePlan: plan ? { path: [...plan.path], plantFlag: plan.plantFlag } : null,
    peeked: world.peeks
      .filter((p) => p.playerId === viewerId)
      .map((p) => ({ voteKind: p.voteKind, voterNickname: p.voterNickname })),
    // 아직 답하지 않은 제안만. 남의 협상은 들어오지 않는다
    trades: world.trades.filter((t) => t.fromTeam === team || t.toTeam === team),
    proposals: world.proposals.filter((p) => p.fromTeam === team || p.toTeam === team),
    myChoice: (() => {
      const c = world.choices.find((x) => x.playerId === viewerId)
      return c ? { chosenId: c.chosenId, day4: c.day4 } : null
    })(),
    // 역할은 **자기 한 줄뿐이다.** 남의 것은 들어가지 않는다
    own: me ? { roleId: me.roleId, bondId: me.bondId } : null,
    myArriveAtMs: world.pawns.find((p) => p.playerId === viewerId)?.arriveAtMs ?? null,
    myPost: world.pawns.find((p) => p.playerId === viewerId)?.postTile ?? null,

    // 진상 공개 흐름
    handledDays: [...(world.progress.find((p) => p.playerId === viewerId)?.handledDays ?? [])].sort((a, b) => a - b),
    readDays: [...(world.progress.find((p) => p.playerId === viewerId)?.readDays ?? [])].sort((a, b) => a - b),
    // 내가 말했거나 내가 들은 것만. 나머지는 제목조차 없다
    confessions: world.confessions
      .filter((c) => canSeeConfession(c, viewerId))
      .map((c) => ({ ...c, listenerIds: [...c.listenerIds] })),
    // 먼저 가져간 팀만. 끝나면 전원
    memories: world.memories.filter((m) => canSeeMemory(m, team, world.over)),
    // A의 시선은 깨달음에 이른 본인에게만
    sightAtMs: world.awakenedAtMs[viewerId] ?? null,
    notices: noticesFor(world.notices, viewerId).map((n) => ({ id: n.id, text: n.text, atMs: n.atMs })),
  }
}

/** 열넷 몫을 한 번에. 사람마다 따로 판단한다. */
export function projectAll(world: World): Record<string, View> {
  return Object.fromEntries(world.roster.map((r) => [r.playerId, projectView(world, r.playerId)]))
}
