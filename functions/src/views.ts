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
import type { TileId } from '../../shared/rules/board'
import type {
  CardDoc,
  CommutePlanDoc,
  FlagTruthDoc,
  GameDoc,
  GoalDoc,
  NoticeDoc,
  PawnDoc,
  RosterDoc,
  TileDoc,
} from '../../shared/model'
import { releasedDays } from '../../shared/reveal/release'
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
  const [pawns, tiles, roster, hands, goals, plans, flagTruth, peeks, progress, confessions, memories, awakened, notices] =
    await Promise.all([
      sub(gameId, 'pawns').get(),
      sub(gameId, 'tiles').get(),
      secret(gameId, 'roster').get(),
      secret(gameId, 'hands').get(),
      secret(gameId, 'goals').get(),
      secret(gameId, 'plans').get(),
      secret(gameId, 'flagTruth').get(),
      secret(gameId, 'peeks').get(),
      secret(gameId, 'progress').get(),
      secret(gameId, 'confessions').get(),
      secret(gameId, 'memories').get(),
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
      // 걷는 중이면 경로의 앞이 다음 칸이다. 목적지는 담지 않는다
      fromTile: p.tileId === null ? ((p as PawnDoc & { fromTile?: TileId }).fromTile ?? null) : null,
      toTile: p.tileId === null ? (p.path[0] ?? null) : null,
      asleep: p.asleep,
      hiddenUntilMs: p.hiddenUntilMs ?? null,
      intelOfficer: p.title === 'intelOfficer',
    }
  })

  return {
    nowMs,
    over: game.phase === 'finished',
    pawns: worldPawns,
    tiles: tiles.docs.map((d) => {
      const t = d.data() as TileDoc
      return { tileId: d.id as TileId, ownerTeam: t.ownerTeam, buildings: t.buildings ?? [] }
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
    plans: plans.docs.map((d) => {
      const p = d.data() as CommutePlanDoc & { playerId: string }
      return { playerId: p.playerId ?? d.id, path: p.path, plantFlag: p.plantFlag }
    }),
    flagTruth: flagTruth.docs.map((d) => {
      const f = d.data() as FlagTruthDoc & { team: 'A' | 'B' | 'C' | 'D'; fake: boolean }
      return { tileId: d.id as TileId, team: f.team, fake: f.fake }
    }),
    peeks: peeks.docs.map((d) => d.data() as { playerId: string; voteKind: 'trust' | 'suspicion'; voterNickname: string }),
    releasedDays: releasedDays(game.startedAtMs ?? null, nowMs),
    progress: progress.docs.map((d) => {
      const p = d.data() as ProgressDoc
      return { playerId: p.playerId ?? d.id, handledDays: p.handledDays ?? [], readDays: p.readDays ?? [] }
    }),
    confessions: confessions.docs.map((d) => ({ ...(d.data() as ConfessionDoc), id: d.id })),
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
