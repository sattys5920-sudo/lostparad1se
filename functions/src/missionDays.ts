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
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

import { judge } from '../../shared/missions/judge'
import { dayVerdict, dayView, type DayVerdict, type DayVerdictView } from '../../shared/missions/daily'
import type { MissionBoard, MissionMail } from '../../shared/missions/mail'
import { ROLE_BY_ID } from '../../shared/missions/roles'
import { ROLE_NAMES, canonRoleId, type RoleId } from '../../shared/missions/roleNames'
import { TOTAL_DAYS, type TeamId } from '../../shared/rules/v2'
import type { GameDoc, RosterDoc, ScheduleDoc } from '../../shared/model'

import { buildLog } from './ending'
import { gameRef, requireUid } from './index'
import { requireHost } from './host'

const db = getFirestore()

export const missionDaysOf = (gameId: string) =>
  gameRef(gameId).collection('secret').doc('missionDays').collection('items')
export const missionSnapsOf = (gameId: string) =>
  gameRef(gameId).collection('secret').doc('missionSnaps').collection('items')

/** 운영자가 뒤집고 보낸 기록 — 언제 누가 무엇을 */
export const missionLogOf = (gameId: string) =>
  gameRef(gameId).collection('secret').doc('missionLog').collection('items')
/** 본인만 읽는 우편함(firestore.rules) */
export const inboxOf = (gameId: string) => gameRef(gameId).collection('inbox')
const rosterOf = (gameId: string) => gameRef(gameId).collection('secret').doc('roster').collection('items')
/**
 * 짝사랑의 대상 — 날짜별. **배정 때 정하지 않는다.** 운영자가 밤마다
 * 정한다(hostSetCrushTarget) — 그날 못 정하면 그 날짜는 키가 없고,
 * 그날 조항은 대상 없음으로 실패한다.
 */
const crushOf = (gameId: string) => gameRef(gameId).collection('secret').doc('crush')

interface CrushDoc {
  byDay: Record<string, string>
}

export async function crushTargetFor(gameId: string, day: number): Promise<string | null> {
  const doc = (await crushOf(gameId).get()).data() as (CrushDoc & Record<string, unknown>) | undefined
  const legacy = doc?.[`byDay.${day}`]
  // **옛 저장도 읽는다.** 전에는 점이 든 이름(「byDay.1」)을 칸 하나로 적어서 byDay 안에
  // 안 들어갔다 — 그때 정해 둔 대상이 사라지지 않게 그 칸도 본다
  return doc?.byDay?.[String(day)] ?? (typeof legacy === 'string' ? legacy : null)
}

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
  const crushTarget = await crushTargetFor(gameId, day)
  const batch = db.batch()
  batch.create(metaRef, { day, fromMs, asOfMs, final, count: roster.length } satisfies MissionDayDoc)
  for (const r of roster as RosterDoc[]) {
    // 이름을 바꾸기 전에 배정된 판은 옛 키(snacker · locker)를 쥐고 있다
    const roleId = canonRoleId(r.roleId)
    if (!roleId) continue
    // 짝사랑의 대상은 그날 운영자가 정한 것이다 — 배정 때 정한 값이 아니다
    const targetId = roleId === 'crush' ? crushTarget : (r.targetId ?? null)
    const truth = dayVerdict(judge({ playerId: r.playerId, team: r.team, roleId, targetId }, log), ctx)
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

/**
 * **이미 판정한 날을 같은 자로 다시 판정한다** — 결과(truth · view)만 바꾸고,
 * 운영자가 뒤집은 것(override)과 보낸 시각(sentAtMs)은 그대로 둔다.
 *
 * 투명인간 결과를 날을 넘긴 뒤에 발표하면(ballotGate.hostAnnounceBallot), 그날
 * 미션은 이미 발표 전 기록으로 판정돼 있다 — 뒷자리(「내가 적은 이름이 투명인간이
 * 됨」)가 결과 없이 실패로 굳는다. 발표하는 자리에서 이것을 부른다. 그날을 아직
 * 판정 안 했으면 아무 일도 없다. 다시 판정한 사람 수를 돌려준다
 */
export async function rejudgeMissionDay(gameId: string, day: number): Promise<number> {
  const meta = (await missionDaysOf(gameId).doc(`d${day}`).get()).data() as MissionDayDoc | undefined
  if (!meta) return 0
  const game = (await gameRef(gameId).get()).data() as GameDoc
  const { log, roster } = await buildLog(gameId, game, { over: true, fromMs: meta.fromMs, asOfMs: meta.asOfMs, throughDay: day })
  const ctx = { final: meta.final, noBallot: !hasBallot(day) }
  const crushTarget = await crushTargetFor(gameId, day)
  const batch = db.batch()
  let n = 0
  for (const r of roster as RosterDoc[]) {
    const roleId = canonRoleId(r.roleId)
    if (!roleId) continue
    const targetId = roleId === 'crush' ? crushTarget : (r.targetId ?? null)
    const truth = dayVerdict(judge({ playerId: r.playerId, team: r.team, roleId, targetId }, log), ctx)
    batch.set(missionSnapsOf(gameId).doc(snapId(day, r.playerId)), { truth, view: dayView(truth, meta.final) }, { merge: true })
    n += 1
  }
  await batch.commit()
  return n
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

/** 오늘 0시 — DAY 1 은 판이 시작한 때, 그 뒤로는 운영자가 오늘을 넘긴 때. 모르면 undefined */
export async function todayFromMs(gameId: string, game: GameDoc): Promise<number | undefined> {
  if (game.day <= 1) return game.startedAtMs ?? undefined
  return (await cutoffs(gameId)).get(`dayStart:${game.day}`)
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


/** 운영자가 남기는 기록 한 줄 */
export interface MissionLogDoc {
  kind: 'override' | 'send' | 'board'
  day: number
  playerIds: string[]
  /** 뒤집기 — 전 값과 새 값(null 이면 뒤집기를 거뒀다) · 까닭 */
  from?: DayVerdict['status'] | null
  to?: DayVerdict['status'] | null
  reason?: string
  byId: string
  atMs: number
}

const nameIn = (game: GameDoc) => (id: string) => game.seats.find((s) => s.playerId === id)?.name ?? ''

/**
 * 운영자가 날짜별 판정을 본다. 날을 안 주면 가장 최근 날.
 *
 * **운영자만.** 4단계 화면이 이것을 그린다. 남의 추리 노트나 A의 기록은
 * 여기 없다 — 미션 판정뿐이다. 그날 뒤집고 보낸 기록도 같이 준다.
 */
export const hostMissionDay = onCall<{ gameId: string; day?: number }>(async (req) => {
  requireHost(req.auth)
  const { gameId } = req.data
  const gameSnap = await gameRef(gameId).get()
  if (!gameSnap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  await catchUpMissionDays(gameId, gameSnap.data() as GameDoc)
  const days = (await missionDaysOf(gameId).get()).docs.map((d) => d.data() as MissionDayDoc).sort((a, b) => a.day - b.day)
  const day = typeof req.data.day === 'number' ? req.data.day : (days[days.length - 1]?.day ?? null)
  if (day === null) return { days, day: null, rows: [], prev: [], log: [] }
  const [rows, prev, log] = await Promise.all([
    missionSnapsOf(gameId).where('day', '==', day).get(),
    day > 1 ? missionSnapsOf(gameId).where('day', '==', day - 1).get() : null,
    missionLogOf(gameId).where('day', '==', day).get(),
  ])
  const nameOf = nameIn(gameSnap.data() as GameDoc)
  return {
    days,
    day,
    rows: rows.docs.map((d) => {
      const r = d.data() as MissionSnapDoc
      return { ...r, name: nameOf(r.playerId), roleName: ROLE_NAMES[r.roleId] ?? r.roleId, mail: mailOf(r) }
    }),
    prev: prev ? prev.docs.map((d) => d.data() as MissionSnapDoc) : [],
    log: log.docs
      .map((d) => d.data() as MissionLogDoc)
      .sort((a, b) => b.atMs - a.atMs)
      .map((l) => ({ ...l, names: l.playerIds.map(nameOf) })),
  }
})

/**
 * 본인에게 갈 한 장. **view 에서만 만든다** — truth 는 한 글자도 안 섞는다.
 * 운영자가 뒤집었으면 결과만 그 값으로 바꾼다. 까닭은 안 보낸다.
 */
export function mailOf(snap: MissionSnapDoc, sentAtMs = snap.sentAtMs ?? 0): MissionMail {
  const role = ROLE_BY_ID[snap.roleId]
  return {
    day: snap.day,
    final: snap.final,
    status: snap.override?.status ?? snap.view.status,
    clauses: snap.view.clauses,
    roleName: ROLE_NAMES[snap.roleId] ?? '',
    line: role?.line ?? '',
    sentAtMs,
  }
}

const OVERRIDE_TO = new Set(['met', 'failed'])
const REASON_MAX = 200

/**
 * 운영자가 한 사람의 그날 결과를 뒤집는다. status 가 null 이면 뒤집기를 거둔다.
 *
 * **까닭을 꼭 적는다.** 기록에 남는다(secret/missionLog). 이미 보낸 뒤라면
 * 다시 보내야 그 사람에게 간다 — 보낸 것을 몰래 바꾸지 않는다.
 */
export const hostMissionOverride = onCall<{
  gameId: string
  day: number
  playerId: string
  status: 'met' | 'failed' | null
  reason: string
}>(async (req) => {
  const hostId = requireHost(req.auth)
  const { gameId, day, playerId } = req.data
  const status = req.data.status ?? null
  const reason = String(req.data.reason ?? '').trim().slice(0, REASON_MAX)
  if (status !== null && !OVERRIDE_TO.has(status)) throw new HttpsError('invalid-argument', '달성 아니면 실패로만 바꾼다.')
  if (status !== null && reason.length === 0) throw new HttpsError('invalid-argument', '바꾸는 까닭을 적어라.')
  const ref = missionSnapsOf(gameId).doc(snapId(Number(day), String(playerId)))
  const atMs = Date.now()
  const out = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpsError('not-found', '그날 판정이 없다.')
    const cur = snap.data() as MissionSnapDoc
    const from = cur.override?.status ?? null
    tx.update(ref, { override: status === null ? null : { status, reason, byId: hostId, atMs } })
    tx.create(missionLogOf(gameId).doc(), {
      kind: 'override',
      day: cur.day,
      playerIds: [cur.playerId],
      from,
      to: status,
      reason,
      byId: hostId,
      atMs,
    } satisfies MissionLogDoc)
    return { sent: cur.sentAtMs !== null }
  })
  return { ok: true, ...out }
})

/**
 * 운영자가 그날 판정을 보낸다 — 한 사람 · 고른 사람 · 전부.
 *
 * 받는 사람의 우편함(inbox/{사람})에 **본인 몫(view)만** 적는다. 다시 보내면
 * 덮어쓰고, 그 사람의 팝업이 다시 뜬다(seen 을 지운다).
 */
export const hostMissionSend = onCall<{ gameId: string; day: number; playerIds?: string[] }>(async (req) => {
  const hostId = requireHost(req.auth)
  const { gameId } = req.data
  const day = Number(req.data.day)
  const snaps = await missionSnapsOf(gameId).where('day', '==', day).get()
  if (snaps.empty) throw new HttpsError('failed-precondition', '그날 판정이 아직 없다.')
  const want = Array.isArray(req.data.playerIds) ? new Set(req.data.playerIds.map(String)) : null
  const pick = snaps.docs.filter((d) => !want || want.has((d.data() as MissionSnapDoc).playerId))
  if (pick.length === 0) throw new HttpsError('invalid-argument', '보낼 사람이 없다.')
  const atMs = Date.now()
  const batch = db.batch()
  for (const d of pick) {
    const snap = d.data() as MissionSnapDoc
    batch.update(d.ref, { sentAtMs: atMs })
    batch.set(
      inboxOf(gameId).doc(snap.playerId),
      { missions: { [`d${day}`]: mailOf(snap, atMs) }, seen: { [`d${day}`]: FieldValue.delete() } },
      { merge: true },
    )
  }
  const ids = pick.map((d) => (d.data() as MissionSnapDoc).playerId)
  batch.create(missionLogOf(gameId).doc(), { kind: 'send', day, playerIds: ids, byId: hostId, atMs } satisfies MissionLogDoc)
  await batch.commit()
  return { ok: true, sent: ids.length }
})

/**
 * 그날 결과를 **모두에게** 알린다 — 「민수 성공 · 예지 실패」.
 *
 * 개인에게 보내기(hostMissionSend)와 따로다. 저쪽은 제 조항과 숫자까지
 * 본인 우편함에 넣고, 이쪽은 열넷 전원의 이름과 해냈는지만 판 문서에
 * 적는다. **역할 · 조건 · 숫자는 안 싣는다** — 그것까지 나가면 누가 무슨
 * 역할인지가 결과 한 장으로 풀린다.
 *
 * 뒤집은 판정이 있으면 뒤집은 값으로 적는다. 본인이 받은 종이와 모두가
 * 본 한 줄이 다르면 안 된다. 다시 누르면 새로 적는다(뒤집은 뒤 고쳐 알릴 때).
 */
export const hostMissionBoard = onCall<{ gameId: string; day: number }>(async (req) => {
  const hostId = requireHost(req.auth)
  const { gameId } = req.data
  const day = Number(req.data.day)
  if (!Number.isInteger(day) || day < 1) throw new HttpsError('invalid-argument', '날이 이상하다.')
  const [gameSnap, snaps] = await Promise.all([gameRef(gameId).get(), missionSnapsOf(gameId).where('day', '==', day).get()])
  if (!gameSnap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  if (snaps.empty) throw new HttpsError('failed-precondition', '그날 판정이 아직 없다.')
  const game = gameSnap.data() as GameDoc
  const byId = new Map(snaps.docs.map((d) => [(d.data() as MissionSnapDoc).playerId, d.data() as MissionSnapDoc]))
  // 자리 순서대로. 판정이 없는 사람(중간에 빠진 자리)은 안 싣는다
  const rows = game.seats
    .filter((s) => byId.has(s.playerId))
    .map((s) => {
      const snap = byId.get(s.playerId) as MissionSnapDoc
      return { playerId: s.playerId, met: (snap.override?.status ?? snap.view.status) === 'met' }
    })
  const atMs = Date.now()
  const board: MissionBoard = { day, final: snaps.docs.some((d) => (d.data() as MissionSnapDoc).final), atMs, rows }
  const batch = db.batch()
  batch.update(gameRef(gameId), { [`missionBoards.d${day}`]: board })
  batch.create(missionLogOf(gameId).doc(), { kind: 'board', day, playerIds: rows.map((r) => r.playerId), byId: hostId, atMs } satisfies MissionLogDoc)
  await batch.commit()
  return { ok: true, day, met: rows.filter((r) => r.met).length, failed: rows.filter((r) => !r.met).length }
})

/** 본인이 팝업을 닫았다. 다음에 앱을 열어도 다시 안 뜬다 */
export const seenMissionDay = onCall<{ gameId: string; day: number }>(async (req) => {
  const uid = requireUid(req.auth)
  const day = Number(req.data.day)
  if (!Number.isInteger(day) || day < 1) throw new HttpsError('invalid-argument', '날이 이상하다.')
  await inboxOf(req.data.gameId).doc(uid).set({ seen: { [`d${day}`]: true } }, { merge: true })
  return { ok: true }
})

/** 이 판의 짝사랑 한 줄. 없으면 null */
async function crushOf14(gameId: string): Promise<(RosterDoc & { roleId: 'crush' }) | null> {
  const snap = await rosterOf(gameId).get()
  for (const d of snap.docs) {
    const r = d.data() as RosterDoc
    if (canonRoleId(r.roleId) === 'crush') return r as RosterDoc & { roleId: 'crush' }
  }
  return null
}

/**
 * 운영자가 오늘의 짝사랑 대상을 본다 — 후보(다른 팀 사람)와 이미 골랐으면 그 사람.
 *
 * **오늘 치만 다룬다.** 지난 날은 이미 판정이 끝났고, 앞날은 아직
 * 누가 있을지 운영자도 모른다(팀이 바뀔 수 있다) — 그날 아침에 그날
 * 것만 고르게 한다.
 */
export const hostCrushTarget = onCall<{ gameId: string }>(async (req) => {
  requireHost(req.auth)
  const { gameId } = req.data
  const snap = await gameRef(gameId).get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  const game = snap.data() as GameDoc
  const crush = await crushOf14(gameId)
  if (!crush) return { day: game.day, crushPlayerId: null, crushName: null, candidates: [], targetId: null }
  const candidates = game.seats
    // **분단은 안 가린다.** 같은 분단 사람도 대상이 될 수 있다
    .filter((s) => s.team !== null && s.playerId !== crush.playerId)
    .map((s) => ({ id: s.playerId, name: s.name, team: s.team as TeamId }))
  const targetId = await crushTargetFor(gameId, game.day)
  return { day: game.day, crushPlayerId: crush.playerId, crushName: nameIn(game)(crush.playerId), candidates, targetId }
})

/**
 * 오늘의 대상을 정한다(또는 targetId 를 안 주면 거둔다). **오늘 치만.**
 *
 * 분단은 안 가린다 — 나 말고는 누구든 된다.
 */
export const hostSetCrushTarget = onCall<{ gameId: string; targetId?: string | null }>(async (req) => {
  requireHost(req.auth)
  const { gameId } = req.data
  const targetId = req.data.targetId ? String(req.data.targetId) : null
  const snap = await gameRef(gameId).get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  const game = snap.data() as GameDoc
  const crush = await crushOf14(gameId)
  if (!crush) throw new HttpsError('failed-precondition', '이 판에 짝사랑이 없다.')
  if (targetId !== null) {
    if (targetId === crush.playerId) throw new HttpsError('invalid-argument', '자기 자신은 대상이 될 수 없다.')
    const seat = game.seats.find((s) => s.playerId === targetId)
    if (!seat) throw new HttpsError('invalid-argument', '그런 사람이 없다.')
  }
  /*
   * **byDay 지도 안의 그날 칸에 적는다.** set 은 점이 든 이름을 경로로 안 읽는다 —
   * `{ 'byDay.1': … }` 로 적으면 「byDay.1」이라는 칸이 따로 생겨서 대상이 안 정해졌다.
   * 그렇게 생긴 옛 칸은 여기서 지운다
   */
  const day = String(game.day)
  await crushOf(gameId).set(
    { byDay: { [day]: targetId === null ? FieldValue.delete() : targetId }, [`byDay.${day}`]: FieldValue.delete() },
    { merge: true },
  )
  return { day: game.day, targetId }
})
