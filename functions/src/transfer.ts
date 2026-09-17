// 이적 — 서버 쪽.
//
// 거래와 같은 골격이다. 마주 선 둘 사이의 문서 하나를 만들고, 부른
// 쪽이 아니라 **불린 쪽**이 답한다. 규칙 판정은
// shared/rules/transfer.ts 의 순수 함수가 한다.
//
// **수락해도 그 자리에서 팀이 바뀌지는 않는다.** pawn 에 「옮기기로
// 했다」만 적어 두고, 다음 페이즈가 열릴 때 phase.ts 가 발효시킨다.
// 팀 값은 세 군데(자리표·말·명단)에 나뉘어 적혀 있어서, 셋을 한꺼번에
// 쓸 수 있는 자리에서 한 번에 옮기는 편이 안전하다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

import {
  TRANSFER_NO,
  askExpired,
  whyNotTransfer,
  type TransferState,
} from '../../shared/rules/transfer'
import { cellsTouch } from '../../shared/rules/board'
import { dayNumber } from '../../shared/rules/clock'
import type { GameDoc, PawnDoc } from '../../shared/model'
import type { TeamId } from '../../shared/rules/v2'
import { freshNow, myPawn, refuseIfInvisible } from './turn'
import { refreshViews } from './views'
import { gameRef, requireUid } from './index'

const db = getFirestore()

const asksOf = (gameId: string) => gameRef(gameId).collection('transfers')

/** 게임 속 며칠째인가. 시작 전이면 0일이라 아무것도 못 꺼낸다. */
function dayOf(game: GameDoc, nowMs: number): number {
  return game.startedAtMs == null ? 0 : dayNumber(game.startedAtMs, nowMs)
}

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
  const { gameId, toPlayerId } = req.data
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
    day: dayOf(game, nowMs),
    phaseOpen: game.phaseNow?.open === true,
    byId: uid,
    byTeam: mine.team,
    toId: toPlayerId,
    toTeam: their.team,
    bothStanding: mine.tileId !== null && their.tileId !== null && mine.tileId === their.tileId,
    nextTo: cellsTouch(mine.at, their.at),
    asking: (await liveAskOf(gameId, uid, nowMs)) || (await liveAskOf(gameId, toPlayerId, nowMs)),
    movingTo: their.movingTo ?? null,
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
  return { id: doc.id }
})

/**
 * 불린 쪽이 답한다. **부른 쪽은 못 답한다.**
 *
 * 수락하면 pawn 에 표시만 남는다. 팀이 실제로 바뀌는 것은 다음
 * 페이즈가 열릴 때다.
 */
export const answerTransfer = onCall<{ gameId: string; askId: string; accept: boolean }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, askId, accept } = req.data
  const { game, nowMs } = await freshNow(gameId)
  const ref = asksOf(gameId).doc(askId)

  const team = await db.runTransaction<TeamId | null>(async (tx) => {
    const snap = await tx.get(ref)
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
    tx.update(gameRef(gameId).collection('pawns').doc(uid), { movingTo: ask.byTeam })
    tx.update(ref, { status: 'taken' })
    return ask.byTeam
  })

  await refreshViews(gameId)
  return team === null
    ? { moved: false }
    : { moved: true, team, said: `다음 점령전부터 ${team}팀이다.` }
})
