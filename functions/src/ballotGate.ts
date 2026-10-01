// 투명인간 투표의 문 — 운영자가 열고 닫는다.
//
//   열기   그날 투표를 받기 시작한다. 화면의 투표 탭이 이때 열린다.
//          **지난 투명인간은 여기서 풀린다** — 발표부터 다음 투표가
//          열릴 때까지가 투명인간의 전부다(settleBallots 가 지운다)
//   닫기   그 자리에서 센다(settleBallots) — 최다 한 명이 그 자리에서
//          지워진다. 동률이면 아무도 안 지워진다. 결과는 공지로 나간다
//
// 운영자가 안 닫고 날을 넘기면 정산 때 세던 길(announceBallots)이 그대로
// 남아 있다 — 문이 열린 채로 하루가 끝나는 일은 없다.
//
// 하루에 한 번이다. 이미 센 날은 다시 못 연다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

import { TOTAL_DAYS } from '../../shared/rules/v2'
import type { GameDoc } from '../../shared/model'

import { announceBallots } from './ballot'
import { requireHost } from './host'
import { reseatIfShared } from './seat'
import { refreshViews } from './views'
import { gameRef, nowOf } from './index'

const db = getFirestore()

export const hostOpenBallot = onCall<{ gameId: string }>(async (req) => {
  requireHost(req.auth)
  const { gameId } = req.data
  const snap = await gameRef(gameId).get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  const game = snap.data() as GameDoc
  if (game.phase !== 'running') throw new HttpsError('failed-precondition', '판이 돌고 있지 않다.')
  const day = game.day
  if (day >= TOTAL_DAYS) throw new HttpsError('failed-precondition', '마지막 날에는 투표가 없다.')
  if ((await gameRef(gameId).collection('secret').doc('ballotDays').collection('items').doc(`d${day}`).get()).exists) {
    throw new HttpsError('failed-precondition', '오늘 표는 이미 셌다.')
  }
  if (game.ballot?.open && game.ballot.day === day) throw new HttpsError('failed-precondition', '이미 열려 있다.')
  const nowMs = nowOf(game)
  const batch = db.batch()
  batch.update(gameRef(gameId), {
    ballot: { day, open: true, openedAtMs: nowMs },
    // 지난 투명인간을 여기서 푼다. 다음 투표가 열렸으니 그 시간은 끝났다
    invisibleId: null,
    invisibleTeam: null,
  })
  batch.set(gameRef(gameId).collection('events').doc(), { atMs: nowMs, day, kind: 'ballotOpen', detail: {} })
  await batch.commit()
  // 투명인간은 칸을 차지하지 않았다 — 누가 그 칸에 섰으면 비켜 세운다
  if (game.invisibleId) await reseatIfShared(gameId, game.invisibleId, nowMs)
  await refreshViews(gameId)
  return { day, open: true }
})

export const hostCloseBallot = onCall<{ gameId: string }>(async (req) => {
  requireHost(req.auth)
  const { gameId } = req.data
  const snap = await gameRef(gameId).get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  const game = snap.data() as GameDoc
  if (!game.ballot?.open) throw new HttpsError('failed-precondition', '열린 투표가 없다.')
  const day = game.ballot.day
  const nowMs = nowOf(game)
  await gameRef(gameId).update({ 'ballot.open': false, 'ballot.closedAtMs': nowMs })
  await gameRef(gameId).collection('events').add({ atMs: nowMs, day, kind: 'ballotClose', detail: {} })
  // 닫는 순간 센다. 이미 셌으면(정산이 먼저 지나갔으면) 아무 일도 안 한다
  await announceBallots(gameId, day)
  // **새 투명인간은 그 순간 모두에게서 사라진다.** 다음에 누가 움직일
  // 때까지 views 를 그대로 두면 지워진 사람이 남의 화면에 그대로 서 있다
  await refreshViews(gameId)
  return { day, open: false }
})
