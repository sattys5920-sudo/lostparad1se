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
import { ROOF_LANDINGS, TILE_BY_ID, roomOfCell, type Cell, type TileId } from '../../shared/rules/board'
import { capacityOf } from '../../shared/rules/occupy'
import { entryCellOf, nearestOpenHall, seatIn } from '../../shared/rules/seat'
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
 * **페이즈가 열릴 때 정원을 넘은 방을 비운다 — 늦게 들어온 사람부터.**
 *
 * 자유 시간에는 정원이 없어서 좁은 방에 여럿이 들어가 있을 수 있다.
 * 그대로 페이즈를 열면 정원보다 많은 사람이 그 방을 쓴다. 넘친 만큼
 * 그 방에 들어온 시각(inSinceMs)이 늦은 사람부터 문 앞 복도에 세운다.
 * 들어온 시각이 같으면 아무 쪽이나 같은 순서로(id) 가른다.
 *
 * 덫에 묶였거나 하던 일이 있는 사람은 옮기지 않는다 — 머릿수에는 든다.
 * 복도에 빈 칸이 없으면 그 사람은 그대로 둔다. 내보낸 사람을 돌려준다.
 */
export async function pushOutOverflow(gameId: string, nowMs: number): Promise<{ playerId: string; room: TileId }[]> {
  const ref = gameRef(gameId)
  return db.runTransaction(async (tx) => {
    const [pawns, papers] = await Promise.all([tx.get(ref.collection('pawns')), tx.get(papersOf(gameId))])
    const rooms = new Map<TileId, { id: string; p: PawnDoc }[]>()
    for (const d of pawns.docs) {
      const p = d.data() as PawnDoc
      if (p.tileId === null || !p.at || roomOfCell(p.at.x, p.at.y) !== p.tileId) continue
      const list = rooms.get(p.tileId as TileId) ?? []
      list.push({ id: d.id, p })
      rooms.set(p.tileId as TileId, list)
    }
    const taken = takenFrom(pawns.docs, papers.docs, null)
    const out: { playerId: string; room: TileId; cell: Cell }[] = []
    for (const [room, list] of rooms) {
      let over = list.length - capacityOf(room)
      if (over <= 0) continue
      const order = list
        .filter((x) => (x.p.busyUntilMs ?? 0) <= nowMs && (x.p.boundUntilMs ?? 0) <= nowMs)
        .sort((a, b) => (b.p.inSinceMs ?? 0) - (a.p.inSinceMs ?? 0) || b.id.localeCompare(a.id))
      for (const x of order) {
        if (over <= 0) break
        // 옥상은 문 앞 복도가 없다 — 2층 계단통으로 내려선다
        const cell =
          nearestOpenHall(entryCellOf(room), taken) ??
          (room === 'rooftop' ? (ROOF_LANDINGS.map((c) => nearestOpenHall(c, taken)).find((c) => c !== null) ?? null) : null)
        if (!cell) break
        taken.add(`${cell.x},${cell.y}`)
        if (x.p.at) taken.delete(`${x.p.at.x},${x.p.at.y}`)
        out.push({ playerId: x.id, room, cell })
        over--
      }
    }
    for (const o of out) {
      claimSeat(tx, gameId, o.playerId, o.cell, nowMs)
      // 방은 그대로다(tileId) — 문 앞 복도에 선 것이다. 다시 들어가려면 다른 사람과 똑같이 들어간다
      tx.update(ref.collection('pawns').doc(o.playerId), { at: o.cell })
      tx.set(ref.collection('notices').doc(), {
        toPlayerId: o.playerId,
        text: `${TILE_BY_ID[o.room].name}은(는) 정원 ${capacityOf(o.room)} 명을 넘었다. 늦게 들어온 차례로 문 앞 복도에 나왔다.`,
        atMs: nowMs,
      })
    }
    return out.map(({ playerId, room }) => ({ playerId, room }))
  })
}
