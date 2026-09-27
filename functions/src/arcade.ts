// 오락실 — 뒷골목 기계 열 대. 혼자 하는 판, 다른 기계를 불러 하는 판.
//
// **한 판은 늘 방 하나다**(arcadeRooms). 기계 앞에 앉은 사람이 게임을
// 고르면 방이 서고, 여럿이 하는 게임이면 다른 기계에 앉은 사람을
// 부른다. 받은 사람이 들어오고, 부른 사람이 시작을 누르면 판이 열린다.
//
// **앉아 있어야 한다.** 기계 앞자리(rules/arcade 의 seat)에 선 것이
// 앉은 것이다. 고를 때도, 부를 때도, 받을 때도, 한 수 둘 때도 서버가
// pawns 의 at 을 본다 — 화면이 보낸 자리는 안 믿는다.
//
// **판정은 서버가 한다.**
//
//   ㆍ 업다운의 숫자는 secret 에만 있고 판이 끝나야 방 문서로 간다
//   ㆍ 가위바위보에서 먼저 낸 수는 secret 에 봉인되고, 방 문서에는
//     「냈다」만 선다. 둘 다 내야 한 트랜잭션 안에서 편다
//   ㆍ 손 게임(리듬…)은 화면이 누른 기록을 보내면 서버가 같은 규칙으로
//     다시 돌려 점수를 낸다. **점수는 다 끝날 때까지 secret 에 있다** —
//     먼저 끝낸 사람의 점수를 보고 나머지가 맞춰 칠 수 없다
//
// 보상은 아직 없다. 판이 끝나면 records 에 arcadeDone 한 줄을 남긴다 —
// 무엇을 줄지 정하는 날 그 줄을 센다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore, type Transaction } from 'firebase-admin/firestore'

import {
  ARCADE_BY_ID,
  ARCADE_COUNTDOWN_MS,
  LIVE_ROOM,
  UPDOWN_NO,
  inMembers,
  isArcadeGameId,
  isRpsPick,
  machineAtSeat,
  roomAfterLeave,
  rpsResolve,
  settleRoom,
  updownGuess,
  updownNew,
  type ArcadeGameId,
  type ArcadeOutcome,
  type RoomDoc,
  type RoomMember,
  type RoomResult,
  type RpsPick,
  type Scored,
  type UpDownSecret,
} from '../../shared/rules/arcade'
import { RHYTHM_END_MS, cleanTaps, rhythmReplay } from '../../shared/rules/arcadeRhythm'
import type { Cell } from '../../shared/rules/board'
import type { TeamId } from '../../shared/rules/v2'
import type { GameDoc, PawnDoc } from '../../shared/model'
import { josa } from '../../shared/text'
import { note } from './records'
import { freshNow, myPawn, refuseIfInvisible, requireAwake } from './turn'
import { gameRef, requireUid } from './index'

const db = getFirestore()

/** 방 문서. **그 방에 든 사람(부른 사람 포함)만 읽는다**(firestore.rules). */
export const roomsOf = (gameId: string) => gameRef(gameId).collection('arcadeRooms')
const secretOf = (gameId: string) => gameRef(gameId).collection('secret').doc('arcade')
/** 업다운의 숨은 숫자. 방마다. */
const soloOf = (gameId: string) => secretOf(gameId).collection('solo')
/** 가위바위보에서 먼저 낸 수. 둘 다 내기 전까지 여기에만 있다. */
const sealOf = (gameId: string) => secretOf(gameId).collection('seal')
/** 손 게임에서 먼저 끝낸 사람의 점수. 다 끝나면 방 문서로 편다. */
const scoreOf = (gameId: string) => secretOf(gameId).collection('score')

/**
 * 손 게임 기록을 받기 시작하는 때. **판이 끝나기 전에는 안 받는다.**
 * 시작한 지 2초 만에 32초짜리 곡의 기록이 오면 손으로 친 것이 아니다.
 * 화면 시계와 서버 시계가 어긋나는 만큼은 봐준다.
 */
const LIVE_EARLY_SLACK_MS = 5000

/** 앉아 있는 기계. 안 앉았으면 막는다 */
function mustSit(pawn: PawnDoc, who = ''): number {
  const m = machineAtSeat((pawn.at ?? null) as Cell | null)
  if (m === null) throw new HttpsError('failed-precondition', `${who}오락기 앞에 앉아야 한다.`)
  return m
}

const nameOf = (game: GameDoc, uid: string): string => game.seats.find((s) => s.playerId === uid)?.name ?? ''

/** 끝난 판을 records 에 남긴다. 사람마다 한 줄. */
async function finish(gameId: string, nowMs: number, room: RoomDoc, results: Record<string, RoomResult>) {
  const ids = Object.keys(results)
  const pawns = await Promise.all(ids.map((id) => myPawn(gameId, id).catch(() => null)))
  const played = room.members.filter((m) => m.state === 'in' || m.state === 'left')
  await Promise.all(
    ids.map((id, i) => {
      const team = (pawns[i]?.team ?? null) as TeamId | null
      if (!team) return null
      const vs = played.find((m) => m.id !== id)?.id
      return note(gameId, 'arcadeDone', nowMs, { id, team }, { subjectId: `${room.game}:${results[id].outcome}`, ...(vs ? { otherId: vs } : {}) })
    }),
  )
}

/** 내가 든 방 가운데 아직 살아 있는 것. */
async function liveRoomsOf(gameId: string, uid: string) {
  // 상태까지 걸면 복합 색인이 든다. 한 판의 방은 몇백이 안 되니 여기서 거른다
  const snap = await roomsOf(gameId).where('memberIds', 'array-contains', uid).get()
  return snap.docs.filter((d) => {
    const r = d.data() as RoomDoc
    const me = r.members.find((m) => m.id === uid)
    return LIVE_ROOM.has(r.status) && (me?.state === 'in' || me?.state === 'invited')
  })
}

function settleLive(room: RoomDoc, scores: Record<string, Scored>): Record<string, RoomResult> {
  const scored = room.doneIds.map((id) => scores[id]).filter((s): s is Scored => !!s)
  const left = room.members.filter((m) => m.state === 'left').map((m) => m.id)
  return settleRoom(ARCADE_BY_ID[room.game].mode, scored, left)
}

/** 방 하나에서 나간다. 트랜잭션 안에서. 판이 끝나야 하면 끝낸 결과를 돌려준다. */
async function leaveIn(tx: Transaction, gameId: string, roomId: string, uid: string): Promise<{ room: RoomDoc; results: Record<string, RoomResult> } | null> {
  const ref = roomsOf(gameId).doc(roomId)
  const snap = await tx.get(ref)
  if (!snap.exists) return null
  const r = snap.data() as RoomDoc
  if (!LIVE_ROOM.has(r.status)) return null
  const scoreSnap = r.status === 'playing' ? await tx.get(scoreOf(gameId).doc(roomId)) : null
  const next = roomAfterLeave(r, uid)
  const after: RoomDoc = { ...r, members: next.members, status: next.status }
  // 손 게임 — 남은 사람이 다 끝냈으면 지금 닫는다
  if (after.status === 'playing' && inMembers(after).every((m) => after.doneIds.includes(m.id))) {
    const results = settleLive(after, (scoreSnap?.data() ?? {}) as Record<string, Scored>)
    tx.update(ref, { members: after.members, status: 'done', results })
    tx.delete(scoreOf(gameId).doc(roomId))
    return { room: after, results }
  }
  tx.update(ref, { members: after.members, status: after.status })
  if (after.status === 'gone') {
    tx.delete(sealOf(gameId).doc(roomId))
    tx.delete(scoreOf(gameId).doc(roomId))
    tx.delete(soloOf(gameId).doc(roomId))
  }
  return null
}

/** 살아 있는 방에서 다 빠진다. 새로 고르거나 부름을 받을 때 앞의 것을 정리한다. */
async function leaveAll(gameId: string, uid: string, nowMs: number, keep: string | null = null) {
  for (const d of await liveRoomsOf(gameId, uid)) {
    if (d.id === keep) continue
    const closed = await db.runTransaction((tx) => leaveIn(tx, gameId, d.id, uid))
    if (closed) await finish(gameId, nowMs, closed.room, closed.results)
  }
}

/**
 * 판을 연다. 방 문서에 얹을 것을 돌려주고, 숨길 것은 그 자리에서 봉인한다.
 *
 * **시작 시각은 벽시계다(Date.now).** 게임 시계는 시험 판에서 60배로
 * 달린다 — 그 시계로 셋을 세면 3초가 0.05초가 되고, 32초짜리 곡이
 * 반 초 만에 「끝났다」. 오락기 앞의 시간은 사람 손의 시간이다.
 */
function beginPatch(gameId: string, tx: Transaction, roomId: string, room: RoomDoc, nowMs: number): Partial<RoomDoc> {
  const wall = Date.now()
  const members = room.members.map((m) => (m.state === 'invited' ? { ...m, state: 'declined' as const } : m))
  const seed = Math.floor(Math.random() * 2 ** 31)
  const patch: Partial<RoomDoc> = { members, status: 'playing', seed, atMs: nowMs, doneIds: [], results: null }
  if (room.game === 'updown') {
    const { secret, view } = updownNew(Math.random())
    tx.set(soloOf(gameId).doc(roomId), secret)
    patch.updown = view
    patch.startAtMs = wall
  } else if (room.game === 'rps') {
    patch.rps = { inIds: [], rounds: [] }
    patch.startAtMs = wall
  } else {
    // 손 게임 — 셋을 세고 연다. 여럿이면 다 같이 센다
    patch.startAtMs = wall + ARCADE_COUNTDOWN_MS
  }
  return patch
}

// ── 고르기 · 부르기 · 받기 · 시작 ──────────────────────────────

/**
 * 게임을 고른다. **방이 선다.** 혼자 하는 게임이면 곧장 열린다.
 * 하던 방이 있으면 거기서는 빠진다 — 한 사람이 두 판을 할 수는 없다.
 */
export const arcadeOpen = onCall<{ gameId: string; game: ArcadeGameId }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  if (!isArcadeGameId(req.data.game)) throw new HttpsError('invalid-argument', '그런 게임은 없다.')
  const spec = ARCADE_BY_ID[req.data.game]
  if (!spec.ready) throw new HttpsError('failed-precondition', '아직 준비 중인 게임이다.')
  const { game, nowMs } = await freshNow(gameId)
  const pawn = await myPawn(gameId, uid)
  requireAwake(pawn, nowMs)
  const machine = mustSit(pawn)
  await leaveAll(gameId, uid, nowMs)

  const ref = roomsOf(gameId).doc()
  const room: RoomDoc = {
    game: spec.id,
    hostId: uid,
    members: [{ id: uid, name: nameOf(game, uid), machine, state: 'in' }],
    memberIds: [uid],
    status: 'lobby',
    seed: null,
    startAtMs: null,
    doneIds: [],
    results: null,
    updown: null,
    rps: null,
    atMs: nowMs,
  }
  await db.runTransaction(async (tx) => {
    // 혼자 하는 게임은 고르는 중이 없다. 선 채로 곧장 연다
    tx.set(ref, spec.max === 1 ? { ...room, ...beginPatch(gameId, tx, ref.id, room, nowMs) } : room)
  })
  return { roomId: ref.id }
})

/** 다른 기계에 앉은 사람을 부른다. 방장만, 고르는 중에만. */
export const arcadeInvite = onCall<{ gameId: string; roomId: string; playerId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, playerId } = req.data
  if (!playerId || playerId === uid) throw new HttpsError('invalid-argument', '부를 사람을 골라야 한다.')
  const { game, nowMs } = await freshNow(gameId)
  // 지워진 사람은 없는 사람이다 — 부르지도, 불리지도 않는다
  refuseIfInvisible(game.invisibleId, uid, playerId, '다른 기계를 부를')
  const [me, them] = await Promise.all([myPawn(gameId, uid), myPawn(gameId, playerId)])
  requireAwake(me, nowMs)
  mustSit(me)
  const machine = mustSit(them, '그 사람도 ')

  const ref = roomsOf(gameId).doc(String(req.data.roomId))
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpsError('not-found', '그런 방이 없다.')
    const r = snap.data() as RoomDoc
    if (r.hostId !== uid) throw new HttpsError('permission-denied', '고른 사람만 부른다.')
    if (r.status !== 'lobby') throw new HttpsError('failed-precondition', '이미 시작했다.')
    const spec = ARCADE_BY_ID[r.game]
    const was = r.members.find((m) => m.id === playerId)
    if (was && (was.state === 'in' || was.state === 'invited')) throw new HttpsError('failed-precondition', '이미 부른 사람이다.')
    const taken = r.members.filter((m) => m.state === 'in' || m.state === 'invited').length
    if (taken >= spec.max) throw new HttpsError('failed-precondition', `${spec.name}${josa(spec.name, '은/는')} ${spec.max}명까지다.`)
    const entry: RoomMember = { id: playerId, name: nameOf(game, playerId), machine, state: 'invited' }
    const members = was ? r.members.map((m) => (m.id === playerId ? entry : m)) : [...r.members, entry]
    tx.update(ref, { members, memberIds: members.map((m) => m.id), atMs: nowMs })
  })
  return { ok: true }
})

/** 부름에 답한다. 들어가면 고르는 중이던 다른 방에서는 빠진다. */
export const arcadeAnswer = onCall<{ gameId: string; roomId: string; accept: boolean }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const roomId = String(req.data.roomId)
  const { nowMs } = await freshNow(gameId)
  if (req.data.accept) {
    const me = await myPawn(gameId, uid)
    requireAwake(me, nowMs)
    mustSit(me)
    // 하던 판이 있으면 먼저 끝내고 와야 한다. 고르는 중이던 방은 버린다
    for (const d of await liveRoomsOf(gameId, uid)) {
      const r = d.data() as RoomDoc
      const mine = r.members.find((m) => m.id === uid)
      if (d.id !== roomId && r.status === 'playing' && mine?.state === 'in') {
        throw new HttpsError('failed-precondition', '하던 판부터 끝내야 한다.')
      }
    }
    await leaveAll(gameId, uid, nowMs, roomId)
  }
  const ref = roomsOf(gameId).doc(roomId)
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpsError('not-found', '그런 방이 없다.')
    const r = snap.data() as RoomDoc
    const mine = r.members.find((m) => m.id === uid)
    if (!mine || mine.state !== 'invited') throw new HttpsError('failed-precondition', '받은 부름이 없다.')
    if (r.status !== 'lobby') throw new HttpsError('failed-precondition', '이미 지난 부름이다.')
    const members = r.members.map((m) => (m.id === uid ? { ...m, state: req.data.accept ? ('in' as const) : ('declined' as const) } : m))
    tx.update(ref, { members, atMs: nowMs })
  })
  return { ok: true }
})

/**
 * 시작한다. 방장만. **들어온 사람이 아직 앉아 있는지 다시 본다** —
 * 받아 놓고 일어난 사람은 빼고 센다. 모자라면 안 연다.
 */
export const arcadeBegin = onCall<{ gameId: string; roomId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const roomId = String(req.data.roomId)
  const { nowMs } = await freshNow(gameId)
  const ref = roomsOf(gameId).doc(roomId)
  const first = await ref.get()
  if (!first.exists) throw new HttpsError('not-found', '그런 방이 없다.')
  const seated = new Set<string>()
  for (const m of inMembers(first.data() as RoomDoc)) {
    const p = await myPawn(gameId, m.id).catch(() => null)
    if (p && machineAtSeat((p.at ?? null) as Cell | null) !== null) seated.add(m.id)
  }
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const r = snap.data() as RoomDoc
    if (r.hostId !== uid) throw new HttpsError('permission-denied', '고른 사람만 시작한다.')
    if (r.status !== 'lobby') throw new HttpsError('failed-precondition', '이미 시작했다.')
    if (!seated.has(uid)) throw new HttpsError('failed-precondition', '오락기 앞에 앉아야 한다.')
    const members = r.members.map((m) => (m.state === 'in' && !seated.has(m.id) ? { ...m, state: 'left' as const } : m))
    const spec = ARCADE_BY_ID[r.game]
    const n = members.filter((m) => m.state === 'in').length
    if (n < spec.min) throw new HttpsError('failed-precondition', `${spec.name}${josa(spec.name, '은/는')} ${spec.min}명이 있어야 한다(지금 ${n}명).`)
    tx.update(ref, beginPatch(gameId, tx, roomId, { ...r, members }, nowMs))
  })
  return { ok: true }
})

/** 그만둔다. 부름을 거절할 때도, 하다 말 때도, 자리에서 일어날 때도. */
export const arcadeLeave = onCall<{ gameId: string; roomId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const roomId = String(req.data.roomId)
  const { nowMs } = await freshNow(gameId)
  const ref = roomsOf(gameId).doc(roomId)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 방이 없다.')
  if (!(snap.data() as RoomDoc).memberIds.includes(uid)) throw new HttpsError('permission-denied', '내 방이 아니다.')
  const closed = await db.runTransaction((tx) => leaveIn(tx, gameId, roomId, uid))
  if (closed) await finish(gameId, nowMs, closed.room, closed.results)
  return { ok: true }
})

// ── 차례 게임 ───────────────────────────────────────────────────

async function playingRoom(tx: Transaction, gameId: string, roomId: string, uid: string, game: ArcadeGameId) {
  const ref = roomsOf(gameId).doc(roomId)
  const snap = await tx.get(ref)
  if (!snap.exists) throw new HttpsError('not-found', '그런 방이 없다.')
  const r = snap.data() as RoomDoc
  if (r.game !== game) throw new HttpsError('invalid-argument', '그 게임의 방이 아니다.')
  if (!inMembers(r).some((m) => m.id === uid)) throw new HttpsError('permission-denied', '내 판이 아니다.')
  if (r.status !== 'playing') throw new HttpsError('failed-precondition', '지금은 둘 수 없다.')
  return { ref, r }
}

/** 업다운 — 숫자 하나를 부른다. */
export const arcadeMove = onCall<{ gameId: string; roomId: string; n: number }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const roomId = String(req.data.roomId)
  const { nowMs } = await freshNow(gameId)
  const pawn = await myPawn(gameId, uid)
  requireAwake(pawn, nowMs)
  mustSit(pawn)

  const closed = await db.runTransaction(async (tx) => {
    const { ref, r } = await playingRoom(tx, gameId, roomId, uid, 'updown')
    const secret = (await tx.get(soloOf(gameId).doc(roomId))).data() as UpDownSecret | undefined
    if (!secret || !r.updown) throw new HttpsError('failed-precondition', '하던 판이 없다.')
    const g = updownGuess(secret, r.updown, Number(req.data.n))
    if (!g.ok) throw new HttpsError('failed-precondition', `${UPDOWN_NO[g.why]}.`)
    if (!g.view.outcome) {
      tx.update(ref, { updown: g.view, atMs: nowMs })
      return null
    }
    const results: Record<string, RoomResult> = {
      [uid]: {
        outcome: g.view.outcome,
        score: g.view.left,
        line: g.view.outcome === 'win' ? `${g.view.guesses.length}번 만에` : `정답은 ${g.view.answer}`,
      },
    }
    tx.update(ref, { updown: g.view, status: 'done', results, atMs: nowMs })
    tx.delete(soloOf(gameId).doc(roomId))
    return { room: r, results }
  })
  if (closed) await finish(gameId, nowMs, closed.room, closed.results)
  return { ok: true }
})

/**
 * 가위바위보 — 한 수 낸다. **먼저 낸 수는 봉인된다.**
 *
 * 방 문서에는 「냈다」만 서고 무엇을 냈는지는 seal 에 간다. 둘 다
 * 내면 같은 트랜잭션 안에서 펴서 한 판을 닫는다 — 한쪽 수가 공개된
 * 채로 상대가 고를 틈이 없다.
 */
export const arcadePick = onCall<{ gameId: string; roomId: string; pick: RpsPick }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const roomId = String(req.data.roomId)
  if (!isRpsPick(req.data.pick)) throw new HttpsError('invalid-argument', '가위·바위·보 중에 낸다.')
  const pick = req.data.pick
  const { nowMs } = await freshNow(gameId)
  const me = await myPawn(gameId, uid)
  requireAwake(me, nowMs)
  mustSit(me)

  const seal = sealOf(gameId).doc(roomId)
  const closed = await db.runTransaction(async (tx) => {
    const { ref, r } = await playingRoom(tx, gameId, roomId, uid, 'rps')
    const sealSnap = await tx.get(seal)
    const state = r.rps ?? { inIds: [], rounds: [] }
    if (state.inIds.includes(uid)) throw new HttpsError('failed-precondition', '이번 판은 이미 냈다.')
    // a 는 부른 사람, b 는 받은 사람이다. 방에 든 순서 그대로
    const [a, b] = inMembers(r).map((m) => m.id)
    const side = uid === a ? 'a' : 'b'
    const sealed = (sealSnap.data() ?? {}) as { a?: RpsPick; b?: RpsPick }
    const next = { ...sealed, [side]: pick }
    if (!next.a || !next.b) {
      tx.set(seal, next)
      tx.update(ref, { rps: { ...state, inIds: [...state.inIds, uid] }, atMs: nowMs })
      return null
    }
    const res = rpsResolve(state.rounds, next.a, next.b)
    tx.delete(seal)
    if (!res.outcome) {
      tx.update(ref, { rps: { inIds: [], rounds: res.rounds }, atMs: nowMs })
      return null
    }
    const of = (s: 'a' | 'b'): ArcadeOutcome => (res.outcome === 'draw' ? 'draw' : res.outcome === s ? 'win' : 'lose')
    const line = `${res.rounds.length}판`
    const results: Record<string, RoomResult> = {
      [a]: { outcome: of('a'), score: 0, line },
      [b]: { outcome: of('b'), score: 0, line },
    }
    tx.update(ref, { rps: { inIds: [], rounds: res.rounds }, status: 'done', results, atMs: nowMs })
    return { room: r, results }
  })
  if (closed) await finish(gameId, nowMs, closed.room, closed.results)
  return { ok: true }
})

// ── 손 게임 ─────────────────────────────────────────────────────

/** 판 길이. 게임마다. 기록을 받기 시작하는 때를 이것으로 잰다. */
const LIVE_LENGTH_MS: Partial<Record<ArcadeGameId, number>> = {
  rhythm: RHYTHM_END_MS,
}

/** 기록 하나를 점수로. **서버가 점수를 내는 길은 이것뿐이다.** */
function scoreLive(game: ArcadeGameId, seed: number, raw: unknown): Omit<Scored, 'id'> {
  if (game === 'rhythm') {
    const r = rhythmReplay(seed, cleanTaps(raw))
    return { score: r.score, solo: r.outcome, line: `${r.grade} · ${r.percent}% · 최대 콤보 ${r.maxCombo}` }
  }
  throw new HttpsError('invalid-argument', '기록을 받는 게임이 아니다.')
}

/**
 * 손 게임을 끝내고 누른 기록을 낸다. 서버가 다시 돌려 점수를 낸다.
 * 낸 사람이 마지막이면 그 자리에서 판을 닫는다.
 */
export const arcadeSubmit = onCall<{ gameId: string; roomId: string; log: unknown }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const roomId = String(req.data.roomId)
  const { nowMs } = await freshNow(gameId)
  const me = await myPawn(gameId, uid)
  mustSit(me)

  const ref = roomsOf(gameId).doc(roomId)
  const scoreRef = scoreOf(gameId).doc(roomId)
  const closed = await db.runTransaction(async (tx) => {
    const [snap, scoreSnap] = await Promise.all([tx.get(ref), tx.get(scoreRef)])
    if (!snap.exists) throw new HttpsError('not-found', '그런 방이 없다.')
    const r = snap.data() as RoomDoc
    if (!inMembers(r).some((m) => m.id === uid)) throw new HttpsError('permission-denied', '내 판이 아니다.')
    if (r.status !== 'playing' || r.seed === null || r.startAtMs === null) throw new HttpsError('failed-precondition', '지금은 낼 수 없다.')
    if (r.doneIds.includes(uid)) throw new HttpsError('failed-precondition', '이미 냈다.')
    const length = LIVE_LENGTH_MS[r.game]
    if (length === undefined) throw new HttpsError('invalid-argument', '기록을 받는 게임이 아니다.')
    if (Date.now() < r.startAtMs + length - LIVE_EARLY_SLACK_MS) throw new HttpsError('failed-precondition', '아직 판이 안 끝났다.')

    const mine: Scored = { id: uid, ...scoreLive(r.game, r.seed, req.data.log) }
    const scores = { ...((scoreSnap.data() ?? {}) as Record<string, Scored>), [uid]: mine }
    const after: RoomDoc = { ...r, doneIds: [...r.doneIds, uid] }
    if (!inMembers(after).every((m) => after.doneIds.includes(m.id))) {
      tx.set(scoreRef, scores)
      tx.update(ref, { doneIds: after.doneIds, atMs: nowMs })
      return null
    }
    const results = settleLive(after, scores)
    tx.delete(scoreRef)
    tx.update(ref, { doneIds: after.doneIds, status: 'done', results, atMs: nowMs })
    return { room: after, results }
  })
  if (closed) await finish(gameId, nowMs, closed.room, closed.results)
  return { ok: true }
})
