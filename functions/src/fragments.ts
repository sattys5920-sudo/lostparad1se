// A의 기록을 내려보낸다.
//
// 이 파일이 서버 전용 문장과 화면 사이의 유일한 문이다. 열린 날만
// 내려보낸다(releasedDays).
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { REFUSAL_MESSAGE, releasedDays } from '../../shared/reveal/release'
import { FRAGMENT_BY_DAY } from './story/fragments'
import { gameRef, nowOf } from './index'
import type { GameDoc } from '../../shared/model'

/** 화면에 내려보내는 모양. 서버 전용 타입(FragmentData)과 일부러 다르다. */
export interface FragmentPayload {
  day: number
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

/** 지금까지 열린 것 전부. 보관함이 이걸로 목록을 만든다. */
export const releasedFragments = onCall<{ gameId: string }>(async (req) => {
  if (!req.auth?.uid) throw new HttpsError('unauthenticated', '로그인이 필요하다.')
  const game = await load(req.data.gameId)
  const days = releasedDays(game.startedAtMs ?? null, nowOf(game))
  return { days, fragments: days.map(payloadOf) }
})
