// 무전 — 같은 팀끼리만 통하는 줄.
//
// **방에 매이지 않는다.** 말(chat.ts)은 그 방에, 그때 있던 사람에게만
// 남는다. 무전은 학교 어디에 있든 같은 팀에게 닿는다 — 넷이 흩어져
// 사방을 겨루는 판에서 팀이 팀으로 움직이려면 떨어져서도 말이 통해야
// 한다. 팀장을 뽑기 전에 서로 이야기하는 자리도 여기다.
//
// **팀 밖으로는 한 줄도 안 나간다.** 거르는 일은 서버가 한다 — 네 팀
// 것을 다 보내 놓고 화면에서 고르면 개발자도구로 다 보인다.
//
// 걷는 중에도 된다. 말과 다른 점이 이것이다.
//
// 지워진 사람의 무전은 **같은 팀에게도 안 간다.** 본인 화면에만 남는다.
// 「아무한테도 안 보인다」에 같은 팀이라고 예외를 두면, 그날 하루 그
// 사람은 팀 안에서만 멀쩡히 살아 있는 셈이 된다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'

import { chatReaches } from '../../shared/rules/invisible'
import { CHAT_MAX_LEN } from '../../shared/rules/v2'
import type { TeamId } from '../../shared/rules/v2'
import { freshNow, myPawn } from './turn'
import { gameRef, requireUid } from './index'

/** games/{gameId}/secret/radio/items/{id} — 팀 것만 골라 내려보낸다. */
export interface RadioDocRaw {
  team: TeamId
  playerId: string
  name: string
  text: string
  atMs: number
  day: number
  /** 칠 때 지워져 있었는가. 그러면 같은 팀에게도 안 간다. */
  invisible: boolean
}

const radioOf = (gameId: string) => gameRef(gameId).collection('secret').doc('radio').collection('items')

/** 한 줄 보낸다. 같은 팀 넷에게만 간다. */
export const radio = onCall<{ gameId: string; text: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const text = String(req.data.text ?? '').trim()
  if (text.length === 0) throw new HttpsError('invalid-argument', '할 말을 적어라.')
  if (text.length > CHAT_MAX_LEN) throw new HttpsError('invalid-argument', `${CHAT_MAX_LEN}자까지 칠 수 있다.`)

  const { game, nowMs } = await freshNow(gameId)
  const pawn = await myPawn(gameId, uid)
  const seat = game.seats.find((s) => s.playerId === uid)

  const row: RadioDocRaw = {
    team: pawn.team,
    playerId: uid,
    name: seat?.name ?? '',
    text,
    atMs: nowMs,
    day: game.day,
    invisible: game.invisibleId === uid,
  }
  await radioOf(gameId).add(row)
  return { said: true, heard: !row.invisible }
})

/**
 * 우리 팀 무전.
 *
 * 방에 **들어온** 시각은 안 따진다. 무전은 자리가 아니라 팀에 매인
 * 것이라, 학교 어디에 있든 우리 팀 줄은 다 듣는다.
 *
 * 다만 **팀이 된** 시각은 따진다. 옮겨 온 사람이 새 팀의 하루치를
 * 통째로 읽으면 배신 한 번에 그 팀이 아침부터 짠 것이 전부 넘어간다.
 */
export const radioLines = onCall<{ gameId: string; sinceMs?: number }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const { game } = await freshNow(gameId)
  const pawn = await myPawn(gameId, uid)
  // **옮겨 온 사람은 옮긴 뒤부터 듣는다.** 방에서 하는 말이 「들어온
  // 뒤의 말만」인 것과 같다 — 배신 한 번에 그 팀 하루치가 넘어가면
  // 안 된다
  const since = Math.max(Number(req.data.sinceMs ?? 0), pawn.teamSinceMs ?? 0)

  const all = await radioOf(gameId)
    .where('team', '==', pawn.team)
    .where('atMs', '>', since)
    .orderBy('atMs')
    .limit(300)
    .get()

  const lines = all.docs
    .map((d) => d.data() as RadioDocRaw)
    .filter((r) => chatReaches(r, uid))
    .map((r) => ({
      playerId: r.playerId,
      name: r.name,
      team: r.team,
      atMs: r.atMs,
      text: r.text,
      /** 「이 줄은 전해지지 않았다」. **본인 줄에만 붙는다.** */
      muted: r.invisible,
    }))

  return { lines, day: game.day, team: pawn.team }
})
