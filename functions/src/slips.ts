// 쪽지 — 바닥에 떨어진 종이 한 장을 줍고, 읽고, 처리한다.
//
// **적힌 것은 끝까지 secret 아래에만 둔다.** 바닥에 놓인 쪽지는 그 방에
// 선 사람에게 「한 장 있다」까지만 보이고, 문장은 주워서 읽은 사람에게만
// 간다. 문서를 통째로 내려보내고 화면에서 가리면 개발자도구로 다 보인다.
//
// 처리는 셋이다.
//
//   찢기    찢긴 종이가 발밑 옆 바닥에 남는다. 테이프가 있으면 누구든 붙인다
//   두기    선 방에 놓는다. 다음에 그 방에 온 사람이 줍는다
//   건네기  마주 선 사람에게 준다. 값을 부르려면 교역에 실어 보낸다(deal.ts)
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

import { roomOfCell, type Cell, type TileId } from '../../shared/rules/board'
import { atPaper, dropCellNear } from '../../shared/rules/quiz'
import { takenCells } from './notes'
import type { PawnDoc } from '../../shared/model'
import { freshNow, refuseIfSnared, refuseInPractice } from './turn'
import { note } from './records'
import { refreshViews } from './views'
import { gameRef, nowOf, requireUid } from './index'
import { requireHost } from './host'
import { docId } from './ids'
import { fillSubject } from '../../shared/reveal/slips'
import { SLIP_NOTE_BY_ID } from './story/slipNotes'

const NO_SLIP = '그런 쪽지가 없다.'
import { bumpSlips, logEvent } from './qaLog'
import type { GameDoc } from '../../shared/model'

const db = getFirestore()

/**
 * 쪽지 한 장. **secret 아래에 있다.**
 *
 * 바닥에 있으면 tileId 가 차고, 누가 들고 있으면 heldBy 가 찬다.
 * 둘 다 null 인 쪽지는 찢긴 것이다 — 지우지 않고 남겨 둔다. 누가
 * 무엇을 없앴는지가 나중에 이야기가 된다.
 */
export interface SlipDoc {
  /** 옛 문장 표의 번호. 서버가 뿌리던 때의 것이라 이제 늘 비어 있다. */
  textId: string
  /**
   * 쪽지 56장 중 몇 번인가(story/slipNotes). **서버 안에서만 쓴다** —
   * 어떤 투영에도 안 실린다. 번호 앞자리가 역할 번호라, 새면 역할이 드러난다.
   * 문장은 여기 안 적고 읽는 순간 번호로 찾는다.
   */
  noteId?: string
  /** 운영자가 뿌린 날. 배포판의 몰림 경고가 본다 */
  placedDay?: number
  /** 한 번이라도 누가 주웠나. 주웠던 것은 운영자가 회수 못 한다 */
  everHeld?: boolean
  /** 처음 놓인 방과 시각. 운영자 이력이 본다 — 주워 가면 자리가 비므로 따로 둔다 */
  placedTile?: TileId | null
  placedAtMs?: number
  /** 빈 종이에 손으로 적어 둔 사람. 운영자 이력만 본다 */
  writtenBy?: string
  /**
   * 적힌 글. 비밀 쪽지와 메모는 운영자가 놓을 때 적었고(drop.ts), 빈
   * 종이는 사람이 적었다(use.ts). **그래도 secret 아래다** — 주워서
   * 읽은 사람에게만 간다.
   */
  text?: string
  /** 누구의 비밀인가. 운영자가 놓을 때 고른다. 운영자 메모는 비어 있다. */
  subjectId: string
  /**
   * 방 바닥에 있으면 그 방. 들어온 사람에게 「한 장 있다」가 뜨고
   * 방 어디서나 줍는다. 사람이 두고 간 것·힌트 메모가 이쪽이다.
   */
  tileId: TileId | null
  /**
   * **칸 하나에 놓인 것.** 운영자가 짚어 놓은 비밀 쪽지가 이쪽이다 —
   * 맵 바닥에 종이가 그려지고, 그 옆 칸에 서야 줍는다. 복도에도
   * 놓이므로 방이 아니라 칸이다. 주우면 비운다.
   */
  x?: number | null
  y?: number | null
  heldBy: string | null
  /** 한 번이라도 읽은 사람들. 넘겨줘도 읽은 것은 안 잊는다. */
  readBy: string[]
  tornBy: string | null
  /**
   * 찢긴 방. **조각은 그 자리에 남는다.**
   *
   * 찢으면 종이가 세상에서 사라지는 것이 아니라 조각이 된다.
   * 테이프를 가진 사람이 같은 방에 오면 붙일 수 있다(use.ts) —
   * 「영영」에 값이 붙은 예외를 하나 두는 것이다.
   */
  tornAt?: TileId | null
  atMs: number
}

const slipsOf = (gameId: string) => gameRef(gameId).collection('secret').doc('slips').collection('items')


/** 나. 기록에 팀이 들어가므로 자리와 팀을 같이 가져온다. 선 칸도 같이 — 칸에 놓인 쪽지는 옆에 서야 줍는다. */
async function me(gameId: string, uid: string): Promise<{ tileId: TileId | null; team: PawnDoc['team']; at: Cell | null }> {
  const snap = await gameRef(gameId).collection('pawns').doc(uid).get()
  if (!snap.exists) throw new HttpsError('permission-denied', '이 판에 없는 사람이다.')
  const p = snap.data() as PawnDoc
  return { tileId: (p.tileId ?? null) as TileId | null, team: p.team, at: (p.at ?? null) as Cell | null }
}

/** 바닥의 한 칸에 놓인 쪽지인가. */
const onCell = (s: SlipDoc): s is SlipDoc & { x: number; y: number } =>
  s.heldBy === null && s.tornBy === null && typeof s.x === 'number' && typeof s.y === 'number'

/**
 * 바닥에서 줍는다.
 *
 * 방 바닥에 있는 것은 **그 방에 서 있으면** 줍고, 칸에 놓인 것은
 * **그 옆 칸에 서야** 줍는다 — 문제 종이와 같은 자다. 복도에 놓인
 * 쪽지도 있으므로 칸 쪽은 방을 안 본다.
 */
export const takeSlip = onCall<{ gameId: string; slipId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const slipId = docId(req.data.slipId, NO_SLIP)
  const self = await me(gameId, uid)
  const here = self.tileId
  const { game, nowMs } = await freshNow(gameId)
  refuseInPractice(game, '쪽지를 만질')
  await refuseIfSnared(gameId, uid, nowMs)

  let subject = ''
  await db.runTransaction(async (tx) => {
    const ref = slipsOf(gameId).doc(slipId)
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpsError('not-found', NO_SLIP)
    const s = snap.data() as SlipDoc
    // 먼저 주운 사람만 가진다. 둘이 같은 쪽지를 노리면 여기서 갈린다
    if (onCell(s)) {
      if (!atPaper(self.at, { x: s.x, y: s.y })) throw new HttpsError('failed-precondition', '쪽지 옆에 서야 한다.')
    } else {
      if (!here) throw new HttpsError('failed-precondition', '걷는 중이다.')
      if (s.heldBy !== null || s.tileId !== here) throw new HttpsError('failed-precondition', '여기 없는 쪽지다.')
    }
    tx.update(ref, { tileId: null, x: null, y: null, heldBy: uid, everHeld: true })
    subject = s.subjectId
  })
  await note(gameId, 'slipTake', nowMs, { id: uid, team: self.team }, {
    tileId: here ?? undefined,
    subjectId: slipId,
    ownerId: subject,
  })
  await refreshViews(gameId)
  return { slipId }
})

/**
 * 읽는다. 들고 있어야 하고, **읽은 것은 기록에 남는다.**
 *
 * 넘겨주고 나서도 읽었다는 사실은 안 사라진다. 쪽지를 돌려도 이미
 * 아는 사람은 계속 아는 것이 맞다.
 */
export const readSlip = onCall<{ gameId: string; slipId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const slipId = docId(req.data.slipId, NO_SLIP)
  const { game, nowMs } = await freshNow(gameId)
  refuseInPractice(game, '쪽지를 만질')
  await refuseIfSnared(gameId, uid, nowMs)
  let first = false
  let subject = ''
  let isNote = false
  await db.runTransaction(async (tx) => {
    const ref = slipsOf(gameId).doc(slipId)
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpsError('not-found', '그런 쪽지가 없다.')
    const s = snap.data() as SlipDoc
    if (s.heldBy !== uid) throw new HttpsError('permission-denied', '내가 들고 있는 쪽지가 아니다.')
    if (s.readBy.includes(uid)) return
    tx.update(ref, { readBy: [...s.readBy, uid] })
    first = true
    subject = s.subjectId
    isNote = Boolean(s.noteId)
  })
  // 두 번째부터는 안 적는다. 「세 장을 읽는다」가 한 장을 세 번 읽어서
  // 채워지면 안 된다. **손으로 쓴 빈 종이는 안 센다** — 개인 미션은
  // 운영자가 놓은 쪽지(56장) 몫이다
  if (first && isNote) {
    await note(gameId, 'slipRead', nowMs, { id: uid, team: (await me(gameId, uid)).team }, {
      subjectId: slipId,
      ownerId: subject,
    })
  }
  await refreshViews(gameId)
  return { slipId }
})

/**
 * 선 자리에 두고 간다. 다음에 지나가는 사람이 줍는다.
 *
 * **발밑 옆 빈 칸에 놓는다** — 운영자가 뿌린 것과 똑같이 바닥에
 * 종이가 그려지고, 그 옆에 서서 줍는다. 둘레에 빈 칸이 없으면 안
 * 놓는다. 칸 없이 방 바닥에만 두면 맵에 안 보이고 주울 길도 없다.
 */
export const dropSlip = onCall<{ gameId: string; slipId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const slipId = docId(req.data.slipId, NO_SLIP)
  const self = await me(gameId, uid)
  const here = self.tileId
  if (!here) throw new HttpsError('failed-precondition', '걷는 중이다.')
  const cell = self.at ? dropCellNear(self.at, await takenCells(gameId)) : null
  if (!cell) throw new HttpsError('failed-precondition', '여기에는 놓을 자리가 없다.')
  const { game, nowMs } = await freshNow(gameId)
  refuseInPractice(game, '쪽지를 만질')
  await refuseIfSnared(gameId, uid, nowMs)

  let subject = ''
  await db.runTransaction(async (tx) => {
    const ref = slipsOf(gameId).doc(slipId)
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpsError('not-found', '그런 쪽지가 없다.')
    if ((snap.data() as SlipDoc).heldBy !== uid) {
      throw new HttpsError('permission-denied', '내가 들고 있는 쪽지가 아니다.')
    }
    tx.update(ref, { tileId: null, x: cell.x, y: cell.y, heldBy: null })
    subject = (snap.data() as SlipDoc).subjectId
  })
  await note(gameId, 'slipDrop', nowMs, { id: uid, team: self.team }, {
    tileId: here,
    subjectId: slipId,
    ownerId: subject,
  })
  await refreshViews(gameId)
  return { tileId: here }
})

// **손에 든 쪽지는 못 찢는다.** 찢는 것은 바닥에서만 한다(tearSlipHere) —
// 찢긴 종이가 그 자리에 남아야 테이프로 되살리는 일이 뜻을 갖는다.

/**
 * 바닥의 쪽지를 **그 자리에서 읽는다.** 줍지 않는다 — 읽고 나면 그대로
 * 바닥에 있고, 다음 사람도 와서 읽는다.
 *
 * 비밀 쪽지도 메모도 된다. 글은 **이 응답으로만** 간다 — 내 몫(views)에도
 * 안 실린다. 옆 칸에 서야 한다. 비밀 쪽지를 처음 읽으면 주워서 읽은
 * 것과 똑같이 slipRead 한 줄이 남는다(개인 미션이 센다).
 */
export const readSlipHere = onCall<{ gameId: string; slipId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const slipId = docId(req.data.slipId, NO_SLIP)
  const self = await me(gameId, uid)
  const { game, nowMs } = await freshNow(gameId)
  refuseInPractice(game, '쪽지를 만질')
  await refuseIfSnared(gameId, uid, nowMs)
  let first = false
  let doc: SlipDoc | null = null
  await db.runTransaction(async (tx) => {
    const ref = slipsOf(gameId).doc(slipId)
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpsError('not-found', NO_SLIP)
    const s = snap.data() as SlipDoc
    if (!onCell(s)) throw new HttpsError('failed-precondition', '바닥에 없는 쪽지다.')
    if (!atPaper(self.at, { x: s.x, y: s.y })) throw new HttpsError('failed-precondition', '쪽지 옆에 서야 한다.')
    if (!s.readBy.includes(uid)) {
      tx.update(ref, { readBy: [...s.readBy, uid] })
      first = true
    }
    doc = s
  })
  const s = doc as SlipDoc | null
  if (!s) throw new HttpsError('not-found', NO_SLIP)
  // 이름을 끼운 문장 — 주워서 읽을 때(views)와 같은 문장이다
  const owner = game.seats.find((x) => x.playerId === s.subjectId)?.name ?? null
  const line = s.noteId ? fillSubject(SLIP_NOTE_BY_ID[s.noteId]?.text ?? '', owner) : fillSubject(s.text ?? '', owner)
  if (first && s.noteId) {
    await note(gameId, 'slipRead', nowMs, { id: uid, team: self.team }, { subjectId: slipId, ownerId: s.subjectId })
  }
  // 누구의 쪽지인지는 안 돌려준다 — 문장 밑에 주인 이름이 붙으면 역할이 드러난다
  return { line }
})

/**
 * 바닥의 쪽지를 **그 자리에서 찢는다.** 찢긴 종이가 그 칸에 남아 맵에
 * 그려진다. 테이프를 가진 사람이 옆에서 짚으면 다시
 * 붙인다. 비밀 쪽지도 붙인다.
 *
 * 비밀 쪽지를 찢으면 주워서 찢은 것과 똑같이 slipTear 한 줄이 남는다
 * (미화부의 「내 비밀이 적힌 쪽지를 찢는다」가 센다). 메모 · 빈 종이는
 * 어떤 쪽지 미션에도 안 세므로 줄을 안 남긴다.
 */
export const tearSlipHere = onCall<{ gameId: string; slipId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const slipId = docId(req.data.slipId, NO_SLIP)
  const self = await me(gameId, uid)
  const { game, nowMs } = await freshNow(gameId)
  refuseInPractice(game, '쪽지를 만질')
  await refuseIfSnared(gameId, uid, nowMs)
  let torn: SlipDoc | null = null
  await db.runTransaction(async (tx) => {
    const ref = slipsOf(gameId).doc(slipId)
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpsError('not-found', NO_SLIP)
    const s = snap.data() as SlipDoc
    if (!onCell(s)) throw new HttpsError('failed-precondition', '바닥에 없는 쪽지다.')
    if (!atPaper(self.at, { x: s.x, y: s.y })) throw new HttpsError('failed-precondition', '쪽지 옆에 서야 한다.')
    const room = roomOfCell(s.x, s.y) ?? self.tileId ?? s.placedTile ?? null
    tx.update(ref, { tileId: null, heldBy: null, tornBy: uid, tornAt: room, atMs: nowMs })
    torn = s
  })
  const t = torn as SlipDoc | null
  if (t?.noteId) {
    await note(gameId, 'slipTear', nowMs, { id: uid, team: self.team }, { subjectId: slipId, ownerId: t.subjectId })
  }
  await refreshViews(gameId)
  return { torn: true }
})

// **쪽지를 그냥 건네는 길은 없다.** 손을 바꾸는 것은 거래(deals.ts)뿐이다 —
// 거래가 성립할 때 한 장에 한 줄씩 slipGive 가 남아서 개인 미션도 그대로 센다

/**
 * 운영자가 아직 아무도 안 주운 쪽지를 도로 거둔다. **칸에 놓인 것만.**
 *
 * 잘못 놓았을 때 쓴다. 문서를 지우므로 그 사람 앞으로 넉 장 중 한
 * 자리가 다시 빈다. 한 번이라도 누가 주웠던 것은 이미 이야기가 됐으니
 * 못 거둔다.
 */
export const hostPullSlip = onCall<{ gameId: string; slipId: string }>(async (req) => {
  requireHost(req.auth)
  const { gameId } = req.data
  const slipId = docId(req.data.slipId, NO_SLIP)
  await db.runTransaction(async (tx) => {
    const ref = slipsOf(gameId).doc(slipId)
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpsError('not-found', NO_SLIP)
    const s = snap.data() as SlipDoc
    // 한 번이라도 누가 주웠으면 못 거둔다 — 바닥에 도로 놓였어도 이미 이야기가 됐다
    if (!onCell(s) || s.everHeld === true || s.readBy.length > 0) throw new HttpsError('failed-precondition', '누가 주워 갔다.')
    tx.delete(ref)
    // 문서 하나가 사라진다 — 불변식의 기대 장수도 하나 내린다
    bumpSlips(tx, gameId, -1)
  })
  const game = (await gameRef(gameId).get()).data() as GameDoc
  await logEvent(gameId, 'slipPulled', nowOf(game), null, {}, { day: game.day })
  await refreshViews(gameId)
  return { ok: true }
})
