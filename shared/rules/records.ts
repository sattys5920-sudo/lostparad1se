// 판이 남기는 다섯 가지 기록.
//
//   위치                  어느 방에 언제부터 언제까지 서 있었나
//   같은 방에 있었던 사람  두 사람의 체류 구간이 겹친 시간
//   거래 내역             누가 누구와 무엇을 주고받았나
//   쪽지 처리             읽고, 건네고, 찢은 일
//   로봇                  만들고, 부수고, 주인이 바뀐 일
//
// **개인 미션은 이 다섯 가지로만 판정한다.** 채팅은 여기에 들어오지
// 않는다 — 손으로 친 말은 연기인지 아닌지 판별할 수 없고, 판정에 쓰이는
// 순간 「미션을 위해 하는 말」이 게임을 덮는다.
//
// 앞의 둘은 체류 구간(secret/intervals)에서 계산한다. 뒤의 셋은 그 일이
// 일어날 때 서버가 한 줄씩 적는다.
//
// 이 파일은 **순수 함수**다. 문서도 시계도 모른다.
import type { TileId } from './board'
import type { TeamId } from './v2'

// ── 적히는 것 ───────────────────────────────────────────────────

export type RecordKind =
  | 'trade'
  | 'slipTake'
  | 'slipRead'
  | 'slipGive'
  | 'slipTear'
  | 'robotBorn'
  | 'robotSmashed'
  // 아무도 안 부쉈는데 사라진 짝. 이적으로 한도가 넘쳐서 지워진 것이다.
  // **기술부는 이걸 안 센다** — 사유를 칸 하나로 두는 대신 종류를 갈랐다
  | 'robotGone'
  | 'robotOwner'
  | 'quizSolved'
  // 자판기. **사는 것과 파는 것을 가른다** — 매점 단골은 산 것만 센다
  | 'vendBuy'
  | 'vendSell'
  // 심부름. 받은 것 · 끝낸 것 · 놓은 것을 다 남긴다
  | 'errandTake'
  | 'errandDone'
  | 'errandQuit'
  // 화분
  | 'potHarvest'
  // 팀이 바뀐 순간. 「그 사건 시점의 팀」이 이 줄들로 되짚어진다
  | 'teamMoved'

/**
 * 일어난 일 한 줄. **secret 아래에만 쌓인다.**
 *
 * 누구에게도 통째로 내려보내지 않는다 — 이 기록을 다 보면 남의 미션이
 * 무엇인지 역산할 수 있다. 판정은 서버에서 하고, 각자에게는 자기
 * 진행도만 간다.
 */
export interface GameRecord {
  kind: RecordKind
  atMs: number
  /** 이 일을 한 사람. */
  actorId: string
  actorTeam: TeamId
  /**
   * 상대가 있는 일이면 그 사람. 거래 상대, 쪽지를 받은 사람.
   *
   * 사람이 없는 일에는 팀만 쓴다 — 부서진 짝이 어느 팀 것이었나,
   * 이적하기 전에 어느 팀이었나.
   */
  otherId?: string | null
  otherTeam?: TeamId | null
  /** 어디에서 일어났나. */
  tileId?: TileId | null
  /** 무엇에 대한 일인가 — 쪽지 id · 로봇 id · 문제 id. */
  subjectId?: string | null
  /**
   * 그 쪽지가 누구의 비밀인가. 로봇이면 처음 만든 사람.
   *
   * 「내 비밀이 적힌 쪽지를 찢는다」와 「내가 만든 로봇이 남의 팀에
   * 있다」가 이 한 칸으로 판정된다.
   */
  ownerId?: string | null
}

// ── 체류 구간 ───────────────────────────────────────────────────

/**
 * 한 사람이 한 방에 머문 한 구간.
 *
 * tileId 가 null 이면 걷는 중이다 — 어느 방에도 없으므로 누구와도
 * 같이 있지 않았다. endMs 가 null 이면 아직 거기 서 있다.
 */
export interface Stay {
  playerId: string
  tileId: TileId | null
  startMs: number
  endMs: number | null
}

/** 아직 안 끝난 구간은 지금까지로 친다. */
const endOf = (s: Stay, nowMs: number): number => s.endMs ?? nowMs

/** 두 구간이 겹친 밀리초. 안 겹치면 0. */
function overlapMs(a: Stay, b: Stay, nowMs: number): number {
  const from = Math.max(a.startMs, b.startMs)
  const to = Math.min(endOf(a, nowMs), endOf(b, nowMs))
  return Math.max(0, to - from)
}

/**
 * 두 사람이 **같은 방에** 함께 있었던 시간의 합.
 *
 * 걷는 중인 구간(tileId === null)은 세지 않는다. 문 사이에서는 어느
 * 방에도 없고, 그때는 마주친 것이 아니다.
 */
export function coStayMs(stays: readonly Stay[], a: string, b: string, nowMs: number): number {
  if (a === b) return 0
  const mine = stays.filter((s) => s.playerId === a && s.tileId !== null)
  const yours = stays.filter((s) => s.playerId === b && s.tileId !== null)
  let total = 0
  for (const x of mine) {
    for (const y of yours) {
      if (x.tileId !== y.tileId) continue
      total += overlapMs(x, y, nowMs)
    }
  }
  return total
}

/**
 * 이만큼 이상 같이 있어 본 사람들. **반장이 이것을 센다.**
 *
 * 「서로 다른 사람 열 명과 1분 이상」은 여기서 나온다.
 */
export function metPeople(
  stays: readonly Stay[],
  me: string,
  leastMs: number,
  nowMs: number,
): string[] {
  const others = [...new Set(stays.map((s) => s.playerId))].filter((id) => id !== me)
  return others.filter((id) => coStayMs(stays, me, id, nowMs) >= leastMs).sort()
}

/** 그 사람이 그 방에 서 있었던 시간의 합. */
export function stayInTileMs(stays: readonly Stay[], playerId: string, tileId: TileId, nowMs: number): number {
  return stays
    .filter((s) => s.playerId === playerId && s.tileId === tileId)
    .reduce((n, s) => n + Math.max(0, endOf(s, nowMs) - s.startMs), 0)
}

/**
 * 그 팀이 가진 방들에 서 있었던 시간의 합. **전학생이 이것을 센다.**
 *
 * 주인은 페이즈마다 바뀌므로 「지금 주인」으로 센다. 구간마다 그때의
 * 주인을 되짚으면 정확하겠지만, 그러려면 소유 이력을 따로 쌓아야 하고
 * 판정이 사람에게 설명하기 어려워진다 — 끝났을 때의 판으로 센다.
 */
export function stayInTeamRoomsMs(
  stays: readonly Stay[],
  playerId: string,
  team: TeamId,
  ownerOf: (id: TileId) => TeamId | null,
  nowMs: number,
): number {
  return stays
    .filter((s) => s.playerId === playerId && s.tileId !== null && ownerOf(s.tileId) === team)
    .reduce((n, s) => n + Math.max(0, endOf(s, nowMs) - s.startMs), 0)
}

/** 발을 들여 본 방. 잠깐 스쳐도 센다 — 「들였다」가 조건이다. */
export function tilesVisited(stays: readonly Stay[], playerId: string): TileId[] {
  const seen = new Set<TileId>()
  for (const s of stays) {
    if (s.playerId !== playerId || s.tileId === null) continue
    seen.add(s.tileId)
  }
  return [...seen].sort()
}

// ── 쌓인 기록 읽기 ──────────────────────────────────────────────

/** 이 사람이 한 일 중 그 종류만. */
export const didBy = (rows: readonly GameRecord[], kind: RecordKind, who: string): GameRecord[] =>
  rows.filter((r) => r.kind === kind && r.actorId === who)

/**
 * 이 사람이 거래한 상대 팀들. **매점 단골과 심부름꾼이 이것을 본다.**
 *
 * 거래는 양쪽 다 한 것으로 친다 — 제안한 쪽만 세면 받기만 한 사람은
 * 아무리 거래해도 안 센 것이 된다.
 */
export function tradedTeams(rows: readonly GameRecord[], who: string): TeamId[] {
  const out = new Set<TeamId>()
  for (const r of rows) {
    if (r.kind !== 'trade') continue
    if (r.actorId === who && r.otherTeam) out.add(r.otherTeam)
    else if (r.otherId === who && r.actorTeam) out.add(r.actorTeam)
  }
  return [...out].sort()
}

// ── 그때 그 방은 누구 것이었나 ──────────────────────────────────

/**
 * 페이즈가 닫힐 때 방 하나의 주인이 정해진 한 줄.
 *
 * 소유는 페이즈가 닫힐 때만 바뀌므로, 이 줄들이 곧 소유 이력이다.
 * 따로 이력을 쌓을 필요가 없었다 — 이미 쌓이고 있었다.
 */
export interface OwnerChange {
  tileId: TileId
  /** 닫힌 뒤의 주인. 아무도 안 섰으면 null. */
  team: TeamId | null
  /** 닫히기 전의 주인. */
  ownerBefore: TeamId | null
  atMs: number
}

/**
 * 그 시각에 그 방은 누구 것이었나.
 *
 * **끝났을 때의 주인으로 세면 안 되는 자리가 있다.** 전학생의 「그 팀
 * 방에 10분 서 있었다」는 서 있던 **그때** 그 팀 것이었느냐를 묻는다.
 * 마지막 페이즈에 주인이 바뀌면, 닷새 내내 A팀 방이던 곳에 서 있던
 * 시간이 통째로 B팀 몫이 되거나 반대가 된다.
 *
 * 그 시각 이전의 마지막 변경을 찾아 그 뒤의 주인을 쓴다. 그전에
 * 아무 변경도 없었으면 첫 줄의 「닫히기 전 주인」이 답이다 —
 * 스물다섯 방이 전부 빈 채로 시작하므로 보통 null 이다.
 */
export function ownerAt(
  changes: readonly OwnerChange[],
  tileId: TileId,
  atMs: number,
): TeamId | null {
  const mine = changes.filter((c) => c.tileId === tileId).sort((a, b) => a.atMs - b.atMs)
  if (mine.length === 0) return null
  let owner: TeamId | null = mine[0].ownerBefore
  for (const c of mine) {
    if (c.atMs > atMs) break
    owner = c.team
  }
  return owner
}

/**
 * 그 사람이 **그때 그 팀 것이던** 방들에 서 있었던 시간의 합.
 *
 * stayInTeamRoomsMs 와 짝이다. 그쪽은 지금 주인으로 세고, 이쪽은
 * 구간마다 그때의 주인을 되짚는다. 한 구간 안에서 주인이 바뀌면
 * 바뀐 지점에서 잘라 센다 — 안 자르면 10분짜리 체류가 두 팀 모두에게
 * 10분씩 들어간다.
 */
export function stayInTeamRoomsAtTimeMs(
  stays: readonly Stay[],
  playerId: string,
  team: TeamId,
  changes: readonly OwnerChange[],
  nowMs: number,
): number {
  let total = 0
  for (const s of stays) {
    if (s.playerId !== playerId || s.tileId === null) continue
    const from = s.startMs
    const to = endOf(s, nowMs)
    if (to <= from) continue
    // 이 구간 안에서 주인이 바뀐 시각들. 구간을 그 지점마다 자른다
    const cuts = changes
      .filter((c) => c.tileId === s.tileId && c.atMs > from && c.atMs < to)
      .map((c) => c.atMs)
      .sort((a, b) => a - b)
    let at = from
    for (const cut of [...cuts, to]) {
      if (ownerAt(changes, s.tileId, at) === team) total += cut - at
      at = cut
    }
  }
  return total
}

/** 이 사람이 낀 거래의 수. 제안한 것과 받은 것을 다 센다. */
export const tradeCount = (rows: readonly GameRecord[], who: string): number =>
  rows.filter((r) => r.kind === 'trade' && (r.actorId === who || r.otherId === who)).length
