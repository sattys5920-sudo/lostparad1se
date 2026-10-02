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
// 하루에 한 번이다. 이미 센 날은 다시 못 연다 — 다만 오늘 것은 운영자가
// 되돌려 다시 열 수 있다(hostReopenBallot). 투표 전에 정산을 넘긴 날을 위해서다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

import { TOTAL_DAYS } from '../../shared/rules/v2'
import type { GameDoc } from '../../shared/model'
import { ANNOUNCE_NOBODY, INVISIBLE_NOTICE, announceInvisible } from '../../shared/story/vote'

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
  if (game.practice) throw new HttpsError('failed-precondition', '연습 시간이다. 먼저 「연습 끝 · DAY 1 시작」을 누른다.')
  if ((await gameRef(gameId).collection('secret').doc('ballotDays').collection('items').doc(`d${day}`).get()).exists) {
    throw new HttpsError('failed-precondition', '오늘 표는 이미 셌다.')
  }
  if (game.ballot?.open && game.ballot.day === day) throw new HttpsError('failed-precondition', '이미 열려 있다.')
  // **다른 날 투표가 아직 열려 있으면 먼저 닫는다.** 그대로 열면 그 표를 세지도 않고 덮어쓴다
  if (game.ballot?.open) throw new HttpsError('failed-precondition', `DAY ${game.ballot.day} 투표가 아직 열려 있다. 먼저 닫는다.`)
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

/**
 * **센 날을 되돌리고 다시 연다.** 투표를 열기 전에 「21 시 정산」을 넘기면
 * 그 자리에서 0 장으로 세어 버려서, 그날 표로 정할 투명인간이 아무도 없게
 * 된다. 오늘 것만 되돌린다 — 지난 날을 되돌리면 이미 지나간 투명인간의
 * 하루가 어긋난다.
 *
 * 되돌리는 것: 그날 결과 한 장(ballotDays), 내일 투명인간 칸(invisibleByDay),
 * 지금 투명인간, 그때 나간 결과 공지(모두에게 · 본인에게). 이미 들어온 표는
 * 그대로 두고 다시 받는다 — 닫으면 그 표까지 같이 센다.
 */
export const hostReopenBallot = onCall<{ gameId: string }>(async (req) => {
  requireHost(req.auth)
  const { gameId } = req.data
  const ref = gameRef(gameId)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  const game = snap.data() as GameDoc
  if (game.phase !== 'running') throw new HttpsError('failed-precondition', '판이 돌고 있지 않다.')
  const day = game.day
  if (day >= TOTAL_DAYS) throw new HttpsError('failed-precondition', '마지막 날에는 투표가 없다.')
  if (game.practice) throw new HttpsError('failed-precondition', '연습 시간이다.')
  const dayRef = ref.collection('secret').doc('ballotDays').collection('items').doc(`d${day}`)
  const counted = await dayRef.get()
  if (!counted.exists) throw new HttpsError('failed-precondition', '오늘 표는 아직 안 셌다. 그냥 연다.')
  const was = counted.data() as { atMs?: number; invisibleId?: string | null }
  const nowMs = nowOf(game)

  // 그때 나간 결과 공지. 센 시각 앞뒤 1 분 안의 것만 — 다른 날 공지는 안 건드린다
  const at = was.atMs ?? 0
  const near = (n: unknown) => typeof n === 'number' && Math.abs(n - at) <= 60_000
  const notices = await ref.collection('notices').where('atMs', '>=', at - 60_000).get()
  const stale = notices.docs.filter((d) => {
    const n = d.data() as { toPlayerId?: string | null; text?: string; atMs?: number }
    if (!near(n.atMs)) return false
    if ((n.toPlayerId ?? null) === null) return n.text === ANNOUNCE_NOBODY || (n.text ?? '').startsWith(announceInvisible(''))
    return !!was.invisibleId && n.toPlayerId === was.invisibleId && n.text === INVISIBLE_NOTICE
  })

  const batch = db.batch()
  batch.delete(dayRef)
  for (const d of stale) batch.delete(d.ref)
  batch.update(ref, {
    [`invisibleByDay.${day + 1}`]: FieldValue.delete(),
    invisibleId: null,
    invisibleTeam: null,
    ballot: { day, open: true, openedAtMs: nowMs },
  })
  batch.set(ref.collection('events').doc(), { atMs: nowMs, day, kind: 'ballotOpen', detail: { reopened: true } })
  await batch.commit()
  if (game.invisibleId) await reseatIfShared(gameId, game.invisibleId, nowMs)
  await refreshViews(gameId)
  return { day, open: true, removedNotices: stale.length }
})
