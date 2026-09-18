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
// **지워진 사람도 무전은 쓴다.** 방에서 하는 말(chat.ts)은 막히지만
// 무전은 안 막힌다 — 지워진 것은 판정에서지 팀에서가 아니다. 셋이
// 넷인 줄 알고 방을 나누면 그날 작전이 통째로 어긋나므로, 오히려
// 말이 통해야 한다. 대신 그 줄에는 **이름 옆에 「안 보임」이 붙는다** —
// 오늘 그 사람이 머릿수에 안 들어간다는 것을 팀이 알아야 한다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'

import { CHAT_MAX_LEN } from '../../shared/rules/v2'
import { RADIO_BEAT_MS, RADIO_STALE_MS } from '../../shared/rules/radio'
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
  /**
   * 칠 때 지워져 있었는가. **막지는 않는다** — 이름 옆 표시로만 쓴다.
   * 그때의 상태를 적어 두는 것이라, 나중에 다시 봐도 그날 그 줄이다.
   */
  invisible: boolean
  /** 사람이 친 것이 아니라 판이 적은 줄. 화면에서 서식이 다르다. */
  system?: boolean
}

const radioOf = (gameId: string) => gameRef(gameId).collection('secret').doc('radio').collection('items')

/**
 * 판이 적는 줄.
 *
 * **이미 그 팀이 아는 것만 적는다.** 방이 넘어간 것도 팀원이 지워진
 * 것도 그 팀은 원래 본다 — 무전만 봐도 팀 상황이 따라오게 한 줄로
 * 옮겨 적는 것이지, 여기가 새 정보가 새는 구멍이 되면 안 된다.
 *
 * 대화와 같은 통에 들어간다. 시각 순서가 섞여야 「3교시가 열렸다」
 * 다음에 그 교시에 오간 말이 온다.
 */
export function sysRow(team: TeamId, text: string, atMs: number, day: number): RadioDocRaw {
  return { team, playerId: '', name: '', text, atMs, day, invisible: false, system: true }
}

/**
 * 쓰던 배치나 트랜잭션에 얹는다. 사건을 적는 자리와 같은 커밋이어야
 * 한다 — 따로 쓰면 방은 넘어갔는데 무전에는 안 뜨는 순간이 생긴다.
 */
export interface Writes {
  set(ref: FirebaseFirestore.DocumentReference, data: FirebaseFirestore.DocumentData): unknown
}

export function sysLine(
  into: Writes,
  gameId: string,
  team: TeamId,
  text: string,
  atMs: number,
  day: number,
): void {
  into.set(radioOf(gameId).doc(), sysRow(team, text, atMs, day))
}

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
  // 지워져 있어도 팀에게는 닿는다
  return { said: true, heard: true }
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
  const { game, nowMs } = await freshNow(gameId)
  const pawn = await myPawn(gameId, uid)
  // **옮겨 온 사람은 옮긴 뒤부터 듣는다.** 방에서 하는 말이 「들어온
  // 뒤의 말만」인 것과 같다 — 배신 한 번에 그 팀 하루치가 넘어가면
  // 안 된다
  const since = Math.max(Number(req.data.sinceMs ?? 0), pawn.teamSinceMs ?? 0)

  /*
   * **켜 둔 사람을 센다.** 「수신 n」이 이 수다.
   *
   * 무전을 가져가는 일 자체가 맥이다 — 앱을 켜 두고 있으면 탭이
   * 어디에 있든 계속 가져간다. 지도의 실시간 자리는 걷는 동안에만
   * 적혀서, 방에 가만히 선 팀원이 6초 만에 사라진다.
   *
   * 나는 안 센다. 내가 말하면 들을 사람 수다.
   */
  const ref = gameRef(gameId)
  if (nowMs - (pawn.radioAtMs ?? 0) > RADIO_BEAT_MS / 2) {
    await ref.collection('pawns').doc(uid).update({ radioAtMs: nowMs })
  }
  const crew = await ref.collection('pawns').where('team', '==', pawn.team).get()
  const here = crew.docs.filter(
    (d) => d.id !== uid && nowMs - ((d.data() as { radioAtMs?: number }).radioAtMs ?? 0) < RADIO_STALE_MS,
  ).length

  const all = await radioOf(gameId)
    .where('team', '==', pawn.team)
    .where('atMs', '>', since)
    .orderBy('atMs')
    .limit(300)
    .get()

  const lines = all.docs
    .map((d) => d.data() as RadioDocRaw)
    .map((r) => ({
      playerId: r.playerId,
      name: r.name,
      team: r.team,
      atMs: r.atMs,
      text: r.text,
      /** 칠 때 지워져 있었다. 이름 옆에 「안 보임」이 붙는다 */
      hidden: r.invisible,
      /** 판이 적은 줄. 화면이 서식을 가른다 */
      system: r.system === true,
    }))

  return { lines, day: game.day, team: pawn.team, here }
})
