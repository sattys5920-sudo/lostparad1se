// 운영자가 바닥에 한 장 놓는다 — 문제 종이 또는 메모.
//
// 평소에는 서버가 페이즈가 닫힐 때 알아서 뿌린다(scatterQuizzes ·
// scatterSlips). 어디에 떨어질지는 씨앗이 정하고, 무엇이 떨어질지는
// 미리 등록해 둔 것 중에서 고른다.
//
// **여기는 운영자가 그 자리에서 정하는 길이다.** 자유 시간에 「저기
// 미술실에 이런 쪽지가 있으면 좋겠다」가 생기는데, 그때 기다릴 수
// 있는 것은 다음 페이즈가 닫힐 때까지다. 판을 이끄는 사람이 이야기를
// 밀어 넣을 손이 하나는 있어야 한다.
//
// 놓는 것까지가 전부다. 줍고 읽고 찢는 것은 원래 규칙 그대로고
// (slips.ts), 문제를 펴고 푸는 것도 그대로다(quiz.ts).
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

import { TILE_BY_ID, type TileId } from '../../shared/rules/board'
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
  /** 어느 방 바닥에 놓나. */
  tileId: string
  kind: 'quiz' | 'memo'
  /** kind === 'memo' 일 때. 운영자가 쓴 그대로 나간다. */
  text?: string
  /** kind === 'quiz' 일 때. 은행에도 같이 적힌다. */
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

  const tileId = String(req.data.tileId ?? '') as TileId
  if (!TILE_BY_ID[tileId]) throw new HttpsError('invalid-argument', '그런 방이 없다.')

  const snap = await gameRef(gameId).get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  const game = snap.data() as GameDoc
  // 로비에서는 못 놓는다. 아직 아무도 그 방에 갈 수가 없다
  if (game.phase !== 'running') throw new HttpsError('failed-precondition', '판이 돌고 있을 때만 놓을 수 있다.')
  const nowMs = nowOf(game)

  if (kind === 'memo') {
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

  const q = req.data.quiz
  const prompt = String(q?.prompt ?? '').trim()
  if (prompt.length === 0) throw new HttpsError('invalid-argument', '문제가 비어 있다.')
  if (prompt.length > CHAT_MAX * 8) throw new HttpsError('invalid-argument', '문제가 너무 길다.')
  const qKind = q?.kind === 'short' ? 'short' : 'choice'
  const choices = (q?.choices ?? []).map((c) => String(c).trim()).filter((c) => c !== '')
  if (qKind === 'choice' && choices.length < 2) {
    throw new HttpsError('invalid-argument', '객관식은 보기가 둘 이상 있어야 한다.')
  }
  const answers = (q?.answers ?? []).map((a) => String(a).trim()).filter((a) => a !== '')
  if (answers.length === 0) throw new HttpsError('invalid-argument', '정답을 적어야 한다.')

  /*
   * 은행에도 적는다. **떨어뜨린 문제만 목록에서 빠져 있으면**, 운영자
   * 화면의 「등록된 문제 n개」와 판에 나간 것이 어긋난다 — 같은 문제를
   * 두 번 내고도 모른다.
   */
  const bank = bankOf(gameId).doc()
  const batch = db.batch()
  batch.set(bank, {
    kind: qKind,
    prompt,
    choices: qKind === 'choice' ? choices : [],
    answers,
    explain: String(q?.explain ?? ''),
  })
  // 접힌 채로 놓는다. 펴는 것은 그 방에 선 사람이 한다 — 펴면 거기
  // 있던 사람 전원이 같이 본다는 것이 이 물건의 전부다
  batch.set(floorOf(gameId).doc(), {
    quizId: bank.id,
    tileId,
    openedBy: null,
    openedInPhase: null,
    wrongBy: [],
    solvedBy: null,
    solvedTeam: null,
    atMs: nowMs,
  })
  await batch.commit()
  await refreshViews(gameId)
  return { dropped: 'quiz', tileId, where: TILE_BY_ID[tileId].name, quizId: bank.id }
})
