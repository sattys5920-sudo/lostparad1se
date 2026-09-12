// 엔딩 데이터를 모은다. **종례가 끝난 뒤에만.**
//
// 닷새 동안 흩어져 있던 기록을 GameLog 하나로 모아 judge를 돌린다.
// 판정 규칙은 shared/missions/judge.ts에 있고 여기서는 재료만 모은다.
//
// 문장은 전부 서버 전용 데이터에서 온다. 끝나기 전에는 이 엔드포인트가
// 아무것도 내려보내지 않는다 — A의 시선 열넷이 한 줄이라도 먼저 나가면
// 닷새가 무너진다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'

import { judge, type FlagRecord, type GameLog, type JudgeVote, type RevealRecord, type ScoutRecord, type TradeRecord } from '../../shared/missions/judge'
import { day4Met, type Day4Choice } from '../../shared/rules/choices'
import { publicScore, rankTeams, type TeamState } from '../../shared/rules/score'
import { snowStopped } from '../../shared/rules/snow'
import { skippedScenes } from '../../shared/reveal/ending'
import { boardResult, scoreBoard, type DeductionNote } from '../../shared/reveal/notes'
import { MEMORY_TILES } from '../../shared/rules/memory'
import { TEAMS } from '../../shared/rules/lobby'
import { dayNumber } from '../../shared/rules/clock'
import { TILE_BY_ID, type TileId } from '../../shared/rules/board'
import { ROLE_NAMES, type RoleId } from '../../shared/missions/roleNames'
import type { Interval } from '../../shared/rules/presence'
import type { TeamId } from '../../shared/rules/v2'
import type { EventDoc, GameDoc, RosterDoc, TeamDoc, TileDoc, VoteDoc } from '../../shared/model'

import { AFTERMATH, AFTERMATH_CLOSING } from './story/aftermath'
import { COMMON_ENDING, MIRROR } from './story/mirror'
import { SIGHTS } from './story/sights'
import { TORN_LINES, tornIntro } from './story/torn'
import { gameRef, nowOf, requireUid } from './index'
import type { ChoiceDoc } from './choice'

const secret = (gameId: string, name: string) =>
  gameRef(gameId).collection('secret').doc(name).collection('items')

/**
 * 추리 노트를 쓸 수 있는 모양으로 고친다.
 *
 * notes/{playerId}는 규칙이 클라이언트에게 직접 쓰기를 열어 준
 * 유일한 문서다(판정에 쓰이지 않는 개인 메모라 서버를 거칠 이유가
 * 없다). 대신 읽는 쪽이 모양을 믿으면 안 된다 — 칸 하나가 빠진 문서
 * 하나로 엔딩 전체가 터진다.
 */
function normalizeNote(ownerId: string, raw: unknown): DeductionNote {
  const o = (raw ?? {}) as Partial<DeductionNote>
  const rows = Array.isArray(o.board) ? o.board : []
  const hist = Array.isArray(o.history) ? o.history : []
  return {
    ownerId,
    entryNotes: typeof o.entryNotes === 'object' && o.entryNotes !== null ? o.entryNotes : {},
    board: rows
      .filter((t) => t && typeof t.targetId === 'string')
      .map((t) => ({
        targetId: t.targetId,
        guess: t.guess ?? 'unknown',
        note: typeof t.note === 'string' ? t.note : '',
        updatedAtMs: Number(t.updatedAtMs) || 0,
      })),
    history: hist
      .filter((h) => h && typeof h.targetId === 'string')
      .map((h) => ({
        targetId: h.targetId,
        from: h.from ?? 'unknown',
        to: h.to ?? 'unknown',
        atMs: Number(h.atMs) || 0,
      })),
  }
}

/** 닷새치 기록을 GameLog 하나로. */
async function buildLog(gameId: string, game: GameDoc): Promise<{
  log: GameLog
  roster: RosterDoc[]
  seats: GameDoc['seats']
  ranked: { team: TeamId; rank: number; total: number }[]
  choices: Map<string, ChoiceDoc>
}> {
  const ref = gameRef(gameId)
  const nowMs = nowOf(game)
  const startedAtMs = game.startedAtMs ?? nowMs

  const [rosterS, ivS, voteS, evS, scoutS, tileS, teamS, awakeS, choiceS, closingS] = await Promise.all([
    secret(gameId, 'roster').get(),
    secret(gameId, 'intervals').get(),
    secret(gameId, 'votes').get(),
    ref.collection('events').get(),
    secret(gameId, 'scouts').get(),
    ref.collection('tiles').get(),
    ref.collection('teams').get(),
    secret(gameId, 'awakened').get(),
    secret(gameId, 'choices').get(),
    ref.collection('secret').doc('closing').get(),
  ])

  const roster = rosterS.docs.map((d) => d.data() as RosterDoc)
  const teamOfMap = new Map(roster.map((r) => [r.playerId, r.team]))
  const teamOf = (playerId: string): TeamId => teamOfMap.get(playerId) ?? 'A'

  const tiles = tileS.docs.map((d) => {
    const t = d.data() as TileDoc
    return { tileId: d.id as TileId, ownerTeam: t.ownerTeam, buildings: t.buildings ?? [] }
  })
  const ownerAt = new Map(tiles.map((t) => [t.tileId, t.ownerTeam]))
  const teamDocs = new Map(teamS.docs.map((d) => [d.id as TeamId, d.data() as TeamDoc]))

  const events = evS.docs.map((d) => d.data() as EventDoc)
  const flags: FlagRecord[] = events
    .filter((e) => e.kind === 'flagSucceeded' || e.kind === 'flagFailed')
    .map((e) => ({
      tileId: e.tileId as TileId,
      team: e.team as TeamId,
      planterId: e.playerId as string,
      target: (e.detail?.target as FlagRecord['target']) ?? 'empty',
      success: e.kind === 'flagSucceeded',
      ownerBefore: (e.detail?.ownerBefore as TeamId | null) ?? null,
      standing: (e.detail?.standing as string[]) ?? [],
      atMs: e.atMs,
    }))
  const trades: TradeRecord[] = events
    .filter((e) => e.kind === 'tradeAccepted')
    .map((e) => ({ fromTeam: e.detail?.fromTeam as TeamId, toTeam: e.team as TeamId, atMs: e.atMs }))
  const lostTile = new Set(events.filter((e) => e.kind === 'tileLost').map((e) => e.team as TeamId))

  const votes: JudgeVote[] = voteS.docs.map((d) => {
    const v = d.data() as VoteDoc
    return { voterId: v.voterId, targetId: v.targetId, kind: v.kind, day: v.day, exactHit: v.exactHit, atMs: v.castAtMs }
  })
  const reveals: RevealRecord[] = roster
    .filter((r) => r.reveal)
    .map((r) => ({
      speakerId: r.playerId,
      scope: r.reveal!.scope,
      listenerIds: r.reveal!.listenerIds,
      day: dayNumber(startedAtMs, r.reveal!.atMs),
      atMs: r.reveal!.atMs,
    }))
  const scouts: ScoutRecord[] = scoutS.docs.map((d) => {
    const s = d.data() as { tileId: TileId; day: number; team: TeamId }
    return { playerId: '', tileId: s.tileId, atMs: startedAtMs }
  })

  // 최종 순위. 비밀 목표는 아직 안 넣는다 — 공개 점수로 낸다
  const scores = TEAMS.map((team) => {
    const doc = teamDocs.get(team) as TeamDoc
    const state: TeamState = {
      team,
      resources: doc.resources,
      researchTier: doc.researchTier,
      allyTeam: doc.allyTeam,
      goals: [],
      lostTile: lostTile.has(team),
      raidSuccesses: flags.filter((f) => f.team === team && f.success && f.ownerBefore !== null).length,
      brokeAlliance: events.some((e) => e.kind === 'allianceBroken' && e.team === team),
      trustFrom: [],
      revealed: roster.some((r) => r.team === team && r.reveal),
    }
    return publicScore({ tiles, fragments: [], team: state })
  })
  const ranked = rankTeams(scores, (team) => teamDocs.get(team)?.resources.influence ?? 0)
  const teamRank = Object.fromEntries(ranked.map((r) => [r.team, r.rank])) as Record<TeamId, number>

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
    over: true,
    teamOf,
    intervals: ivS.docs.map((d) => d.data() as Interval),
    votes,
    reveals,
    leverageUses: [],
    flags,
    trades,
    scouts,
    fragmentTiles: game.boostedTiles as TileId[],
    ownerAtEnd: (id) => ownerAt.get(id) ?? null,
    teamRank,
    allianceAtEnd: Object.fromEntries(TEAMS.map((t) => [t, teamDocs.get(t)?.allyTeam ?? null])) as Record<TeamId, TeamId | null>,
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
 * 엔딩 한 사람 몫.
 *
 * **끝나기 전에는 아무것도 내려보내지 않는다.** A의 시선 열넷이 한 줄이라도
 * 먼저 나가면 닷새가 무너진다.
 */
export const endingData = onCall<{ gameId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const snap = await gameRef(gameId).get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  const game = snap.data() as GameDoc
  if (game.phase !== 'finished') throw new HttpsError('failed-precondition', '아직 종례가 끝나지 않았다.')

  const { log, roster, seats, ranked, choices } = await buildLog(gameId, game)
  const me = roster.find((r) => r.playerId === uid)
  if (!me) throw new HttpsError('permission-denied', '이 판에 없는 사람이다.')

  // 한 번 돌려 주·인연 미션 결과를 얻고, 그걸로 DAY 4 선택을 판정한 뒤
  // 다시 돌린다. judge는 순수 함수라 두 번 돌려도 같은 값이다
  const first = new Map(
    roster.map((r) => [r.playerId, judge({ playerId: r.playerId, team: r.team, roleId: r.roleId as RoleId, bondId: r.bondId }, log)]),
  )
  log.choiceMet = Object.fromEntries(
    roster.map((r) => {
      const f = first.get(r.playerId)
      return [
        r.playerId,
        day4Met({
          choice: (choices.get(r.playerId)?.day4 ?? null) as Day4Choice | null,
          teamRank: log.teamRank[r.team],
          mainMet: f?.main.met === true,
          bondMet: f?.bond.met === true,
        }),
      ]
    }),
  )
  const mine = judge({ playerId: me.playerId, team: me.team, roleId: me.roleId as RoleId, bondId: me.bondId }, log)

  const nameOf = (id: string) => seats.find((s) => s.playerId === id)?.name ?? id

  // 내 추리 보드. **내 노트만** 읽는다.
  //
  // notes/는 클라이언트가 **직접 쓰는 유일한 문서다.** 그래서 모양을
  // 믿지 않는다 — 칸이 빠진 채로 올라와도 서버가 터지면 안 된다.
  const noteSnap = await gameRef(gameId).collection('notes').doc(uid).get()
  const note = normalizeNote(uid, noteSnap.data())
  const roleMap = new Map(roster.map((r) => [r.playerId, r.roleId as RoleId]))
  const actualOf = (id: string): RoleId => roleMap.get(id) ?? 'mediator'
  const everyone = roster.map((r) => r.playerId)
  const scored = scoreBoard(note, actualOf, log.startedAtMs)
  const board = boardResult(note, actualOf, log.startedAtMs, everyone)

  const hadInvisible = Object.values(game.invisibleByDay).some((v) => v !== null)

  return {
    hadInvisible,
    skipped: skippedScenes({ hadInvisible }),
    people: seats.map((s) => ({ playerId: s.playerId, name: s.name, team: s.team })),
    teamResult: ranked,
    personal: {
      band: mine.band.name,
      bandLine: mine.band.line,
      score: mine.score,
      // 세 줄 — 주 미션 · 인연 미션 · 엔딩 구간. 「후회·반성·깨달음」
      // 42문장은 아직 [작성 예정]이라 미션 문장을 그대로 보인다
      lines: [mine.main.text, mine.bond.text, mine.band.line],
      mainMet: mine.main.met,
      bondMet: mine.bond.met,
    },
    // 그날의 전말 — 열네 명이 한 일이 시간순으로
    aftermath: AFTERMATH.map((row) => ({
      when: row.when,
      what: row.what,
      who: row.who.map((r) => ROLE_NAMES[r]),
      names: row.who.map((r) => {
        const found = roster.find((x) => x.roleId === r)
        return found ? nameOf(found.playerId) : ROLE_NAMES[r]
      }),
    })),
    aftermathClosing: AFTERMATH_CLOSING,
    mirror: MIRROR,
    // 지워진 동안 「…」로만 보였던 말. 채팅이 붙으면 채워진다
    unheard: [],
    // A의 시선 열넷. 끝났으니 전원이 다 본다
    aWords: SIGHTS.map((s) => {
      const who = roster.find((r) => r.roleId === s.role)
      return { name: who ? nameOf(who.playerId) : ROLE_NAMES[s.role], text: s.text }
    }),
    // 찢긴 한 장. 도서부가 털어놓았는지로 소개가 갈린다
    torn: {
      intro: tornIntro(roster.some((r) => r.roleId === 'librarian' && r.reveal !== null)),
      lines: TORN_LINES,
    },
    commonEnding: {
      ...(log.snowStopped ? COMMON_ENDING.snowStopped : COMMON_ENDING.snowKept),
      chalk: log.snowStopped ? '이제 보여?' : '다음 주에도.',
    },
    myBoard: scored.map((row) => ({
      name: nameOf(row.targetId),
      guess: row.guess === 'unknown' ? '모름' : ROLE_NAMES[row.guess as RoleId],
      actual: ROLE_NAMES[row.actual],
      correct: row.correct,
      firstDay: row.firstCorrectDay,
    })),
    boardResult: board,
    // 기억 열셋이 전원에게 열렸다
    memoryTiles: MEMORY_TILES.map((id) => ({ tileId: id, name: TILE_BY_ID[id].name })),
  }
})
