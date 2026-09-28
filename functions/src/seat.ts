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

import type { PawnDoc } from '../../shared/model'
import type { Cell, TileId } from '../../shared/rules/board'
import { seatIn } from '../../shared/rules/seat'
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
 */
export function takenFrom(
  pawns: readonly (QueryDocumentSnapshot | DocumentSnapshot)[],
  papers: readonly (QueryDocumentSnapshot | DocumentSnapshot)[],
  except: string | null,
  also: Iterable<Cell> = [],
): Set<string> {
  const out = new Set<string>()
  for (const d of pawns) {
    if (d.id === except) continue
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
  const [pawns, papers] = await Promise.all([tx.get(gameRef(gameId).collection('pawns')), tx.get(papersOf(gameId))])
  return seatIn(room, takenFrom(pawns.docs, papers.docs, uid), near)
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
