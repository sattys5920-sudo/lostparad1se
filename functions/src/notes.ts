// 쪽지 56장 배포 — 운영자 화면의 「쪽지」 탭이 부른다. **운영자만.**
//
// 한 장에 문서 하나(secret/slips/items/{무작위 번호}). 그 쪽지의 문서가
// 없으면 대기, 있으면 판에 나간 것이다. **문서 번호를 쪽지 번호로 쓰지
// 않는다** — 쪽지 id 는 줍는 사람 화면까지 가는데, r04 가 보이면 4번 역할이
// 드러난다. 쪽지 번호는 문서 안(noteId)에만 둔다. 줍기 · 읽기 · 두기 · 건네기 · 찢기는 원래
// 쪽지 규칙 그대로다(slips.ts).
//
// **문안은 여기서도 안 적는다.** 문서에는 쪽지 번호(noteId)와 주인
// (그 역할을 받은 사람)만 들어가고, 문장은 읽는 순간 투영이 번호로
// 찾아 이름을 끼워 넣는다(views.ts). roleKey 는 문서에도 안 들어간다 —
// 주인이 누구인지만 알면 되고, 어느 역할인지는 번호가 서버 안에서만 안다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

import { SLIP_NOTES, SLIP_NOTE_BY_ID } from './story/slipNotes'
import { canonRoleId } from '../../shared/missions/roleNames'
import { fillSubject } from '../../shared/reveal/slips'
import { freeDropCell } from '../../shared/rules/quiz'
import { TILE_BY_ID, roomOfCell, type TileId } from '../../shared/rules/board'
import {
  LATE_FROM_DAY,
  SCATTER_ROOMS,
  needsEarlyConfirm,
  planScatter,
  type BoardNote,
  type SlipState,
} from '../../shared/rules/slipBoard'
import type { GameDoc, RosterDoc } from '../../shared/model'
import type { SlipDoc } from './slips'
import { refreshViews } from './views'
import { gameRef, nowOf } from './index'
import { requireHost } from './host'
import { bumpSlips, logEvent } from './qaLog'

const db = getFirestore()

const slipsOf = (gameId: string) => gameRef(gameId).collection('secret').doc('slips').collection('items')
const floorOf = (gameId: string) => gameRef(gameId).collection('secret').doc('quiz').collection('floor')
const rosterOf = (gameId: string) => gameRef(gameId).collection('secret').doc('roster').collection('items')

/** 역할 번호 1~14. 쪽지 번호 앞자리(r01)다 */
const noOf = (noteId: string) => Number(noteId.slice(1, 3))

async function runningGame(gameId: string): Promise<GameDoc> {
  const snap = await gameRef(gameId).get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  const game = snap.data() as GameDoc
  if (game.phase !== 'running') throw new HttpsError('failed-precondition', '판이 돌고 있을 때만 뿌린다.')
  return game
}

/** 역할 → 그 역할을 받은 사람. 배정 전이면 비어 있다 */
async function ownersByRole(gameId: string): Promise<Map<string, string>> {
  const snap = await rosterOf(gameId).get()
  // 옛 판의 옛 키(snacker · locker)도 지금 키로 읽는다
  return new Map(snap.docs.map((d) => [canonRoleId((d.data() as RosterDoc).roleId) ?? '', (d.data() as RosterDoc).playerId]))
}

/** 지금 종이가 놓인 칸("x,y"). 쪽지와 문제 종이 모두 — 한 칸에 한 장이다 */
export async function takenCells(gameId: string): Promise<Set<string>> {
  const [slips, floor] = await Promise.all([slipsOf(gameId).get(), floorOf(gameId).get()])
  const out = new Set<string>()
  for (const d of slips.docs) {
    const s = d.data() as SlipDoc
    if (s.heldBy === null && s.tornBy === null && typeof s.x === 'number' && typeof s.y === 'number') out.add(`${s.x},${s.y}`)
  }
  for (const d of floor.docs) {
    const q = d.data() as { x: number; y: number; heldBy: string | null; solvedBy: string | null }
    if (q.heldBy === null && q.solvedBy === null) out.add(`${q.x},${q.y}`)
  }
  return out
}

/** 쪽지 문서 하나의 상태 */
export function stateOf(s: SlipDoc | null): SlipState {
  if (!s) return 'waiting'
  if (s.tornBy) return 'torn'
  if (s.heldBy) return 'held'
  return 'placed'
}

/** 바닥에 있으면 그 방. 칸에 놓인 것은 칸으로 방을 찾는다 */
export function roomOfSlip(s: SlipDoc): TileId | null {
  if (typeof s.x === 'number' && typeof s.y === 'number') return roomOfCell(s.x, s.y)
  return s.tileId ?? null
}

/**
 * 한 장을 뿌린다. 트랜잭션 안에서 **대기인지 다시 본다** — 둘이 같은
 * 쪽지를 동시에 누르면 한쪽만 나간다.
 */
async function place(
  gameId: string,
  game: GameDoc,
  noteId: string,
  room: TileId,
  owners: Map<string, string>,
  taken: Set<string>,
): Promise<{ x: number; y: number }> {
  const note = SLIP_NOTE_BY_ID[noteId]
  if (!note) throw new HttpsError('invalid-argument', '그런 쪽지가 없다.')
  if (!SCATTER_ROOMS.includes(room)) throw new HttpsError('invalid-argument', '거기에는 못 뿌린다.')
  // **쪽지의 주인은 그 역할을 받은 사람이다.** 배정 전이면 주인이 없다
  const subjectId = owners.get(note.roleKey)
  if (!subjectId) throw new HttpsError('failed-precondition', '역할을 아직 안 나눴다.')
  const cell = freeDropCell(room, taken)
  if (!cell) throw new HttpsError('failed-precondition', `${TILE_BY_ID[room].name}에는 빈 칸이 없다.`)
  const ref = slipsOf(gameId).doc()
  await db.runTransaction(async (tx) => {
    const now = await tx.get(slipsOf(gameId).where('noteId', '==', noteId).limit(1))
    if (!now.empty) throw new HttpsError('failed-precondition', '이미 뿌린 쪽지다.')
    const doc: SlipDoc = {
      textId: '',
      noteId,
      subjectId,
      tileId: null,
      x: cell.x,
      y: cell.y,
      heldBy: null,
      readBy: [],
      tornBy: null,
      tornAt: null,
      placedDay: game.day,
      everHeld: false,
      placedTile: room,
      placedAtMs: nowOf(game),
      atMs: nowOf(game),
    }
    tx.set(ref, doc)
    // 문서 하나가 생긴다 — 불변식의 기대 장수도 하나 올린다
    bumpSlips(tx, gameId, 1)
  })
  taken.add(`${cell.x},${cell.y}`)
  // 어느 쪽지인지(noteId)는 안 적는다 — 번호 앞자리가 역할이다
  await logEvent(gameId, 'slipScattered', nowOf(game), null, {}, { day: game.day, tileId: room })
  return cell
}

/**
 * 배포판. 56장 전부 — 상태 · 방 · 든 사람 · 뿌린 날, 그리고 **문안 전문**
 * (운영자에게만. {이름}은 실제 이름으로 바꿔서).
 */
export const hostSlipBoard = onCall<{ gameId: string }>(async (req) => {
  requireHost(req.auth)
  const { gameId } = req.data
  const snap = await gameRef(gameId).get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  const game = snap.data() as GameDoc
  const [owners, slips] = await Promise.all([ownersByRole(gameId), slipsOf(gameId).get()])
  const byNote = new Map<string, SlipDoc & { docId: string }>()
  for (const d of slips.docs) {
    const s = d.data() as SlipDoc
    if (s.noteId) byNote.set(s.noteId, { ...s, docId: d.id })
  }
  const nameOf = (id: string | null | undefined) => (id ? (game.seats.find((st) => st.playerId === id)?.name ?? null) : null)
  const notes: BoardNote[] = SLIP_NOTES.map((n) => {
    const s = byNote.get(n.id) ?? null
    const state = stateOf(s)
    return {
      id: n.id,
      no: noOf(n.id),
      roleKey: n.roleKey,
      slot: n.slot,
      kind: n.kind,
      state,
      slipId: s?.docId ?? null,
      room: s && state === 'placed' ? roomOfSlip(s) : null,
      holder: s && state === 'held' ? nameOf(s.heldBy) : null,
      placedDay: s?.placedDay ?? null,
      everHeld: s ? (s.everHeld ?? s.readBy.length > 0) : false,
      text: fillSubject(n.text, nameOf(owners.get(n.roleKey))),
    }
  })
  return { day: game.day, running: game.phase === 'running', assigned: owners.size > 0, lateFromDay: LATE_FROM_DAY, notes }
})

/**
 * 한 장을 고른 방에 뿌린다. 방 안의 빈 칸 하나에 놓인다.
 *
 * **3~4번(그날)을 DAY 3 전에 뿌리려면 confirmEarly 를 같이 보내야 한다.**
 * 화면이 한 번 더 묻고, 물은 뒤에만 보낸다.
 */
export const hostScatterSlip = onCall<{ gameId: string; noteId: string; tileId: string; confirmEarly?: boolean }>(
  async (req) => {
    requireHost(req.auth)
    const { gameId, noteId } = req.data
    const room = String(req.data.tileId ?? '') as TileId
    const game = await runningGame(gameId)
    const note = SLIP_NOTE_BY_ID[noteId]
    if (!note) throw new HttpsError('invalid-argument', '그런 쪽지가 없다.')
    if (needsEarlyConfirm(note.slot, game.day) && req.data.confirmEarly !== true) {
      throw new HttpsError('failed-precondition', `3~4번(그날)은 DAY ${LATE_FROM_DAY}부터다. 그래도 뿌리려면 한 번 더 확인한다.`)
    }
    const [owners, taken] = await Promise.all([ownersByRole(gameId), takenCells(gameId)])
    const cell = await place(gameId, game, noteId, room, owners, taken)
    await refreshViews(gameId)
    return { noteId, room, where: TILE_BY_ID[room]?.name ?? '', ...cell }
  },
)

/**
 * 무작위로 n장. **고르는 것도 서버가 한다**(rules/slipBoard.planScatter) —
 * 대기 중인 것에서, 3~4번(그날)은 DAY 3 이후에만, 한 역할이 같은 날 두 장이
 * 안 되게, 쪽지가 없는 방부터.
 */
export const hostScatterRandom = onCall<{ gameId: string; n: number }>(async (req) => {
  requireHost(req.auth)
  const { gameId } = req.data
  const n = Math.max(1, Math.min(SLIP_NOTES.length, Math.floor(Number(req.data.n) || 0)))
  const game = await runningGame(gameId)
  const [owners, taken, slips] = await Promise.all([ownersByRole(gameId), takenCells(gameId), slipsOf(gameId).get()])
  const byNote = new Map<string, SlipDoc>()
  for (const d of slips.docs) {
    const s = d.data() as SlipDoc
    if (s.noteId) byNote.set(s.noteId, s)
  }
  const plan = planScatter({
    day: game.day,
    n,
    notes: SLIP_NOTES.map((x) => {
      const s = byNote.get(x.id) ?? null
      const state = stateOf(s)
      return { id: x.id, roleKey: x.roleKey, slot: x.slot, state, placedDay: s?.placedDay ?? null, room: s && state === 'placed' ? roomOfSlip(s) : null }
    }),
  })
  const done: { noteId: string; where: string }[] = []
  for (const p of plan) {
    try {
      await place(gameId, game, p.id, p.room, owners, taken)
      done.push({ noteId: p.id, where: TILE_BY_ID[p.room].name })
    } catch {
      // 그 방이 찼으면 건너뛴다. 몇 장이 나갔는지는 돌려주는 수가 말한다
    }
  }
  if (done.length > 0) await refreshViews(gameId)
  return { asked: n, scattered: done.length, done }
})
