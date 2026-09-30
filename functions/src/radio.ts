// 무전 — 같은 팀끼리만 통하는 줄.
//
// **방에 매이지 않는다.** 말(chat.ts)은 그 방에, 그때 있던 사람에게만
// 남는다. 무전은 학교 어디에 있든 같은 팀에게 닿는다 — 넷이 흩어져
// 사방을 겨루는 판에서 팀이 팀으로 움직이려면 떨어져서도 말이 통해야
// 한다.
//
// **팀 밖으로는 한 줄도 안 나간다.** 거르는 일은 서버가 한다 — 네 팀
// 것을 다 보내 놓고 화면에서 고르면 개발자도구로 다 보인다.
//
// 걷는 중에도 된다. 말과 다른 점이 이것이다.
//
// **전원 채널이 하나 있다.** 팀 무전과 같은 통에 team 'ALL' 로 적는다 —
// 열넷 누구나 듣고 말한다. 방에서 하는 말은 그 방 사람에게만 닿고
// 지도 위에 떠서 읽기 어렵다. 판 전체가 한 줄로 이야기할 자리가 여기다.
//
// **운영자는 네 팀 무전과 전원 채널을 다 본다**(hostRadio*). 운영자만.
//
// **지워진 사람은 무전으로 말하지 못한다.** 팀 채널이든 전원 채널이든
// 마찬가지다 — 거래도 대화도 마주 보고 하는 일이라 안 되는 것과 같은
// 이유다. **듣는 것은 막지 않는다** — 팀 상황을 놓치면 안 되니까.
import { HttpsError, onCall } from 'firebase-functions/v2/https'

import { CHAT_MAX_LEN } from '../../shared/rules/v2'
import { ALL_CLOSED, ALL_OPENED, ALL_SHUT, RADIO_BEAT_MS, RADIO_STALE_MS } from '../../shared/rules/radio'
import type { GameDoc } from '../../shared/model'
import { getFirestore } from 'firebase-admin/firestore'
import { TEAM_IDS, type TeamId } from '../../shared/rules/v2'
import { freshNow, myPawn } from './turn'
import { gameRef, nowOf, requireUid } from './index'
import { sinceOf } from './chat'
import { requireHost } from './host'
import { notify } from './notify'
import { MUTE_WHILE_INVISIBLE } from '../../shared/rules/invisible'

const db = getFirestore()

/** games/{gameId}/secret/radio/items/{id} — 팀 것만 골라 내려보낸다. */
/** 전원 채널. 팀 무전과 같은 통에 이 값으로 적는다 */
export const ALL_CHANNEL = 'ALL' as const
export type RadioChannel = TeamId | typeof ALL_CHANNEL

export interface RadioDocRaw {
  team: RadioChannel
  playerId: string
  name: string
  text: string
  atMs: number
  day: number
  /**
   * 칠 때 지워져 있었는가. 이제는 지워진 동안 아예 못 치므로 새 줄은
   * 늘 false다 — 이 값을 남겨 두는 것은 이 규칙이 생기기 전에 이미
   * 쌓인 줄을 그대로 읽기 위해서다(이름 옆 「안 보임」 표시).
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

/** 한 줄 보낸다. 팀 채널이면 같은 팀에게만, 전원 채널이면 열넷에게 간다. */
export const radio = onCall<{ gameId: string; text: string; channel?: 'team' | 'all' }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const text = String(req.data.text ?? '').trim()
  if (text.length === 0) throw new HttpsError('invalid-argument', '할 말을 적어라.')
  if (text.length > CHAT_MAX_LEN) throw new HttpsError('invalid-argument', `${CHAT_MAX_LEN}자까지 칠 수 있다.`)

  const { game, nowMs } = await freshNow(gameId)
  const pawn = await myPawn(gameId, uid)
  const seat = game.seats.find((s) => s.playerId === uid)

  const toAll = req.data.channel === 'all'
  if (toAll && game.allChannelClosed === true) {
    throw new HttpsError('failed-precondition', ALL_SHUT)
  }
  // 무전도 마주 보고 하는 대화다 — 지워진 동안은 팀 채널이든 전원
  // 채널이든 말할 수 없다
  if (game.invisibleId === uid) {
    throw new HttpsError('failed-precondition', MUTE_WHILE_INVISIBLE)
  }
  const row: RadioDocRaw = {
    team: toAll ? ALL_CHANNEL : pawn.team,
    playerId: uid,
    name: seat?.name ?? '',
    text,
    atMs: nowMs,
    day: game.day,
    invisible: game.invisibleId === uid,
  }
  await radioOf(gameId).add(row)
  // 이름이 나오면 그 사람에게 알린다(태그). 팀 채널은 팀원만, 전원 채널은
  // 열넷 누구나. **무슨 말인지는 안 싣는다**
  const called = game.seats
    .filter((s) => s.playerId !== uid && (toAll || s.team === pawn.team) && s.name.length > 0 && text.includes(s.name))
    .map((s) => s.playerId)
  if (called.length > 0) await notify(gameId, called, 'tag', `tag:${uid}:${nowMs}`)
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
export const radioLines = onCall<{ gameId: string; sinceMs?: number; channel?: 'team' | 'all' }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const { game, nowMs } = await freshNow(gameId)
  const pawn = await myPawn(gameId, uid)
  const toAll = req.data.channel === 'all'
  // **옮겨 온 사람은 옮긴 뒤부터 듣는다.** 방에서 하는 말이 「들어온
  // 뒤의 말만」인 것과 같다 — 배신 한 번에 그 팀 하루치가 넘어가면
  // 안 된다. 전원 채널은 팀과 상관없으니 처음부터 다 듣는다
  const since = toAll ? sinceOf(req.data.sinceMs) : Math.max(sinceOf(req.data.sinceMs), pawn.teamSinceMs ?? 0)

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
  const crew = toAll ? await ref.collection('pawns').get() : await ref.collection('pawns').where('team', '==', pawn.team).get()
  const here = crew.docs.filter(
    (d) => d.id !== uid && nowMs - ((d.data() as { radioAtMs?: number }).radioAtMs ?? 0) < RADIO_STALE_MS,
  ).length

  // **최근 것부터** 300줄을 잘라 뒤집는다. 오래된 것부터 자르면 줄이 쌓인
  // 판에서 처음 켠 사람이 아침 말만 받고 지금 말은 못 받는다
  const all = await radioOf(gameId)
    .where('team', '==', toAll ? ALL_CHANNEL : pawn.team)
    .where('atMs', '>', since)
    .orderBy('atMs', 'desc')
    .limit(300)
    .get()

  const lines = [...all.docs]
    .reverse()
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

  return { lines, day: game.day, team: pawn.team, channel: toAll ? 'all' : 'team', here }
})

/** 한 채널의 줄을 운영자 화면 모양으로 */
function hostRows(docs: FirebaseFirestore.QueryDocumentSnapshot[]) {
  return docs
    .map((d) => d.data() as RadioDocRaw)
    .map((r) => ({
      playerId: r.playerId,
      name: r.name,
      team: r.team,
      atMs: r.atMs,
      text: r.text,
      hidden: r.invisible,
      system: r.system === true,
    }))
}

/**
 * 운영자 — 채널 다섯(네 팀 · 전원)을 한눈에. 줄 수 · 마지막 줄 · 켜 둔 사람 수.
 *
 * **운영자만.** 목록에서 채널을 누르면 hostRadioLines 로 그 채널을 실시간으로 본다.
 */
export const hostRadioOverview = onCall<{ gameId: string }>(async (req) => {
  requireHost(req.auth)
  const { gameId } = req.data
  const ref = gameRef(gameId)
  const game = (await ref.get()).data() as { clock?: unknown } | undefined
  if (!game) throw new HttpsError('not-found', '그런 판이 없다.')
  const nowMs = nowOf(game as never)
  const pawns = await ref.collection('pawns').get()
  const channels: RadioChannel[] = [...TEAM_IDS, ALL_CHANNEL]
  const rows = await Promise.all(
    channels.map(async (ch) => {
      const [last, count] = await Promise.all([
        radioOf(gameId).where('team', '==', ch).orderBy('atMs', 'desc').limit(1).get(),
        radioOf(gameId).where('team', '==', ch).count().get(),
      ])
      const l = last.docs[0]?.data() as RadioDocRaw | undefined
      const members = pawns.docs.filter((d) => ch === ALL_CHANNEL || (d.data() as { team?: string }).team === ch)
      return {
        channel: ch,
        lines: count.data().count,
        last: l ? { name: l.system ? '' : l.name, text: l.text, atMs: l.atMs, system: l.system === true } : null,
        members: members.length,
        here: members.filter((d) => nowMs - ((d.data() as { radioAtMs?: number }).radioAtMs ?? 0) < RADIO_STALE_MS).length,
      }
    }),
  )
  return { channels: rows, nowMs, allOpen: (game as { allChannelClosed?: boolean }).allChannelClosed !== true }
})

/** 운영자 — 한 채널의 줄. sinceMs 뒤의 것만(화면이 몇 초마다 부른다 — 실시간) */
export const hostRadioLines = onCall<{ gameId: string; channel: string; sinceMs?: number }>(async (req) => {
  requireHost(req.auth)
  const { gameId } = req.data
  const ch = String(req.data.channel ?? '')
  if (ch !== ALL_CHANNEL && !(TEAM_IDS as readonly string[]).includes(ch)) {
    throw new HttpsError('invalid-argument', '그런 채널이 없다.')
  }
  const since = sinceOf(req.data.sinceMs)
  const snap = await radioOf(gameId).where('team', '==', ch).where('atMs', '>', since).orderBy('atMs', 'desc').limit(300).get()
  return { channel: ch, lines: hostRows([...snap.docs].reverse()) }
})

/**
 * 운영자 — 전원 채널을 여닫는다. 닫혀 있으면 아무도 전원 채널에 말하지
 * 못한다(지난 말은 읽힌다). 여닫을 때 그 채널에 한 줄이 남는다.
 */
export const hostSetAllChannel = onCall<{ gameId: string; open: boolean }>(async (req) => {
  requireHost(req.auth)
  const { gameId } = req.data
  const open = req.data.open === true
  const ref = gameRef(gameId)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  const game = snap.data() as GameDoc
  const batch = db.batch()
  batch.update(ref, { allChannelClosed: !open })
  const row: RadioDocRaw = { team: ALL_CHANNEL, playerId: '', name: '', text: open ? ALL_OPENED : ALL_CLOSED, atMs: nowOf(game), day: game.day, invisible: false, system: true }
  batch.set(radioOf(gameId).doc(), row)
  await batch.commit()
  return { open }
})
