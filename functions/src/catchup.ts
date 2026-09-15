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
import type { TileState } from '../../shared/rules/resources'
import { closingMutual, closingTogether } from '../../shared/rules/choices'
import { publicScore, type TeamState } from '../../shared/rules/score'
import { settleDay } from '../../shared/rules/settlement'
import { tallyVotes, type Vote } from '../../shared/rules/votes'
import { isShortHanded } from '../../shared/rules/occupy'
import { TEAMS } from '../../shared/rules/lobby'
import {
  ALLIANCE_CLEAR_DAY,
  CORE_OPENING,
  type Resource,
  type TeamId,
} from '../../shared/rules/v2'
import type { TileId } from '../../shared/rules/board'
import type { Fragment } from '../../shared/rules/fragments'
import { FRAGMENT_BY_DAY } from './story/fragments'
import type {
  GameDoc,
  PawnDoc,
  ScheduleDoc,
  TeamDoc,
  TileDoc,
  TokenStateDoc,
  VoteDoc,
} from '../../shared/model'
import { gameRef } from './index'
import { refreshViews } from './views'
import { openInterval, refreshAwakening } from './reveal'

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
  /**
   * 이번 따라잡기에서 칸에 선 말들. 체류 기록은 트랜잭션 **밖에서**
   * 연다 — 도착 처리기는 이미 쓰기 단계에 있어서 더 읽을 수 없다.
   *
   * 모듈 바깥에 두면 안 된다. 두 요청이 동시에 따라잡으면 서로의
   * 목록이 섞인다.
   */
  landed: { playerId: string; tileId: TileId; atMs: number }[]
}

/**
 * 하루가 열리는 자정.
 *
 * 날이 바뀌고, 오늘 열리는 핵심 칸이 열리고, 사람마다 쓴 토큰과 표가
 * 0으로 돌아간다. 3인 팀 주장도 돌아간다 — 하루씩 번갈아 맡는다.
 */
async function dayStart(c: Ctx): Promise<void> {
  const ref = gameRef(c.gameId)
  const opens = (CORE_OPENING[c.day] ?? []) as TileId[]
  const openedTiles = [...new Set([...c.game.openedTiles, ...opens])]
  const boostedTiles = fragmentsUpTo(c.day).map((f) => f.spotTile)

  // **등교 예약은 없앴다.** 밤새 멈춰 있던 시절의 규칙이고, 어디든
  // 한 걸음이 된 뒤로는 자유 시간에 그냥 걸어가는 것과 같아졌다
  const pawns = await c.tx.get(ref.collection('pawns'))
  for (const p of pawns.docs) {
    c.tx.update(p.ref, { tokensUsedToday: 0, votedToday: false, peeksToday: 0 })
  }

  // 머릿수가 모자란 팀의 주장은 날마다 돈다
  for (const team of TEAMS) {
    const members = c.game.seats.filter((s) => s.team === team)
    if (!isShortHanded(members.length)) continue
    const next = members[(c.day - 1) % members.length].playerId
    c.tx.update(ref.collection('teams').doc(team), { captainId: next })
  }

  // DAY 4 가 열릴 때 — 모든 동맹이 풀린다. 먼저 깬 것이 아니므로 아무도
  // 값을 치르지 않고, 잠기지도 않는다
  if (c.day === ALLIANCE_CLEAR_DAY) {
    for (const team of TEAMS) {
      c.tx.update(ref.collection('teams').doc(team), { allyTeam: null })
    }
    c.tx.set(ref.collection('events').doc(), {
      atMs: c.atMs,
      day: c.day,
      kind: 'allianceCleared',
      detail: {},
    })
  }

  c.tx.update(ref, {
    day: c.day,
    openedTiles,
    boostedTiles,
    // 어제 21:00에 정해진 사람이 오늘 지워진다
    invisibleId: c.game.invisibleByDay[c.day] ?? null,
  })
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
  const [tileSnap, teamSnap, tokenSnap, voteSnap] = await Promise.all([
    c.tx.get(ref.collection('tiles')),
    c.tx.get(ref.collection('teams')),
    c.tx.get(ref.collection('secret').doc('tokens').collection('items')),
    c.tx.get(ref.collection('secret').doc('votes').collection('items')),
  ])

  const tiles: TileState[] = tileSnap.docs.map((d) => {
    const t = d.data() as TileDoc
    return { tileId: d.id as TileId, ownerTeam: t.ownerTeam }
  })
  const teamDocs = new Map(teamSnap.docs.map((d) => [d.id as TeamId, d.data() as TeamDoc]))

  // 1. 생산
  //
  // **여기서 나오던 것은 건물 생산뿐이었다.** 건물을 걷어냈으니
  // 정산에서 금고에 붙는 것은 없다. 금고는 노동·탐색·카드·교역으로만
  // 는다. 자리는 남겨 둔다 — 다른 수입이 생기면 여기로 들어온다
  const after = new Map<TeamId, Record<Resource, number>>()
  for (const team of TEAMS) {
    const doc = teamDocs.get(team)
    if (!doc) continue
    after.set(team, { ...doc.resources })
  }

  // 2. 받은 표
  //
  // **표는 금고를 움직이지 않는다.** 받은 장수만 세어 목표 판정에 쓴다
  //
  // 오늘 던져진 것만 센다. 아직 정산 안 된 표를 날짜 상관없이 긁으면
  // 따라잡기로 이틀이 한꺼번에 밀릴 때 어제 표가 오늘 또 들어간다
  const todays = voteSnap.docs.filter((d) => {
    const v = d.data() as VoteDoc
    return !v.settled && v.day === c.day
  })
  const votes: Vote[] = todays.map((d) => {
    const v = d.data() as VoteDoc
    return {
      voterId: v.voterId,
      voterTeam: v.voterTeam,
      targetId: v.targetId,
      targetTeam: v.targetTeam,
      kind: v.kind,
      atMs: v.castAtMs,
    }
  })

  tallyVotes({ votes })

  // 생산을 적는다
  for (const team of TEAMS) {
    const res = after.get(team)
    if (res) c.tx.update(ref.collection('teams').doc(team), { resources: res })
  }
  for (const d of todays) c.tx.update(d.ref, { settled: true })

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
    knowledgeOf: (team) => after.get(team)?.knowledge ?? 0,
    // 투명인간은 이제 전용 투표로 정한다(ballot.ts). 하루 정산이
    // 아니라 그날 마지막 페이즈가 닫힐 때 골라진다
    ballots: [],
    // 이틀 연속은 없다
    yesterdayInvisibleId: c.game.invisibleByDay[c.day] ?? null,
  })

  // 마지막 여섯 시간에는 점수를 알리지 않는다
  for (const r of result.ranked) {
    c.tx.update(ref.collection('teams').doc(r.team), {
      publicScore: c.game.lastHours ? null : r.total,
    })
  }

  // 5. 꼴찌는 다음 날이 열릴 때 토큰을 더 받는다
  const lastBox = tokenSnap.docs.find((d) => d.id === result.comeback)
  if (lastBox) c.tx.set(lastBox.ref, markComeback(lastBox.data() as TokenStateDoc))

  // 내일 지워지는 사람. 표가 갈렸으면 null이고, 그것도 그대로 알린다
  const tomorrow = c.day + 1
  c.tx.update(ref, {
    spotlightTeams: [result.spotlighted],
    comebackTeams: [result.comeback],
    [`invisibleByDay.${tomorrow}`]: result.invisible.playerId,
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

/**
 * DAY 5 자정 — 판이 끝난다.
 *
 * 종례 순간의 두 가지를 여기서 굳힌다. 중요한 사람과 같은 칸에
 * 있었는가, 서로를 골랐는가. 나중에 다시 계산하면 「그 순간」이
 * 아니라 「지금」을 재게 된다.
 */
async function gameEnd(c: Ctx): Promise<void> {
  const ref = gameRef(c.gameId)
  const [pawnSnap, choiceSnap] = await Promise.all([
    c.tx.get(ref.collection('pawns')),
    c.tx.get(ref.collection('secret').doc('choices').collection('items')),
  ])

  const tileAt: Record<string, string | null> = {}
  for (const d of pawnSnap.docs) tileAt[d.id] = (d.data() as PawnDoc).tileId
  const chosenBy: Record<string, string | null> = {}
  for (const d of pawnSnap.docs) chosenBy[d.id] = null
  for (const d of choiceSnap.docs) chosenBy[d.id] = (d.data() as { chosenId: string | null }).chosenId ?? null

  const together = closingTogether({ chosenBy, tileAt })
  const mutual = closingMutual(chosenBy)

  c.tx.set(ref.collection('secret').doc('closing'), { chosenBy, tileAt, together, mutual, atMs: c.atMs })
  c.tx.update(ref, { phase: 'finished' })
  c.tx.set(ref.collection('events').doc(), { atMs: c.atMs, day: c.day, kind: 'gameEnd', detail: {} })
}

/**
 * 말이 한 칸 도착했다.
 *
 * 남은 경로가 있으면 계속 걷고, 없으면 그 칸에 선다. 다음 칸 도착은
 * 이미 예정 이벤트로 적혀 있으므로 여기서 새로 걸지 않는다.
 */
async function arrive(c: Ctx, payload: Record<string, unknown>): Promise<void> {
  const ref = gameRef(c.gameId)
  const playerId = payload.playerId as string
  const tileId = payload.tileId as TileId
  const rest = (payload.rest as TileId[]) ?? []
  const nextAtMs = (payload.nextAtMs as number | null) ?? null

  const pawnRef = ref.collection('pawns').doc(playerId)
  const snap = await c.tx.get(pawnRef)
  if (!snap.exists) return
  const pawn = snap.data() as PawnDoc
  // 길을 바꿨으면 옛 도착은 없던 것이다. 남은 경로로 알아본다
  if (pawn.path[0] !== tileId) return

  if (rest.length === 0) {
    // 발을 들였으니 지도에 남는다. 사람마다 따로 쌓인다
    const been = new Set(pawn.visitedTiles ?? [])
    been.add(tileId)
    c.tx.update(pawnRef, { tileId, fromTile: null, path: [], arriveAtMs: null, visitedTiles: [...been] })
    // 이 칸에 섰다. 체류 기록은 트랜잭션 밖에서 연다
    c.landed.push({ playerId, tileId, atMs: c.atMs })
  } else {
    c.tx.update(pawnRef, { tileId: null, fromTile: tileId, path: rest, arriveAtMs: nextAtMs })
  }
  c.tx.set(ref.collection('events').doc(), {
    atMs: c.atMs,
    day: c.day,
    kind: 'arrive',
    playerId,
    team: pawn.team,
    tileId,
    detail: { done: rest.length === 0 },
  })
}

const HANDLERS: Partial<Record<ScheduleDoc['kind'], (c: Ctx, payload: Record<string, unknown>) => Promise<void>>> = {
  dayStart: (c) => dayStart(c),
  lastHours: (c) => lastHours(c),
  settlement: (c) => settlement(c),
  gameEnd: (c) => gameEnd(c),
  arrive,
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
  const landed: Ctx['landed'] = []
  for (const item of dueItems(due, toMs)) {
    const handler = HANDLERS[item.kind]
    const payload = pending.docs.find((d) => d.id === item.id)?.data() as ScheduleDoc
    // **내가 정말로 밀었는지**를 트랜잭션이 돌려준다. 밖에서 그냥
    // 세면, 남이 먼저 민 것을 건너뛰고도 센 것으로 친다. 열넷이 아침에
    // 동시에 들어오면 같은 정산을 열넷이 「내가 했다」고 보고한다 —
    // 실제로 한 번만 처리되니 자원은 맞는데, 세는 숫자만 거짓말을 한다.
    const did = await db.runTransaction(async (tx) => {
      // 트랜잭션 안에서 다시 읽는다 — 다른 요청이 먼저 밀었을 수 있다
      const itemRef = ref.collection('schedule').doc(item.id)
      const [fresh, gameFresh] = await Promise.all([tx.get(itemRef), tx.get(ref)])
      if (!fresh.exists || (fresh.data() as ScheduleDoc).doneAtMs !== null) return false
      game = gameFresh.data() as GameDoc

      if (handler) {
        await handler(
          {
            tx,
            gameId,
            game,
            atMs: item.dueAtMs,
            day: (payload.payload?.day as number) ?? game.day,
            landed,
          },
          payload.payload ?? {},
        )
      }
      tx.update(itemRef, { doneAtMs: item.dueAtMs })
      return true
    })
    if (did) applied += 1
  }

  // 토큰은 예정 이벤트가 아니라 한 번에 따라잡는다
  await accrueAll(gameId, toMs)
  await ref.update({ caughtUpToMs: toMs })

  // 칸에 선 말의 체류 기록을 연다. 트랜잭션 안에서 하면 읽기·쓰기
  // 순서에 걸린다 — 도착 처리기는 이미 쓰기 단계에 있다
  for (const a of landed) await openInterval(gameId, a.playerId, a.tileId, a.atMs)
  if (landed.length > 0) await refreshAwakening(gameId)

  // 세상이 바뀌었으면 각자 몫을 다시 깎는다. 틀린 안개는 새는 안개다
  if (applied > 0) await refreshViews(gameId)

  const last = (await ref.get()).data() as GameDoc
  return { applied, day: last.day, phase: last.phase }
}
