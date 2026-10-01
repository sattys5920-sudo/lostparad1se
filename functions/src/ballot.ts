// 투명인간 투표.
//
// **신뢰·호감 표와는 완전히 다른 것이다.** 그쪽은 마주 서야 주는
// 호의고, 이쪽은 만나지 않고 하는 배제다. 어디서든 던지고, 마감 전까지
// 바꿀 수 있고, 하루에 한 사람만 적는다.
//
// 누가 누구를 적었는지는 **열넷 누구에게도 안 나간다.** 득표수도 안
// 나간다 — 플레이어에게 발표되는 것은 결과 한 줄뿐이다. 「몇 표였다」가
// 새는 순간 누가 적었는지를 좁혀 나갈 수 있고, 그러면 이 투표가
// 무기명이라는 말이 거짓이 된다.
//
// **운영자만은 본다(hostBallots).** 운영자는 판을 지켜야 하는 사람이라
// 다른 무기명 투표(신뢰·호감표)도 서버 안에서는 항상 다 보인다 —
// 다만 그 둘은 API로도 안 나가고, 이 투표만 운영자용 API를 하나 연다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

import { canName, countBallots, eraseFrom, pickInvisible, type Ballot } from '../../shared/rules/invisible'
import { TOTAL_DAYS, type TeamId } from '../../shared/rules/v2'
import { TEAMS } from '../../shared/rules/lobby'
import type { GameDoc } from '../../shared/model'
import { ANNOUNCE_NOBODY, INVISIBLE_NOTICE, announceInvisible } from '../../shared/story/vote'
import { erasedOn } from './use'
import { freshNow } from './turn'
import { refreshViews } from './views'
import { logSecret } from './qaLog'
import { requireHost } from './host'
import { reseatIfShared } from './seat'
import { gameRef, nowOf, requireUid } from './index'

const db = getFirestore()

/**
 * 한 사람의 오늘 한 표. 문서 하나가 사람 하나다.
 *
 * **하루에 한 장뿐이라 문서 아이디를 「날짜:사람」으로 둔다.** 그러면
 * 두 번 던지는 것이 저절로 「바꾸는 것」이 된다 — 따로 지우고 쓸 일이
 * 없고, 같은 사람이 두 장을 넣는 사고도 안 난다.
 */
export interface BallotDoc {
  day: number
  voterId: string
  targetId: string
  /**
   * **적은 그 순간의 두 팀.**
   *
   * 나중에 명단을 봐도 알 수 없다 — 이적하면 명단은 새 팀으로 덮이고,
   * 말의 teamSinceMs 는 마지막 한 번뿐이라 두 번 옮기면 첫 번째가
   * 사라진다. 뒷자리의 「그중 한 번은 우리 팀 사람」이 이 두 칸으로 갈린다.
   */
  voterTeam: TeamId
  targetTeam: TeamId
  atMs: number
}

/**
 * 그날 표를 센 결과. **하루에 한 장.**
 *
 * 세는 일은 늘 있었는데 결과가 어디에도 안 남았다. 게임 문서의
 * invisibleByDay 는 「누가 지워졌나」만 알려 주고 null 하나에
 * 동률·표 없음·이틀 연속 금지가 다 뭉쳐 있다. 뒷자리는 **동률로
 * 무효가 된 날을 안 세야** 하므로 셋을 갈라 둔다.
 */
export interface BallotDayDoc {
  day: number
  /** 지워진 사람. 아무도 안 지워졌으면 null. */
  invisibleId: string | null
  /** picked · none · tie · repeat */
  reason: string
  atMs: number
}

const ballotsOf = (gameId: string) => gameRef(gameId).collection('secret').doc('ballots').collection('items')
const ballotDaysOf = (gameId: string) =>
  gameRef(gameId).collection('secret').doc('ballotDays').collection('items')
const keyOf = (day: number, voterId: string) => `d${day}:${voterId}`

/**
 * 한 명을 적는다. **기권은 없다.**
 *
 * 하루 중 아무 때나, 마감 전까지 몇 번이든 바꿀 수 있다. 마지막에
 * 적은 이름만 남는다.
 */
export const castBallot = onCall<{ gameId: string; targetId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, targetId } = req.data
  const { game, nowMs } = await freshNow(gameId)
  if (game.phase !== 'running') throw new HttpsError('failed-precondition', '지금은 적을 때가 아니다.')

  const seat = game.seats.find((s) => s.playerId === uid)
  if (!seat) throw new HttpsError('permission-denied', '이 판에 없는 사람이다.')
  if (!game.seats.some((s) => s.playerId === targetId)) {
    throw new HttpsError('invalid-argument', '그런 사람이 없다.')
  }

  const day = game.day
  if (day >= TOTAL_DAYS) throw new HttpsError('failed-precondition', '마지막 날에는 적지 않는다.')
  // 오늘 표를 이미 셌으면 더 받지 않는다 — 닫혔거나 정산을 넘긴 뒤다.
  // 문이 닫혔는지보다 먼저 본다 — 늦게 온 사람에게 「아직 안 열렸다」는 거짓말이다
  if ((await ballotDaysOf(gameId).doc(`d${day}`).get()).exists) {
    throw new HttpsError('failed-precondition', '오늘 표는 이미 셌다.')
  }
  // 운영자가 연 뒤에만 적는다(ballotGate). 열기 전에는 탭도 잠겨 있다
  if (!(game.ballot?.open === true && game.ballot.day === day)) {
    throw new HttpsError('failed-precondition', '아직 투표가 열리지 않았다.')
  }
  const out = canName({
    voterId: uid,
    targetId,
    // **오늘 내내 지워져 있던 사람** — 세는 쪽(settleBallots)과 같은 값을 본다.
    // game.invisibleId 는 hostOpenBallot 이 투표를 열면서 이미 비웠다. 그걸
    // 보면 어제 지워진 사람도 적혀 놓고, 셀 때 조용히 버려졌다
    yesterdayId: game.invisibleByDay?.[day] ?? null,
  })
  if (!out.ok) {
    const why: Record<string, string> = {
      self: '나는 못 적는다.',
      repeat: '어제 지워진 사람이다.',
    }
    throw new HttpsError('failed-precondition', why[out.reason as string] ?? '적을 수 없다.')
  }

  const targetSeat = game.seats.find((s) => s.playerId === targetId)
  const doc: BallotDoc = {
    day,
    voterId: uid,
    targetId,
    // 판이 돌고 있으면 자리마다 팀이 다 차 있다 — 배정 없이는 시작이 안 된다
    voterTeam: seat.team as TeamId,
    targetTeam: (targetSeat?.team ?? seat.team) as TeamId,
    atMs: nowMs,
  }
  await ballotsOf(gameId).doc(keyOf(day, uid)).set(doc)
  // **적었다는 것만**, 그것도 **운영자 로그에만** 남긴다. events 는 로그인한 누구나 읽는
  // 컬렉션이라(firestore.rules) 거기에 playerId 를 적으면 「누가 적었는가」가 열넷에게 새고,
  // 그 목록을 발표와 맞춰 보면 무기명이 무너진다. 누구를 적었는지는 어디에도 안 나간다
  await logSecret(gameId, 'ballotCast', nowMs, uid, {}, { day })
  await refreshViews(gameId)
  // 무엇을 적었는지는 본인에게만 돌려준다
  return { targetId }
})

/** 그날 던져진 표 전부. **서버 안에서만 돈다.** */
export async function ballotsOn(gameId: string, day: number): Promise<Ballot[]> {
  const snap = await ballotsOf(gameId).where('day', '==', day).get()
  return snap.docs.map((d) => {
    const b = d.data() as BallotDoc
    return { voterId: b.voterId, targetId: b.targetId, atMs: b.atMs }
  })
}

/** 오늘 내가 적은 사람. 투영이 **본인 것만** 실어 보낸다. */
export async function myBallotOn(gameId: string, day: number, uid: string): Promise<string | null> {
  const snap = await ballotsOf(gameId).doc(keyOf(day, uid)).get()
  return snap.exists ? ((snap.data() as BallotDoc).targetId ?? null) : null
}

/**
 * 운영자 — 그날(기본은 오늘) 누가 누구를 적었는지 그대로.
 *
 * **여기만 예외다.** 신뢰·호감표는 운영자에게도 팀 합계·사람별 합계
 * 까지만 나가지만, 이 투표는 판을 지키는 운영자가 흐름을 볼 수 있어야
 * 한다는 판단으로 개별 표를 그대로 연다. 플레이어에게는 여전히 결과
 * 한 줄뿐이다 — 이 콜러블은 운영자만 부를 수 있다.
 */
export const hostBallots = onCall<{ gameId: string; day?: number }>(async (req) => {
  requireHost(req.auth)
  const { gameId } = req.data
  const snap = await gameRef(gameId).get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  const game = snap.data() as GameDoc
  const day = typeof req.data.day === 'number' ? req.data.day : game.day
  const nameOf = (id: string) => game.seats.find((s) => s.playerId === id)?.name ?? id

  const rows = await ballotsOf(gameId).where('day', '==', day).get()
  return {
    day,
    rows: rows.docs
      .map((d) => d.data() as BallotDoc)
      .map((b) => ({
        voterId: b.voterId,
        voterName: nameOf(b.voterId),
        targetId: b.targetId,
        targetName: nameOf(b.targetId),
        atMs: b.atMs,
      }))
      .sort((a, b) => a.atMs - b.atMs),
  }
})

/**
 * 투표가 닫혔다(또는 운영자가 넘긴 정산이 대신 닫았다). 다음
 * 투명인간을 고르고 **그 자리에서** 지운다. 운영자가 그날 정산을
 * 넘길 때 한 번 돈다(catchup.pushByHand)거나, hostCloseBallot이 부른다.
 *
 * **마지막 날에는 안 고른다.** 내일이 없는 날에 사람을 지워 봐야
 * 아무 일도 일어나지 않고, 발표만 잔인하다.
 */
export async function settleBallots(
  gameId: string,
  game: GameDoc,
  day: number,
): Promise<{ invisibleId: string | null; reason: string } | null> {
  if (day >= TOTAL_DAYS) return null
  // 같은 날을 두 번 세지 않는다
  if ((await ballotDaysOf(gameId).doc(`d${day}`).get()).exists) return null

  // **지우개로 지운 표를 빼고 센다.** 누가 몇 장 지웠는지는 여기까지
  // 오고 더 가지 않는다 — 결과 한 줄 말고는 아무것도 안 나간다
  const picked = pickInvisible({
    counts: eraseFrom(countBallots(await ballotsOn(gameId, day)), await erasedOn(gameId, day)),
    // **오늘 이미 지워진 사람.** 지금은 game.invisibleId 가 아니다 —
    // hostOpenBallot 이 오늘 투표를 열 때 그 자리에서 이미 비워 뒀다.
    // invisibleByDay[day] 는 그 값이 비워지기 전에 적힌, 오늘 내내
    // 지워져 있던 사람이라 여기서는 이걸 본다
    yesterdayId: game.invisibleByDay[day] ?? null,
  })
  const team = picked.playerId ? (game.seats.find((s) => s.playerId === picked.playerId)?.team ?? null) : null

  const ref = gameRef(gameId)
  const nowMs = nowOf(game)
  const batch = db.batch()
  /*
   * **그 자리에서 지운다.** 발표되는 순간부터 다음 투표가 열릴 때까지가
   * 투명인간의 전부다 — hostOpenBallot 이 다음번에 비운다. 전에는
   * 「다음 날 08:00부터」였다. 이제 08:00 은 자정과 같은 시각이 됐고
   * (DAY_START_HOUR=0), 그 경계에 매일 까닭도 없어서 발표 즉시로
   * 바꿨다. invisibleByDay 는 그대로 둔다 — 뒷자리가 날짜로 되짚는다
   */
  batch.update(ref, {
    [`invisibleByDay.${day + 1}`]: picked.playerId,
    invisibleId: picked.playerId,
    invisibleTeam: team,
    // 세고 나면 문은 닫힌 것이다 — 운영자가 안 닫고 날을 넘겼어도
    ...(game.ballot?.day === day ? { 'ballot.open': false } : {}),
  })
  // 무전에는 안 적는다 — 무전은 사람끼리 하는 말만 오간다
  /*
   * **그날의 결과를 한 장 남긴다.**
   *
   * 전에는 이 사유(picked · none · tie · repeat)가 돌려주는 값으로만
   * 있다가 부르는 쪽에서 버려졌다. 게임 문서에는 「누가 지워졌나」만
   * 남고, 아무도 안 지워진 날은 이유가 뭉개졌다.
   *
   * 뒷자리는 **동률로 무효가 된 날을 안 센다**. 그 하루를 가르려면
   * 사유가 남아 있어야 한다.
   */
  const dayDoc: BallotDayDoc = {
    day,
    invisibleId: picked.playerId,
    reason: picked.reason,
    atMs: nowMs,
  }
  batch.set(ballotDaysOf(gameId).doc(`d${day}`), dayDoc)
  await batch.commit()
  // 받아 둔 심부름은 그대로 둔다 — 보이지 않아도 심부름은 한다(룰북 08)
  // **득표수는 어디에도 안 적는다.** 누가 지워졌는지와 왜인지만 남는다
  return { invisibleId: picked.playerId, reason: picked.reason }
}

/** 그날들의 결과. **서버 안에서만 돈다** — 뒷자리 판정이 읽는다. */
export async function ballotDays(gameId: string): Promise<BallotDayDoc[]> {
  const snap = await ballotDaysOf(gameId).get()
  return snap.docs.map((d) => d.data() as BallotDayDoc).sort((a, b) => a.day - b.day)
}

/**
 * 운영자가 오늘의 투명인간을 즉시 푼다.
 *
 * 사람이 힘들어하면 규칙보다 사람이 먼저다. **사유를 남긴다** —
 * 남기지 않으면 나중에 왜 풀었는지 아무도 모르고, 그러면 다음번에
 * 같은 판단을 못 한다.
 */
export const clearInvisible = onCall<{ gameId: string; reason: string }>(async (req) => {
  const uid = requireUid(req.auth)
  if (req.auth?.token?.admin !== true) throw new HttpsError('permission-denied', '감독관만 할 수 있다.')
  const { gameId, reason } = req.data
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw new HttpsError('invalid-argument', '사유를 적어야 한다.')
  }
  const { game, nowMs } = await freshNow(gameId)
  const who = game.invisibleId
  if (!who) throw new HttpsError('failed-precondition', '오늘은 투명인간이 없다.')

  const ref = gameRef(gameId)
  const batch = db.batch()
  batch.update(ref, {
    invisibleId: null,
    invisibleTeam: null,
    [`invisibleByDay.${game.day}`]: null,
  })
  batch.set(ref.collection('events').doc(), {
    atMs: nowMs,
    day: game.day,
    kind: 'invisibleCleared',
    playerId: who,
    byId: uid,
    detail: { reason: reason.trim().slice(0, 300) },
  })
  // 본인에게만 알린다. 사유는 싣지 않는다 — 운영자 기록에만 남는다
  batch.set(ref.collection('notices').doc(), {
    toPlayerId: who,
    text: '이제 다시 보인다.',
    atMs: nowMs,
    byId: uid,
  })
  await batch.commit()
  // 투명인간은 칸을 차지하지 않았다 — 누가 그 칸에 섰으면 비켜 세운다
  await reseatIfShared(gameId, who, nowMs)
  await refreshViews(gameId)
  return { cleared: who }
})

export { TEAMS }

/**
 * 정산을 넘길 때 표를 세고 알린다. **득표수는 남기지 않는다** — 발표되는
 * 것은 결과 한 줄뿐이다.
 */
export async function announceBallots(gameId: string, day: number): Promise<void> {
  const snap = await gameRef(gameId).get()
  const game = snap.data() as GameDoc
  const erased = await settleBallots(gameId, game, day)
  if (!erased) return
  const ref = gameRef(gameId)
  const atMs = nowOf(game)
  const batch = db.batch()
  const name = game.seats.find((s) => s.playerId === erased.invisibleId)?.name ?? null
  batch.set(ref.collection('notices').doc(), {
    toPlayerId: null,
    text: name ? announceInvisible(name) : ANNOUNCE_NOBODY,
    atMs,
  })
  if (erased.invisibleId) {
    batch.set(ref.collection('notices').doc(), {
      toPlayerId: erased.invisibleId,
      text: INVISIBLE_NOTICE,
      atMs,
    })
  }
  await batch.commit()
}
