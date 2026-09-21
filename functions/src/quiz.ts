// 문제 종이 — 바닥에 떨어진 시험지 한 장.
//
// **정답은 끝까지 secret 아래에만 둔다.** 열린 문제도 클라이언트에게는
// 문제와 보기까지만 간다. 정답을 실어 보내고 화면에서 가리면
// 개발자도구로 다 보이고, 그러면 이 물건은 아무 값도 없다. 채점은 전부
// 여기서 한다.
//
// 쪽지와 반대다. 쪽지는 주워서 혼자 읽고 감추는 것이고, 문제는 그
// 자리에서 펴서 같이 보는 것이다 — 들고 갈 수도 건넬 수도 없다.
// 다른 팀 사람 앞에서 여는 것이 이 물건의 전부고, 열면 상대도 같이
// 본다. 먼저 푸는 쪽이 가져간다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

import {
  KNOWLEDGE_PER_QUIZ,
  QUIZ_ON_FLOOR_MAX,
  QUIZ_PER_PHASE,
  bankIsThin,
  isCorrect,
  type QuizKind,
} from '../../shared/rules/quiz'
import { TILES, type TileId } from '../../shared/rules/board'
import { rngFrom } from '../../shared/missions/assign'
import { gain, purseOf } from '../../shared/rules/resources'
import type { PawnDoc } from '../../shared/model'
import { freshNow } from './turn'
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
 * 바닥에 놓인 종이 한 장. **secret/quiz/floor 아래에 있다.**
 *
 * 푼 사람이 생기면 지우지 않고 solvedBy 를 채운다 — 누가 무엇을
 * 가져갔는지가 나중에 이야기가 되고, 개인 미션도 이 기록을 본다.
 */
export interface QuizPaperDoc {
  quizId: string
  tileId: TileId
  /** 누가 펼쳤는가. null 이면 아직 아무도 안 열었다. */
  openedBy: string | null
  /** 페이즈가 닫히면 도로 접힌다. 그 페이즈 번호. */
  openedInPhase: number | null
  /** 틀린 사람들. 그 사람만 다시 못 푼다 — 같은 팀 다른 사람은 할 수 있다. */
  wrongBy: string[]
  /** 맞힌 사람. 차면 이 종이는 끝이다. */
  solvedBy: string | null
  solvedTeam: string | null
  atMs: number
}

const bankOf = (gameId: string) => gameRef(gameId).collection('secret').doc('quiz').collection('bank')
const floorOf = (gameId: string) => gameRef(gameId).collection('secret').doc('quiz').collection('floor')

/** 문제 종이가 떨어질 수 있는 방. 기지는 뺀다. */
const DROP_TILES: TileId[] = TILES.map((t) => t.id)

/** 지금 내가 선 방. 걷는 중이면 null 이다. */
async function whereAmI(gameId: string, uid: string): Promise<TileId | null> {
  const snap = await gameRef(gameId).collection('pawns').doc(uid).get()
  if (!snap.exists) throw new HttpsError('permission-denied', '이 판에 없는 사람이다.')
  return ((snap.data() as PawnDoc).tileId ?? null) as TileId | null
}

/**
 * 문제 종이를 뿌린다. 페이즈가 닫힐 때 서버가 부른다.
 *
 * **한 게임에서 같은 문제는 한 번만 나온다.** 이미 쓴 문제를 빼고
 * 남은 것 중에서 고른다. 남은 것이 없으면 그 페이즈에는 안 떨어지고,
 * 운영자 화면이 그 사실을 본다(hostQuizStatus).
 */
export async function scatterQuizzes(gameId: string, phaseNo: number, nowMs: number): Promise<number> {
  const [bank, papers] = await Promise.all([bankOf(gameId).get(), floorOf(gameId).get()])
  const used = new Set(papers.docs.map((d) => (d.data() as QuizPaperDoc).quizId))
  const left = bank.docs.filter((d) => !used.has(d.id))
  // 아직 아무도 안 푼 종이가 바닥에 몇 장인가
  const onFloor = papers.docs.filter((d) => (d.data() as QuizPaperDoc).solvedBy === null).length
  const room = Math.max(0, QUIZ_ON_FLOOR_MAX - onFloor)
  const howMany = Math.min(QUIZ_PER_PHASE, room, left.length)
  if (howMany === 0) return 0

  const rng = rngFrom(`${gameId}:quiz:${phaseNo}`)
  const pick = <T>(xs: T[]): T => xs.splice(Math.floor(rng() * xs.length), 1)[0] as T
  const pool = [...left]

  const batch = db.batch()
  for (let i = 0; i < howMany; i++) {
    const doc: QuizPaperDoc = {
      quizId: pick(pool).id,
      tileId: DROP_TILES[Math.floor(rng() * DROP_TILES.length)] as TileId,
      openedBy: null,
      openedInPhase: null,
      wrongBy: [],
      solvedBy: null,
      solvedTeam: null,
      atMs: nowMs,
    }
    batch.set(floorOf(gameId).doc(), doc)
  }
  await batch.commit()
  return howMany
}

/** 페이즈가 닫히면 펴 둔 종이가 도로 접힌다. */
export async function foldQuizzes(gameId: string): Promise<void> {
  const open = await floorOf(gameId).where('openedBy', '!=', null).get()
  if (open.empty) return
  const batch = db.batch()
  for (const d of open.docs) batch.update(d.ref, { openedBy: null, openedInPhase: null })
  await batch.commit()
}

/**
 * 펼친다. **그 방에 선 사람 전원에게 보이게 된다.**
 *
 * 다른 팀 사람 앞에서 여는 것이 이 물건의 전부다. 열지 않으면 아무도
 * 못 풀고, 열면 상대도 같이 본다.
 */
export const openQuiz = onCall<{ gameId: string; paperId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, paperId } = req.data
  const [here, { game }] = await Promise.all([whereAmI(gameId, uid), freshNow(gameId)])
  if (!here) throw new HttpsError('failed-precondition', '걷는 중이다. 도착해야 펼 수 있다.')

  await db.runTransaction(async (tx) => {
    const ref = floorOf(gameId).doc(paperId)
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpsError('not-found', '그런 문제가 없다.')
    const q = snap.data() as QuizPaperDoc
    if (q.tileId !== here) throw new HttpsError('failed-precondition', '여기 없는 문제다.')
    if (q.solvedBy) throw new HttpsError('failed-precondition', '이미 누가 가져갔다.')
    if (q.openedBy) return
    tx.update(ref, { openedBy: uid, openedInPhase: game.phaseNow?.no ?? null })
  })
  await refreshViews(gameId)
  return { paperId }
})

/**
 * 답을 낸다. **채점은 여기서만 한다.**
 *
 * 여럿이 동시에 내면 트랜잭션이 도착 순서대로 줄을 세운다 — 먼저 닿은
 * 답이 맞으면 그 팀이 가져가고, 뒤에 온 답은 「이미 누가 가져갔다」를
 * 받는다.
 */
export const answerQuiz = onCall<{ gameId: string; paperId: string; given: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, paperId, given } = req.data
  if (typeof given !== 'string') throw new HttpsError('invalid-argument', '답이 없다.')
  const here = await whereAmI(gameId, uid)
  if (!here) throw new HttpsError('failed-precondition', '걷는 중이다. 도착해야 답을 낼 수 있다.')

  const pawn = (await gameRef(gameId).collection('pawns').doc(uid).get()).data() as PawnDoc
  const ref = gameRef(gameId)

  const out = await db.runTransaction(async (tx) => {
    const paperRef = floorOf(gameId).doc(paperId)
    const paperSnap = await tx.get(paperRef)
    if (!paperSnap.exists) throw new HttpsError('not-found', '그런 문제가 없다.')
    const paper = paperSnap.data() as QuizPaperDoc
    if (paper.tileId !== here) throw new HttpsError('failed-precondition', '여기 없는 문제다.')
    if (!paper.openedBy) throw new HttpsError('failed-precondition', '아직 안 펼친 문제다.')
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
    await note(gameId, 'quizSolved', Date.now(), { id: uid, team: pawn.team }, {
      tileId: here,
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
    /** 아직 안 나온 문제 수. 0이면 더 안 떨어진다 */
    left: bank.docs.filter((d) => !used.has(d.id)).length,
    thin: bankIsThin(bank.size),
    items: bank.docs.map((d) => ({ id: d.id, ...(d.data() as QuizDoc), used: used.has(d.id) })),
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
