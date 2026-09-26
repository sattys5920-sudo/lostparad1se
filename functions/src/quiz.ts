// 문제 종이 — 운영자가 바닥에 놓는 시험지 한 장.
//
// **정답은 끝까지 secret 아래에만 둔다.** 주운 사람에게도 문제 문장까지만
// 간다. 정답을 실어 보내고 화면에서 가리면 개발자도구로 다 보이고,
// 그러면 이 물건은 아무 값도 없다. 채점은 전부 여기서 한다.
//
// 쪽지와 같은 방식이 됐다 — 주워서 손패에 넣고 혼자 푼다. 다만 쪽지는
// 남의 비밀이고 이건 문제다. **먼저 맞히는 한 사람이 가져간다** —
// 같은 문제를 들고 있던 나머지는 그 순간 못 적게 된다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

import {
  KNOWLEDGE_PER_QUIZ,
  bankIsThin,
  isCorrect,
  type QuizKind,
  atPaper,
} from '../../shared/rules/quiz'
import type { Cell } from '../../shared/rules/board'
import { gain, purseOf } from '../../shared/rules/resources'
import type { PawnDoc } from '../../shared/model'
import { freshNow, mustBeFreeTime } from './turn'
import { note } from './records'
import { refreshViews } from './views'
import { gameRef, requireUid } from './index'
import { requireHost } from './host'

const db = getFirestore()

/**
 * 문제 하나. **secret/quiz/bank 아래에 있다.**
 *
 * 운영자가 등록한다. answers 와 explain 은 어떤 투영에도 실리지 않는다.
 */
export interface QuizDoc {
  kind: QuizKind
  prompt: string
  /** 객관식 보기 넷. 단답형이면 빈 배열. */
  choices: string[]
  /** 정답 목록. 동의어와 표기 차이를 운영자가 미리 적어 둔다. **서버 전용.** */
  answers: string[]
  /** 해설. 있어도 되고 없어도 된다. **서버 전용.** */
  explain: string
}

/**
 * 놓인 종이 한 장. **secret/quiz/floor 아래에 있다.**
 *
 * 푼 사람이 생기면 지우지 않고 solvedBy 를 채운다 — 누가 무엇을
 * 가져갔는지가 나중에 이야기가 되고, 개인 미션도 이 기록을 본다.
 */
export interface QuizPaperDoc {
  quizId: string
  /**
   * 놓인 칸. **방이 아니라 생짜 칸이다** — 복도에도 놓이기 때문이다.
   * 주워 간 뒤에도 그대로 둔다. 어디서 나온 종이인지가 기록이다.
   */
  x: number
  y: number
  /** 주워 간 사람. null 이면 아직 바닥에 있다. */
  heldBy: string | null
  /** 틀린 사람들. 그 사람만 다시 못 푼다 — 같은 팀 다른 사람은 할 수 있다. */
  wrongBy: string[]
  /** 맞힌 사람. 차면 이 종이는 끝이다. */
  solvedBy: string | null
  solvedTeam: string | null
  atMs: number
}

const bankOf = (gameId: string) => gameRef(gameId).collection('secret').doc('quiz').collection('bank')
const floorOf = (gameId: string) => gameRef(gameId).collection('secret').doc('quiz').collection('floor')

/** 내 말. 없으면 이 판 사람이 아니다. */
async function pawnOf(gameId: string, uid: string): Promise<PawnDoc> {
  const snap = await gameRef(gameId).collection('pawns').doc(uid).get()
  if (!snap.exists) throw new HttpsError('permission-denied', '이 판에 없는 사람이다.')
  return snap.data() as PawnDoc
}

/**
 * 종이 옆에 서 있는가. **방에 들어온 것만으로는 안 된다.**
 *
 * 종이는 바닥 한 칸에 그려진다. 문턱에서 펼 수 있으면 그 그림이
 * 아무 뜻이 없다. 옛 문서(칸이 없는 것)만 방 어디서나 편다.
 */
function mustBeBeside(pawn: PawnDoc, paper: QuizPaperDoc): void {
  if (!atPaper((pawn.at ?? null) as Cell | null, { x: paper.x, y: paper.y })) {
    throw new HttpsError('failed-precondition', '종이 옆에 서야 한다.')
  }
}

/** 운영자가 아직 아무도 안 주운 종이를 도로 거둔다. */
export const hostPullQuiz = onCall<{ gameId: string; paperId: string }>(async (req) => {
  requireHost(req.auth)
  const { gameId, paperId } = req.data
  await db.runTransaction(async (tx) => {
    const ref = floorOf(gameId).doc(paperId)
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpsError('not-found', '그런 종이가 없다.')
    const paper = snap.data() as QuizPaperDoc
    if (paper.heldBy) throw new HttpsError('failed-precondition', '누가 주워 갔다.')
    tx.delete(ref)
  })
  await refreshViews(gameId)
  return { ok: true }
})

/**
 * 줍는다. **손패에 들어온다.**
 *
 * 옆 칸에 서야 한다 — 기물·심부름 물건과 같은 자다. 주우면 문제
 * 문장이 그 사람에게만 간다. 바닥에 있는 동안에는 누구에게도 문장이
 * 안 간다(views 의 quizFloor 가 자리만 싣는다).
 */
export const takeQuiz = onCall<{ gameId: string; paperId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, paperId } = req.data
  const [pawn, { game }] = await Promise.all([pawnOf(gameId, uid), freshNow(gameId)])
  mustBeFreeTime(game, '문제를 주울')

  await db.runTransaction(async (tx) => {
    const ref = floorOf(gameId).doc(paperId)
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpsError('not-found', '그런 문제가 없다.')
    const q = snap.data() as QuizPaperDoc
    // **먼저 줍는 손이 임자다.** 남이 가져간 뒤에는 자리만 남는다
    if (q.heldBy) throw new HttpsError('failed-precondition', '이미 누가 주워 갔다.')
    if (q.solvedBy) throw new HttpsError('failed-precondition', '이미 누가 가져갔다.')
    mustBeBeside(pawn, q)
    tx.update(ref, { heldBy: uid })
  })

  await refreshViews(gameId)
  return { ok: true }
})

export const answerQuiz = onCall<{ gameId: string; paperId: string; given: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, paperId, given } = req.data
  if (typeof given !== 'string') throw new HttpsError('invalid-argument', '답이 없다.')
  const [pawn, { game, nowMs }] = await Promise.all([pawnOf(gameId, uid), freshNow(gameId)])
  mustBeFreeTime(game, '문제를 풀')

  const ref = gameRef(gameId)

  const out = await db.runTransaction(async (tx) => {
    const paperRef = floorOf(gameId).doc(paperId)
    const paperSnap = await tx.get(paperRef)
    if (!paperSnap.exists) throw new HttpsError('not-found', '그런 문제가 없다.')
    const paper = paperSnap.data() as QuizPaperDoc
    /*
     * **들고 있어야 푼다.** 어디에 서 있는지는 안 본다 — 주워서
     * 손패에 넣은 뒤로는 걸어 다니며 생각해도 된다.
     */
    if (paper.heldBy !== uid) throw new HttpsError('failed-precondition', '들고 있지 않은 문제다.')
    // 먼저 닿은 답이 이겼다. 뒤에 온 사람은 여기서 걸린다
    if (paper.solvedBy) throw new HttpsError('failed-precondition', '이미 누가 가져갔다.')
    if (paper.wrongBy.includes(uid)) throw new HttpsError('failed-precondition', '한 번 틀린 문제다.')

    const quizSnap = await tx.get(bankOf(gameId).doc(paper.quizId))
    if (!quizSnap.exists) throw new HttpsError('not-found', '문제가 사라졌다.')
    const quiz = quizSnap.data() as QuizDoc

    if (!isCorrect(given, quiz.answers)) {
      // 틀린 사람만 다시 못 푼다. 같은 팀 다른 사람은 할 수 있다
      tx.update(paperRef, { wrongBy: [...paper.wrongBy, uid] })
      return { correct: false as const, explain: null }
    }

    // **맞힌 사람 지식이 는다.** 팀 금고가 없어졌다 — 푼 사람 것이다
    const meRef = ref.collection('pawns').doc(uid)
    const me = (await tx.get(meRef)).data() as PawnDoc
    tx.update(paperRef, { solvedBy: uid, solvedTeam: pawn.team })
    tx.update(meRef, { resources: gain(purseOf(me), { knowledge: KNOWLEDGE_PER_QUIZ }) })
    // 해설은 맞힌 사람에게만, 그것도 응답으로만 간다. 문서에는 안 남는다
    return { correct: true as const, explain: quiz.explain || null }
  })

  // 맞힌 것만 남긴다. **전교 1등의 「문제를 5개 이상 맞힌다」가
  // 이 줄을 센다** — 팀이 아니라 본인이 맞혀야 한다
  if (out.correct) {
    await note(gameId, 'quizSolved', nowMs, { id: uid, team: pawn.team }, {
      tileId: pawn.tileId ?? undefined,
      subjectId: paperId,
    })
  }
  await refreshViews(gameId)
  return out
})

// ── 운영자 ──────────────────────────────────────────────────────

/** 운영자만. 판정은 커스텀 클레임으로 한다 — 화면이 하는 말을 믿지 않는다. */

/** 등록된 문제를 본다. **운영자만.** 정답과 해설이 여기서만 나간다. */
export const hostQuizList = onCall<{ gameId: string }>(async (req) => {
  requireHost(req.auth)
  const { gameId } = req.data
  const [bank, papers] = await Promise.all([bankOf(gameId).get(), floorOf(gameId).get()])
  const used = new Set(papers.docs.map((d) => (d.data() as QuizPaperDoc).quizId))
  return {
    count: bank.size,
    /** 아직 안 놓은 문제 수. */
    left: bank.docs.filter((d) => !used.has(d.id)).length,
    thin: bankIsThin(bank.size),
    items: bank.docs.map((d) => ({ id: d.id, ...(d.data() as QuizDoc), used: used.has(d.id) })),
    /**
     * 지금 판에 나가 있는 종이. **운영자 판에 점으로 찍힌다** —
     * 어디에 이미 놓았는지 안 보이면 같은 자리에 겹쳐 놓게 된다.
     * 문장은 안 싣는다. 운영자는 은행 목록에서 읽는다
     */
    onFloor: papers.docs.map((d) => {
      const p = d.data() as QuizPaperDoc
      return {
        id: d.id,
        quizId: p.quizId,
        x: p.x,
        y: p.y,
        /** 주워 갔는가. 주운 것은 거둘 수 없다 */
        taken: p.heldBy !== null,
        solved: p.solvedBy !== null,
      }
    }),
  }
})

/** 등록하거나 고친다. **운영자만.** id 를 주면 고치고, 없으면 새로 만든다. */
export const hostQuizUpsert = onCall<{ gameId: string; id?: string; quiz: QuizDoc }>(async (req) => {
  requireHost(req.auth)
  const { gameId, id, quiz } = req.data
  // **문제는 주관식이다.** 보기 넷을 주면 방에 선 사람 전원이 넷 중
  // 하나를 찍고, 먼저 찍는 손이 이긴다 — 아는 것과 상관없다. 적어야
  // 하는 문제는 아는 사람이 이긴다
  const kind = quiz?.kind
  if (kind !== 'short') throw new HttpsError('invalid-argument', '문제는 주관식이다.')
  const prompt = (quiz.prompt ?? '').trim()
  if (prompt === '') throw new HttpsError('invalid-argument', '문제를 적어야 한다.')
  const answers = (quiz.answers ?? []).map((a) => a.trim()).filter((a) => a !== '')
  if (answers.length === 0) throw new HttpsError('invalid-argument', '정답을 하나는 적어야 한다.')

  const doc: QuizDoc = { kind, prompt, choices: [], answers, explain: (quiz.explain ?? '').trim() }
  const ref = id ? bankOf(gameId).doc(id) : bankOf(gameId).doc()
  await ref.set(doc)
  return { id: ref.id }
})

/** 지운다. **운영자만.** 이미 바닥에 나간 문제는 못 지운다. */
export const hostQuizRemove = onCall<{ gameId: string; id: string }>(async (req) => {
  requireHost(req.auth)
  const { gameId, id } = req.data
  const out = await floorOf(gameId).where('quizId', '==', id).limit(1).get()
  if (!out.empty) throw new HttpsError('failed-precondition', '이미 판에 나간 문제다.')
  await bankOf(gameId).doc(id).delete()
  return { id }
})
