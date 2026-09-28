// 자정 판정 — 날이 바뀌는 순간 열넷의 그날 미션을 판정해 날짜별로 남긴다.
//
// **미션은 하루짜리다.** 그날 0시부터 자정까지 한 것만 세고, 자정 판정이
// 그날의 결과다(달성 · 실패). 운영자가 날마다 발표한다.
//
// **판정은 여기서만 한다.** 셈은 shared/missions/judge.ts, 네 가지 판정은
// shared/missions/daily.ts 가 하고, 여기서는 재료를 모아 굳혀 둔다.
//
//   secret/missionDays/items/d{날}          그날 판정을 했다는 표시(날 · 자른 시각 · 최종인가)
//   secret/missionSnaps/items/d{날}_{사람}  한 사람의 그날 판정 — truth(운영자) · view(본인)
//
// **참가자에게는 아직 안 간다.** 운영자 화면이 먼저 보고, 보내기를 눌러야
// 그 사람에게 간다(4·5단계). 둘 다 secret 아래라 규칙이 클라이언트를 막는다.
//
// 날은 운영자가 넘긴다(pushDay). 넘기는 순간 판정하고, 무슨 까닭으로 빠졌으면
// 다음에 누가 두드릴 때(tick) **날짜순으로** 따라잡는다. 따라잡을 때도 그날
// 밤까지의 기록만 센다 — 넘긴 시각(pushedAtMs)에서 자른다.
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

import { judge } from '../../shared/missions/judge'
import { dayVerdict, dayView, type DayVerdict, type DayVerdictView } from '../../shared/missions/daily'
import { canonRoleId, type RoleId } from '../../shared/missions/roleNames'
import { TOTAL_DAYS, type TeamId } from '../../shared/rules/v2'
import type { GameDoc, RosterDoc, ScheduleDoc } from '../../shared/model'

import { buildLog } from './ending'
import { gameRef } from './index'
import { requireHost } from './host'

const db = getFirestore()

export const missionDaysOf = (gameId: string) =>
  gameRef(gameId).collection('secret').doc('missionDays').collection('items')
export const missionSnapsOf = (gameId: string) =>
  gameRef(gameId).collection('secret').doc('missionSnaps').collection('items')

export const snapId = (day: number, playerId: string) => `d${day}_${playerId}`

export interface MissionDayDoc {
  day: number
  /** 이 시각부터 센 하루다 */
  fromMs: number
  /** 이 시각까지의 기록으로 판정했다 */
  asOfMs: number
  /** 마지막 날 — 최종 판정 */
  final: boolean
  count: number
}

export interface MissionSnapDoc {
  day: number
  playerId: string
  roleId: RoleId
  team: TeamId
  asOfMs: number
  final: boolean
  /** 운영자가 보는 판정. 숨긴 조항까지 다 센다 */
  truth: DayVerdict
  /** 본인에게 갈 판정. 공개 시점이 안 된 조항은 값이 없다 */
  view: DayVerdictView
  /** 운영자가 뒤집었으면 그 기록(4단계). 없으면 null */
  override: { status: DayVerdict['status']; reason: string; byId: string; atMs: number } | null
  /** 그 사람에게 보낸 시각(4단계). 안 보냈으면 null */
  sentAtMs: number | null
}

/** 투명인간 투표가 있는 날인가. 투표는 DAY 1 ~ 마지막 전날까지다 */
export const hasBallot = (day: number): boolean => day < TOTAL_DAYS

/**
 * 한 날을 판정한다. 이미 했으면 아무것도 안 한다(false).
 *
 * 표시 문서를 **create** 로 쓴다 — 둘이 동시에 불러도 한쪽 묶음만 들어간다.
 */
export async function judgeMissionDay(
  gameId: string,
  game: GameDoc,
  day: number,
  /** 그날 0시 — 전날을 넘긴 시각. **미션은 하루짜리라 여기부터 센다** */
  fromMs: number,
  asOfMs: number,
  final: boolean,
): Promise<boolean> {
  const metaRef = missionDaysOf(gameId).doc(`d${day}`)
  if ((await metaRef.get()).exists) return false
  const { log, roster } = await buildLog(gameId, game, { over: true, fromMs, asOfMs, throughDay: day })
  const ctx = { final, noBallot: !hasBallot(day) }
  const batch = db.batch()
  batch.create(metaRef, { day, fromMs, asOfMs, final, count: roster.length } satisfies MissionDayDoc)
  for (const r of roster as RosterDoc[]) {
    // 이름을 바꾸기 전에 배정된 판은 옛 키(snacker · locker)를 쥐고 있다
    const roleId = canonRoleId(r.roleId)
    if (!roleId) continue
    const truth = dayVerdict(judge({ playerId: r.playerId, team: r.team, roleId, targetId: r.targetId ?? null }, log), ctx)
    const doc: MissionSnapDoc = {
      day,
      playerId: r.playerId,
      roleId,
      team: r.team,
      asOfMs,
      final,
      truth,
      view: dayView(truth, final),
      override: null,
      sentAtMs: null,
    }
    batch.set(missionSnapsOf(gameId).doc(snapId(day, r.playerId)), doc)
  }
  try {
    await batch.commit()
  } catch (e) {
    // 다른 요청이 먼저 같은 날을 판정했다. 그쪽 묶음이 들어갔다
    if ((await metaRef.get()).exists) return false
    throw e
  }
  await gameRef(gameId).update({ missionJudgedThrough: day })
  return true
}

/** 그날 밤을 어디서 자를까 — 다음 날을 실제로 넘긴 시각. 마지막 날은 판이 끝난 시각 */
async function cutoffs(gameId: string): Promise<Map<string, number>> {
  const snap = await gameRef(gameId).collection('schedule').where('kind', 'in', ['dayStart', 'gameEnd']).get()
  const out = new Map<string, number>()
  for (const d of snap.docs) {
    const s = d.data() as ScheduleDoc
    if (s.doneAtMs === null) continue
    const day = Number(s.payload?.day ?? 0)
    out.set(`${s.kind}:${day}`, s.pushedAtMs ?? s.doneAtMs)
  }
  return out
}

/**
 * 밀린 날을 **날짜순으로** 판정한다. 판정한 날 수를 돌려준다.
 *
 * 게임 문서의 missionJudgedThrough 만 보고 할 일이 없으면 곧장 나간다 —
 * 열넷이 몇 초마다 두드려도 읽기가 늘지 않는다.
 */
export async function catchUpMissionDays(gameId: string, game?: GameDoc): Promise<number> {
  const g = game ?? ((await gameRef(gameId).get()).data() as GameDoc | undefined)
  if (!g || g.phase === 'lobby') return 0
  const finished = g.phase === 'finished'
  /** 판정할 수 있는 마지막 날 — 끝났으면 마지막 날까지, 아니면 어제까지 */
  const upTo = finished ? g.day : g.day - 1
  const done = g.missionJudgedThrough ?? 0
  if (upTo <= done) return 0

  const cut = await cutoffs(gameId)
  let judged = 0
  for (let day = done + 1; day <= upTo; day++) {
    const final = finished && day === g.day
    const asOfMs = final ? cut.get(`gameEnd:${day}`) : cut.get(`dayStart:${day + 1}`)
    // 그날을 넘긴 기록이 없으면 여기서 멈춘다 — 순서를 건너뛰어 판정하지 않는다
    if (asOfMs === undefined) break
    // 그날 0시 — DAY 1 은 판이 시작한 때, 그 뒤로는 그날을 넘긴 때
    const fromMs = day === 1 ? (g.startedAtMs ?? 0) : cut.get(`dayStart:${day}`)
    if (fromMs === undefined) break
    if (await judgeMissionDay(gameId, g, day, fromMs, asOfMs, final)) judged += 1
  }
  return judged
}

/**
 * 운영자가 날짜별 판정을 본다. 날을 안 주면 가장 최근 날.
 *
 * **운영자만.** 4단계 화면이 이것을 그린다. 남의 추리 노트나 A의 기록은
 * 여기 없다 — 미션 판정뿐이다.
 */
export const hostMissionDay = onCall<{ gameId: string; day?: number }>(async (req) => {
  requireHost(req.auth)
  const { gameId } = req.data
  const gameSnap = await gameRef(gameId).get()
  if (!gameSnap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  await catchUpMissionDays(gameId, gameSnap.data() as GameDoc)
  const days = (await missionDaysOf(gameId).get()).docs.map((d) => d.data() as MissionDayDoc).sort((a, b) => a.day - b.day)
  const day = typeof req.data.day === 'number' ? req.data.day : (days[days.length - 1]?.day ?? null)
  if (day === null) return { days, day: null, rows: [], prev: [] }
  const [rows, prev] = await Promise.all([
    missionSnapsOf(gameId).where('day', '==', day).get(),
    day > 1 ? missionSnapsOf(gameId).where('day', '==', day - 1).get() : null,
  ])
  const game = gameSnap.data() as GameDoc
  const nameOf = (id: string) => game.seats.find((s) => s.playerId === id)?.name ?? ''
  return {
    days,
    day,
    rows: rows.docs.map((d) => ({ ...(d.data() as MissionSnapDoc), name: nameOf((d.data() as MissionSnapDoc).playerId) })),
    prev: prev ? prev.docs.map((d) => d.data() as MissionSnapDoc) : [],
  }
})
