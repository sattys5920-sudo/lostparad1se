// 닷새의 기록을 GameLog 하나로 모은다. 판정 규칙은
// shared/missions/judge.ts 에 있고 여기서는 재료만 모은다.
// 「나」 탭의 학생증(paper.ts)이 이걸 쓴다.
//
// **엔딩 열 장면은 없앴다.** 전말·거울 규칙·A가 남긴 말·찢긴 한 장·
// 공동 엔딩을 화면이 차례로 틀어 주던 자리다. 지금은 A의 마지막
// 쪽지 한 장을, 운영자가 누르는 순간 전원에게 같이 튼다(아래).
import { HttpsError, onCall } from 'firebase-functions/v2/https'

import type { BallotDay, BallotVote, GameLog, JudgeVote } from '../../shared/missions/judge'
import { ownerAt, type GameRecord, type OwnerChange } from '../../shared/rules/records'
import { publicScore, rankTeams } from '../../shared/rules/score'
import { TEAMS } from '../../shared/rules/lobby'
import type { TileId } from '../../shared/rules/board'
import type { Interval } from '../../shared/rules/presence'
import type { TeamId } from '../../shared/rules/v2'
import type { CaptureDoc, GameDoc, RosterDoc, TileDoc, VoteDoc } from '../../shared/model'
import { FINAL_NOTE_LINES } from './story/finalNote'

import { gameRef, nowOf, requireUid } from './index'
import { requireHost } from './host'
import { refreshViews } from './views'
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
  opts: {
    over?: boolean
    voteCutoffDay?: number
    /**
     * **이 시각까지만 센다.** 자정 판정(missionDays.ts)이 쓴다 — 밀린 날을
     * 나중에 따라잡아 판정해도 그날 밤까지의 기록만 들어가야 한다.
     * 체류 구간은 판정이 nowMs 에서 자르므로 nowMs 를 이 값으로 둔다
     */
    asOfMs?: number
    /** 이날까지의 표 · 투명인간 투표만 센다(자정 판정). voteCutoffDay 보다 먼저 본다 */
    throughDay?: number
    /**
     * **이 시각부터만 센다.** 미션은 하루짜리다 — 그날 0시(전날을 넘긴 시각)부터
     * 센다. 주면 표 · 투명인간 투표도 throughDay 하루 것만 센다
     */
    fromMs?: number
  } = {},
): Promise<{
  log: GameLog
  roster: RosterDoc[]
  seats: GameDoc['seats']
  ranked: { team: TeamId; rank: number; total: number }[]
  choices: Map<string, ChoiceDoc>
}> {
  const ref = gameRef(gameId)
  const nowMs = opts.asOfMs ?? nowOf(game)
  const inTime = (atMs: number) => opts.asOfMs === undefined || atMs <= opts.asOfMs
  const inDays = (day: number) =>
    opts.throughDay === undefined || (opts.fromMs !== undefined ? day === opts.throughDay : day <= opts.throughDay)
  const inWindow = (atMs: number) => inTime(atMs) && (opts.fromMs === undefined || atMs >= opts.fromMs)
  // 센 기간의 처음. 하루 판정이면 그날 0시다
  const startedAtMs = opts.fromMs ?? game.startedAtMs ?? nowMs

  const [rosterS, ivS, voteS, capS, tileS, choiceS, closingS, recordS, ballotDayS, ballotS, slipS] = await Promise.all([
    secret(gameId, 'roster').get(),
    secret(gameId, 'intervals').get(),
    secret(gameId, 'votes').get(),
    ref.collection('captures').get(),
    ref.collection('tiles').get(),
    secret(gameId, 'choices').get(),
    ref.collection('secret').doc('closing').get(),
    // **오래 쓰기만 하던 자리를 이제 읽는다.** 자판기·심부름·화분·쪽지·
    // 짝·시험지·이적이 전부 여기 쌓여 있었는데 판정에는 안 들어갔다
    ref.collection('secret').doc('records').collection('items').get(),
    ref.collection('secret').doc('ballotDays').collection('items').get(),
    ref.collection('secret').doc('ballots').collection('items').get(),
    ref.collection('secret').doc('slips').collection('items').get(),
  ])

  const roster = rosterS.docs.map((d) => d.data() as RosterDoc)
  const teamOfMap = new Map(roster.map((r) => [r.playerId, r.team]))
  const teamOf = (playerId: string): TeamId => teamOfMap.get(playerId) ?? 'A'

  const tiles = tileS.docs.map((d) => {
    const t = d.data() as TileDoc
    return { tileId: d.id as TileId, ownerTeam: t.ownerTeam }
  })

  /** 페이즈가 닫힐 때마다 남긴 점령 기록. 소유 이력이 여기서 나온다. */
  const captures = capS.docs
    .map((d) => {
      const c = d.data() as CaptureDoc
      return {
        tileId: c.tileId as TileId,
        team: c.team,
        ownerBefore: c.ownerBefore,
        standing: c.standing,
        atMs: c.atMs,
      }
    })
    .filter((c) => inTime(c.atMs))

  const cutoff = opts.voteCutoffDay
  const votes: JudgeVote[] = voteS.docs
    .map((d) => d.data() as VoteDoc)
    .filter((v) => (opts.throughDay !== undefined ? inDays(v.day) : cutoff === undefined || v.day < cutoff))
    .map((v) => ({ voterId: v.voterId, voterTeam: v.voterTeam, targetId: v.targetId, kind: v.kind, day: v.day, atMs: v.castAtMs }))


  const records = recordS.docs
    .map((d) => d.data() as GameRecord)
    .filter((r) => inWindow(r.atMs))
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
  // 순위. **가진 방 개수다** — 개인 지갑은 팀 점수에 안 들어간다.
  // 그날 밤을 판정할 때는 그 시각의 주인으로 센다(점령 기록을 되짚는다)
  const tilesThen = opts.asOfMs === undefined
    ? tiles
    : tiles.map((t) => ({ tileId: t.tileId, ownerTeam: ownerAt(ownerChanges, t.tileId, opts.asOfMs as number) }))
  const scores = TEAMS.map((team) => publicScore({ tiles: tilesThen, team }))
  const ranked = rankTeams(scores)
  // 안 가른 순위. 「우리 팀이 1위가 아니다」가 이쪽을 본다
  const teamTiedRank = Object.fromEntries(ranked.map((r) => [r.team, r.tiedRank])) as Record<TeamId, number>

  const ballots: BallotVote[] = ballotS.docs
    .map((d) => d.data() as BallotVote & { atMs: number })
    .filter((b) => inDays(b.day))
    .map((b) => ({ day: b.day, voterId: b.voterId, targetId: b.targetId, voterTeam: b.voterTeam, targetTeam: b.targetTeam }))

  /**
   * 끝에 누가 어떤 쪽지를 쥐고 있나. 찢긴 것은 heldBy 가 비어 있다.
   * **운영자가 놓은 쪽지(56장)만** — 손으로 쓴 빈 종이는 어떤 미션에도 안 센다
   */
  const slipsHeldAtEnd: Record<string, string[]> = {}
  for (const d of slipS.docs) {
    const row = d.data() as { heldBy: string | null; noteId?: string }
    if (!row.heldBy || !row.noteId) continue
    ;(slipsHeldAtEnd[row.heldBy] ??= []).push(d.id)
  }

  const ballotDayRows: BallotDay[] = ballotDayS.docs
    .map((d) => d.data() as { day: number; invisibleId: string | null; reason: string })
    .map((r) => ({ day: r.day, invisibleId: r.invisibleId ?? null, reason: r.reason }))
    .filter((r) => inDays(r.day))
    .sort((a, b) => a.day - b.day)

  const choices = new Map(choiceS.docs.map((d) => [d.id, d.data() as ChoiceDoc]))
  const closing = closingS.data() as
    | { together: Record<string, boolean>; mutual: Record<string, boolean>; chosenBy: Record<string, string | null> }
    | undefined


  const log: GameLog = {
    startedAtMs,
    nowMs,
    over: opts.over ?? true,
    teamOf,
    roster: roster.map((r) => r.playerId),
    intervals: ivS.docs.map((d) => d.data() as Interval),
    votes,
    ballots,
    ballotDays: ballotDayRows,
    records,
    ownerChanges,
    teamTiedRank,
    slipsHeldAtEnd,
    // 종례 때 굳힌 것이 있으면 그것, 아니면 지금 고른 것
    chosenBy: closing?.chosenBy ?? Object.fromEntries([...choices].map(([id, c]) => [id, c.chosenId ?? null])),
    choiceMet: {},
    // 마지막 선택은 판정이 직접 셈한다(judge.choiceMetOf)
    day4Choice: Object.fromEntries([...choices].map(([id, c]) => [id, c.day4 ?? null])),
  }

  return { log, roster, seats: game.seats, ranked: ranked.map((r) => ({ team: r.team, rank: r.rank, total: r.total })), choices }
}

/**
 * 엔딩 — **운영자가 적지 않는다.** 버튼 하나(엔딩 송출하기)가 전부다.
 *
 * 한때 열 장면이었고, 그다음엔 운영자가 사람마다 쓰는 한 편이었다.
 * 이제는 A의 마지막 쪽지 한 장을 전원에게 같은 순간 튼다 — 문장은
 * 고정이고(story/finalNote.ts, **서버 전용**), 화면은 재생 직전에
 * finalNoteText 로 받아 온다. 여기서는 「언제 눌렀는가」와 「누가
 * 봤는가」만 쥔다.
 *
 * **송출은 판 문서에 한 줄 적는 것뿐이다.** endingBroadcast 는 열넷
 * 전원이 이미 구독하는 자리라, 여기 적는 순간 다들 지금 보던 화면
 * 위로 그대로 뜬다 — 새 구독을 만들 필요가 없다.
 */
const endingSeenOf = (gameId: string) => gameRef(gameId).collection('secret').doc('endingSeen').collection('items')

/** 게임이 끝났는가. 그 전에는 송출도, 봤다는 기록도 안 받는다. */
async function requireFinished(gameId: string): Promise<GameDoc> {
  const snap = await gameRef(gameId).get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  const game = snap.data() as GameDoc
  if (game.phase !== 'finished') throw new HttpsError('failed-precondition', '아직 판이 안 끝났다.')
  return game
}

/**
 * A의 마지막 쪽지 문장. **종례가 끝난 뒤에만** — 그 전에는 스포일러다.
 *
 * 화면(FinalNoteScene.tsx)이 재생 직전에 부른다. 판이 안 끝났으면
 * 거절한다 — 엔딩 탭도, 오버레이도 끝나기 전에는 열리지 않는다.
 */
export const finalNoteText = onCall<{ gameId: string }>(async (req) => {
  requireUid(req.auth)
  await requireFinished(req.data.gameId)
  return { lines: FINAL_NOTE_LINES }
})

/**
 * 엔딩을 송출한다. **운영자만.**
 *
 * mode 'all' — 이미 본 사람도 포함해 전원에게 다시 튼다. atMs 를
 * 지금 시각으로 올린다.
 * mode 'unseen' — 아직 못 본 사람에게만 간다. 처음 송출이면 'all'과
 * 같다. 이미 한 번 보낸 뒤라면 atMs 는 그대로 두고 pingMs 만 울려서,
 * 이미 본 사람은 그대로 두고 접속 중인데 못 본 사람만 다시 뜨게 한다.
 */
export const hostBroadcastEnding = onCall<{ gameId: string; mode: 'all' | 'unseen' }>(async (req) => {
  requireHost(req.auth)
  const { gameId } = req.data
  const mode = req.data.mode === 'unseen' ? 'unseen' : 'all'
  const game = await requireFinished(gameId)
  const nowMs = Date.now()
  const bumpAtMs = mode === 'all' || !game.endingBroadcast
  const atMs = bumpAtMs ? nowMs : game.endingBroadcast!.atMs
  const broadcast = { atMs, pingMs: nowMs }
  await gameRef(gameId).update({ endingBroadcast: broadcast })
  await gameRef(gameId).collection('events').add({
    atMs: nowMs,
    day: game.day,
    kind: 'endingBroadcast',
    detail: { mode, atMs },
  })
  return broadcast
})

/**
 * 지금 송출 상태. **운영자만.** 본 인원을 판마다 실시간으로 보려고
 * 관리자 화면이 이걸 되풀이해 부른다(따로 구독을 열지 않는다).
 */
export const hostEndingStatus = onCall<{ gameId: string }>(async (req) => {
  requireHost(req.auth)
  const { gameId } = req.data
  const game = await (async () => {
    const snap = await gameRef(gameId).get()
    if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
    return snap.data() as GameDoc
  })()
  const broadcast = game.endingBroadcast ?? null
  const seenS = await endingSeenOf(gameId).get()
  const seenCount = broadcast
    ? seenS.docs.filter((d) => ((d.data() as { seenAtMs: number }).seenAtMs) >= broadcast.atMs).length
    : 0
  return { broadcast, seenCount, total: game.seats.length, finished: game.phase === 'finished' }
})

/** 봤다고 적는다. 플레이어 본인만 — 화면이 재생을 끝내는 순간 부른다. */
export const markEndingSeen = onCall<{ gameId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  await endingSeenOf(gameId).doc(uid).set({ seenAtMs: Date.now() })
  await refreshViews(gameId)
  return { ok: true }
})
