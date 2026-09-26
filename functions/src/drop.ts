// 운영자가 바닥에 한 장 놓는다 — 문제 종이 또는 메모.
//
// **문제는 여기서만 나온다.** 서버가 페이즈마다 뿌리던 것을 걷어냈다 —
// 어디에 무엇을 놓을지가 운영자의 수다. 쪽지는 아직 서버도 뿌린다
// (scatterSlips).
//
// 둘의 주소가 다르다.
//
//   메모   **방** 하나. 쪽지와 같은 규칙이라 방 바닥에 떨어진다
//   문제   **칸** 하나. 방이든 복도든 선 수 있는 자리면 된다
//
// 문제만 칸으로 두는 것은 복도에 놓기 위해서다. 복도는 어느 방에도
// 안 속해서 방 주소로는 가리킬 수가 없다(덫이 같은 이유로 칸을 쓴다).
//
// 놓는 것까지가 전부다. 줍고 읽고 찢는 것은 원래 규칙 그대로고
// (slips.ts), 문제를 줍고 푸는 것도 그렇다(quiz.ts).
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

import { TILE_BY_ID, roomOfCell, type TileId } from '../../shared/rules/board'
import { canDropQuizAt } from '../../shared/rules/quiz'
import { CHAT_MAX } from './chat'
import { gameRef, nowOf, requireUid } from './index'
import { requireHost } from './host'
import { refreshViews } from './views'
import type { GameDoc } from '../../shared/model'

const db = getFirestore()

/** 메모 한 장에 적을 수 있는 길이. 쪽지는 주워서 읽는 것이라 말보다 길다. */
export const MEMO_MAX = 300

export interface DropInput {
  gameId: string
  /** kind === 'memo' 일 때. 어느 방 바닥에 놓나. */
  tileId?: string
  /** kind === 'quiz' 일 때. 어느 칸에 놓나. **복도도 된다.** */
  x?: number
  y?: number
  kind: 'quiz' | 'memo'
  /** kind === 'memo' 일 때. 운영자가 쓴 그대로 나간다. */
  text?: string
  /** kind === 'quiz' 일 때. 은행에 이미 있는 문제를 놓으려면 이것만 준다. */
  quizId?: string
  /** kind === 'quiz' 일 때. 새로 적어 놓으면 은행에도 같이 적힌다. */
  quiz?: {
    kind: 'choice' | 'short'
    prompt: string
    choices?: string[]
    answers?: string[]
    explain?: string
  }
}

const slipsOf = (gameId: string) => gameRef(gameId).collection('secret').doc('slips').collection('items')
const bankOf = (gameId: string) => gameRef(gameId).collection('secret').doc('quiz').collection('bank')
const floorOf = (gameId: string) => gameRef(gameId).collection('secret').doc('quiz').collection('floor')

export const hostDrop = onCall<DropInput>(async (req) => {
  requireHost(req.auth)
  requireUid(req.auth)
  const { gameId, kind } = req.data

  const snap = await gameRef(gameId).get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  const game = snap.data() as GameDoc
  // 로비에서는 못 놓는다. 아직 아무도 그 방에 갈 수가 없다
  if (game.phase !== 'running') throw new HttpsError('failed-precondition', '판이 돌고 있을 때만 놓을 수 있다.')
  const nowMs = nowOf(game)

  if (kind === 'memo') {
    const tileId = String(req.data.tileId ?? '') as TileId
    if (!TILE_BY_ID[tileId]) throw new HttpsError('invalid-argument', '그런 방이 없다.')
    const text = String(req.data.text ?? '').trim()
    if (text.length === 0) throw new HttpsError('invalid-argument', '적을 말이 없다.')
    if (text.length > MEMO_MAX) throw new HttpsError('invalid-argument', `${MEMO_MAX}자까지 쓸 수 있다.`)

    /*
     * 운영자가 쓴 메모는 **누구의 비밀도 아니다.**
     *
     * 뿌려지는 쪽지는 열넷 중 한 사람이 주인이고(subjectId), 주운
     * 사람이 「누구의 일이다」를 같이 본다. 운영자 메모는 그 자리가
     * 비어 있다 — 학교에 떨어져 있던 종이 한 장이다.
     */
    await slipsOf(gameId).add({
      textId: '',
      text,
      subjectId: '',
      tileId,
      heldBy: null,
      readBy: [],
      tornBy: null,
      atMs: nowMs,
    })
    await refreshViews(gameId)
    return { dropped: 'memo', tileId, where: TILE_BY_ID[tileId].name }
  }

  if (kind !== 'quiz') throw new HttpsError('invalid-argument', '그런 것은 못 놓는다.')

  /*
   * 자리부터 본다. **방이든 복도든 선 수 있는 빈 칸이면 된다.**
   * 기물 위에는 못 놓는다 — 자판기에 겹치면 탭했을 때 기물이 먼저
   * 열려서 종이를 영영 못 줍는다.
   */
  const x = Math.floor(Number(req.data.x))
  const y = Math.floor(Number(req.data.y))
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new HttpsError('invalid-argument', '어느 칸에 놓을지 없다.')
  }
  if (!canDropQuizAt(x, y)) {
    throw new HttpsError('failed-precondition', '거기에는 못 놓는다. 방이나 복도의 빈 칸이어야 한다.')
  }

  const batch = db.batch()
  let quizId = String(req.data.quizId ?? '')

  if (quizId === '') {
    // 새로 적어 놓는다. **은행에도 같이 적는다** — 떨어뜨린 문제만
    // 목록에서 빠져 있으면 운영자 화면의 「등록된 문제 n개」와 판에
    // 나간 것이 어긋나고, 같은 문제를 두 번 내고도 모른다
    const q = req.data.quiz
    const prompt = String(q?.prompt ?? '').trim()
    if (prompt.length === 0) throw new HttpsError('invalid-argument', '문제가 비어 있다.')
    if (prompt.length > CHAT_MAX * 8) throw new HttpsError('invalid-argument', '문제가 너무 길다.')
    // 은행(quiz.ts)과 같은 규칙이다 — 문제는 주관식뿐이다
    if (q?.kind !== 'short') throw new HttpsError('invalid-argument', '문제는 주관식이다.')
    const answers = (q?.answers ?? []).map((a) => String(a).trim()).filter((a) => a !== '')
    if (answers.length === 0) throw new HttpsError('invalid-argument', '정답을 적어야 한다.')

    const bank = bankOf(gameId).doc()
    batch.set(bank, {
      kind: 'short' as const,
      prompt,
      choices: [],
      answers,
      explain: String(q?.explain ?? ''),
    })
    quizId = bank.id
  } else {
    // 은행에 있는 것을 놓는다. **같은 문제를 두 번 놓지는 못한다** —
    // 둘이 깔려 있으면 하나가 풀린 뒤에도 나머지가 남아서
    // 「먼저 맞히는 한 사람」이 둘이 된다
    const [has, already] = await Promise.all([
      bankOf(gameId).doc(quizId).get(),
      floorOf(gameId).where('quizId', '==', quizId).limit(1).get(),
    ])
    if (!has.exists) throw new HttpsError('not-found', '그런 문제가 없다.')
    if (!already.empty) throw new HttpsError('failed-precondition', '이미 놓은 문제다.')
  }

  // 접힌 채로 놓는다. 줍는 것은 옆에 선 사람이 한다
  const paper = floorOf(gameId).doc()
  batch.set(paper, {
    quizId,
    x,
    y,
    heldBy: null,
    wrongBy: [],
    solvedBy: null,
    solvedTeam: null,
    atMs: nowMs,
  })
  await batch.commit()
  await refreshViews(gameId)
  const room = roomOfCell(x, y)
  return {
    dropped: 'quiz',
    x,
    y,
    where: room ? TILE_BY_ID[room].name : '복도',
    quizId,
  }
})
