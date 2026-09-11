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
import { visiblePawns, visibleTiles, type PawnPosition, type PawnView } from './fog'
import type { CardKind, GoalKind, TeamId, VoteKind } from './v2'
import { TILE_BY_ID, type TileId } from './board'
import { canSeeConfession, canSeeMemory } from '../reveal/archive'
import { noticesFor, type Notice } from '../reveal/notice'

// ── 서버가 쥐고 있는 것 ─────────────────────────────────────────

export interface WorldPawn extends PawnPosition {
  /** 정보부장이면 우리 팀 시야가 한 겹 넓어진다. */
  intelOfficer: boolean
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
  pawns: readonly WorldPawn[]
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
  visibleTiles: TileId[]
  hand: { id: string; kind: CardKind; targetTeam?: TeamId }[]
  goals: { id: string; kind: GoalKind; rivalTeam?: TeamId; revealed: boolean }[]
  commutePlan: { path: TileId[]; plantFlag: boolean } | null
  fakeFlagTiles: TileId[]
  peeked: { voteKind: VoteKind; voterNickname: string }[]
  own: { roleId: string; bondId: string } | null
  handledDays: number[]
  readDays: number[]
  confessions: WorldConfession[]
  memories: { tileId: TileId; team: TeamId; atMs: number }[]
  sightAtMs: number | null
  notices: { id: string; text: string; atMs: number }[]
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

  // 팀이 없으면 안개도 없다. 빈 view를 돌려준다
  if (team === null) {
    return {
      updatedAtMs: world.nowMs,
      visiblePawns: [],
      visibleTiles: [],
      hand: [],
      goals: [],
      commutePlan: null,
      fakeFlagTiles: [],
      peeked: [],
      own: null,
      handledDays: [],
      readDays: [],
      confessions: [],
      memories: [],
      sightAtMs: null,
      notices: noticesFor(world.notices, viewerId).map((n) => ({ id: n.id, text: n.text, atMs: n.atMs })),
    }
  }

  const ours = world.pawns.filter((p) => p.team === team)
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
    visiblePawns: visiblePawns({
      viewerId,
      viewerTeam: team,
      pawns: world.pawns,
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
    // 역할은 **자기 한 줄뿐이다.** 남의 것은 들어가지 않는다
    own: me ? { roleId: me.roleId, bondId: me.bondId } : null,

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
