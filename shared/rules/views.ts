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
  /** 이번 페이즈에 남은 토큰. 투영이 본인 몫에만 싣는다. */
  tokens?: number
  /** 전투 자리. 본인 몫에만 실린다 — 남의 전선 계획까지 보일 이유가 없다. */
  postTile?: TileId | null
  /** 가 본 방. 본인 몫에만 실린다. */
  visitedTiles?: readonly TileId[]
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

/**
 * 판 위의 쪽지 하나. **서버만 통째로 본다.**
 *
 * line 은 서버가 이미 이름까지 끼워 넣은 문장이다. 문장 표는
 * functions/src/story/slips.ts 에 있고 번들에 실리지 않는다.
 */
export interface WorldSlip {
  id: string
  subjectId: string
  line: string
  tileId: TileId | null
  heldBy: string | null
  readBy: readonly string[]
}

/**
 * 바닥의 문제 종이 한 장. **정답은 여기에 없다.**
 *
 * 서버가 은행에서 문제와 보기만 떼어 실어 보낸다. 정답과 해설은 어떤
 * 경로로도 나가지 않고, 채점은 서버가 한다.
 */
export interface WorldQuiz {
  id: string
  tileId: TileId
  kind: 'choice' | 'short'
  /** 펼쳐졌을 때만 찬다. 안 펼친 종이는 null 이다. */
  prompt: string | null
  choices: readonly string[]
  openedBy: string | null
  solvedTeam: TeamId | null
  /** 틀린 사람들. 투영이 내 것만 본다. */
  wrongBy: readonly string[]
}

export interface World {
  nowMs: number
  /**
   * 팀마다의 금고. **투영이 내 팀 것만 떼어 보낸다.**
   *
   * 전에는 games/{id}/teams/{t} 를 누구나 읽을 수 있어서 남의 돈과
   * 지식이 그대로 보였다. 「저 팀 지식이 4니까 곧 로봇이 나온다」가
   * 추측이 아니라 계산이 되면 숨길 것이 하나도 남지 않는다.
   */
  vaults?: Readonly<Partial<Record<TeamId, { money: number; knowledge: number }>>>
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
  /** 이번 페이즈에 로봇을 부순 사람. 투영이 내 것만 세어 보낸다. */
  smashedBy?: readonly string[]
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
  /**
   * 오간 말. **마주 선 자리에서만 살아 있다.**
   *
   * 자리를 뜨거나 페이즈가 바뀌면 죽는다. 죽은 말은 투영이 아예 안
   * 싣는다 — 남겨 두면 화면에 「대기 중인 제안」이 쌓이고, 그건
   * 없애기로 한 바로 그것이다.
   */
  trades: readonly {
    id: string
    fromTeam: TeamId
    toTeam: TeamId
    /** 마주 선 그 사람. 팀의 아무나가 아니다. */
    toPlayerId?: string | null
    byId?: string | null
    /** 말을 꺼낸 자리. */
    tileId?: string | null
    /** 살아 있는 범위. 지금 것과 다르면 죽은 말이다. */
    epoch?: string | null
    give: Record<string, number>
    want: Record<string, number>
    note: string
    status: string
    createdAtMs: number
  }[]
  /** 지금의 범위. 투영이 죽은 말을 가르는 데 쓴다. */
  tradeEpoch?: string
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
  /** 판 위의 쪽지 전부. 투영이 여기서 **거의 다 잘라낸다.** */
  slips?: readonly WorldSlip[]
  quizzes?: readonly WorldQuiz[]
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
  /** 이번 페이즈에 내게 남은 토큰. 남의 것은 안 보낸다. */
  myTokens: number
  /** **우리 팀** 금고. 남의 팀 금고는 어떤 경로로도 안 온다. */
  myVault: { money: number; knowledge: number }
  /**
   * 우리 팀 로봇 수. 한도(ROBOTS_PER_TEAM)를 보여 주려면 안개 밖의
   * 것까지 세어야 한다 — 우리 것이므로 다 알아도 된다. 남의 팀 총수는
   * 안 보낸다.
   */
  myTeamRobots: number
  /** 내가 데리고 다니는 로봇 수. 두고 갈 것을 미리 셈하는 데 쓴다. */
  myCarriedRobots: number
  /**
   * 이번 페이즈에 **내가** 부순 로봇 수. 남이 몇 기를 부쉈는지는 안 온다.
   *
   * 한 사람 한 기라서 화면이 버튼을 미리 잠그려면 이 수가 필요하다.
   */
  mySmashes: number
  /**
   * 보이는 방마다 서 있는 로봇 수. 안 보이는 방은 아예 넣지 않는다.
   *
   * 정원과 별개라 roomCounts 와 따로 간다 — 화면이 「사람 3/6 · 로봇 1/2」
   * 을 그대로 그리고, 옮기기 전에 몇 기를 두고 가는지도 여기서 센다.
   */
  robotCounts: Record<TileId, number>
  /**
   * 내가 가 본 방. **한 번도 안 간 방은 지도에 검게 남는다.**
   *
   * 지금 보이는 방(visibleTiles)과는 다르다. 관측소로 멀리 보는 것과
   * 발을 들여 본 것은 다른 일이라, 지도는 둘을 합쳐서 「아는 방」으로
   * 친다 — 어느 쪽도 아니면 서버가 그 방 숫자를 아예 안 보낸다.
   */
  visitedTiles: TileId[]
  handledDays: number[]
  readDays: number[]
  confessions: WorldConfession[]
  /**
   * 내가 선 방 바닥에 있는 쪽지. **한 장 있다는 것까지만이다.**
   *
   * 무엇이 적혔는지도, 누구의 비밀인지도 안 온다. 주워서 읽어야 안다.
   */
  slipsHere: { id: string }[]
  /** 내가 들고 있는 쪽지. 읽은 것만 문장이 실린다. */
  mySlips: { id: string; read: boolean; line: string | null; subjectId: string | null }[]
  /**
   * 내가 선 방의 문제 종이. **안 펼친 것은 「한 장 있다」까지만이다.**
   *
   * 펼치면 그 방 사람 전원에게 문제와 보기가 간다 — 다른 팀 사람 앞에서
   * 여는 것이 이 물건의 전부라, 여기서 팀을 가르면 규칙이 성립하지 않는다.
   * 정답과 해설은 어느 쪽이든 안 온다.
   */
  quizzesHere: {
    id: string
    kind: 'choice' | 'short'
    prompt: string | null
    choices: string[]
    opened: boolean
    /** 내가 이미 틀렸는가. 남이 틀렸는지는 안 온다. */
    iFailed: boolean
  }[]
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
      myTokens: 0,
      myVault: { money: 0, knowledge: 0 },
      myTeamRobots: 0,
      myCarriedRobots: 0,
      mySmashes: 0,
      robotCounts: {},
      visitedTiles: [],
      handledDays: [],
      readDays: [],
      confessions: [],
      slipsHere: [],
      quizzesHere: [],
      mySlips: [],
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
  // 내가 선 방. 걷는 중이면 어느 방에도 없다 — 바닥의 쪽지도 안 보인다
  const here = seenPawns.find((p) => p.playerId === viewerId)?.tileId ?? null

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
    // 죽은 말은 아예 안 싣는다. 「대기 중인 제안」이라는 것이 없다
    trades: world.trades.filter((t) => {
      if (t.status !== 'open') return false
      if (t.epoch && world.tradeEpoch && t.epoch !== world.tradeEpoch) return false
      // 꺼낸 사람과 받을 사람이 **둘 다 아직 그 자리**에 있어야 한다
      if (t.tileId) {
        const at = (id: string | null | undefined) =>
          id ? (world.pawns.find((p) => p.playerId === id)?.tileId ?? null) : null
        if (at(t.byId) !== t.tileId) return false
        if (t.toPlayerId && at(t.toPlayerId) !== t.tileId) return false
      }
      // 나에게 온 말이거나 내가 꺼낸 말만
      if (t.toPlayerId) return t.byId === viewerId || t.toPlayerId === viewerId
      return t.fromTeam === team || t.toTeam === team
    }),
    proposals: world.proposals.filter((p) => p.fromTeam === team || p.toTeam === team),
    myChoice: (() => {
      const c = world.choices.find((x) => x.playerId === viewerId)
      return c ? { chosenId: c.chosenId, day4: c.day4 } : null
    })(),
    // 역할은 **자기 한 줄뿐이다.** 남의 것은 들어가지 않는다
    own: me ? { roleId: me.roleId, bondId: me.bondId } : null,
    myArriveAtMs: world.pawns.find((p) => p.playerId === viewerId)?.arriveAtMs ?? null,
    myPost: world.pawns.find((p) => p.playerId === viewerId)?.postTile ?? null,
    // **내 것만이다.** 남이 토큰을 얼마나 남겼는지 보이면 언제 밀고
    // 들어올지가 읽힌다 — 그게 이 게임의 절반이다
    myTokens: world.pawns.find((p) => p.playerId === viewerId)?.tokens ?? 0,
    myVault: world.vaults?.[team] ?? { money: 0, knowledge: 0 },
    myTeamRobots: (world.robots ?? []).filter((r) => r.team === team).length,
    myCarriedRobots: (world.robots ?? []).filter((r) => r.carriedBy === viewerId).length,
    mySmashes: (world.smashedBy ?? []).filter((id) => id === viewerId).length,
    robotCounts: Object.fromEntries(
      [...visible].map((t) => [t, (world.robots ?? []).filter((r) => r.tileId === t).length]),
    ) as Record<TileId, number>,
    visitedTiles: [...(world.pawns.find((p) => p.playerId === viewerId)?.visitedTiles ?? [])].sort(),

    // 진상 공개 흐름
    handledDays: [...(world.progress.find((p) => p.playerId === viewerId)?.handledDays ?? [])].sort((a, b) => a - b),
    readDays: [...(world.progress.find((p) => p.playerId === viewerId)?.readDays ?? [])].sort((a, b) => a - b),
    // 내가 말했거나 내가 들은 것만. 나머지는 제목조차 없다
    confessions: world.confessions
      .filter((c) => canSeeConfession(c, viewerId))
      .map((c) => ({ ...c, listenerIds: [...c.listenerIds] })),
    // **바닥의 쪽지는 「한 장 있다」까지만.** 무엇이 적혔는지도, 누구의
    // 비밀인지도 안 간다 — 주워서 읽어야 안다
    slipsHere: (world.slips ?? [])
      .filter((s) => here !== null && s.tileId === here)
      .map((s) => ({ id: s.id })),
    // **안 펼친 문제는 「한 장 있다」까지만.** 펼치면 그 방 사람
    // 전원에게 문제와 보기가 간다 — 다른 팀 사람 앞에서 여는 것이
    // 이 물건의 전부라, 여기서 팀을 가르면 규칙이 성립하지 않는다.
    // 정답과 해설은 어느 쪽이든 안 간다
    quizzesHere: (world.quizzes ?? [])
      .filter((q) => here !== null && q.tileId === here && q.solvedTeam === null)
      .map((q) => {
        const opened = q.openedBy !== null
        return {
          id: q.id,
          kind: q.kind,
          prompt: opened ? q.prompt : null,
          choices: opened ? [...q.choices] : [],
          opened,
          // 남이 틀렸는지는 안 간다. 「저 사람은 이미 틀렸다」를 알면
          // 누가 무엇을 모르는지가 공개 정보가 된다
          iFailed: q.wrongBy.includes(viewerId),
        }
      }),
    // 들고 있는 것. **읽은 것만 문장이 실린다** — 주웠다고 저절로
    // 읽히면 「읽는다」가 아무 일도 아닌 것이 된다
    mySlips: (world.slips ?? [])
      .filter((s) => s.heldBy === viewerId)
      .map((s) => {
        const read = s.readBy.includes(viewerId)
        // **읽어야 문장이 온다.** 안 읽었으면 적힌 것도, 누구의
        // 비밀인지도 안 간다
        return { id: s.id, read, line: read ? s.line : null, subjectId: read ? s.subjectId : null }
      }),
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
