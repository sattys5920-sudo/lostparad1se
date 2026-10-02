// 방에 들어선 사람을 **빈 칸에** 세운다 — 한 칸에 한 사람.
//
// 방에 들어오면(roamTo · 걸어서 도착 · 종이 칠 때 제자리 · 계단) 서버가 칸을
// 정해 준다. 전에는 칸을 비우고(at: null) 화면이 고르게 했다. 같은 문으로
// 여럿이 들어오면 저마다 문 앞 같은 칸을 골랐고, 칸이 없는 사람은 standAt 의
// 「누가 서 있다」에 안 걸려서 둘이 한 칸에 선 채로 남았다.
//
// 고르는 것은 rules/seat 이다. 여기서는 트랜잭션 안에서 **지금 선 사람들과
// 바닥 종이를 읽어** 넘기고, 고른 칸에 칸 표시(secret/cells)를 남긴다 — 같은
// 칸으로 동시에 오는 standAt 이 그 표시를 두고 다툰다.
import { getFirestore, type DocumentSnapshot, type QueryDocumentSnapshot, type Transaction } from 'firebase-admin/firestore'

import type { GameDoc, PawnDoc } from '../../shared/model'
import { ROOF_LANDINGS, roomOfCell, type Cell, type TileId } from '../../shared/rules/board'
import { entryCellOf, nearestOpenHall, nearestOpenHallOffLane, seatIn } from '../../shared/rules/seat'
import { gameRef } from './index'

const db = getFirestore()

/** 칸 표시 — 누가 그 칸에 섰나. 동시에 같은 칸으로 오는 둘을 가른다(standAt). 참가자는 못 읽는다 */
export const cellsOf = (gameId: string) => gameRef(gameId).collection('secret').doc('cells').collection('items')

/** 아직 아무도 안 주운 바닥 종이. 그 칸에는 못 선다 */
const papersOf = (gameId: string) =>
  gameRef(gameId).collection('secret').doc('quiz').collection('floor').where('heldBy', '==', null)

/**
 * 이미 찬 칸들("x,y"). **방에 있는 사람(tileId 가 있는)의 칸**과 안 주운 종이.
 * 걷는 중인 사람은 어느 칸도 아니다. except 는 뺀다(본인).
 *
 * **투명인간(ghost)은 칸을 차지하지 않는다.** 남에게 안 보이는 사람이 칸을
 * 막으면, 빈 칸에 서려다 튕긴 사람이 그 자리에 누가 있는지 알게 된다.
 * 투명이 풀릴 때 겹친 채면 reseatIfShared 가 비켜 세운다.
 */
export function takenFrom(
  pawns: readonly (QueryDocumentSnapshot | DocumentSnapshot)[],
  papers: readonly (QueryDocumentSnapshot | DocumentSnapshot)[],
  except: string | null,
  also: Iterable<Cell> = [],
  ghost: string | null = null,
): Set<string> {
  const out = new Set<string>()
  for (const d of pawns) {
    if (d.id === except || d.id === ghost) continue
    const p = d.data() as PawnDoc | undefined
    if (!p || p.tileId === null || !p.at) continue
    out.add(`${p.at.x},${p.at.y}`)
  }
  for (const d of papers) {
    const q = d.data() as { x?: number; y?: number } | undefined
    if (typeof q?.x === 'number' && typeof q?.y === 'number') out.add(`${q.x},${q.y}`)
  }
  for (const c of also) out.add(`${c.x},${c.y}`)
  return out
}

/**
 * 트랜잭션 안에서 **읽기만** 한다 — 그 방에 설 칸을 골라 돌려준다.
 * 쓰기는 부르는 쪽이 claimSeat 으로 한다(트랜잭션은 읽기가 다 끝난 뒤에 쓴다).
 */
export async function pickSeat(
  tx: Transaction,
  gameId: string,
  uid: string,
  room: TileId,
  near: Cell | null = null,
): Promise<Cell | null> {
  const [pawns, papers, game] = await Promise.all([
    tx.get(gameRef(gameId).collection('pawns')),
    tx.get(papersOf(gameId)),
    tx.get(gameRef(gameId)),
  ])
  const ghost = (game.data() as GameDoc | undefined)?.invisibleId ?? null
  return seatIn(room, takenFrom(pawns.docs, papers.docs, uid, [], ghost), near)
}

/** 고른 칸에 표시를 남긴다. 자리(at)는 부르는 쪽이 같은 트랜잭션에서 적는다 */
export function claimSeat(tx: Transaction, gameId: string, uid: string, cell: Cell | null, atMs: number): void {
  if (!cell) return
  tx.set(cellsOf(gameId).doc(`${cell.x}_${cell.y}`), { by: uid, atMs })
}

/**
 * 한 사람을 그 방의 빈 칸에 세운다 — 트랜잭션 하나. 종이 칠 때 제자리처럼
 * 여럿을 한꺼번에 옮기는 곳이 한 사람씩 부른다. 선 칸을 돌려준다.
 * 그 사이 그 사람이 다른 방으로 갔으면 건드리지 않는다.
 */
export async function seatPawn(gameId: string, uid: string, room: TileId, atMs: number, near: Cell | null = null): Promise<Cell | null> {
  const ref = gameRef(gameId).collection('pawns').doc(uid)
  return db.runTransaction(async (tx) => {
    const mine = await tx.get(ref)
    const p = mine.data() as PawnDoc | undefined
    if (!p || p.tileId !== room) return null
    const cell = await pickSeat(tx, gameId, uid, room, near)
    claimSeat(tx, gameId, uid, cell, atMs)
    tx.update(ref, { at: cell })
    return cell
  })
}

/**
 * 투명이 풀린 사람이 **남과 한 칸에 서 있으면** 가까운 빈 칸으로 비켜 세운다.
 * 투명인간은 칸을 차지하지 않으므로(takenFrom) 그동안 누가 그 칸에 섰을 수
 * 있다. 방 안이면 그 방의 빈 칸, 복도면 가까운 빈 복도 칸(없으면 제 방으로).
 * 겹치지 않았으면 건드리지 않는다. 옮긴 칸을 돌려준다.
 */
export async function reseatIfShared(gameId: string, uid: string, atMs: number): Promise<Cell | null> {
  const ref = gameRef(gameId).collection('pawns').doc(uid)
  return db.runTransaction(async (tx) => {
    const [mine, pawns, papers] = await Promise.all([
      tx.get(ref),
      tx.get(gameRef(gameId).collection('pawns')),
      tx.get(papersOf(gameId)),
    ])
    const p = mine.data() as PawnDoc | undefined
    if (!p || p.tileId === null || !p.at) return null
    const taken = takenFrom(pawns.docs, papers.docs, uid)
    if (!taken.has(`${p.at.x},${p.at.y}`)) return null
    const room = p.tileId as TileId
    const cell = roomOfCell(p.at.x, p.at.y) === room
      ? seatIn(room, taken, p.at)
      : (nearestOpenHall(p.at, taken) ?? seatIn(room, taken))
    if (!cell) return null
    claimSeat(tx, gameId, uid, cell, atMs)
    tx.update(ref, { at: cell })
    return cell
  })
}

/**
 * **페이즈가 열리면 모두 복도에서 시작한다.**
 *
 * 전에는 그 자리 그대로였다. 자유 시간 끝에 원하는 방에 미리 들어가 있던
 * 사람이 토큰도 5 분도 안 내고 점령전을 시작했다. 그래서 종이 치면
 * 방 안에 있던 사람은 **그 방 문 앞 복도**에, 걷던 사람은 **가던 방 문 앞
 * 복도**에 세운다. 우리 분단 방·2-3 교실도 같다. 옥상은 문 앞 복도가 없어
 * 2층 계단통으로 내려선다.
 *
 * 방은 그대로 둔다(tileId) — 복도에 선 것이다. 다시 들어가려면 다른 사람과
 * 똑같이 들어간다(토큰 · 5 분, 점령한 방이면 5 분만). 쫓겨나는 데에는 나가는
 * 5 분을 물리지 않는다. 걷던 사람의 도착 예약은 지운다 — 안 그러면 복도에
 * 세운 뒤에 저절로 방에 들어선다.
 *
 * **덫에 묶인 사람은 옮기지 않는다** — 걸린 칸에서 못 벗어나는 것이 덫이다.
 * 복도에 빈 칸이 없으면 그 사람은 그대로 둔다. 내보낸 사람을 돌려준다.
 */
export async function pushEveryoneOut(gameId: string, nowMs: number): Promise<{ playerId: string; room: TileId; walking: boolean }[]> {
  const ref = gameRef(gameId)
  return db.runTransaction(async (tx) => {
    const [pawns, papers, arrivals] = await Promise.all([
      tx.get(ref.collection('pawns')),
      tx.get(papersOf(gameId)),
      tx.get(ref.collection('schedule').where('doneAtMs', '==', null)),
    ])
    const taken = takenFrom(pawns.docs, papers.docs, null)
    const out: { playerId: string; room: TileId; cell: Cell; walking: boolean }[] = []
    // 같은 순서로 세운다 — 방 이름, 그다음 아이디. 다시 해도 같은 칸이다
    const rows = pawns.docs
      .map((d) => ({ id: d.id, p: d.data() as PawnDoc }))
      .sort((a, b) => String(a.p.tileId ?? a.p.path?.[0] ?? '').localeCompare(String(b.p.tileId ?? b.p.path?.[0] ?? '')) || a.id.localeCompare(b.id))
    for (const { id, p } of rows) {
      if ((p.busyUntilMs ?? 0) > nowMs && p.busyKind === '덫') continue
      const walking = p.tileId === null
      const room = (walking ? (p.path?.[0] ?? p.fromTile ?? null) : p.tileId) as TileId | null
      if (!room) continue
      // 이미 복도에 선 사람은 그대로다
      if (!walking && (!p.at || roomOfCell(p.at.x, p.at.y) !== room)) continue
      const from = entryCellOf(room)
      const roof = room === 'rooftop' ? (ROOF_LANDINGS.map((c) => nearestOpenHallOffLane(c, taken)).find((c) => c !== null) ?? null) : null
      // 문 바로 앞 칸은 비워 둔다 — 다시 들어가는 길이다. 열넷이 한 방에 몰려
      // 있었으면 문 앞이 금방 찬다 — 조금 더 멀리까지 본다
      const cell = room === 'rooftop' ? roof : (nearestOpenHallOffLane(from, taken) ?? nearestOpenHallOffLane(from, taken, 12))
      if (!cell) continue
      taken.add(`${cell.x},${cell.y}`)
      if (p.at && !walking) taken.delete(`${p.at.x},${p.at.y}`)
      out.push({ playerId: id, room, cell, walking })
    }
    for (const o of out) {
      claimSeat(tx, gameId, o.playerId, o.cell, nowMs)
      tx.update(ref.collection('pawns').doc(o.playerId), {
        at: o.cell,
        ...(o.walking ? { tileId: o.room, path: [], arriveAtMs: null } : {}),
      })
      if (o.walking) {
        for (const d of arrivals.docs) {
          const s = d.data() as { kind?: string; payload?: { playerId?: string } }
          if (s.kind === 'arrive' && s.payload?.playerId === o.playerId) tx.update(d.ref, { doneAtMs: nowMs, cancelled: 'phaseOpen' })
        }
      }
    }
    return out.map(({ playerId, room, walking }) => ({ playerId, room, walking }))
  })
}
