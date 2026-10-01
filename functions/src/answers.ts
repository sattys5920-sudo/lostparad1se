// 답안지 — 서로의 역할을 맞힌다(shared/rules/answers).
//
//   hostOpenAnswers   감독관이 연다. 모두의 화면에 답안지가 뜬다
//   submitAnswers     각자 낸다. 채점 전까지는 고쳐 낼 수 있다
//   myAnswers         내가 낸 것(다시 열었을 때 채워 둔다)
//   hostAnswers       감독관이 본다 — 누가 냈는지와 답
//   hostGradeAnswers  채점한다. 정답과 점수가 게임 문서에 적혀 모두에게 간다
//
// **정답은 채점하는 순간에만 밖으로 나간다.** 그 전까지 역할은 secret 에만 있다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

import { gameRef, requireUid } from './index'
import { requireHost } from './host'
import type { GameDoc, RosterDoc } from '../../shared/model'
import { cleanAnswers, gradeSheet } from '../../shared/rules/answers'
import { canonRoleId, type RoleId } from '../../shared/missions/roleNames'

const db = getFirestore()

const sheetsOf = (gameId: string) => gameRef(gameId).collection('secret').doc('answers').collection('items')
const rosterOf = (gameId: string) => gameRef(gameId).collection('secret').doc('roster').collection('items')
/** 최종 점수. **감독관이 계산해 적는다** — 게임이 매기지 않는다. 사람마다 제 것만 본다 */
export const finalScoresOf = (gameId: string) => gameRef(gameId).collection('secret').doc('finalScores')

interface SheetDoc {
  playerId: string
  answers: Record<string, RoleId>
  atMs: number
}

async function gameOf(gameId: string): Promise<GameDoc> {
  const snap = await gameRef(gameId).get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  return snap.data() as GameDoc
}

export const hostOpenAnswers = onCall<{ gameId: string; open: boolean }>(async (req) => {
  requireHost(req.auth)
  const { gameId } = req.data
  const game = await gameOf(gameId)
  if (game.phase === 'lobby') throw new HttpsError('failed-precondition', '판이 시작된 뒤에 연다.')
  if (req.data.open === false) {
    await gameRef(gameId).update({ answerSheet: null })
    return { open: false }
  }
  // 다시 열면 지난 채점은 지운다 — 새로 맞히는 판이다
  await gameRef(gameId).update({ answerSheet: { openAtMs: Date.now() }, answerResult: null })
  return { open: true }
})

export const submitAnswers = onCall<{ gameId: string; answers: Record<string, string> }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const game = await gameOf(gameId)
  if (!game.seats.some((s) => s.playerId === uid)) throw new HttpsError('permission-denied', '이 판에 없는 사람이다.')
  if (!game.answerSheet) throw new HttpsError('failed-precondition', '답안지가 열려 있지 않다.')
  const answers = cleanAnswers(req.data.answers, game.seats.map((s) => s.playerId))
  const doc: SheetDoc = { playerId: uid, answers, atMs: Date.now() }
  await sheetsOf(gameId).doc(uid).set(doc)
  return { saved: Object.keys(answers).length }
})

export const myAnswers = onCall<{ gameId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const snap = await sheetsOf(req.data.gameId).doc(uid).get()
  const d = snap.exists ? (snap.data() as SheetDoc) : null
  return { answers: d?.answers ?? {}, atMs: d?.atMs ?? null }
})

export const hostAnswers = onCall<{ gameId: string }>(async (req) => {
  requireHost(req.auth)
  const { gameId } = req.data
  const game = await gameOf(gameId)
  const [sheets, roster] = await Promise.all([sheetsOf(gameId).get(), rosterOf(gameId).get()])
  const key = keyOf(roster.docs.map((d) => d.data() as RosterDoc))
  const byId = new Map(sheets.docs.map((d) => [d.id, d.data() as SheetDoc]))
  return {
    open: Boolean(game.answerSheet),
    rows: game.seats.map((s) => {
      const sh = byId.get(s.playerId) ?? null
      return {
        playerId: s.playerId,
        name: s.name,
        submitted: sh !== null,
        atMs: sh?.atMs ?? null,
        answers: sh?.answers ?? {},
        // 감독관 화면에만. 채점 전 점수를 미리 본다
        preview: sh ? gradeSheet(sh.answers, key) : null,
      }
    }),
  }
})

function keyOf(rows: readonly RosterDoc[]): Record<string, RoleId> {
  const key: Record<string, RoleId> = {}
  for (const r of rows) {
    const id = canonRoleId(r.roleId)
    if (id) key[r.playerId] = id
  }
  return key
}

export const hostGradeAnswers = onCall<{ gameId: string }>(async (req) => {
  requireHost(req.auth)
  const { gameId } = req.data
  const game = await gameOf(gameId)
  const [sheets, roster] = await Promise.all([sheetsOf(gameId).get(), rosterOf(gameId).get()])
  const key = keyOf(roster.docs.map((d) => d.data() as RosterDoc))
  if (Object.keys(key).length === 0) throw new HttpsError('failed-precondition', '역할이 아직 안 정해졌다.')
  const byId = new Map(sheets.docs.map((d) => [d.id, d.data() as SheetDoc]))
  const nameOf = (id: string) => game.seats.find((s) => s.playerId === id)?.name ?? '?'
  const result = {
    atMs: Date.now(),
    key: game.seats
      .filter((s) => key[s.playerId])
      .map((s) => ({ playerId: s.playerId, name: s.name, roleId: key[s.playerId] as string })),
    scores: game.seats
      .map((s) => {
        const sh = byId.get(s.playerId)
        const g = gradeSheet(sh?.answers ?? {}, key)
        return { playerId: s.playerId, name: nameOf(s.playerId), ...g, submitted: Boolean(sh) }
      })
      .sort((a, b) => b.score - a.score),
  }
  await db.runTransaction(async (tx) => {
    tx.update(gameRef(gameId), { answerResult: result, answerSheet: null })
  })
  return { graded: result.scores.length }
})

/** 감독관 — 최종 점수 전부(열넷 이름과 함께). */
export const hostFinalScores = onCall<{ gameId: string }>(async (req) => {
  requireHost(req.auth)
  const { gameId } = req.data
  const game = await gameOf(gameId)
  const byId = ((await finalScoresOf(gameId).get()).data()?.byId ?? {}) as Record<string, number>
  return {
    rows: game.seats.map((s) => ({ playerId: s.playerId, name: s.name, score: typeof byId[s.playerId] === 'number' ? byId[s.playerId] : null })),
  }
})

/** 감독관 — 한 사람의 최종 점수를 적는다. score 가 null 이면 지운다. */
export const hostSetFinalScore = onCall<{ gameId: string; playerId: string; score: number | null }>(async (req) => {
  requireHost(req.auth)
  const { gameId, playerId } = req.data
  const game = await gameOf(gameId)
  if (!game.seats.some((s) => s.playerId === playerId)) throw new HttpsError('invalid-argument', '그런 사람이 없다.')
  const raw = req.data.score
  if (raw === null || raw === undefined) {
    await finalScoresOf(gameId).set({ byId: { [playerId]: FieldValue.delete() } }, { merge: true })
    return { playerId, score: null }
  }
  const score = Number(raw)
  if (!Number.isFinite(score) || Math.abs(score) > 100000) throw new HttpsError('invalid-argument', '점수가 이상하다.')
  const kept = Math.round(score * 10) / 10
  await finalScoresOf(gameId).set({ byId: { [playerId]: kept } }, { merge: true })
  return { playerId, score: kept }
})
