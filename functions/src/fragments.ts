// A의 기록을 내려보낸다.
//
// 이 파일이 서버 전용 문장과 화면 사이의 유일한 문이다. 문을 지키는 것은
// canRelease() 하나뿐이고, 화면도 같은 함수를 쓴다 — 둘이 다른 답을 내면
// 화면에는 잠겨 있는데 요청은 통과하는 구멍이 생긴다.
//
// 날짜를 건너뛴 요청도 여기서 막힌다. DAY 1 아침에 DAY 5를 달라고 해도
// 「아직」이라고만 답하고, 본문은 근처에도 가지 않는다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { canRelease, REFUSAL_MESSAGE, releasedDays } from '../../shared/reveal/release'
import { FRAGMENT_BY_DAY } from './story/fragments'
import { gameRef, nowOf } from './index'
import type { GameDoc } from '../../shared/model'

/** 화면에 내려보내는 모양. 서버 전용 타입(FragmentData)과 일부러 다르다. */
export interface FragmentPayload {
  day: number
  spotTile: string
  papers: {
    kind: string
    lines: string[]
    caption: string | null
    topLines: string[] | null
    topCaption: string | null
  }[]
}

/**
 * 가리키는 역할은 **내려보내지 않는다.**
 *
 * 적중 의심의 판정은 서버가 한다. 목록을 보내 주면 그날 누가 가리켜졌는지
 * 모두가 알게 되고, 「정확히 짚으면 두 배」가 추리가 아니라 조회가 된다.
 */
function payloadOf(day: number): FragmentPayload {
  const data = FRAGMENT_BY_DAY[day]
  if (!data) throw new HttpsError('not-found', REFUSAL_MESSAGE.noSuchDay)
  return {
    day: data.day,
    spotTile: data.spotTile,
    papers: data.papers.map((p) => ({
      kind: p.kind,
      lines: [...p.lines],
      caption: p.caption ?? null,
      topLines: p.topLines ? [...p.topLines] : null,
      topCaption: p.topCaption ?? null,
    })),
  }
}

async function load(gameId: string): Promise<GameDoc> {
  const snap = await gameRef(gameId).get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  return snap.data() as GameDoc
}

/** 한 조각. 열리지 않았으면 본문 대신 거절만 돌아간다. */
export const fragmentOfDay = onCall<{ gameId: string; day: number }>(async (req) => {
  if (!req.auth?.uid) throw new HttpsError('unauthenticated', '로그인이 필요하다.')
  const game = await load(req.data.gameId)
  const check = canRelease(req.data.day, game.startedAtMs ?? null, nowOf(game))
  if (!check.ok) {
    throw new HttpsError('failed-precondition', REFUSAL_MESSAGE[check.reason as 'notYet'])
  }
  return payloadOf(req.data.day)
})

/** 지금까지 열린 것 전부. 보관함이 이걸로 목록을 만든다. */
export const releasedFragments = onCall<{ gameId: string }>(async (req) => {
  if (!req.auth?.uid) throw new HttpsError('unauthenticated', '로그인이 필요하다.')
  const game = await load(req.data.gameId)
  const days = releasedDays(game.startedAtMs ?? null, nowOf(game))
  return { days, fragments: days.map(payloadOf) }
})
