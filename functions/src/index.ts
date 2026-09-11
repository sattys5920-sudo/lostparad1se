// 영역전 v2 서버.
//
// 판정은 전부 여기서 한다. 클라이언트는 Firestore의 게임 트리에 직접 쓰지
// 못하고(규칙이 막는다), 숨겨야 하는 것은 애초에 읽을 수 있는 자리에
// 놓지 않는다.
//
// 규칙 코드는 shared/ 에 있고 화면과 서버가 같은 파일을 쓴다. 게임 시계가
// 한 벌뿐이라 화면에 뜨는 남은 시간과 서버 판정이 어긋날 수 없다.
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { setGlobalOptions } from 'firebase-functions/v2/options'

import { dayNumber, gameNow, type DevClock } from '../../shared/rules/clock'
import { DEV_CLOCK_SPEED_MAX, DEV_CLOCK_SPEED_MIN } from '../../shared/rules/v2'
import type { GameDoc } from '../../shared/model'

initializeApp()

// 한국에서 하는 판이니 서울에 둔다. 왕복 지연이 그대로 체감된다.
setGlobalOptions({ region: 'asia-northeast3', maxInstances: 10 })

const db = getFirestore()

export const gameRef = (gameId: string) => db.doc(`games/${gameId}`)

/** 로그인하지 않았으면 아무것도 못 한다. */
function requireUid(auth: { uid?: string } | undefined): string {
  const uid = auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요하다.')
  return uid
}

async function loadGame(gameId: string): Promise<GameDoc> {
  const snap = await gameRef(gameId).get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  return snap.data() as GameDoc
}

/**
 * 지금 게임 속 시각이 몇 시인지. 모든 시각 계산이 이 함수를 거친다.
 * 개발용 시계가 걸려 있으면 그 시각이 나온다.
 */
export function nowOf(game: GameDoc): number {
  return gameNow(game.clock as DevClock)
}

/** 화면이 시계를 맞춰 볼 수 있게 열어 둔다. 숨길 것이 없는 값이다. */
export const clockNow = onCall<{ gameId: string }>(async (req) => {
  requireUid(req.auth)
  const game = await loadGame(req.data.gameId)
  const nowMs = nowOf(game)
  return {
    nowMs,
    day: game.startedAtMs ? dayNumber(game.startedAtMs, nowMs) : 0,
    speed: game.clock.speed,
  }
})

/**
 * 개발용 시계를 맞춘다. 배속을 올려 닷새를 몇 분에 돌려 볼 수 있다.
 *
 * 운영자만 쓴다. 확인은 서버에서 한다 — 클라이언트가 "나 관리자야"라고
 * 말하는 것을 믿지 않는다.
 */
export const setDevClock = onCall<{ gameId: string; anchorGameMs: number; speed: number }>(
  async (req) => {
    const uid = requireUid(req.auth)
    if (req.auth?.token?.admin !== true) {
      throw new HttpsError('permission-denied', '운영자만 시계를 만질 수 있다.')
    }
    const { gameId, anchorGameMs, speed } = req.data
    if (!Number.isFinite(speed) || speed < DEV_CLOCK_SPEED_MIN || speed > DEV_CLOCK_SPEED_MAX) {
      throw new HttpsError('invalid-argument', `배속은 ${DEV_CLOCK_SPEED_MIN}~${DEV_CLOCK_SPEED_MAX}이다.`)
    }
    const clock: DevClock = { anchorRealMs: Date.now(), anchorGameMs, speed }
    await gameRef(gameId).update({ clock })
    await gameRef(gameId).collection('events').add({
      atMs: gameNow(clock),
      day: 0,
      kind: 'devClock',
      playerId: uid,
      detail: { anchorGameMs, speed },
    })
    return { ok: true, clock }
  },
)
