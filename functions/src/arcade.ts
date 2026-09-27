// 오락기 — 혼자 하는 게임과 옆 사람과 하는 대결.
//
// **답은 서버만 쥔다.** 업다운의 숫자는 secret 에만 있고 판이 끝나야
// 화면으로 간다. 대결에서 먼저 낸 수는 secret 에 봉인되고, 대결 문서
// 에는 「냈다」 표시만 선다 — 상대가 개발자도구로 대결 문서를 열어도
// 내 수는 없다. 둘 다 내야 서버가 한꺼번에 편다.
//
// **오락기 옆에 서 있어야 한다.** 시작할 때도, 한 수 둘 때도. 걸어서
// 떠나면 거기서 판이 멈춘다 — 떠나 놓고 멀리서 계속 두는 기계는 없다.
//
// 보상은 아직 없다. 판이 끝나면 records 에 arcadeDone 한 줄을 남긴다 —
// 무엇을 줄지 정하는 날 그 줄을 센다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

import {
  ARCADE_BY_ID,
  UPDOWN_NO,
  atArcade,
  isRpsPick,
  rpsResolve,
  updownGuess,
  updownNew,
  type ArcadeGameId,
  type ArcadeOutcome,
  type RpsPick,
  type RpsRound,
  type UpDownSecret,
  type UpDownView,
} from '../../shared/rules/arcade'
import type { Cell } from '../../shared/rules/board'
import type { TeamId } from '../../shared/rules/v2'
import type { PawnDoc } from '../../shared/model'
import { note } from './records'
import { freshNow, myPawn, refuseIfInvisible, requireAwake } from './turn'
import { gameRef, requireUid } from './index'

const db = getFirestore()

/** 혼자 하는 판. **사람마다 하나** — 새로 시작하면 하던 판은 버린다. */
const soloOf = (gameId: string) => gameRef(gameId).collection('secret').doc('arcade').collection('solo')
/** 대결에서 먼저 낸 수. 둘 다 내기 전까지 여기에만 있다. */
const sealOf = (gameId: string) => gameRef(gameId).collection('secret').doc('arcade').collection('seal')
/** 대결 문서. **그 대결의 두 사람만 읽는다**(firestore.rules). 봉인된 수는 없다 */
export const matchesOf = (gameId: string) => gameRef(gameId).collection('arcadeMatches')

interface SoloDoc {
  playerId: string
  game: ArcadeGameId
  secret: UpDownSecret
  view: UpDownView
  atMs: number
}

export type MatchStatus = 'asked' | 'playing' | 'done' | 'declined' | 'gone'

export interface MatchDoc {
  game: ArcadeGameId
  aId: string
  bId: string
  status: MatchStatus
  /** 이번 판에 냈는가. **무엇을 냈는지는 없다** — 그건 seal 에 있다. */
  aIn: boolean
  bIn: boolean
  /** 둘 다 낸 뒤에 편 판들. 여기 오르면 이미 둘 다 본 것이다. */
  rounds: RpsRound[]
  /** 끝났을 때만. a 쪽에서 본 승부. */
  outcome: 'a' | 'b' | 'draw' | null
  atMs: number
}

const LIVE: ReadonlySet<MatchStatus> = new Set(['asked', 'playing'])

/** 오락기 옆에 서 있어야 한다. 화면이 보낸 자리를 안 믿고 pawns 의 at 을 본다 */
function mustBeAtArcade(pawn: PawnDoc, who = ''): void {
  if (!atArcade((pawn.at ?? null) as Cell | null)) {
    throw new HttpsError('failed-precondition', `${who}오락기 옆에 서야 한다.`)
  }
}

async function done(gameId: string, nowMs: number, who: { id: string; team: TeamId }, game: ArcadeGameId, outcome: ArcadeOutcome, otherId?: string) {
  await note(gameId, 'arcadeDone', nowMs, who, { subjectId: `${game}:${outcome}`, ...(otherId ? { otherId } : {}) })
}

// ── 혼자 ────────────────────────────────────────────────────────

/** 판을 새로 연다. 하던 판이 있으면 버린다. */
export const arcadeStart = onCall<{ gameId: string; game: ArcadeGameId }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const spec = ARCADE_BY_ID[req.data.game]
  if (!spec) throw new HttpsError('invalid-argument', '그런 게임은 없다.')
  if (!spec.ready) throw new HttpsError('failed-precondition', '아직 준비 중인 게임이다.')
  if (spec.players !== 1) throw new HttpsError('invalid-argument', '둘이 하는 게임은 옆 사람에게 신청한다.')
  const { nowMs } = await freshNow(gameId)
  const pawn = await myPawn(gameId, uid)
  requireAwake(pawn, nowMs)
  mustBeAtArcade(pawn)

  const { secret, view } = updownNew(Math.random())
  const doc: SoloDoc = { playerId: uid, game: spec.id, secret, view, atMs: nowMs }
  await soloOf(gameId).doc(uid).set(doc)
  // **숨은 쪽은 안 돌려준다.** 화면이 받는 것은 view 뿐이다
  return { game: spec.id, view }
})

/** 한 수. 업다운이면 숫자 하나를 부른다. */
export const arcadeMove = onCall<{ gameId: string; n: number }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const { nowMs } = await freshNow(gameId)
  const pawn = await myPawn(gameId, uid)
  requireAwake(pawn, nowMs)
  mustBeAtArcade(pawn)

  const ref = soloOf(gameId).doc(uid)
  const view = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpsError('failed-precondition', '하던 판이 없다. 게임을 골라 시작한다.')
    const s = snap.data() as SoloDoc
    const r = updownGuess(s.secret, s.view, Number(req.data.n))
    if (!r.ok) throw new HttpsError('failed-precondition', `${UPDOWN_NO[r.why]}.`)
    tx.update(ref, { view: r.view })
    return r.view
  })
  if (view.outcome) await done(gameId, nowMs, { id: uid, team: pawn.team as TeamId }, 'updown', view.outcome)
  return { game: 'updown', view }
})

// ── 대결 ────────────────────────────────────────────────────────

async function liveMatchOf(gameId: string, uid: string): Promise<string | null> {
  const [a, b] = await Promise.all([
    matchesOf(gameId).where('aId', '==', uid).get(),
    matchesOf(gameId).where('bId', '==', uid).get(),
  ])
  const hit = [...a.docs, ...b.docs].find((d) => LIVE.has((d.data() as MatchDoc).status))
  return hit?.id ?? null
}

/** 옆 사람에게 한 판 하자고 한다. **둘 다 오락기 옆에 서 있어야 한다.** */
export const arcadeChallenge = onCall<{ gameId: string; game: ArcadeGameId; toPlayerId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, toPlayerId } = req.data
  const spec = ARCADE_BY_ID[req.data.game]
  if (!spec) throw new HttpsError('invalid-argument', '그런 게임은 없다.')
  if (!spec.ready) throw new HttpsError('failed-precondition', '아직 준비 중인 게임이다.')
  if (spec.players !== 2) throw new HttpsError('invalid-argument', '혼자 하는 게임이다.')
  if (!toPlayerId || toPlayerId === uid) throw new HttpsError('invalid-argument', '상대를 골라야 한다.')

  const { game, nowMs } = await freshNow(gameId)
  // 지워진 사람은 없는 사람이다 — 부르지도, 불리지도 않는다
  refuseIfInvisible(game.invisibleId, uid, toPlayerId, '대결을 걸')
  const [me, them] = await Promise.all([myPawn(gameId, uid), myPawn(gameId, toPlayerId)])
  requireAwake(me, nowMs)
  mustBeAtArcade(me)
  mustBeAtArcade(them, '상대도 ')
  if (await liveMatchOf(gameId, uid)) throw new HttpsError('failed-precondition', '이미 하던 대결이 있다.')
  if (await liveMatchOf(gameId, toPlayerId)) throw new HttpsError('failed-precondition', '그 사람은 다른 대결 중이다.')

  const doc: MatchDoc = {
    game: spec.id,
    aId: uid,
    bId: toPlayerId,
    status: 'asked',
    aIn: false,
    bIn: false,
    rounds: [],
    outcome: null,
    atMs: nowMs,
  }
  const ref = await matchesOf(gameId).add(doc)
  return { matchId: ref.id }
})

/** 받은 쪽이 한다·안 한다. */
export const arcadeAnswer = onCall<{ gameId: string; matchId: string; accept: boolean }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, matchId } = req.data
  const { nowMs } = await freshNow(gameId)
  const ref = matchesOf(gameId).doc(String(matchId))
  if (req.data.accept) {
    const [me, m] = await Promise.all([myPawn(gameId, uid), ref.get()])
    requireAwake(me, nowMs)
    mustBeAtArcade(me)
    const a = (m.data() as MatchDoc | undefined)?.aId
    if (a) mustBeAtArcade(await myPawn(gameId, a), '건 사람이 ')
  }
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpsError('not-found', '그런 대결이 없다.')
    const m = snap.data() as MatchDoc
    if (m.bId !== uid) throw new HttpsError('permission-denied', '나한테 온 대결이 아니다.')
    if (m.status !== 'asked') throw new HttpsError('failed-precondition', '이미 지난 신청이다.')
    tx.update(ref, { status: req.data.accept ? 'playing' : 'declined', atMs: nowMs })
  })
  return { ok: true }
})

/**
 * 한 수 낸다. **먼저 낸 수는 봉인된다.**
 *
 * 대결 문서에는 「냈다」만 서고 무엇을 냈는지는 seal 에 간다. 둘 다
 * 내면 같은 트랜잭션 안에서 펴서 한 판을 닫는다 — 한쪽 수가 공개된
 * 채로 상대가 고를 틈이 없다.
 */
export const arcadePick = onCall<{ gameId: string; matchId: string; pick: RpsPick }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, matchId } = req.data
  if (!isRpsPick(req.data.pick)) throw new HttpsError('invalid-argument', '가위·바위·보 중에 낸다.')
  const pick = req.data.pick
  const { nowMs } = await freshNow(gameId)
  const me = await myPawn(gameId, uid)
  requireAwake(me, nowMs)
  mustBeAtArcade(me)

  const ref = matchesOf(gameId).doc(String(matchId))
  const seal = sealOf(gameId).doc(String(matchId))
  const closed = await db.runTransaction(async (tx) => {
    const [snap, sealSnap] = await Promise.all([tx.get(ref), tx.get(seal)])
    if (!snap.exists) throw new HttpsError('not-found', '그런 대결이 없다.')
    const m = snap.data() as MatchDoc
    const side = m.aId === uid ? 'a' : m.bId === uid ? 'b' : null
    if (!side) throw new HttpsError('permission-denied', '내 대결이 아니다.')
    if (m.status !== 'playing') throw new HttpsError('failed-precondition', '지금은 낼 수 없다.')
    if (side === 'a' ? m.aIn : m.bIn) throw new HttpsError('failed-precondition', '이번 판은 이미 냈다.')

    const sealed = (sealSnap.data() ?? {}) as { a?: RpsPick; b?: RpsPick }
    const next = { ...sealed, [side]: pick }
    if (!next.a || !next.b) {
      // 한쪽만 냈다 — 봉인하고 표시만 세운다
      tx.set(seal, next)
      tx.update(ref, { [side === 'a' ? 'aIn' : 'bIn']: true })
      return null
    }
    // 둘 다 냈다 — 편다
    const r = rpsResolve(m.rounds, next.a, next.b)
    tx.delete(seal)
    tx.update(ref, {
      rounds: r.rounds,
      aIn: false,
      bIn: false,
      ...(r.outcome ? { status: 'done', outcome: r.outcome } : {}),
      atMs: nowMs,
    })
    return r.outcome ? { ...m, outcome: r.outcome } : null
  })

  if (closed?.outcome) {
    const [pa, pb] = await Promise.all([myPawn(gameId, closed.aId), myPawn(gameId, closed.bId)])
    const of = (side: 'a' | 'b'): ArcadeOutcome =>
      closed.outcome === 'draw' ? 'draw' : closed.outcome === side ? 'win' : 'lose'
    await done(gameId, nowMs, { id: closed.aId, team: pa.team as TeamId }, closed.game, of('a'), closed.bId)
    await done(gameId, nowMs, { id: closed.bId, team: pb.team as TeamId }, closed.game, of('b'), closed.aId)
  }
  return { ok: true }
})

/** 그만둔다. 신청을 거둘 때도, 하다 말 때도. */
export const arcadeLeave = onCall<{ gameId: string; matchId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, matchId } = req.data
  const ref = matchesOf(gameId).doc(String(matchId))
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpsError('not-found', '그런 대결이 없다.')
    const m = snap.data() as MatchDoc
    if (m.aId !== uid && m.bId !== uid) throw new HttpsError('permission-denied', '내 대결이 아니다.')
    if (!LIVE.has(m.status)) return
    tx.update(ref, { status: 'gone' })
  })
  await sealOf(gameId).doc(String(matchId)).delete()
  return { ok: true }
})
