// 운영자 전용 엔드포인트.
//
// 확인은 **전부 서버에서** 한다. 클라이언트가 「나 운영자야」라고 말하는
// 것을 믿지 않는다. 화면 쪽 비밀번호 검사도 쓰지 않는다.
//
// 여기 있는 것은 읽기뿐이다. 게임 상태를 바꾸는 기능은 넣지 않았다 —
// 투명인간 해제 같은 것은 기존 운영자 도구로만 한다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import { checkNotice, leaderText } from '../../shared/reveal/notice'
import { publicScore, rankTeams } from '../../shared/rules/score'
import { TEAMS } from '../../shared/rules/lobby'
import { requireHost } from './host'
import { nowOf } from './index'
import type { GameDoc } from '../../shared/model'
import { notify } from './notify'
import { refreshViews } from './views'
import { tileStates } from './turn'

const db = getFirestore()

/** 커스텀 클레임으로만 통과한다. 토큰에 admin이 없으면 여기서 끝난다. */

/** 공지를 보낸다. 전원이면 toPlayerId를 비워 둔다. */
export const hostNotice = onCall<{ gameId: string; text: string; toPlayerId?: string | null }>(
  async (req) => {
    const uid = requireHost(req.auth)
    const check = checkNotice(req.data.text)
    if (!check.ok) throw new HttpsError('invalid-argument', '보낼 말을 확인해라.')

    // 판의 시계로 적는다 — 배속을 걸어 둔 판에서 실제 시각을 적으면 순서가 어긋난다
    const gameSnap = await db.doc(`games/${req.data.gameId}`).get()
    const notice = {
      toPlayerId: req.data.toPlayerId ?? null,
      text: req.data.text.trim(),
      atMs: gameSnap.exists ? nowOf(gameSnap.data() as GameDoc) : Date.now(),
      byId: uid,
    }
    const ref = await db.collection(`games/${req.data.gameId}/notices`).add(notice)
    // 「새 공지」만 간다 — 본문은 앱 안 공지 칸에서 읽는다
    const game = gameSnap.data() as { seats?: { playerId: string }[] } | undefined
    const to = notice.toPlayerId ? [notice.toPlayerId] : (game?.seats ?? []).map((s) => s.playerId)
    await notify(req.data.gameId, to, 'notice', `notice:${ref.id}`)
    // 공지는 views 로 내려간다. 다시 쓰지 않으면 누가 다음 행동을 할 때까지 안 뜬다
    await refreshViews(req.data.gameId)
    return { id: ref.id, ...notice }
  },
)

/**
 * 1위 발표. **지금 이 순간** 가진 방 수로 센 1위를 모두에게 띄운다.
 *
 * 점수는 정산과 같은 자로 잰다(rules/score) — 가진 방 개수, 동점은
 * 공동이다. 화면에는 공지 팝업으로 뜨고 「나」 탭 공지 칸에 남는다.
 */
export const hostAnnounceLeader = onCall<{ gameId: string }>(async (req) => {
  const uid = requireHost(req.auth)
  const gameId = req.data.gameId
  const snap = await db.doc(`games/${gameId}`).get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  const game = snap.data() as GameDoc
  if (game.phase !== 'running') throw new HttpsError('failed-precondition', '판이 돌고 있을 때만 발표한다.')

  const tiles = tileStates((await db.collection(`games/${gameId}/tiles`).get()).docs)
  const ranked = rankTeams(TEAMS.map((team) => publicScore({ tiles, team })))
  const top = ranked.filter((r) => r.rank === 1)
  const rooms = top[0]?.total ?? 0
  const leader = top.map((r) => r.team)
  const text = leaderText(leader, rooms)
  if (text === null) throw new HttpsError('failed-precondition', '아직 방을 가진 분단이 없다.')

  const notice = { toPlayerId: null, text, atMs: nowOf(game), byId: uid, leader }
  const ref = await db.collection(`games/${gameId}/notices`).add(notice)
  await notify(gameId, game.seats.map((s) => s.playerId), 'notice', `notice:${ref.id}`)
  await refreshViews(gameId)
  return { id: ref.id, text, leader, rooms }
})

