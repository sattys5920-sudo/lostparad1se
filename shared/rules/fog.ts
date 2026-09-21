// 안개 — 무엇이 보이는가.
//
// 이 파일은 「화면에서 가린다」가 아니라 「보낼 것을 고른다」를 한다.
// 서버가 views/{playerId}를 만들 때 이걸 거쳐서 담고, 걸러진 말은 문서에
// 아예 들어가지 않는다. 받은 뒤 숨기면 개발자도구로 다 보인다.
//
// 걷는 말의 목적지는 어느 view에도 들어가지 않는다 — 본인 팀 것도.
import { ADJACENCY, HALLS, TILE_BY_ID, tileDistance, type Cell, type TileId } from './board'
import { HALL_SIGHT, INTEL_VISION_BONUS, VISION_RANGE, type TeamId } from './v2'

/**
 * 잠복한 말을 같은 팀도 못 보는가.
 *
 * 규칙 원문은 「누구에게도 보이지 않는다」다. 그대로 읽었다. 같은 팀에게는
 * 보이는 편이 낫다고 판단되면 이 값만 false로 바꾸면 된다 — 본인은 어느
 * 쪽이든 자기 말을 본다.
 */
export const AMBUSH_HIDDEN_FROM_OWN_TEAM = true

/** 서버가 쥐고 있는 말의 실제 위치. 이 모양 그대로는 절대 내보내지 않는다. */
export interface PawnPosition {
  playerId: string
  team: TeamId
  /** 서 있는 칸. 걷는 중이면 null. */
  tileId: TileId | null
  /** 걷는 중일 때 방금 떠난 칸. */
  fromTile: TileId | null
  /** 걷는 중일 때 바로 다음 칸. 목적지가 아니다. */
  toTile: TileId | null
  asleep: boolean
  /** 방 안 어디에 서 있는가. 걷는 중이면 없다. */
  at?: Cell | null
  /** 잠복 카드가 풀리는 시각. 없으면 null. */
  hiddenUntilMs: number | null
}

/** 말 하나에 대해 남이 볼 수 있는 전부. 목적지는 여기 없다. */
export interface PawnView {
  playerId: string
  team: TeamId
  tileId: TileId | null
  fromTile: TileId | null
  toTile: TileId | null
  asleep: boolean
  walking: boolean
  /**
   * 방 안 어디에 서 있는가. **거래가 이것을 본다.**
   *
   * 보이는 사람의 것만 실린다 — 안개를 이미 지나온 자리라 여기서
   * 새로 샐 것은 없다. 어느 방인지가 이미 보이는데 그 방 어디인지를
   * 감출 이유가 없다.
   */
  at?: Cell | null
}

export interface VisionInput {
  /** 우리 칸 전부. 기지를 포함한다. */
  ownedTiles: Iterable<TileId>
  /** 우리 말이 선 칸. 걷는 중인 말은 다음 칸으로 넣는다. */
  myPawnTiles: Iterable<TileId>
  /** 정보부장이 있으면 말 시야가 한 겹 넓어진다. */
  intelOfficer?: boolean
}

function spread(center: TileId, range: number, into: Set<TileId>): void {
  if (!TILE_BY_ID[center]) return
  if (range <= VISION_RANGE) {
    into.add(center)
    if (range >= 1) for (const n of ADJACENCY[center]) into.add(n)
    return
  }
  // 격자 거리로 잰다
  for (const id of Object.keys(ADJACENCY)) {
    if (tileDistance(center, id) <= range) into.add(id)
  }
}

/**
 * 지금 이 팀에게 안개가 걷힌 칸.
 *
 *   우리 칸은 늘 보인다
 *   우리 말이 선 칸과 그 이웃 (정보부장이 있으면 한 겹 더)
 */
export function visibleTiles(input: VisionInput): Set<TileId> {
  const out = new Set<TileId>()
  for (const id of input.ownedTiles) if (TILE_BY_ID[id]) out.add(id)

  const range = VISION_RANGE + (input.intelOfficer ? INTEL_VISION_BONUS : 0)
  for (const id of input.myPawnTiles) spread(id, range, out)
  return out
}

/** 그 말이 지금 잠복 중인가. */
export function isAmbushed(pawn: PawnPosition, nowMs: number): boolean {
  return pawn.hiddenUntilMs !== null && nowMs < pawn.hiddenUntilMs
}

function viewOf(pawn: PawnPosition): PawnView {
  const walking = pawn.tileId === null
  return {
    playerId: pawn.playerId,
    team: pawn.team,
    tileId: pawn.tileId,
    fromTile: walking ? pawn.fromTile : null,
    toTile: walking ? pawn.toTile : null,
    asleep: pawn.asleep,
    walking,
    // 걷는 중에는 어느 칸이라 할 수 없다. 걷는 말은 어느 판정에도 안 센다
    ...(walking || !pawn.at ? {} : { at: pawn.at }),
  }
}

export interface PawnVisionInput {
  viewerId: string
  viewerTeam: TeamId
  pawns: readonly PawnPosition[]
  visible: ReadonlySet<TileId>
  /** 보는 사람이 선 칸. 복도에 섰는지를 이걸로 본다. */
  at?: Cell | null
  nowMs: number
}

/**
 * 복도에서 **서로 눈에 들어오는가.**
 *
 * 둘 다 복도에 있어야 하고, HALL_SIGHT 칸 안이라야 한다. 한때 「같은
 * 복도 구간이면 끝에서 끝까지」였는데 그러면 한 줄이 마흔아홉 칸이라,
 * 복도에 한 번 서는 것으로 그 층 사람이 전부 드러났다.
 *
 * 네모로 잰다(가로세로 중 먼 쪽). 화면이 네모라서 그렇다 — 대각선으로
 * 재면 화면 구석의 사람이 안 보이는 일이 생긴다.
 */
export function nearInHall(a: Cell | null | undefined, b: Cell | null | undefined): boolean {
  if (!a || !b) return false
  if (!inAnyHall(a) || !inAnyHall(b)) return false
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= HALL_SIGHT
}

const inAnyHall = (c: Cell): boolean => HALLS.some((h) => inHallRect(h.rect, c))

const inHallRect = (r: { x: number; y: number; w: number; h: number }, c: Cell): boolean =>
  c.x >= r.x && c.x < r.x + r.w && c.y >= r.y && c.y < r.y + r.h

/**
 * 이 사람의 view에 담을 말들.
 *
 * 자기 말은 무슨 일이 있어도 보인다. 같은 팀 말은 안개와 상관없이 보인다
 * (잠복 중이 아니라면). 다른 팀 말은 안개가 걷힌 칸에 있을 때만 보이고,
 * 걷는 중이면 떠난 칸이나 다음 칸 중 하나가 보이면 보인다.
 */
export function visiblePawns(input: PawnVisionInput): PawnView[] {
  const out: PawnView[] = []
  for (const pawn of input.pawns) {
    if (pawn.playerId === input.viewerId) {
      out.push(viewOf(pawn))
      continue
    }
    if (isAmbushed(pawn, input.nowMs)) {
      if (AMBUSH_HIDDEN_FROM_OWN_TEAM || pawn.team !== input.viewerTeam) continue
      out.push(viewOf(pawn))
      continue
    }
    if (pawn.team === input.viewerTeam) {
      out.push(viewOf(pawn))
      continue
    }
    /*
     * **복도는 트여 있다.**
     *
     * 안개는 방을 덮는다. 복도는 어느 방도 아니라 덮을 것이 없고,
     * 실제로 거기 서면 눈앞에 사람이 보인다 — 방 문을 열고 들어가야
     * 보이는 것과 다르다. **눈에 들어오는 만큼만** 보인다(HALL_SIGHT).
     *
     * 이게 없으면 복도에서 어깨를 맞대고 서 있어도 남남이다. 각자
     * 마지막으로 들어간 방이 다르고 그 방이 서로 안 보이기 때문이다.
     */
    if (nearInHall(input.at, pawn.at)) {
      out.push(viewOf(pawn))
      continue
    }
    const where = pawn.tileId !== null ? [pawn.tileId] : [pawn.fromTile, pawn.toTile]
    if (where.some((id) => id !== null && input.visible.has(id))) out.push(viewOf(pawn))
  }
  return out
}
