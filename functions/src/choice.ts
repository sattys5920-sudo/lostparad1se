// DAY 3과 DAY 4의 선택.
//
// 둘 다 **그날 하루 동안만** 바꿀 수 있다. 날이 지나면 잠긴다 — 끝에
// 가서 유리한 쪽으로 갈아타는 건 고른 것이 아니다.
//
// 고른 것은 남에게 보이지 않는다. 「누가 나를 중요한 사람으로 골랐나」가
// 보이면 그걸 노리고 서로 붙어 다니게 된다. 본인 몫에만 간다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'

import {
  CHOSEN_ONE_DAY,
  DAY4_CHOICE_DAY,
  DAY4_CHOICE_IDS,
  canChooseDay4,
  canChoosePerson,
  type Day4Choice,
} from '../../shared/rules/choices'
import { refreshViews } from './views'
import { freshNow, myPawn } from './turn'
import { gameRef, requireUid } from './index'

/** games/{gameId}/secret/choices/items/{playerId} */
export interface ChoiceDoc {
  playerId: string
  /** DAY 3에 고른 중요한 사람. */
  chosenId: string | null
  chosenAtDay: number | null
  /** DAY 4에 고른 것. */
  day4: Day4Choice | null
  day4AtDay: number | null
}

const choicesOf = (gameId: string) =>
  gameRef(gameId).collection('secret').doc('choices').collection('items')

const REFUSAL: Record<string, string> = {
  wrongDay: '오늘 고르는 것이 아니다.',
  self: '자기 자신은 못 고른다.',
  unknown: '그런 사람이 없다.',
}

async function mine(gameId: string, uid: string): Promise<ChoiceDoc> {
  const snap = await choicesOf(gameId).doc(uid).get()
  return (
    (snap.data() as ChoiceDoc | undefined) ?? {
      playerId: uid,
      chosenId: null,
      chosenAtDay: null,
      day4: null,
      day4AtDay: null,
    }
  )
}

/** DAY 3 — 중요한 사람을 고른다. 그날 하루는 몇 번이든 바꿀 수 있다. */
export const chooseImportant = onCall<{ gameId: string; targetId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, targetId } = req.data
  const { game } = await freshNow(gameId)
  await myPawn(gameId, uid)

  const target = await gameRef(gameId).collection('pawns').doc(targetId).get()
  const prev = await mine(gameId, uid)
  const out = canChoosePerson({ day: game.day, chooserId: uid, targetId, known: target.exists })
  if (!out.ok) {
    const why =
      out.reason === 'wrongDay' ? `중요한 사람은 DAY ${CHOSEN_ONE_DAY}에 고른다.` : REFUSAL[out.reason as string]
    throw new HttpsError('failed-precondition', why ?? '고를 수 없다.')
  }

  await choicesOf(gameId).doc(uid).set({ ...prev, chosenId: targetId, chosenAtDay: game.day })
  await refreshViews(gameId)
  return { chosenId: targetId }
})

/** DAY 4 — 무엇을 지킬지 고른다. */
export const chooseDay4 = onCall<{ gameId: string; choice: Day4Choice }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, choice } = req.data
  if (!DAY4_CHOICE_IDS.includes(choice)) throw new HttpsError('invalid-argument', '그런 선택은 없다.')
  const { game } = await freshNow(gameId)
  await myPawn(gameId, uid)

  const prev = await mine(gameId, uid)
  const out = canChooseDay4(game.day)
  if (!out.ok) {
    const why = out.reason === 'wrongDay' ? `DAY ${DAY4_CHOICE_DAY}에 고른다.` : REFUSAL[out.reason as string]
    throw new HttpsError('failed-precondition', why ?? '고를 수 없다.')
  }

  await choicesOf(gameId).doc(uid).set({ ...prev, day4: choice, day4AtDay: game.day })
  await refreshViews(gameId)
  return { choice }
})
