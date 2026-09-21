// 투명인간 투표.
//
// **신뢰·호감 표와는 완전히 다른 것이다.** 그쪽은 마주 서야 주는
// 호의고, 이쪽은 만나지 않고 하는 배제다. 어디서든 던지고, 마감 전까지
// 바꿀 수 있고, 하루에 한 사람만 적는다.
//
// 누가 누구를 적었는지는 **게임이 끝날 때까지 아무에게도 안 나간다.**
// 운영자에게도. 득표수도 안 나간다 — 발표되는 것은 결과 한 줄뿐이다.
// 「몇 표였다」가 새는 순간 누가 적었는지를 좁혀 나갈 수 있고, 그러면
// 이 투표가 무기명이라는 말이 거짓이 된다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

import { canName, countBallots, eraseFrom, pickInvisible, type Ballot } from '../../shared/rules/invisible'
import { PHASES_PER_DAY } from '../../shared/rules/occupy'
import { TOTAL_DAYS } from '../../shared/rules/v2'
import { TEAMS } from '../../shared/rules/lobby'
import type { GameDoc, TeamDoc } from '../../shared/model'
import { dropAllErrands } from './errand'
import { erasedOn } from './use'
import { freshNow } from './turn'
import { refreshViews } from './views'
import { gameRef, requireUid } from './index'

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
  atMs: number
}

const ballotsOf = (gameId: string) => gameRef(gameId).collection('secret').doc('ballots').collection('items')
const keyOf = (day: number, voterId: string) => `d${day}:${voterId}`

/** 지금 팀장인 사람들. 팀장은 적을 수 없다. */
async function captainsOf(gameId: string): Promise<string[]> {
  const teams = await gameRef(gameId).collection('teams').get()
  return teams.docs
    .map((d) => (d.data() as TeamDoc).captainId)
    .filter((id): id is string => typeof id === 'string' && id !== '')
}

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

  const day = game.phaseNow?.day ?? game.day
  const out = canName({
    voterId: uid,
    targetId,
    captainIds: await captainsOf(gameId),
    yesterdayId: game.invisibleId ?? null,
  })
  if (!out.ok) {
    const why: Record<string, string> = {
      self: '나는 못 적는다.',
      captain: '팀장은 못 적는다.',
      repeat: '어제 지워진 사람이다.',
    }
    throw new HttpsError('failed-precondition', why[out.reason as string] ?? '적을 수 없다.')
  }

  const doc: BallotDoc = { day, voterId: uid, targetId, atMs: nowMs }
  await ballotsOf(gameId).doc(keyOf(day, uid)).set(doc)
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

/** 그날 마지막 페이즈인가. 여기서 집계한다. */
export const isLastPhaseOfDay = (phaseNo: number): boolean => phaseNo % PHASES_PER_DAY === 0

/**
 * 하루가 끝났다. 내일의 투명인간을 고른다.
 *
 * **마지막 날에는 안 고른다.** 내일이 없는 날에 사람을 지워 봐야
 * 아무 일도 일어나지 않고, 발표만 잔인하다.
 */
export async function settleBallots(
  gameId: string,
  game: GameDoc,
  phaseNo: number,
): Promise<{ invisibleId: string | null; reason: string } | null> {
  if (!isLastPhaseOfDay(phaseNo)) return null
  const day = Math.floor((phaseNo - 1) / PHASES_PER_DAY) + 1
  if (day >= TOTAL_DAYS) return null

  // **지우개로 지운 표를 빼고 센다.** 누가 몇 장 지웠는지는 여기까지
  // 오고 더 가지 않는다 — 결과 한 줄 말고는 아무것도 안 나간다
  const picked = pickInvisible({
    counts: eraseFrom(countBallots(await ballotsOn(gameId, day)), await erasedOn(gameId, day)),
    yesterdayId: game.invisibleId ?? null,
  })

  const ref = gameRef(gameId)
  const batch = db.batch()
  batch.update(ref, {
    [`invisibleByDay.${day + 1}`]: picked.playerId,
    invisibleId: picked.playerId,
  })
  /*
   * **지워지면 받아 둔 심부름을 놓는다.**
   *
   * 없는 사람에게 일을 맡길 수는 없다. 받기 자체가 막히는데 이미
   * 받아 둔 것만 남아 있으면, 물건을 든 채로 아무에게도 안 보이는
   * 사람이 하루를 돈다 — 도착 방에 놓아도 그 방 사람들은 물건이
   * 저절로 생겼다고 볼 것이다.
   */
  if (picked.playerId) await dropAllErrands(gameId, picked.playerId)

  // 투명인간이 나온 팀은 그날 팀 전체로 토큰을 더 받는다. 지워진 것은
  // 한 사람인데 팀이 무너지면, 투표가 사람이 아니라 팀을 겨누게 된다
  if (picked.playerId) {
    const team = game.seats.find((s) => s.playerId === picked.playerId)?.team
    if (team) batch.update(ref, { invisibleTeam: team })
  } else {
    batch.update(ref, { invisibleTeam: null })
  }
  await batch.commit()
  // **득표수는 어디에도 안 적는다.** 결과 한 줄만 남는다
  return { invisibleId: picked.playerId, reason: picked.reason }
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
  if (req.auth?.token?.admin !== true) throw new HttpsError('permission-denied', '운영자만 할 수 있다.')
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
    [`invisibleByDay.${game.phaseNow?.day ?? game.day}`]: null,
  })
  batch.set(ref.collection('events').doc(), {
    atMs: nowMs,
    day: game.phaseNow?.day ?? game.day,
    kind: 'invisibleCleared',
    playerId: who,
    byId: uid,
    detail: { reason: reason.trim().slice(0, 300) },
  })
  await batch.commit()
  await refreshViews(gameId)
  return { cleared: who }
})

export { TEAMS }
