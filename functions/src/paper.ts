// 학생증 한 장 — 「나」 탭이 읽는 것.
//
// **여기서 나가는 것은 전부 본인 몫이다.** 남의 역할도, 남이 무엇을
// 숨기고 있는지도, 누가 나에게 표를 줬는지도 들어 있지 않다.
//
// 세 가지가 서버를 거쳐야 하는 이유가 각각 다르다.
//
//   숨긴 사실   shared/missions/roles.ts 에 열넷이 같이 산다. 화면이
//               그 파일을 부르면 열넷이 통째로 번들에 실린다(실제로
//               그런 적이 있다 — scripts/check-bundle.ts 가 그때 생겼다).
//               내 것 한 줄만 서버가 꺼내 보낸다.
//   미션 진행도 judge 가 판 전체의 기록을 봐야 셀 수 있다. 그 기록을
//               화면에 주면 남의 표와 남의 체류가 통째로 간다.
//               discloseFor 가 **빼고 만든 뒤** 보낸다 — 받아서 가리는
//               것이 아니라 애초에 문서에 안 담는다.
//   받은 표     보낸 사람은 secret/votes 에만 있다. 합계조차 오늘 것은
//               안 센다(buildLog 의 voteCutoffDay).
import { HttpsError, onCall } from 'firebase-functions/v2/https'

import { discloseFor, judge, type Phase } from '../../shared/missions/judge'
import { ROLE_BY_ID } from '../../shared/missions/roles'
import { ROLE_NAMES, ROLE_PATH_LABEL, type RoleId } from '../../shared/missions/roleNames'
import { dayNumber } from '../../shared/rules/clock'
import type { RosterDoc } from '../../shared/model'

import { buildLog } from './ending'
import { freshNow } from './turn'
import { gameRef, requireUid } from './index'

/**
 * 내 학생증과 생활기록부.
 *
 * 판이 끝났으면 phase 가 'end' 라 숫자가 다 열린다. 도는 중에는
 * 'settlement' 인데, 오늘 표를 로그에서 빼 두었으므로 「정산 때
 * 갱신」짜리 조항도 안전하게 숫자를 보여 줄 수 있다.
 */
export const myPaper = onCall<{ gameId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  if (typeof gameId !== 'string' || gameId.length === 0) {
    throw new HttpsError('invalid-argument', '어느 판인지 없다.')
  }
  const { game } = await freshNow(gameId)

  const mineSnap = await gameRef(gameId)
    .collection('secret')
    .doc('roster')
    .collection('items')
    .doc(uid)
    .get()
  if (!mineSnap.exists) throw new HttpsError('permission-denied', '이 판에 없는 사람이다.')
  const mine = mineSnap.data() as RosterDoc
  const roleId = mine.roleId as RoleId
  const role = ROLE_BY_ID[roleId]
  if (!role) throw new HttpsError('internal', '역할을 찾지 못했다.')

  const over = game.phase === 'finished'
  const { log } = await buildLog(gameId, game, {
    over,
    // 끝났으면 다 센다. 도는 중이면 **어제까지만** 센다
    ...(over ? {} : { voteCutoffDay: game.day }),
  })

  const result = judge({ playerId: uid, team: mine.team, roleId, bondId: mine.bondId }, log)
  const phase: Phase = over ? 'end' : 'settlement'
  const shown = discloseFor(result, phase)

  // 받은 표. **합계 하나뿐이다** — 신뢰인지 호감인지도, 누가 줬는지도
  // 보내지 않는다. 종류가 보이면 그 자체로 누구인지 좁혀진다
  const votesReceived = log.votes.filter((v) => v.targetId === uid).length

  return {
    roleId,
    roleName: ROLE_NAMES[roleId],
    pathLabel: ROLE_PATH_LABEL[role.path],
    // 내 것 한 줄. 남의 숨긴 사실은 이 응답 어디에도 없다
    secret: role.secret,
    main: shown.main,
    bond: shown.bond,
    votesReceived,
    /** 표를 어디까지 셌는가. 화면이 「어제까지」라고 적는다. */
    votesThroughDay: over ? game.day : game.day - 1,
    revealed: mine.reveal
      ? {
          scope: mine.reveal.scope,
          atMs: mine.reveal.atMs,
          day: dayNumber(game.startedAtMs ?? mine.reveal.atMs, mine.reveal.atMs),
        }
      : null,
  }
})
