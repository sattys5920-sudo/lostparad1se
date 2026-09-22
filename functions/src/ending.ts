// 닷새의 기록을 GameLog 하나로 모은다. 판정 규칙은
// shared/missions/judge.ts 에 있고 여기서는 재료만 모은다.
// 「나」 탭의 학생증(paper.ts)이 이걸 쓴다.
//
// **엔딩 열 장면은 없앴다.** 전말·거울 규칙·A가 남긴 말·찢긴 한 장·
// 공동 엔딩을 화면이 차례로 틀어 주던 자리다. 무엇을 깨달을지를 화면이
// 정해 주는 대신, 운영자가 사람마다 한 편씩 적는다 — 아래 세 문이다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'

import type { BallotDay, CaptureRecord, GameLog, JudgeVote, RevealRecord, TradeRecord } from '../../shared/missions/judge'
import type { GameRecord, OwnerChange } from '../../shared/rules/records'
import { ALL_KEY, ENDING_MAX } from '../../shared/reveal/ending'
import { teamPurse } from '../../shared/rules/resources'
import { publicScore, rankTeams, type TeamState } from '../../shared/rules/score'
import { snowStopped } from '../../shared/rules/snow'
import { TEAMS } from '../../shared/rules/lobby'
import { dayNumber } from '../../shared/rules/clock'
import type { TileId } from '../../shared/rules/board'
import type { Interval } from '../../shared/rules/presence'
import type { TeamId } from '../../shared/rules/v2'
import type { CaptureDoc, EventDoc, GameDoc, PawnDoc, RosterDoc, TeamDoc, TileDoc, VoteDoc } from '../../shared/model'

import { gameRef, nowOf, requireUid } from './index'
import { requireHost } from './host'
import type { ChoiceDoc } from './choice'

const secret = (gameId: string, name: string) =>
  gameRef(gameId).collection('secret').doc(name).collection('items')

/**
 * 닷새치 기록을 GameLog 하나로.
 *
 * **판이 도는 중에도 부른다**(paper.ts). 그때는 `over` 가 false 고,
 * `voteCutoffDay` 가 온다 — 오늘 받은 표를 **로그에 아예 안 담는다**.
 * 담아 놓고 화면에서 가리면, 같은 방에 한 사람만 있을 때 방금 그
 * 사람이 표를 줬다는 것이 숫자 하나로 드러난다. 익명이 무너진다.
 */
export async function buildLog(
  gameId: string,
  game: GameDoc,
  opts: { over?: boolean; voteCutoffDay?: number } = {},
): Promise<{
  log: GameLog
  roster: RosterDoc[]
  seats: GameDoc['seats']
  ranked: { team: TeamId; rank: number; total: number }[]
  choices: Map<string, ChoiceDoc>
}> {
  const ref = gameRef(gameId)
  const nowMs = nowOf(game)
  const startedAtMs = game.startedAtMs ?? nowMs

  const [rosterS, ivS, voteS, evS, capS, tileS, teamS, awakeS, choiceS, closingS, pawnS, recordS, ballotDayS] = await Promise.all([
    secret(gameId, 'roster').get(),
    secret(gameId, 'intervals').get(),
    secret(gameId, 'votes').get(),
    ref.collection('events').get(),
    ref.collection('captures').get(),
    ref.collection('tiles').get(),
    ref.collection('teams').get(),
    secret(gameId, 'awakened').get(),
    secret(gameId, 'choices').get(),
    ref.collection('secret').doc('closing').get(),
    ref.collection('pawns').get(),
    // **오래 쓰기만 하던 자리를 이제 읽는다.** 자판기·심부름·화분·쪽지·
    // 짝·시험지·이적이 전부 여기 쌓여 있었는데 판정에는 안 들어갔다
    ref.collection('secret').doc('records').collection('items').get(),
    ref.collection('secret').doc('ballotDays').collection('items').get(),
  ])

  const roster = rosterS.docs.map((d) => d.data() as RosterDoc)
  const teamOfMap = new Map(roster.map((r) => [r.playerId, r.team]))
  const teamOf = (playerId: string): TeamId => teamOfMap.get(playerId) ?? 'A'

  const tiles = tileS.docs.map((d) => {
    const t = d.data() as TileDoc
    return { tileId: d.id as TileId, ownerTeam: t.ownerTeam }
  })
  const ownerAt = new Map(tiles.map((t) => [t.tileId, t.ownerTeam]))
  const teamDocs = new Map(teamS.docs.map((d) => [d.id as TeamId, d.data() as TeamDoc]))

  const events = evS.docs.map((d) => d.data() as EventDoc)
  // 페이즈가 닫힐 때마다 남긴 점령 기록. 개인 미션의 「방어 참여」·
  // 「공격 참여」가 이것만 본다
  const captures: CaptureRecord[] = capS.docs.map((d) => {
    const c = d.data() as CaptureDoc
    return {
      tileId: c.tileId as TileId,
      team: c.team,
      ownerBefore: c.ownerBefore,
      standing: c.standing,
      atMs: c.atMs,
    }
  })
  const trades: TradeRecord[] = events
    .filter((e) => e.kind === 'tradeAccepted')
    .map((e) => ({ fromTeam: e.detail?.fromTeam as TeamId, toTeam: e.team as TeamId, atMs: e.atMs }))
  const lostTile = new Set(events.filter((e) => e.kind === 'tileLost').map((e) => e.team as TeamId))

  const cutoff = opts.voteCutoffDay
  const votes: JudgeVote[] = voteS.docs
    .map((d) => d.data() as VoteDoc)
    .filter((v) => cutoff === undefined || v.day < cutoff)
    .map((v) => ({ voterId: v.voterId, targetId: v.targetId, kind: v.kind, day: v.day, atMs: v.castAtMs }))
  const reveals: RevealRecord[] = roster
    .filter((r) => r.reveal)
    .map((r) => ({
      speakerId: r.playerId,
      scope: r.reveal!.scope,
      listenerIds: r.reveal!.listenerIds,
      day: dayNumber(startedAtMs, r.reveal!.atMs),
      atMs: r.reveal!.atMs,
    }))

  // 최종 순위. 비밀 목표는 아직 안 넣는다 — 공개 점수로 낸다
  // **자원은 지갑 넷의 합이다.** 금고가 없어졌다 — 점수판만 팀 단위다
  const wallet = pawnS.docs.map((d) => d.data() as PawnDoc)
  const scores = TEAMS.map((team) => {
    const doc = teamDocs.get(team) as TeamDoc
    const state: TeamState = {
      team,
      resources: teamPurse(wallet, team),
      researchTier: doc.researchTier,
    }
    return publicScore({ tiles, fragments: [], team: state })
  })
  const ranked = rankTeams(scores, (team) => teamPurse(wallet, team).knowledge)
  const teamRank = Object.fromEntries(ranked.map((r) => [r.team, r.rank])) as Record<TeamId, number>
  // 안 가른 순위. 「우리 팀이 1위가 아니다」가 이쪽을 본다
  const teamTiedRank = Object.fromEntries(ranked.map((r) => [r.team, r.tiedRank])) as Record<TeamId, number>

  const records = recordS.docs
    .map((d) => d.data() as GameRecord)
    .sort((a, b) => a.atMs - b.atMs)
  /*
   * 방 주인이 바뀐 이력. **따로 쌓을 것이 없었다** — 소유는 페이즈가
   * 닫힐 때만 바뀌고, 그때마다 점령 기록이 이전 주인과 이후 주인을
   * 같이 남기고 있었다. 모양만 바꿔 넘긴다
   */
  const ownerChanges: OwnerChange[] = captures.map((c) => ({
    tileId: c.tileId,
    team: c.team,
    ownerBefore: c.ownerBefore,
    atMs: c.atMs,
  }))
  const ballotDayRows: BallotDay[] = ballotDayS.docs
    .map((d) => d.data() as { day: number; invisibleId: string | null; reason: string })
    .map((r) => ({ day: r.day, invisibleId: r.invisibleId ?? null, reason: r.reason }))
    .sort((a, b) => a.day - b.day)

  const choices = new Map(choiceS.docs.map((d) => [d.id, d.data() as ChoiceDoc]))
  const closing = closingS.data() as
    | { together: Record<string, boolean>; mutual: Record<string, boolean>; chosenBy: Record<string, string | null> }
    | undefined

  const awakened = Object.fromEntries(awakeS.docs.map((d) => [d.id, true]))
  const revealedCount = reveals.length
  const stopped = snowStopped({ awakened: awakeS.size, revealed: revealedCount })

  const log: GameLog = {
    startedAtMs,
    nowMs,
    over: opts.over ?? true,
    teamOf,
    intervals: ivS.docs.map((d) => d.data() as Interval),
    votes,
    reveals,
    leverageUses: [],
    captures,
    leverageGains: [],
    trades,
    fragmentTiles: game.boostedTiles as TileId[],
    ownerAtEnd: (id) => ownerAt.get(id) ?? null,
    teamRank,
    teamTiedRank,
    records,
    ownerChanges,
    ballotDays: ballotDayRows,
    // 동맹은 걷어냈다. 인연 팀과 손잡는 미션은 나중에 고친다
    allianceAtEnd: Object.fromEntries(TEAMS.map((t) => [t, null])) as Record<TeamId, TeamId | null>,
    leverageAtEnd: [],
    teamLostTile: Object.fromEntries(TEAMS.map((t) => [t, lostTile.has(t)])) as Record<TeamId, boolean>,
    chosenBy: closing?.chosenBy ?? {},
    // 두 번 돌린다. 아래에서 채운다
    choiceMet: {},
    closingTogether: closing?.together ?? {},
    closingMutual: closing?.mutual ?? {},
    awakened,
    snowStopped: stopped,
  }

  return { log, roster, seats: game.seats, ranked: ranked.map((r) => ({ team: r.team, rank: r.rank, total: r.total })), choices }
}

/**
 * 엔딩 — **운영자가 적는다.**
 *
 * 열 장면을 화면이 틀어 주던 자리다. 그 자리에는 그날의 전말도, 거울
 * 규칙도, A가 남긴 말 열넷도 미리 적혀 있었다. 닷새를 지켜본 사람이
 * 그 자리에서 쓰는 한 편이 미리 적은 마흔두 문장보다 낫다.
 *
 * 문서 하나가 한 사람 몫이다. `__all` 은 전원에게 같이 붙는 글이라,
 * 각자 화면에는 「모두에게」가 먼저 오고 그다음 제 몫이 온다.
 */
const endingsOf = (gameId: string) => gameRef(gameId).collection('secret').doc('ending').collection('lines')

export interface EndingLineDoc {
  /** 받는 사람. ALL_KEY 면 전원이다. */
  toPlayerId: string
  text: string
  atMs: number
}

/** 적거나 고친다. **운영자만.** 빈 글을 넣으면 지운다. */
export const hostSetEnding = onCall<{ gameId: string; toPlayerId: string; text: string }>(async (req) => {
  requireHost(req.auth)
  const { gameId } = req.data
  const to = String(req.data.toPlayerId ?? '').trim()
  if (to === '') throw new HttpsError('invalid-argument', '누구에게 줄지 골라야 한다.')
  const text = String(req.data.text ?? '').trim().slice(0, ENDING_MAX)
  const ref = endingsOf(gameId).doc(to)
  if (text === '') {
    await ref.delete()
    return { to, removed: true }
  }
  const doc: EndingLineDoc = { toPlayerId: to, text, atMs: Date.now() }
  await ref.set(doc)
  return { to, saved: true }
})

/** 지금까지 적어 둔 것 전부. **운영자만.** */
export const hostEndings = onCall<{ gameId: string }>(async (req) => {
  requireHost(req.auth)
  const snap = await endingsOf(req.data.gameId).get()
  return { rows: snap.docs.map((d) => ({ to: d.id, text: (d.data() as EndingLineDoc).text })) }
})

/**
 * 내 엔딩. **종례가 끝난 뒤에만.**
 *
 * 남의 몫은 어떤 경로로도 안 나간다 — 문서 두 개만 읽는다.
 */
export const myEnding = onCall<{ gameId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const snap = await gameRef(gameId).get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  if ((snap.data() as GameDoc).phase !== 'finished') {
    throw new HttpsError('failed-precondition', '아직 닷새가 안 끝났다.')
  }
  const seat = await secret(gameId, 'roster').doc(uid).get()
  if (!seat.exists) throw new HttpsError('permission-denied', '이 판에 없는 사람이다.')
  const [all, mine] = await Promise.all([
    endingsOf(gameId).doc(ALL_KEY).get(),
    endingsOf(gameId).doc(uid).get(),
  ])
  const parts: string[] = []
  if (all.exists) parts.push((all.data() as EndingLineDoc).text)
  if (mine.exists) parts.push((mine.data() as EndingLineDoc).text)
  return { text: parts.join('\n\n') }
})
