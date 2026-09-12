// 채팅.
//
// **어떤 판정에도 쓰이지 않는다.** 「나 털어놓을게」라고 치는 것과
// 실제로 털어놓는 것은 완전히 다른 일이고, 게임은 후자만 센다.
//
// 지워진 사람의 전체 채팅은 「…」로만 간다. 본인에게는 원문이 보인다 —
// 자기가 무슨 말을 했는지는 안다. 다만 아무도 듣지 않았다.
//
// 원문은 서버가 그대로 쥐고 있다가 엔딩 6번 장면에서 되돌려 준다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'

import { CHAT_MAX_LEN } from '../../shared/rules/v2'
import { maskClassChat } from '../../shared/rules/invisible'
import type { GameDoc } from '../../shared/model'
import { freshNow, myPawn } from './turn'
import { gameRef, requireUid } from './index'

export const CHAT_MAX = CHAT_MAX_LEN

/** games/{gameId}/secret/chat/items/{id} — 원문은 서버만 쥔다. */
export interface ChatDocRaw {
  room: 'class' | TeamRoom
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

type TeamRoom = `team:${string}`

const chatOf = (gameId: string) => gameRef(gameId).collection('secret').doc('chat').collection('items')

/** 한 줄 친다. 전체 방과 팀 방 둘뿐이다. */
export const say = onCall<{ gameId: string; room: 'class' | 'team'; text: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const text = String(req.data.text ?? '').trim()
  if (text.length === 0) throw new HttpsError('invalid-argument', '할 말을 적어라.')
  if (text.length > CHAT_MAX) throw new HttpsError('invalid-argument', `${CHAT_MAX}자까지 칠 수 있다.`)

  const { game, nowMs } = await freshNow(gameId)
  const pawn = await myPawn(gameId, uid)
  const seat = game.seats.find((s) => s.playerId === uid)

  const row: ChatDocRaw = {
    room: req.data.room === 'team' ? (`team:${pawn.team}` as TeamRoom) : 'class',
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
 * 내가 볼 수 있는 줄들.
 *
 * 전체 방은 모두, 팀 방은 우리 팀만. 지워진 사람의 전체 채팅은
 * 본인 말고는 「…」로 바뀌어 나간다 — 가리는 것이 아니라 **바뀐
 * 글자만** 나가는 것이다. 원문은 서버에 남아 엔딩에서 돌아온다.
 */
export const chatLines = onCall<{ gameId: string; sinceMs?: number }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const snap = await gameRef(gameId).get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  const game = snap.data() as GameDoc
  const pawn = await myPawn(gameId, uid)

  const since = Number(req.data.sinceMs ?? 0)
  const all = await chatOf(gameId).where('atMs', '>', since).orderBy('atMs').limit(300).get()

  const lines = all.docs
    .map((d) => d.data() as ChatDocRaw)
    .filter((c) => c.room === 'class' || c.room === `team:${pawn.team}`)
    .map((c) => ({
      room: c.room === 'class' ? 'class' : 'team',
      playerId: c.playerId,
      name: c.name,
      team: c.team,
      atMs: c.atMs,
      // 전체 방에서만 가린다. 팀 방은 지워져도 팀원에게 들린다
      text: c.room === 'class' ? maskClassChat(c.text, c.invisible, c.playerId === uid) : c.text,
      // 「이 줄은 전해지지 않았다」. 누가 투명인간인지는 이미 모두가
      // 아는 사실이라 이 표시로 새어 나가는 것은 없다
      muted: c.room === 'class' && c.invisible,
    }))

  return { lines, day: game.day }
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
    .filter((c) => c.room === 'class')
    .map((c) => ({ name: c.name, day: c.day, text: c.text }))
}
