// views를 다시 만들어 쓴다.
//
// 무엇을 담을지는 shared/rules/views.ts가 정한다. 여기서는 세상을
// 긁어모아 넘기고 결과를 받아 적을 뿐이다. 판단을 여기서 하면 시험할
// 수 없는 자리에 누출 방지 규칙이 놓인다.
//
// 상태가 바뀐 뒤에는 언제나 이걸 부른다. 안 부르면 화면이 어제 것을
// 본다 — 틀린 안개는 새는 안개다.
import { getFirestore } from 'firebase-admin/firestore'

import { projectAll, type World, type WorldPawn } from '../../shared/rules/views'
import { tradeEpoch } from '../../shared/rules/diplomacy'
import type { TileId } from '../../shared/rules/board'
import type {
  CardDoc,
  GameDoc,
  GoalDoc,
  NoticeDoc,
  PawnDoc,
  RosterDoc,
  TileDoc,
} from '../../shared/model'
import { releasedDays } from '../../shared/reveal/release'
import { fillSubject } from '../../shared/reveal/slips'
import { rawLine } from './story/slips'
import type { SlipDoc } from './slips'
import type { QuizDoc, QuizPaperDoc } from './quiz'
import { gameRef, nowOf } from './index'

const db = getFirestore()

/** 아침 시퀀스를 어디까지 봤는가. secret에 둔다 — 남이 알 일이 아니다. */
export interface ProgressDoc {
  playerId: string
  handledDays: number[]
  readDays: number[]
}

/** 털어놓기 한 번. 들은 사람까지 서버만 쥔다. */
export interface ConfessionDoc {
  id: string
  speakerId: string
  scope: 'class' | 'private'
  listenerIds: string[]
  text: string
  atMs: number
}

/** 먼저 가져간 팀만 아는 A의 기억. */
export interface MemoryDoc {
  tileId: TileId
  team: 'A' | 'B' | 'C' | 'D'
  atMs: number
}

const sub = (gameId: string, name: string) => gameRef(gameId).collection(name)
const secret = (gameId: string, name: string) =>
  gameRef(gameId).collection('secret').doc(name).collection('items')

/** Firestore에서 세상을 긁어모은다. */
export async function loadWorld(gameId: string, game: GameDoc): Promise<World> {
  const nowMs = nowOf(game)
  const [hiddenPhase, pawns, teams, tiles, robots, roster, hands, goals, peeks, trades, proposals, choices, progress, confessions, memories, slips, ballots, quizBank, quizFloor, awakened, notices] =
    await Promise.all([
      gameRef(gameId).collection('secret').doc('phase').get(),
      sub(gameId, 'pawns').get(),
      sub(gameId, 'teams').get(),
      sub(gameId, 'tiles').get(),
      sub(gameId, 'robots').get(),
      secret(gameId, 'roster').get(),
      secret(gameId, 'hands').get(),
      secret(gameId, 'goals').get(),
      secret(gameId, 'peeks').get(),
      secret(gameId, 'trades').get(),
      secret(gameId, 'alliances').get(),
      secret(gameId, 'choices').get(),
      secret(gameId, 'progress').get(),
      secret(gameId, 'confessions').get(),
      secret(gameId, 'memories').get(),
      secret(gameId, 'slips').get(),
      gameRef(gameId).collection('secret').doc('ballots').collection('items').get(),
      gameRef(gameId).collection('secret').doc('quiz').collection('bank').get(),
      gameRef(gameId).collection('secret').doc('quiz').collection('floor').get(),
      secret(gameId, 'awakened').get(),
      sub(gameId, 'notices').get(),
    ])

  const rosterRows = roster.docs.map((d) => d.data() as RosterDoc)

  const worldPawns: WorldPawn[] = pawns.docs.map((d) => {
    const p = d.data() as PawnDoc
    return {
      playerId: p.playerId,
      team: p.team,
      tileId: p.tileId,
      // 걷는 중이면 경로의 **앞 한 칸만** 담는다. 경로의 끝이 목적지라
      // 통째로 넘기면 안개가 있으나 마나다
      fromTile: p.tileId === null ? p.fromTile : null,
      toTile: p.tileId === null ? (p.path[0] ?? null) : null,
      asleep: p.asleep,
      hiddenUntilMs: p.hiddenUntilMs ?? null,
      intelOfficer: p.title === 'intelOfficer',
      // 투영이 본인 몫에만 싣는다. 여기서는 그냥 들고만 간다
      arriveAtMs: p.arriveAtMs ?? null,
      postTile: p.postTile ?? null,
      visitedTiles: p.visitedTiles ?? [],
      dealTokens: p.dealTokens ?? 0,
    }
  })

  return {
    nowMs,
    over: game.phase === 'finished',
    // 금고. 투영이 내 팀 것만 떼어 보낸다 — 여기서는 통째로 들고만 간다
    vaults: Object.fromEntries(
      teams.docs.map((d) => {
        const t = d.data() as { resources?: { money?: number; knowledge?: number } }
        return [d.id, { money: t.resources?.money ?? 0, knowledge: t.resources?.knowledge ?? 0 }]
      }),
    ),
    // 주머니도 통째로 들고 간다. 투영이 내 팀 것만 떼어 보낸다
    satchels: Object.fromEntries(
      teams.docs.map((d) => [d.id, (d.data() as { items?: Record<string, number> }).items ?? {}]),
    ),
    // 페이즈 토큰 상자도 마찬가지다. 남의 상자는 투영에서 걸러진다
    wallets: Object.fromEntries(
      teams.docs.map((d) => [d.id, (d.data() as { phaseTokens?: number }).phaseTokens ?? 0]),
    ),
    invisibleId: game.invisibleId ?? null,
    pawns: worldPawns,
    // 위장은 secret 에만 있다. 판 문서는 누구나 읽을 수 있어서, 거기
    // 적으면 누가 위장했는지 개발자도구로 다 보인다 — 실제로 그랬다.
    // 페이즈가 닫히면 서버가 지우므로 여기서 기한을 따질 것이 없다
    disguised: ((hiddenPhase.data() as { disguised?: string[] } | undefined)?.disguised ?? []),
    smashedBy: ((hiddenPhase.data() as { smashedBy?: string[] } | undefined)?.smashedBy ?? []),
    // 오늘 적은 표. **투영이 본인 것만 떼어 보낸다** — 여기까지는
    // 서버 안이라 전부 들고 있어도 된다
    myBallots: Object.fromEntries(
      ballots.docs
        .map((d) => d.data() as { day: number; voterId: string; targetId: string })
        .filter((b) => b.day === (game.phaseNow?.day ?? game.day))
        .map((b) => [b.voterId, b.targetId]),
    ),
    robots: robots.docs.map((d) => {
      const r = d.data() as { team: WorldPawn['team']; tileId: TileId; carriedBy: string | null }
      return { id: d.id, team: r.team, tileId: r.tileId, carriedBy: r.carriedBy ?? null }
    }),
    tiles: tiles.docs.map((d) => {
      const t = d.data() as TileDoc
      return { tileId: d.id as TileId, ownerTeam: t.ownerTeam }
    }),
    roster: rosterRows.map((r) => ({ playerId: r.playerId, team: r.team, roleId: r.roleId, bondId: r.bondId })),
    hands: hands.docs.map((d) => {
      const c = d.data() as CardDoc & { team: 'A' | 'B' | 'C' | 'D' }
      return { id: d.id, team: c.team, kind: c.kind, ...(c.targetTeam ? { targetTeam: c.targetTeam } : {}) }
    }),
    goals: goals.docs.map((d) => {
      const g = d.data() as GoalDoc & { team: 'A' | 'B' | 'C' | 'D' }
      return { id: d.id, team: g.team, kind: g.kind, ...(g.rivalTeam ? { rivalTeam: g.rivalTeam } : {}), revealed: g.revealed }
    }),
    peeks: peeks.docs.map((d) => d.data() as { playerId: string; voteKind: 'trust' | 'liking'; voterNickname: string }),
    // 지금의 범위. 투영이 페이즈 경계를 넘은 말을 이걸로 가른다
    tradeEpoch: tradeEpoch(game),
    trades: trades.docs
      .filter((d) => (d.data() as { status: string }).status === 'open')
      .map((d) => ({ id: d.id, ...(d.data() as Omit<World['trades'][number], 'id'>) })),
    proposals: proposals.docs
      .filter((d) => (d.data() as { status: string }).status === 'open')
      .map((d) => ({ id: d.id, ...(d.data() as Omit<World['proposals'][number], 'id'>) })),
    choices: choices.docs.map((d) => {
      const c = d.data() as { chosenId: string | null; day4: string | null }
      return { playerId: d.id, chosenId: c.chosenId ?? null, day4: c.day4 ?? null }
    }),
    releasedDays: releasedDays(game.startedAtMs ?? null, nowMs),
    progress: progress.docs.map((d) => {
      const p = d.data() as ProgressDoc
      return { playerId: p.playerId ?? d.id, handledDays: p.handledDays ?? [], readDays: p.readDays ?? [] }
    }),
    confessions: confessions.docs.map((d) => ({ ...(d.data() as ConfessionDoc), id: d.id })),
    // 쪽지는 서버가 이름까지 끼워 넣어 들고 온다. **문장 표는 여기까지만
    // 온다** — shared 에 두면 번들에 실려 열넷이 통째로 읽힌다
    slips: slips.docs.map((d) => {
      const s2 = d.data() as SlipDoc
      const who = game.seats.find((x) => x.playerId === s2.subjectId)?.name ?? null
      return {
        id: d.id,
        subjectId: s2.subjectId,
        line: fillSubject(rawLine(s2.textId), who),
        tileId: s2.tileId ?? null,
        heldBy: s2.heldBy ?? null,
        readBy: s2.readBy ?? [],
      }
    }),
    // 문제 종이. **정답과 해설은 아예 안 싣는다.**
    //
    // 문제와 보기는 싣는다 — 펼친 종이는 그 방 사람 전원에게 가야 해서
    // 투영이 쥐고 있어야 한다. 그러나 정답과 해설은 투영조차 볼 일이
    // 없으므로 여기서 끊는다. 안 실으면 실수로도 못 샌다
    quizzes: quizFloor.docs.map((d) => {
      const paper = d.data() as QuizPaperDoc
      const quiz = quizBank.docs.find((b) => b.id === paper.quizId)?.data() as QuizDoc | undefined
      return {
        id: d.id,
        tileId: paper.tileId,
        kind: quiz?.kind ?? 'short',
        prompt: quiz?.prompt ?? null,
        choices: quiz?.choices ?? [],
        openedBy: paper.openedBy ?? null,
        solvedTeam: (paper.solvedTeam ?? null) as 'A' | 'B' | 'C' | 'D' | null,
        wrongBy: paper.wrongBy ?? [],
      }
    }),
    memories: memories.docs.map((d) => d.data() as MemoryDoc),
    awakenedAtMs: Object.fromEntries(awakened.docs.map((d) => [d.id, (d.data() as { atMs: number }).atMs])),
    notices: notices.docs.map((d) => {
      const n = d.data() as NoticeDoc
      return { id: d.id, toPlayerId: n.toPlayerId, text: n.text, atMs: n.atMs }
    }),
  }
}

/**
 * 열넷 몫을 한 번에 다시 쓴다.
 *
 * 사람마다 따로 계산하지만 쓰기는 한 묶음이다 — 절반만 새 것이면
 * 같은 순간을 두 사람이 다르게 본다.
 */
export async function refreshViews(gameId: string): Promise<number> {
  const snap = await gameRef(gameId).get()
  if (!snap.exists) return 0
  const game = snap.data() as GameDoc
  if (game.phase === 'lobby') return 0

  const world = await loadWorld(gameId, game)
  const views = projectAll(world)

  const batch = db.batch()
  for (const [playerId, view] of Object.entries(views)) {
    batch.set(gameRef(gameId).collection('views').doc(playerId), view)
  }
  await batch.commit()
  return Object.keys(views).length
}
