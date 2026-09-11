// 따라잡기 — 밀린 일을 시각순으로 민다.
//
// 모든 엔드포인트가 일을 하기 전에 이걸 부른다. 상시 켜진 서버가
// 없으므로, 밀린 정산과 아침이 다음 요청에 함께 처리된다.
//
// 한 건씩 트랜잭션으로 민다. 도중에 끊겨도 민 것까지만 doneAtMs가
// 찍히고, 다음 요청이 나머지를 이어서 민다. **두 번 밀려도 같은
// 결과여야 한다** — 그래서 효과를 적는 것과 doneAtMs를 찍는 것이 한
// 트랜잭션 안에 있다.
import { getFirestore, type Transaction } from 'firebase-admin/firestore'

import { dueItems, type Due } from '../../shared/rules/catchup'
import { accrueTokens, markComeback } from '../../shared/rules/tokens'
import { dailyProduction, type TileState } from '../../shared/rules/buildings'
import { publicScore, type TeamState } from '../../shared/rules/score'
import { settleDay } from '../../shared/rules/settlement'
import { TEAMS } from '../../shared/rules/lobby'
import { CORE_OPENING, type Resource, type TeamId } from '../../shared/rules/v2'
import type { TileId } from '../../shared/rules/board'
import type { Fragment } from '../../shared/rules/fragments'
import { FRAGMENT_BY_DAY } from './story/fragments'
import type {
  GameDoc,
  ScheduleDoc,
  TeamDoc,
  TileDoc,
  TokenStateDoc,
} from '../../shared/model'
import { gameRef } from './index'
import { refreshViews } from './views'

const db = getFirestore()

/** 하루가 열리면 가치가 오르는 칸. 그날까지 나온 기록 전부다. */
function fragmentsUpTo(day: number): Fragment[] {
  const out: Fragment[] = []
  for (let d = 1; d <= day; d++) {
    const f = FRAGMENT_BY_DAY[d]
    if (f) out.push({ day: f.day, spotTile: f.spotTile as TileId })
  }
  return out
}

// ── 일 하나씩 ───────────────────────────────────────────────────

interface Ctx {
  tx: Transaction
  gameId: string
  game: GameDoc
  atMs: number
  day: number
}

/**
 * 아침 08:00.
 *
 * 날이 바뀌고, 오늘 열리는 핵심 칸이 열리고, 사람마다 쓴 토큰과 표가
 * 0으로 돌아간다. 3인 팀 주장도 돌아간다 — 하루씩 번갈아 맡는다.
 */
async function dayStart(c: Ctx): Promise<void> {
  const ref = gameRef(c.gameId)
  const opens = (CORE_OPENING[c.day] ?? []) as TileId[]
  const openedTiles = [...new Set([...c.game.openedTiles, ...opens])]
  const boostedTiles = fragmentsUpTo(c.day).map((f) => f.spotTile)

  const pawns = await c.tx.get(ref.collection('pawns'))
  for (const p of pawns.docs) {
    c.tx.update(p.ref, { tokensUsedToday: 0, votedToday: false, peeksToday: 0 })
  }

  // 3인 팀 주장은 날마다 돈다
  for (const team of TEAMS) {
    const members = c.game.seats.filter((s) => s.team === team)
    if (members.length >= 4) continue
    const next = members[(c.day - 1) % members.length].playerId
    c.tx.update(ref.collection('teams').doc(team), { captainId: next })
  }

  c.tx.update(ref, { day: c.day, openedTiles, boostedTiles })
  c.tx.set(ref.collection('events').doc(), {
    atMs: c.atMs,
    day: c.day,
    kind: 'dayStart',
    detail: { opened: opens },
  })
}

/** DAY 5 15:00 — 점수판이 꺼진다. 마지막 여섯 시간은 아무도 순위를 모른다. */
async function lastHours(c: Ctx): Promise<void> {
  const ref = gameRef(c.gameId)
  for (const team of TEAMS) {
    c.tx.update(ref.collection('teams').doc(team), { publicScore: null })
  }
  c.tx.update(ref, { lastHours: true })
  c.tx.set(ref.collection('events').doc(), { atMs: c.atMs, day: c.day, kind: 'spotlight', detail: { lastHours: true } })
}

/**
 * 21:00 정산.
 *
 * 순서가 곧 규칙이다 — 생산 → 표 → 점수 → 주목·만회 → 내일의 투명인간.
 * 표는 5단계에서 붙는다. 그때까지는 빈 목록이 들어가고, 표가 없으면
 * 투명인간도 없다. 그것도 규칙대로의 결과다.
 */
async function settlement(c: Ctx): Promise<void> {
  const ref = gameRef(c.gameId)
  // 트랜잭션은 **읽기를 전부 끝낸 뒤에야** 쓸 수 있다. 그래서 나중에
  // 쓸 토큰 상자까지 여기서 미리 읽는다
  const [tileSnap, teamSnap, tokenSnap] = await Promise.all([
    c.tx.get(ref.collection('tiles')),
    c.tx.get(ref.collection('teams')),
    c.tx.get(ref.collection('secret').doc('tokens').collection('items')),
  ])

  const tiles: TileState[] = tileSnap.docs.map((d) => {
    const t = d.data() as TileDoc
    return { tileId: d.id as TileId, ownerTeam: t.ownerTeam, buildings: t.buildings ?? [] }
  })
  const teamDocs = new Map(teamSnap.docs.map((d) => [d.id as TeamId, d.data() as TeamDoc]))

  // 1. 건물 생산
  const after = new Map<TeamId, Record<Resource, number>>()
  for (const team of TEAMS) {
    const doc = teamDocs.get(team)
    if (!doc) continue
    const got = dailyProduction({ tiles, team })
    const res = { ...doc.resources }
    for (const [r, n] of Object.entries(got) as [Resource, number][]) res[r] += n
    after.set(team, res)
    c.tx.update(ref.collection('teams').doc(team), { resources: res })
  }

  // 2. 받은 표 → 영향력. 5단계에서 붙는다
  const votes: never[] = []

  // 3~4. 점수와 순위, 주목과 만회
  const fragments = fragmentsUpTo(c.day)
  const scores = TEAMS.map((team) => {
    const doc = teamDocs.get(team) as TeamDoc
    const state: TeamState = {
      team,
      resources: after.get(team) ?? doc.resources,
      researchTier: doc.researchTier,
      allyTeam: doc.allyTeam,
      goals: [],
      lostTile: false,
      raidSuccesses: 0,
      brokeAlliance: false,
      trustFrom: [],
      revealed: false,
    }
    return publicScore({ tiles, fragments, team: state })
  })

  const result = settleDay({
    scores,
    influenceOf: (team) => after.get(team)?.influence ?? 0,
    votes,
    yesterdayInvisibleId: null,
  })

  // 마지막 여섯 시간에는 점수를 알리지 않는다
  for (const r of result.ranked) {
    c.tx.update(ref.collection('teams').doc(r.team), {
      publicScore: c.game.lastHours ? null : r.total,
    })
  }

  // 5. 꼴찌는 다음 08:00에 토큰을 더 받는다
  const lastBox = tokenSnap.docs.find((d) => d.id === result.comeback)
  if (lastBox) c.tx.set(lastBox.ref, markComeback(lastBox.data() as TokenStateDoc))

  c.tx.update(ref, {
    spotlightTeams: [result.spotlighted],
    comebackTeams: [result.comeback],
  })
  c.tx.set(ref.collection('events').doc(), {
    atMs: c.atMs,
    day: c.day,
    kind: 'settlement',
    detail: {
      ranked: result.ranked.map((r) => ({ team: r.team, total: r.total })),
      spotlighted: result.spotlighted,
      comeback: result.comeback,
      // 표에 관해 공개되는 건 투명인간 하나뿐이다. 받은 수도 보낸 사람도 아니다
      invisibleId: result.invisible.playerId,
    },
  })
}

/** DAY 5 소등 — 판이 끝난다. */
async function gameEnd(c: Ctx): Promise<void> {
  const ref = gameRef(c.gameId)
  c.tx.update(ref, { phase: 'finished' })
  c.tx.set(ref.collection('events').doc(), { atMs: c.atMs, day: c.day, kind: 'gameEnd', detail: {} })
}

const HANDLERS: Partial<Record<ScheduleDoc['kind'], (c: Ctx) => Promise<void>>> = {
  dayStart,
  lastHours,
  settlement,
  gameEnd,
}

// ── 토큰 ────────────────────────────────────────────────────────

/**
 * 마지막 충전 시각부터 지금까지를 한 번에 따라잡는다.
 *
 * 예정 이벤트로 두지 않는 이유: accrueTokens가 이미 「그 사이의 충전을
 * 전부」 계산한다. 같은 일을 두 군데서 하면 언젠가 한 쪽이 틀린다.
 */
async function accrueAll(gameId: string, toMs: number): Promise<void> {
  const ref = gameRef(gameId)
  await db.runTransaction(async (tx) => {
    const items = ref.collection('secret').doc('tokens').collection('items')
    const snap = await tx.get(items)
    for (const d of snap.docs) {
      const { state, grants } = accrueTokens(d.data() as TokenStateDoc, toMs)
      if (grants.length === 0) continue
      tx.set(d.ref, state)
      tx.update(ref.collection('teams').doc(d.id), { tokens: state.tokens })
    }
  })
}

// ── 밀기 ────────────────────────────────────────────────────────

export interface CatchUpResult {
  applied: number
  day: number
  phase: GameDoc['phase']
}

/**
 * 밀린 일을 전부 민다.
 *
 * 예정 이벤트를 dueAtMs로만 물어 오고 doneAtMs는 여기서 거른다.
 * 두 칸 조건을 걸면 복합 색인이 필요해지는데, 닷새짜리 판에 예정
 * 이벤트가 스무 개 남짓이라 굳이 만들 값이 없다.
 */
export async function catchUp(gameId: string, toMs: number): Promise<CatchUpResult> {
  const ref = gameRef(gameId)
  const snap = await ref.get()
  if (!snap.exists) throw new Error('그런 판이 없다.')
  let game = snap.data() as GameDoc
  if (game.phase !== 'running') {
    return { applied: 0, day: game.day, phase: game.phase }
  }

  const pending = await ref.collection('schedule').where('dueAtMs', '<=', toMs).get()
  const due: Due[] = pending.docs.map((d) => {
    const s = d.data() as ScheduleDoc
    return { id: d.id, dueAtMs: s.dueAtMs, ord: s.ord, kind: s.kind, doneAtMs: s.doneAtMs }
  })

  let applied = 0
  for (const item of dueItems(due, toMs)) {
    const handler = HANDLERS[item.kind]
    const payload = pending.docs.find((d) => d.id === item.id)?.data() as ScheduleDoc
    await db.runTransaction(async (tx) => {
      // 트랜잭션 안에서 다시 읽는다 — 다른 요청이 먼저 밀었을 수 있다
      const itemRef = ref.collection('schedule').doc(item.id)
      const [fresh, gameFresh] = await Promise.all([tx.get(itemRef), tx.get(ref)])
      if (!fresh.exists || (fresh.data() as ScheduleDoc).doneAtMs !== null) return
      game = gameFresh.data() as GameDoc

      if (handler) {
        await handler({
          tx,
          gameId,
          game,
          atMs: item.dueAtMs,
          day: (payload.payload?.day as number) ?? game.day,
        })
      }
      tx.update(itemRef, { doneAtMs: item.dueAtMs })
    })
    applied += 1
  }

  // 토큰은 예정 이벤트가 아니라 한 번에 따라잡는다
  await accrueAll(gameId, toMs)
  await ref.update({ caughtUpToMs: toMs })

  // 세상이 바뀌었으면 각자 몫을 다시 깎는다. 틀린 안개는 새는 안개다
  if (applied > 0) await refreshViews(gameId)

  const last = (await ref.get()).data() as GameDoc
  return { applied, day: last.day, phase: last.phase }
}
