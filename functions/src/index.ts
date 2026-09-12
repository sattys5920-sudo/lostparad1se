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
export function requireUid(auth: { uid?: string } | undefined): string {
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

// A의 기록. 공개 시각 게이트가 여기 붙어 있다.
export { fragmentOfDay, releasedFragments } from './fragments'

// 운영자 전용. 전부 읽기뿐이고, 확인은 커스텀 클레임으로 서버에서 한다.
export { hostDashboard, hostTextAudit, hostNotice, noticeTemplates } from './admin'

// 로비. 역할은 시작할 때 나뉘고 secret에만 적힌다.
export { createGame, joinGame, leaveGame, startGame } from './lobby'

// 따라잡기. 상시 서버가 없으므로 밀린 일을 다음 요청이 민다.
export { catchUp } from './catchup'
export { tick } from './tick'

// 이동과 깃발. 걸음은 예정 이벤트로 적히고 따라잡기가 민다.
export { moveTo, planCommute, plantFlag } from './move'

// 토큰을 쓰는 행동.
export { buildOn, upgradeOn, research, scout, produce, sabotage } from './act'

// 교역과 동맹. 토큰이 들지 않는다.
export { offerTrade, respondTrade, proposeAlliance, respondAlliance, breakAllianceNow } from './deal'

// 표와 털어놓기. 표는 보낸 사람이 어디로도 나가지 않는다.
export { castVote, revealSecret } from './vote'

// 진상 공개 흐름. 아침 진행 · 체류 · 깨달음 · 눈발.
export { markMorning, snowNow } from './reveal'

// DAY 3 중요한 사람, DAY 4 무엇을 지킬 것인가.
export { chooseImportant, chooseDay4 } from './choice'

// 카드. 손패 내용은 우리 팀만 안다.
export { playOne } from './card'

// 엔딩. 종례가 끝난 뒤에만 내려간다.
export { endingData } from './ending'

// 계정. 비밀번호 검사가 서버에 있고, 통과하면 로그인 증표를 만들어 준다.
export { signUpAccount, logInAccount, saveCharacter } from './account'

// 채팅. 어떤 판정에도 쓰이지 않는다.
export { say, chatLines } from './chat'

// 운영자 코드. 코드는 저장소가 아니라 배포 환경변수에 있다.
export { claimHost } from './hostgate'

// QA용 채우기. 운영자만, 로비에서만.
export { seedPlayers } from './qa'
