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
//   받은 표     보낸 사람은 secret/votes 에만 있다 — 그것만 끝까지
//               감춘다. 종류별 합계는 보내지만 오늘 것은 안 센다
//               (buildLog 의 voteCutoffDay).
import { HttpsError, onCall } from 'firebase-functions/v2/https'

import { discloseFor, judge, type Phase } from '../../shared/missions/judge'
import { NOT_DEALT, type MyPaperDoc } from '../../shared/missions/paper'
import { ROLE_BY_ID } from '../../shared/missions/roles'
import { ROLE_NAMES, canonRoleId } from '../../shared/missions/roleNames'
import type { GameDoc, RosterDoc } from '../../shared/model'

import { buildLog } from './ending'
import { catchUp } from './catchup'
import { gameRef, nowOf, requireUid } from './index'

/**
 * 내 학생증과 생활기록부.
 *
 * 판이 끝났으면 phase 가 'end' 라 숫자가 다 열린다. 도는 중에는
 * 'settlement' 인데, 오늘 표를 로그에서 빼 두었으므로 「정산 때
 * 갱신」짜리 조항도 안전하게 숫자를 보여 줄 수 있다.
 */
export const myPaper = onCall<{ gameId: string }, Promise<MyPaperDoc>>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  if (typeof gameId !== 'string' || gameId.length === 0) {
    throw new HttpsError('invalid-argument', '어느 판인지 없다.')
  }
  /*
   * **freshNow 를 안 쓴다.** 그쪽은 phase 가 running 이 아니면 거절하는데,
   * 학생증은 로비에서 먼저 넘어온다(열넷이 차는 순간). 대신 따라잡기는
   * 직접 부른다 — 날짜가 안 넘어간 채로 받은 표를 세면 하루가 어긋난다.
   */
  const first = await gameRef(gameId).get()
  if (!first.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  if ((first.data() as GameDoc).phase !== 'lobby') await catchUp(gameId, nowOf(first.data() as GameDoc))
  const game = (await gameRef(gameId).get()).data() as GameDoc

  const mineSnap = await gameRef(gameId)
    .collection('secret')
    .doc('roster')
    .collection('items')
    .doc(uid)
    .get()
  if (!mineSnap.exists) {
    /*
     * **자리는 있는데 명단 줄이 없으면 아직 안 나눈 것이다.** 역할은
     * 운영자가 「배정」을 누를 때 적히고, 자리가 바뀌면 지워진다
     * (lobby.ts 의 clearRoster). 그 사이를 「이 판에 없는 사람」이라고
     * 하면 고장처럼 읽힌다.
     */
    const seated = game.seats.some((s) => s.playerId === uid)
    if (seated) throw new HttpsError('failed-precondition', NOT_DEALT)
    throw new HttpsError('permission-denied', '이 판에 없는 사람이다.')
  }
  const mine = mineSnap.data() as RosterDoc
  // 이름을 바꾸기 전에 배정한 판은 명단에 옛 id(snacker·locker)가 있다
  const roleId = canonRoleId(mine.roleId)
  const role = roleId ? ROLE_BY_ID[roleId] : undefined
  if (!roleId || !role) {
    // 어느 id 였는지는 기록에만 남긴다 — 화면에 적으면 남이 볼 수 있다
    console.error(`myPaper: 모르는 역할 id ${String(mine.roleId)} (${gameId})`)
    throw new HttpsError('internal', '역할을 찾지 못했다.')
  }

  const head = {
    roleId,
    roleName: ROLE_NAMES[roleId],
    // 역할 카드 맨 위 한 줄. 남의 것은 이 응답 어디에도 없다
    flavor: role.flavor,
    footnote: role.footnote,
    // 학생증 뒷면. 내 역할 것만 꺼내 보낸다
    situation: role.situation,
    line: role.line,
    // 짝사랑만 채워진다. 이름만이고 어디 있는지 · 어느 팀인지는 안 보낸다
    targetName: roleId === 'crush' && mine.targetId ? (game.seats.find((x) => x.playerId === mine.targetId)?.name ?? null) : null,
  }

  /*
   * **로비에서도 부른다.** 열넷이 차면 그 자리에서 역할이 나뉘고
   * 학생증이 넘어오기 때문이다(lobby.ts 의 settleRoster).
   *
   * 다만 진행도는 셀 수가 없다 — 팀 금고도 칸도 시작할 때 놓이므로
   * buildLog 가 읽을 것이 아직 없다. 미션 **문장**은 역할 데이터에
   * 있으니 그대로 보내고, 조항은 빈 채로 둔다. counting 이 false 인
   * 동안 화면은 막대 대신 「닷새가 열리면 센다」를 적는다.
   */
  if (game.phase === 'lobby') {
    return {
      ...head,
      counting: false,
      main: { text: role.main.text, clauses: [], status: 'endOnly' as const },
      choice: 'endOnly' as const,
      votesReceived: { trust: 0, liking: 0 },
      votesThroughDay: 0,
    }
  }

  const over = game.phase === 'finished'
  const { log } = await buildLog(gameId, game, {
    over,
    // 끝났으면 다 센다. 도는 중이면 **어제까지만** 센다
    ...(over ? {} : { voteCutoffDay: game.day }),
  })

  const result = judge({ playerId: uid, team: mine.team, roleId, targetId: mine.targetId ?? null }, log)
  // 하루가 바뀔 때 부르는 자리다 — 받은 표 조항은 여기서만 갱신된다
  const phase: Phase = over ? 'end' : 'dayTurned'
  const shown = discloseFor(result, phase)

  // 받은 표. 종류별로 센다 — **누가 줬는지만** 끝까지 안 보낸다
  const votesForMe = log.votes.filter((v) => v.targetId === uid)
  const votesReceived = {
    trust: votesForMe.filter((v) => v.kind === 'trust').length,
    liking: votesForMe.filter((v) => v.kind === 'liking').length,
  }

  return {
    ...head,
    counting: true,
    main: shown.main,
    choice: shown.choice,
    votesReceived,
    /** 표를 어디까지 셌는가. 화면이 「어제까지」라고 적는다. */
    votesThroughDay: over ? game.day : game.day - 1,
  }
})
