// 이적 — 서버 쪽.
//
// 거래와 같은 골격이다. 마주 선 둘 사이의 문서 하나를 만들고, 부른
// 쪽이 아니라 **불린 쪽**이 답한다. 규칙 판정은
// shared/rules/transfer.ts 의 순수 함수가 한다.
//
// **수락하면 그 자리에서 팀이 바뀐다.** 팀 값은 세 군데(자리표·말·명단)에
// 나뉘어 적혀 있어서, 한 트랜잭션에서 셋을 같이 옮긴다 — 하나만 옮기면
// 새 팀 금고는 열리는데 시야와 채점은 옛 팀인 사람이 생긴다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

import {
  TRANSFER_NO,
  askExpired,
  whyNotTransfer,
  type TransferState,
} from '../../shared/rules/transfer'
import { cellsTouch } from '../../shared/rules/board'
import { sys } from '../../shared/rules/radio'
import type { GameDoc, PawnDoc } from '../../shared/model'
import type { TeamId } from '../../shared/rules/v2'
import { freshNow, myPawn, refuseIfInvisible } from './turn'
import { refreshViews } from './views'
import { logSecret } from './qaLog'
import { note } from './records'
import { sysLine } from './radio'
import { gameRef, requireUid } from './index'
import { docId } from './ids'
import { teamName } from '../../shared/rules/bundan'

const db = getFirestore()

const asksOf = (gameId: string) => gameRef(gameId).collection('transfers')

/** 아직 답을 기다리는 제안. 시간이 지난 것은 없는 것으로 친다. */
async function liveAskOf(gameId: string, uid: string, nowMs: number): Promise<boolean> {
  const rows = await Promise.all([
    asksOf(gameId).where('byId', '==', uid).where('status', '==', 'asking').get(),
    asksOf(gameId).where('toId', '==', uid).where('status', '==', 'asking').get(),
  ])
  return rows.some((r) => r.docs.some((d) => !askExpired(d.data() as TransferState, nowMs)))
}

/**
 * 「우리 팀으로 오겠느냐」고 묻는다.
 *
 * 거래와 같은 자리에서, 같은 거리에서 꺼낸다 — 같은 방만으로는
 * 모자라고 **바로 옆 칸**이라야 한다. 학교 반대편에서 날아드는
 * 배신은 배신이 아니다.
 */
export const askTransfer = onCall<{ gameId: string; toPlayerId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const toPlayerId = docId(req.data.toPlayerId, '그런 사람이 없다.')
  const { game, nowMs } = await freshNow(gameId)
  const mine = await myPawn(gameId, uid)

  const theirSnap = await gameRef(gameId).collection('pawns').doc(toPlayerId).get()
  if (!theirSnap.exists) throw new HttpsError('not-found', '그런 사람이 없다.')
  const their = theirSnap.data() as PawnDoc

  refuseIfInvisible(game.invisibleId, uid, toPlayerId, '이적을 꺼낼')

  // 떠날 팀에 몇이 남는가. **상수를 읽지 않는다** — 이미 오간 사람이
  // 있으면 4·4·3·3 이 아니다
  const pawns = await gameRef(gameId).collection('pawns').get()
  const fromTeamSize = pawns.docs.filter((d) => (d.data() as PawnDoc).team === their.team).length

  const no = whyNotTransfer({
    day: game.day,
    phaseOpen: game.phaseNow?.open === true,
    byId: uid,
    byTeam: mine.team,
    toId: toPlayerId,
    toTeam: their.team,
    bothStanding: mine.tileId !== null && their.tileId !== null && mine.tileId === their.tileId,
    nextTo: cellsTouch(mine.at, their.at),
    asking: (await liveAskOf(gameId, uid, nowMs)) || (await liveAskOf(gameId, toPlayerId, nowMs)),
    fromTeamSize,
  })
  if (no) throw new HttpsError('failed-precondition', `${TRANSFER_NO[no]}.`)

  const ask: TransferState = {
    byId: uid,
    byTeam: mine.team,
    toId: toPlayerId,
    fromTeam: their.team,
    askedAtMs: nowMs,
    status: 'asking',
  }
  const doc = await asksOf(gameId).add(ask)
  // 이적은 본인만 아는 일이다 — 공개 events 가 아니라 QA 몫에 적는다
  await logSecret(gameId, 'transferAsked', nowMs, uid, { askId: doc.id, toTeam: mine.team }, { day: game.day, targetId: toPlayerId })
  return { id: doc.id }
})

/**
 * 불린 쪽이 답한다. **부른 쪽은 못 답한다.**
 *
 * 수락하면 그 자리에서 팀이 바뀐다. 자리표(seats)·말(pawns)·명단(roster)
 * 셋을 한 트랜잭션에서 같이 옮긴다 — 하나만 옮기면 새 팀 금고는
 * 열리는데 시야와 채점은 옛 팀인 사람이 생긴다.
 */
export const answerTransfer = onCall<{ gameId: string; askId: string; accept: boolean }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, accept } = req.data
  const askId = docId(req.data.askId, '그런 제안이 없다.')
  const { game, nowMs } = await freshNow(gameId)
  const ref = asksOf(gameId).doc(askId)
  const gRef = gameRef(gameId)

  const moved = await db.runTransaction<{ from: TeamId; to: TeamId; name: string } | null>(async (tx) => {
    const [snap, gSnap, carried] = await Promise.all([
      tx.get(ref),
      tx.get(gRef),
      tx.get(gRef.collection('robots').where('carriedBy', '==', uid)),
    ])
    if (!snap.exists) throw new HttpsError('not-found', '그런 제안이 없다.')
    const ask = snap.data() as TransferState
    if (ask.toId !== uid) throw new HttpsError('permission-denied', '불린 사람만 답한다.')
    if (ask.status !== 'asking') throw new HttpsError('failed-precondition', '이미 끝난 제안이다.')
    if (askExpired(ask, nowMs)) {
      tx.update(ref, { status: 'gone' })
      throw new HttpsError('failed-precondition', '시간이 지났다.')
    }
    if (!accept) {
      tx.update(ref, { status: 'refused' })
      return null
    }
    // 묻고 답하는 사이에 종이 칠 수 있다. 그때는 안 넘어간다 —
    // 페이즈가 열린 뒤에 편이 바뀌면 그 판정이 사고가 된다
    if (game.phaseNow?.open === true) {
      tx.update(ref, { status: 'gone' })
      throw new HttpsError('failed-precondition', `${TRANSFER_NO.phase}.`)
    }
    const gd = gSnap.data() as GameDoc
    const seat = gd.seats.find((s) => s.playerId === uid)
    tx.update(gRef, { seats: gd.seats.map((s) => (s.playerId === uid ? { ...s, team: ask.byTeam } : s)) })
    tx.update(gRef.collection('pawns').doc(uid), { team: ask.byTeam, teamSinceMs: nowMs })
    tx.update(gRef.collection('secret').doc('roster').collection('items').doc(uid), { team: ask.byTeam })
    // **들고 있던 로봇도 사람을 따라간다** — 새 분단 로봇이 된다
    for (const r of carried.docs) tx.update(r.ref, { team: ask.byTeam })
    // 두 팀 무전에만 적힌다. 공지는 없다 — 마주쳐야 안다
    sysLine(tx, gameId, ask.fromTeam, sys.movedOut(seat?.name ?? '', ask.byTeam), nowMs, game.day)
    sysLine(tx, gameId, ask.byTeam, sys.movedIn(seat?.name ?? ''), nowMs, game.day)
    tx.update(ref, { status: 'taken' })
    return { from: ask.fromTeam, to: ask.byTeam, name: seat?.name ?? '' }
  })

  await logSecret(gameId, 'transferAnswered', nowMs, uid, { askId, accept: moved !== null, ...(moved ? { team: moved.to } : {}) }, { day: game.day })
  if (moved) {
    // 개인 미션의 「그 사건이 일어난 시점의 팀」이 이 줄을 되짚는다 —
    // 이적 전에 한 일은 옛 팀이 한 일이다
    await note(gameId, 'teamMoved', nowMs, { id: uid, team: moved.to }, { otherTeam: moved.from })
  }
  await refreshViews(gameId)
  return moved === null
    ? { moved: false }
    : { moved: true, team: moved.to, said: `이제 ${teamName(moved.to)}이다.` }
})
