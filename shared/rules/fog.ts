// 안개 — 무엇이 보이는가.
//
// 이 파일은 「화면에서 가린다」가 아니라 「보낼 것을 고른다」를 한다.
// 서버가 views/{playerId}를 만들 때 이걸 거쳐서 담고, 걸러진 말은 문서에
// 아예 들어가지 않는다. 받은 뒤 숨기면 개발자도구로 다 보인다.
//
// 걷는 말의 목적지는 어느 view에도 들어가지 않는다 — 본인 팀 것도.
import { HALLS, TILE_BY_ID, isAlleyCell, roomOfCell, type Cell, type TileId } from './board'
import { HALL_SIGHT, type TeamId } from './v2'

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

/**
 * 안개가 걷힌 방. **내가 들어가 있는 방 하나뿐이다.**
 *
 * 몇 명이 있는지는 들어가야만 안다. 전에는 우리 팀이 쥔 방 전부와,
 * 우리 팀 누구든 선 방의 **이웃까지** 보였다(정보부장은 한 겹 더).
 * 그러면 문 앞에 서기만 해도 옆 교실이 몇 명인지 알아서, 들어갈지
 * 말지를 재 볼 일이 없었다. 이제 문을 열어야 안다.
 *
 * **같은 팀도 마찬가지다.** 한때 우리 팀은 어디 있든 보였는데, 그러면
 * 팀원이 선 방마다 그 안이 비쳤다 — 「들어가야 안다」가 우리 팀에게만
 * 안 먹혔다. 복도에서 눈앞에 보이는 사람은 팀과 상관없이 보인다(nearInHall).
 */
export function visibleTiles(input: { myRoom: TileId | null }): Set<TileId> {
  const out = new Set<TileId>()
  if (input.myRoom !== null && TILE_BY_ID[input.myRoom]) out.add(input.myRoom)
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
  /*
   * **뒷골목은 한눈에 들어온다.** 가로 열넷 칸짜리 골목이라 HALL_SIGHT
   * 로 자르면 오락기 줄 끝에 앉은 사람이 반대쪽 끝 사람을 못 본다 —
   * 다른 기계에 대결을 걸려면 거기 누가 앉았는지 보여야 한다.
   * 둘 다 골목 안일 때만이다. 골목 입구에서 학교 복도까지 트이지 않는다.
   */
  if (isAlleyCell(a.x, a.y) && isAlleyCell(b.x, b.y)) return true
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= HALL_SIGHT
}

const inAnyHall = (c: Cell): boolean => HALLS.some((h) => inHallRect(h.rect, c))

const inHallRect = (r: { x: number; y: number; w: number; h: number }, c: Cell): boolean =>
  c.x >= r.x && c.x < r.x + r.w && c.y >= r.y && c.y < r.y + r.h

/**
 * 이 사람의 view에 담을 말들.
 *
 * 자기 말은 무슨 일이 있어도 보인다. **남은 팀과 상관없이** 안개가 걷힌
 * 방(내가 들어가 있는 방) 안에 있거나, 둘 다 복도에서 눈에 들어올 때만
 * 보인다. 걷는 중이면 떠난 칸이나 다음 칸 중 하나가 보이면 보인다.
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
    /*
     * **선 칸이 어느 방인가로 본다.** 복도로 나선 사람도 tileId 는 마지막
     * 방으로 남는다(standAt 은 at 만 고친다) — 그걸로 보면 그 방 안에서
     * 문밖 복도에 선 사람이 비쳤다. 칸이 있으면 칸의 방, 칸이 복도면 어느
     * 방에도 없는 것이다(복도는 위의 nearInHall 이 맡는다).
     */
    const room = pawn.tileId === null ? null : pawn.at ? roomOfCell(pawn.at.x, pawn.at.y) : pawn.tileId
    const where = pawn.tileId !== null ? [room] : [pawn.fromTile, pawn.toTile]
    if (where.some((id) => id !== null && input.visible.has(id))) out.push(viewOf(pawn))
  }
  return out
}
