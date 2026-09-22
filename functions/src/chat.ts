// 말.
//
// **말은 방에 남는다.** 옆 방에서 무슨 이야기가 오갔는지는 알 수 없고,
// 늦게 들어간 사람은 앞서 나눈 말을 볼 수 없다. 그 자리에 없었으면
// 못 들은 것이다.
//
// 그래서 「누가 누구와 같이 있었는가」가 정보가 된다. 복도에서 마주친
// 두 사람이 무슨 말을 했는지는 거기 있던 사람만 안다.
//
// 그리고 **어떤 판정에도 쓰이지 않는다.** 여기 무엇을 치든 서버가
// 세는 것은 실제로 한 일뿐이다.
//
// 지워진 사람의 말은 「…」로만 간다. 본인에게는 원문이 보인다 —
// 자기가 무슨 말을 했는지는 안다. 다만 아무도 듣지 않았다. 원문은
// 서버가 그대로 쥐고 있다가 엔딩 6번 장면에서 되돌려 준다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { chatReaches } from '../../shared/rules/invisible'
import { nearInHall } from '../../shared/rules/fog'

import { ROOM_SAY_MAX } from '../../shared/rules/v2'
import { START_TILE, isHallCell, type Cell, type TileId } from '../../shared/rules/board'
import type { GameDoc, SeatEntry } from '../../shared/model'
import { openInterval } from './reveal'
import { freshNow, myPawn } from './turn'
import { gameRef, nowOf, requireUid } from './index'

/**
 * 방 안의 말은 **무전보다 짧다.** 무전은 적어 두고 읽는 것이지만
 * 이쪽은 머리 위에 떠 있다가 사라지는 것이라, 긴 글이 오면 풍선이
 * 지도를 덮고 그나마도 다 못 읽는다.
 */
export const CHAT_MAX = ROOM_SAY_MAX

/** games/{gameId}/secret/chat/items/{id} — 원문은 서버만 쥔다. */
export interface ChatDocRaw {
  /**
   * 어느 방에서 한 말인가. 그 방에 **그때** 있던 사람만 듣는다.
   *
   * **복도에서 한 말은 null 이다.** 방 이름을 적어 두면 그 방 사람들
   * 로그에 복도 이야기가 섞인다 — 방 질의(tileId == 'x')는 null 을
   * 절대 안 집으므로, 비워 두는 것이 제일 확실한 칸막이다.
   */
  tileId: TileId | null
  /** 복도에서 한 말인가. 그렇다면 at 근처 사람에게만 들린다. */
  hall?: boolean
  /** 복도에서 한 말이면 선 자리. 거리로 듣는 사람을 가른다. */
  at?: Cell | null
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

/**
 * 복도 말이 귀에 남는 시간.
 *
 * 방에는 「언제 들어왔나」가 있어서 그때부터를 듣는데, 복도에는 그
 * 기록이 없다. 짧게 끊는다 — 복도는 지나가며 말하는 곳이고, 뒤늦게
 * 와서 한 시간치를 읽는 곳이 아니다.
 */
const HALL_EARSHOT_MS = 3 * 60_000

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
/**
 * 시작 전의 2-3 교실.
 *
 * **자리에 앉은 사람은 시작 전에도 말한다.** 열넷이 차기를 기다리는
 * 동안 한 교실에 같이 서 있는데 입을 막아 두면, 그 시간이 그대로
 * 죽는다. 말은 원래 방에 남는 것이고, 그때 방은 하나뿐이다.
 *
 * 그때는 말이 아직 없어서(pawns 는 시작할 때 놓인다) 서 있는 칸을
 * 물을 데가 없다. 물을 것도 없다 — 시작 전에 갈 수 있는 곳은
 * 2-3 교실 하나뿐이다(Walk 의 stayIn).
 *
 * 자리에 없는 사람은 여기서도 못 친다. 앉아야 교실에 있는 것이다.
 */
function beforeStart(game: GameDoc, uid: string): { seat: SeatEntry; tileId: TileId } | null {
  if (game.phase !== 'lobby') return null
  const seat = game.seats.find((s) => s.playerId === uid)
  if (!seat) throw new HttpsError('failed-precondition', '아직 자리에 앉지 않았다.')
  return { seat, tileId: START_TILE as TileId }
}

/** 로비에서도 부른다. freshNow 는 판이 도는 중에만 답한다 */
async function loadNow(gameId: string): Promise<{ game: GameDoc; nowMs: number }> {
  const snap = await gameRef(gameId).get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  const game = snap.data() as GameDoc
  if (game.phase !== 'lobby') return freshNow(gameId)
  return { game, nowMs: nowOf(game) }
}

export const say = onCall<{ gameId: string; text: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const text = String(req.data.text ?? '').trim()
  if (text.length === 0) throw new HttpsError('invalid-argument', '할 말을 적어라.')
  if (text.length > CHAT_MAX) throw new HttpsError('invalid-argument', `${CHAT_MAX}자까지 칠 수 있다.`)

  const { game, nowMs } = await loadNow(gameId)
  const early = beforeStart(game, uid)

  let tileId: TileId
  let team: string
  /** 복도에서 한 말이면 그 자리. 방에서 한 말이면 null. */
  let hallAt: Cell | null = null
  if (early) {
    tileId = early.tileId
    team = early.seat.team as string
  } else {
    const pawn = await myPawn(gameId, uid)
    // 문과 문 사이에서 한 말은 어느 방에도 남지 않는다
    if (pawn.tileId === null) {
      throw new HttpsError('failed-precondition', '걷는 중이다.')
    }
    /*
     * **복도에서도 말한다.**
     *
     * 내 칸(tileId)은 복도에 서 있어도 마지막으로 들어간 방 그대로다.
     * 그 이름으로 적어 두면 거기 남은 사람들에게 복도 이야기가 들린다 —
     * 그래서 복도에서 한 말은 방 이름 없이, 선 자리와 함께 적는다.
     */
    const cell = (pawn.at ?? null) as Cell | null
    if (cell && isHallCell(cell.x, cell.y)) {
      hallAt = cell
    }
    tileId = pawn.tileId
    team = pawn.team
  }
  const seat = game.seats.find((s) => s.playerId === uid)

  const row: ChatDocRaw = {
    // 복도에서 한 말에는 방 이름을 안 적는다. 방 질의가 절대 안 집는다
    tileId: hallAt ? null : tileId,
    ...(hallAt ? { hall: true, at: hallAt } : {}),
    playerId: uid,
    name: seat?.name ?? '',
    team,
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
  const { game, nowMs } = await loadNow(gameId)
  const early = beforeStart(game, uid)

  /*
   * 시작 전에는 **체류 기록을 안 만든다.**
   *
   * 아래의 「도착 시각이 없으면 지금 칸을 연다」는 판이 도는 중에나
   * 맞는 말이다. 로비에서 칸을 열어 두면 그 구간이 닷새의 체류 시간에
   * 섞여 들어가고, 「지목 칸에 두 시간」 같은 미션이 시작도 전에 찬다.
   *
   * 대신 sinceMs 만 본다. 시작 전 교실은 한 칸뿐이고 거기서 오간 말은
   * 아직 판의 일이 아니다 — 늦게 들어온 사람도 앞선 줄을 본다.
   * 시작하면 이 줄들은 저절로 떨어져 나간다. 그때 서버가 체류를
   * 시작 시각으로 열어서, 그보다 앞선 말은 다시 안 온다.
   */
  if (early) {
    const since = Number(req.data.sinceMs ?? 0)
    const rows = await chatOf(gameId)
      .where('tileId', '==', early.tileId)
      .where('atMs', '>', since)
      .orderBy('atMs')
      .limit(CHAT_MAX)
      .get()
    return {
      lines: rows.docs.map((d) => {
        const c = d.data() as ChatDocRaw
        return {
          playerId: c.playerId,
          name: c.name,
          team: c.team,
          atMs: c.atMs,
          text: c.text,
          muted: false,
        }
      }),
      day: 0,
      here: early.tileId,
    }
  }

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
  /*
   * **복도에 서 있으면 복도 줄을 듣는다.**
   *
   * 방에서 듣는 규칙은 「그 방에, 내가 들어온 뒤에」다. 복도에는
   * 들어온 시각이 없다 — 체류 기록은 방 단위라서다. 대신 짧은 창을
   * 둔다: 지금부터 HALL_EARSHOT_MS 전까지. 복도 이야기는 지나가며
   * 하는 말이고, 뒤늦게 와서 한 시간치를 읽는 곳이 아니다.
   *
   * 거리는 **보이는 것과 같은 자**로 잰다(nearInHall). 보이는 사람에게
   * 들리고 안 보이는 사람에게는 안 들린다.
   */
  const myCell = (pawn.at ?? null) as Cell | null
  const inHall = myCell !== null && isHallCell(myCell.x, myCell.y)

  let since: number
  let all: FirebaseFirestore.QuerySnapshot
  if (inHall) {
    since = Math.max(Number(req.data.sinceMs ?? 0), nowMs - HALL_EARSHOT_MS)
    // 방 이름으로 못 거른다 — 복도 줄에는 방 이름이 없다. 시각으로
    // 좁혀 오고 거리로 거른다
    all = await chatOf(gameId).where('atMs', '>', since).orderBy('atMs').limit(300).get()
  } else {
    let arrived = await arrivedAtMs(gameId, uid)
    if (!Number.isFinite(arrived) || arrived > nowMs) {
      await openInterval(gameId, uid, pawn.tileId, nowMs)
      arrived = nowMs
    }
    since = Math.max(Number(req.data.sinceMs ?? 0), arrived)
    all = await chatOf(gameId)
      .where('tileId', '==', pawn.tileId)
      .where('atMs', '>', since)
      .orderBy('atMs')
      .limit(300)
      .get()
  }

  const lines = all.docs
    .map((d) => d.data() as ChatDocRaw)
    // 복도에 섰으면 **가까이서 한 복도 말만.** 방 말은 문 너머다
    .filter((c) => (inHall ? c.hall === true && nearInHall(myCell, c.at ?? null) : true))
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

  // 복도에 섰으면 어느 방도 아니다. 화면이 「여기」를 그렇게 적는다
  return { lines, day: game.day, here: inHall ? null : pawn.tileId }
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
