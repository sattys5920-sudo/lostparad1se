// 말.
//
// **말은 방에 남는다.** 옆 방에서 무슨 이야기가 오갔는지는 알 수 없고,
// 늦게 들어간 사람은 앞서 나눈 말을 볼 수 없다. 그 자리에 없었으면
// 못 들은 것이다.
//
// 그래서 「누가 누구와 같이 있었는가」가 정보가 된다. 복도에서 마주친
// 두 사람이 무슨 말을 했는지는 거기 있던 사람만 안다.
//
// 그리고 **어떤 판정에도 쓰이지 않는다.** 「나 털어놓을게」라고 치는
// 것과 실제로 털어놓는 것은 완전히 다른 일이고, 게임은 후자만 센다.
//
// 지워진 사람의 말은 「…」로만 간다. 본인에게는 원문이 보인다 —
// 자기가 무슨 말을 했는지는 안다. 다만 아무도 듣지 않았다. 원문은
// 서버가 그대로 쥐고 있다가 엔딩 6번 장면에서 되돌려 준다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { chatReaches } from '../../shared/rules/invisible'

import { ROOM_SAY_MAX } from '../../shared/rules/v2'
import type { TileId } from '../../shared/rules/board'
import { openInterval } from './reveal'
import { freshNow, myPawn } from './turn'
import { gameRef, requireUid } from './index'

/**
 * 방 안의 말은 **무전보다 짧다.** 무전은 적어 두고 읽는 것이지만
 * 이쪽은 머리 위에 떠 있다가 사라지는 것이라, 긴 글이 오면 풍선이
 * 지도를 덮고 그나마도 다 못 읽는다.
 */
export const CHAT_MAX = ROOM_SAY_MAX

/** games/{gameId}/secret/chat/items/{id} — 원문은 서버만 쥔다. */
export interface ChatDocRaw {
  /** 어느 방에서 한 말인가. 그 방에 **그때** 있던 사람만 듣는다. */
  tileId: TileId
  playerId: string
  name: string
  team: string
  /** 친 그대로. 가리는 일은 내려보낼 때 한다. */
  text: string
  atMs: number
  day: number
  /** 칠 때 지워져 있었는가. 엔딩이 이걸로 「들리지 않았던 말」을 고른다. */
  invisible: boolean
}

const chatOf = (gameId: string) => gameRef(gameId).collection('secret').doc('chat').collection('items')

/**
 * 내가 지금 이 방에 **언제 들어왔는지**.
 *
 * 체류 기록이 이미 그 시각을 들고 있다. 걸어 들어올 때마다 새 칸이
 * 열리므로, 아직 안 닫힌 칸의 시작 시각이 곧 도착 시각이다.
 *
 * 기록이 없으면 Infinity 다. 부르는 쪽이 「지금」으로 고쳐 잡는다 —
 * 여기서 0 을 돌려주면 그 방의 지난 말이 통째로 딸려 간다.
 */
async function arrivedAtMs(gameId: string, uid: string): Promise<number> {
  const open = await gameRef(gameId)
    .collection('secret')
    .doc('intervals')
    .collection('items')
    .where('playerId', '==', uid)
    .where('endMs', '==', null)
    .get()
  const starts = open.docs.map((d) => Number((d.data() as { startMs: number }).startMs ?? 0))
  return starts.length > 0 ? Math.max(...starts) : Number.POSITIVE_INFINITY
}

/** 한 줄 친다. 내가 선 방에 남는다. */
export const say = onCall<{ gameId: string; text: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const text = String(req.data.text ?? '').trim()
  if (text.length === 0) throw new HttpsError('invalid-argument', '할 말을 적어라.')
  if (text.length > CHAT_MAX) throw new HttpsError('invalid-argument', `${CHAT_MAX}자까지 칠 수 있다.`)

  const { game, nowMs } = await freshNow(gameId)
  const pawn = await myPawn(gameId, uid)
  // 문과 문 사이에서 한 말은 어느 방에도 남지 않는다
  if (pawn.tileId === null) {
    throw new HttpsError('failed-precondition', '걷는 중이다. 어딘가에 서야 말할 수 있다.')
  }
  const seat = game.seats.find((s) => s.playerId === uid)

  const row: ChatDocRaw = {
    tileId: pawn.tileId,
    playerId: uid,
    name: seat?.name ?? '',
    team: pawn.team,
    text,
    atMs: nowMs,
    day: game.day,
    // 지워진 채로 친 말. 남에게는 「…」로만 간다
    invisible: game.invisibleId === uid,
  }
  await chatOf(gameId).add(row)
  return { said: true, heard: !row.invisible }
})

/**
 * 내가 들을 수 있는 줄들.
 *
 * **내가 선 방에서, 내가 들어온 뒤에** 나온 말만이다. 옆 방 이야기는
 * 오지 않고, 늦게 들어갔으면 앞서 나눈 말도 오지 않는다 — 화면에서
 * 가리는 것이 아니라 애초에 보내지 않는다. 보내 놓고 가리면
 * 개발자도구로 다 보인다.
 */
export const chatLines = onCall<{ gameId: string; sinceMs?: number }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const { game, nowMs } = await freshNow(gameId)
  const pawn = await myPawn(gameId, uid)
  if (pawn.tileId === null) return { lines: [], day: game.day, here: null }

  /*
   * 도착 시각을 못 믿을 때는 **「지금부터」로 본다.**
   *
   * 전에는 기록이 없으면 아무것도 안 돌려줬다. 안전한 쪽이라고 적어
   * 뒀는데, 안전한 게 아니라 **조용히 영원히 막는 것**이었다 — 말은
   * 들어가는데(화면은 보냈다고 믿는다) 한 줄도 안 돌아오니, 로그도
   * 풍선도 영영 비어 있고 아무 데도 오류가 안 뜬다.
   *
   * 미래도 마찬가지다. 운영자가 시계를 되돌리면 그 전에 열린 칸의
   * 시작 시각이 지금보다 뒤가 된다. 그러면 `atMs > since` 를 넘길
   * 줄이 영영 없다 — 같은 증상이고, 판을 새로 만들기 전에는 안 풀린다.
   *
   * 둘 다 **지금 칸을 열어서 고쳐 놓는다.** 「이 사람이 언제부터 여기
   * 있었나」는 체류 기록이 유일한 답이라, 비워 두면 엔딩까지 틀린다.
   * 지금부터로 잡으므로 **들어오기 전 말이 딸려 가지도 않는다.**
   */
  let arrived = await arrivedAtMs(gameId, uid)
  if (!Number.isFinite(arrived) || arrived > nowMs) {
    await openInterval(gameId, uid, pawn.tileId, nowMs)
    arrived = nowMs
  }
  const since = Math.max(Number(req.data.sinceMs ?? 0), arrived)

  const all = await chatOf(gameId)
    .where('tileId', '==', pawn.tileId)
    .where('atMs', '>', since)
    .orderBy('atMs')
    .limit(300)
    .get()

  const lines = all.docs
    .map((d) => d.data() as ChatDocRaw)
    /*
     * **지워진 사람이 친 줄은 남에게 아예 안 간다.**
     *
     * 전에는 말만 「…」로 가려서 보냈다. 그런데 새는 것은 **누구인가**가
     * 아니라 **어디 있는가**였다 — 오늘의 투명인간이 누구인지는 아침에
     * 모두가 들어서 알지만, 지금 어느 방에 있는지는 맵이 일부러 지워
     * 놓은 값이다. 가려진 줄 한 개가 그 방에 있다는 것을 알려 준다.
     *
     * 본인에게는 그대로 남는다. 제가 친 말이 안 보이면 「안 쳐졌나」와
     * 「안 들렸나」를 가를 수가 없다 — muted 표시가 그 답이다.
     */
    .filter((c) => chatReaches(c, uid))
    .map((c) => ({
      playerId: c.playerId,
      name: c.name,
      team: c.team,
      atMs: c.atMs,
      text: c.text,
      /** 「이 줄은 전해지지 않았다」. **본인 줄에만 붙는다.** */
      muted: c.invisible,
    }))

  return { lines, day: game.day, here: pawn.tileId }
})

/**
 * 「들리지 않았던 말」 — 엔딩 6번 장면.
 *
 * 닷새 동안 「…」로만 보였던 말을 원문으로 되돌린다. **종례가 끝난
 * 뒤에만.** 그 전에 돌려주면 투명인간이 투명인간이 아니게 된다.
 */
export async function unheardLines(gameId: string): Promise<{ name: string; day: number; text: string }[]> {
  const snap = await chatOf(gameId).where('invisible', '==', true).orderBy('atMs').get()
  return snap.docs
    .map((d) => d.data() as ChatDocRaw)
    .map((c) => ({ name: c.name, day: c.day, text: c.text }))
}
