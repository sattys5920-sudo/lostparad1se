// 운영자 — 열넷이 지금 어디서 무엇을 하는가. 그리고 방마다 오간 말.
//
// **운영자만.** 서버가 운영자 표시를 보고 준다(requireHost).
//
// 지도(hostLiveMap)에는 자리와 하는 일만 싣는다. 역할도 추리 노트도
// 쪽지 문안도 안 싣는다 — 운영자 대시보드라도 그것은 볼 일이 아니다.
// 말(hostRoomChat)은 따로 부른다. 플레이어는 「들어온 뒤의 말」만
// 듣지만 운영자는 시간 창 없이 전부 본다. 어느 쪽도 판정에는 안 쓴다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'

import { TILE_BY_ID, isHallCell, roomOfCell, type Cell, type TileId } from '../../shared/rules/board'
import { ARCADE_BY_ID, LIVE_ROOM, machineAtSeat, type RoomDoc } from '../../shared/rules/arcade'
import type { FlagMap } from '../../shared/rules/flag'
import type { GameDoc, LiveDoc, PawnDoc, TeamDoc, TileDoc } from '../../shared/model'
import type { ChatDocRaw } from './chat'
import { LIVE as LIVE_DEAL, dealsOf, type DealDoc } from './dealroom'
import type { ErrandDoc } from './errand'
import { requireHost } from './host'
import { gameRef, nowOf } from './index'

/** 실시간 자리(live)를 믿는 시간. 화면(useLive)과 같은 값이다. */
const LIVE_FRESH_MS = 6000

/** 방 이름. 없는 방이면 아이디 그대로. */
const roomName = (id: string | null | undefined): string => (id ? (TILE_BY_ID[id as TileId]?.name ?? id) : '복도')

/** 남은 분. 1분이 안 남아도 1분으로 적는다 — 0분이면 풀린 줄 안다 */
const minsLeft = (untilMs: number, nowMs: number): number => Math.max(1, Math.ceil((untilMs - nowMs) / 60_000))

export type DoingKind = 'walk' | 'trap' | 'busy' | 'deal' | 'arcade' | 'errand' | 'bound' | 'hidden' | 'idle'

async function loadGame(gameId: string): Promise<GameDoc> {
  const snap = await gameRef(gameId).get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  return snap.data() as GameDoc
}

/**
 * 지도 한 장.
 *
 * 앉은 사람마다 자리 · 걷는 중인지 · 묶였는지 · 거래 · 오락기 · 심부름 ·
 * 마지막으로 움직인 때, 그리고 서버가 붙인 한 줄(doing). 방마다 주인과
 * 깃발 · 로봇 수, 바닥의 종이 자리. **문안은 없다.**
 */
export const hostLiveMap = onCall<{ gameId: string }>(async (req) => {
  requireHost(req.auth)
  const gameId = String(req.data?.gameId ?? '')
  if (!gameId) throw new HttpsError('invalid-argument', '판이 없다.')
  const game = await loadGame(gameId)
  const nowMs = nowOf(game)
  const realNow = Date.now()
  const ref = gameRef(gameId)

  const [pawns, deals, arcade, errands, live, tiles, robots, flagDoc, quizFloor, slips, stays, teamDocs] = await Promise.all([
    ref.collection('pawns').get(),
    dealsOf(gameId).where('status', 'in', LIVE_DEAL).get(),
    ref.collection('arcadeRooms').where('status', 'in', [...LIVE_ROOM]).get(),
    ref.collection('errands').where('expired', '==', false).get(),
    ref.collection('live').get(),
    ref.collection('tiles').get(),
    ref.collection('robots').get(),
    ref.collection('secret').doc('flags').get(),
    ref.collection('secret').doc('quiz').collection('floor').get(),
    ref.collection('secret').doc('slips').collection('items').get(),
    // 지금 방에 **언제 들어왔나**. 안 닫힌 체류 칸의 시작이 곧 그 시각이다
    ref.collection('secret').doc('intervals').collection('items').where('endMs', '==', null).get(),
    ref.collection('teams').get(),
  ])

  const seats = game.seats ?? []
  const nameOf = (id: string) => seats.find((s) => s.playerId === id)?.name ?? ''
  const pawnBy = new Map(pawns.docs.map((d) => [d.id, d.data() as PawnDoc]))
  const liveBy = new Map(live.docs.map((d) => [d.id, d.data() as LiveDoc]))
  const stayBy = new Map<string, number>()
  for (const d of stays.docs) {
    const s = d.data() as { playerId?: string; startMs?: number }
    if (!s.playerId || typeof s.startMs !== 'number') continue
    stayBy.set(s.playerId, Math.max(stayBy.get(s.playerId) ?? 0, s.startMs))
  }

  // 사람마다 살아 있는 거래 하나 — 한 번에 하나뿐이다
  const dealBy = new Map<string, { id: string; deal: DealDoc }>()
  for (const d of deals.docs) {
    const deal = d.data() as DealDoc
    dealBy.set(deal.aId, { id: d.id, deal })
    dealBy.set(deal.bId, { id: d.id, deal })
  }
  // 오락기 방. 들어와 있거나 부름을 받은 사람
  const arcadeBy = new Map<string, { room: RoomDoc; state: string }>()
  for (const d of arcade.docs) {
    const room = d.data() as RoomDoc
    for (const m of room.members ?? []) {
      if (m.state === 'in' || m.state === 'invited') arcadeBy.set(m.id, { room, state: m.state })
    }
  }
  // 받아 든 심부름
  const errandBy = new Map<string, { e: ErrandDoc; tookMs: number; carrying: boolean }>()
  const posted: ErrandDoc[] = []
  for (const d of errands.docs) {
    const e = d.data() as ErrandDoc
    if (e.doneBy !== null) continue
    posted.push(e)
    for (const [uid, t] of Object.entries(e.takers ?? {})) errandBy.set(uid, { e, tookMs: t.tookMs, carrying: t.carrying })
  }

  const people = seats.map((seat) => {
    const id = seat.playerId
    const p = pawnBy.get(id) ?? null
    const team = (p?.team ?? seat.team ?? null) as string | null
    const at = (p?.at ?? null) as Cell | null
    const walking = p !== null && p.tileId === null
    const path = (p?.path ?? []) as TileId[]
    const dest = walking ? (path[path.length - 1] ?? null) : null
    const busy = p && (p.busyUntilMs ?? 0) > nowMs && p.busyKind ? { kind: p.busyKind, untilMs: p.busyUntilMs as number } : null
    const boundUntil = p && (p.boundUntilMs ?? 0) > nowMs ? (p.boundUntilMs as number) : null
    const hiddenUntil = p && (p.hiddenUntilMs ?? 0) > nowMs ? (p.hiddenUntilMs as number) : null
    const deal = dealBy.get(id) ?? null
    const other = deal ? (deal.deal.aId === id ? deal.deal.bId : deal.deal.aId) : null
    const arc = arcadeBy.get(id) ?? null
    const seatAt = machineAtSeat(at)
    const errand = errandBy.get(id) ?? null
    const lv = liveBy.get(id)
    const liveFresh = lv && realNow - lv.ms < LIVE_FRESH_MS ? lv : null
    const inHall = at !== null && roomOfCell(at.x, at.y) === null && isHallCell(at.x, at.y)
    const roomSinceMs = stayBy.get(id) ?? null

    // 마지막으로 움직인 때. 걷기(live)는 실제 시계, 무전은 게임 시계라
    // 「몇 초 전」으로 맞춰 둔다 — 둘 중 가까운 쪽
    const agos: number[] = []
    if (lv) agos.push(Math.max(0, realNow - lv.ms))
    if (typeof p?.radioAtMs === 'number') agos.push(Math.max(0, nowMs - p.radioAtMs))
    const seenAgoMs = agos.length > 0 ? Math.min(...agos) : null

    // 한 줄. 위에 있는 것이 먼저다 — 몸이 묶인 것이 하는 일보다 앞선다
    let kind: DoingKind = 'idle'
    let doing = '가만히'
    let sinceMs: number | null = roomSinceMs
    let untilMs: number | null = null
    if (walking) {
      kind = 'walk'
      doing = dest ? `걷는 중 → ${roomName(dest)}` : '걷는 중'
      sinceMs = null
      untilMs = p?.arriveAtMs ?? null
    } else if (busy && busy.kind === '덫') {
      kind = 'trap'
      doing = `덫에 걸림 ${minsLeft(busy.untilMs, nowMs)} 분`
      untilMs = busy.untilMs
    } else if (deal) {
      kind = 'deal'
      const who = nameOf(other ?? '')
      doing =
        deal.deal.status === 'asking'
          ? deal.deal.askedBy === id
            ? `거래 거는 중 · ${who}`
            : `거래 요청 받음 · ${who}`
          : `거래 중 · ${who}`
      sinceMs = deal.deal.askedAtMs ?? null
    } else if (busy) {
      kind = 'busy'
      doing = `${busy.kind} 중 ${minsLeft(busy.untilMs, nowMs)} 분`
      untilMs = busy.untilMs
    } else if (arc) {
      kind = 'arcade'
      const g = ARCADE_BY_ID[arc.room.game]?.name ?? '게임'
      doing = arc.room.status === 'playing' ? `오락기 · ${g}` : `오락기 대기 · ${g}`
      sinceMs = arc.room.atMs ?? null
    } else if (seatAt !== null) {
      kind = 'arcade'
      doing = `오락기 앞 · ${seatAt + 1} 번`
    } else if (errand) {
      kind = 'errand'
      doing = errand.carrying
        ? `심부름 중 · ${errand.e.thing} → ${roomName(errand.e.to)}`
        : `심부름 받음 · ${errand.e.thing}`
      sinceMs = errand.tookMs
    } else if (boundUntil) {
      kind = 'bound'
      doing = `발 묶임 ${minsLeft(boundUntil, nowMs)} 분`
      untilMs = boundUntil
    } else if (hiddenUntil) {
      kind = 'hidden'
      doing = '잠복 중'
      untilMs = hiddenUntil
    } else if (liveFresh?.moving) {
      kind = 'idle'
      doing = '방 안에서 걷는 중'
    }

    return {
      playerId: id,
      /** 개인 돈(코인). 감독관 현황판이 사람마다 보인다 */
      money: Math.max(0, Number(p?.money ?? 0)),
      name: seat.name,
      team,
      look: seat.look ?? null,
      tileId: p?.tileId ?? null,
      roomName: walking ? null : inHall ? '복도' : roomName(p?.tileId ?? null),
      at,
      inHall,
      walk: walking
        ? { fromTile: p?.fromTile ?? null, nextTile: path[0] ?? null, destTile: dest, arriveAtMs: p?.arriveAtMs ?? null }
        : null,
      busy,
      boundUntilMs: boundUntil,
      hiddenUntilMs: hiddenUntil,
      invisible: game.invisibleId === id,
      asleep: p?.asleep === true,
      deal: deal ? { id: deal.id, status: deal.deal.status, withId: other, withName: nameOf(other ?? '') } : null,
      arcade: arc
        ? { game: ARCADE_BY_ID[arc.room.game]?.name ?? String(arc.room.game), status: arc.room.status, state: arc.state }
        : null,
      machine: seatAt,
      errand: errand
        ? { thing: errand.e.thing, from: errand.e.from, to: errand.e.to, carrying: errand.carrying, tookMs: errand.tookMs }
        : null,
      live: liveFresh ? { x: liveFresh.x, y: liveFresh.y, dir: liveFresh.dir, moving: liveFresh.moving } : null,
      seenAgoMs,
      roomSinceMs: walking ? null : roomSinceMs,
      kind,
      doing,
      sinceMs,
      untilMs,
    }
  })

  // 방마다 — 주인 · 자물쇠 · 깃발 · 로봇
  const flags = ((flagDoc.data() as { tiles?: FlagMap } | undefined)?.tiles ?? {}) as FlagMap
  const rooms: Record<string, { owner: string | null; lockedBy: string | null; flags: Record<string, number>; robots: number }> = {}
  for (const id of Object.keys(TILE_BY_ID)) rooms[id] = { owner: null, lockedBy: null, flags: {}, robots: 0 }
  for (const d of tiles.docs) {
    const t = d.data() as TileDoc
    if (!rooms[d.id]) continue
    rooms[d.id].owner = t.ownerTeam ?? null
    rooms[d.id].lockedBy = t.lockedBy && (t.lockUntilMs ?? 0) > nowMs ? t.lockedBy : null
  }
  for (const [id, by] of Object.entries(flags)) {
    if (!rooms[id] || !by) continue
    rooms[id].flags = Object.fromEntries(Object.entries(by).filter(([, n]) => (n ?? 0) > 0)) as Record<string, number>
  }
  for (const d of robots.docs) {
    const r = d.data() as { tileId?: string; carriedBy?: string | null }
    if (r.tileId && rooms[r.tileId] && !r.carriedBy) rooms[r.tileId].robots += 1
  }

  // 바닥의 것 — **자리만.** 무엇이 적혔는지는 안 싣는다
  const floor: { x: number; y: number; kind: 'quiz' | 'slip' | 'thing'; icon?: string }[] = []
  for (const d of quizFloor.docs) {
    const q = d.data() as { x?: number; y?: number; heldBy?: string | null }
    if (!q.heldBy && typeof q.x === 'number' && typeof q.y === 'number') floor.push({ x: q.x, y: q.y, kind: 'quiz' })
  }
  for (const d of slips.docs) {
    const s = d.data() as { x?: number; y?: number; heldBy?: string | null }
    if (!s.heldBy && typeof s.x === 'number' && typeof s.y === 'number') floor.push({ x: s.x, y: s.y, kind: 'slip' })
  }
  for (const e of posted) {
    const anyOnFloor = Object.values(e.takers ?? {}).length === 0 || Object.values(e.takers ?? {}).some((t) => !t.carrying)
    if (anyOnFloor && e.cell) floor.push({ x: e.cell.x, y: e.cell.y, kind: 'thing', icon: e.icon })
  }

  /*
   * **분단 현황** — 감독관만 본다. 토큰 · 깃발(이번 페이즈 몫 + 자판기에서 산 것)
   * · 로봇(방에 놓인 것 + 손에 든 것) · 지식. 돈은 사람 것이라 사람마다 따로다
   */
  const teams = teamDocs.docs
    .map((d) => {
      const t = d.data() as TeamDoc
      const mine = robots.docs.map((r) => r.data() as { team?: string; carriedBy?: string | null }).filter((r) => r.team === d.id)
      return {
        team: d.id,
        tokens: Number(t.phaseTokens ?? 0),
        flags: Number(t.flags ?? 0),
        boughtFlags: Number(t.boughtFlags ?? 0),
        knowledge: Number(t.resources?.knowledge ?? 0),
        robotsPlaced: mine.filter((r) => !r.carriedBy).length,
        robotsCarried: mine.filter((r) => !!r.carriedBy).length,
      }
    })
    .sort((a, b) => a.team.localeCompare(b.team))

  return {
    nowMs,
    phase: game.phase,
    day: game.day,
    teams,
    phaseNow: game.phaseNow ? { no: game.phaseNow.no, open: game.phaseNow.open, endsAtMs: game.phaseNow.endsAtMs ?? null } : null,
    people,
    rooms,
    floor,
  }
})

// ── 방마다 오간 말 ───────────────────────────────────────────────

const chatOf = (gameId: string) => gameRef(gameId).collection('secret').doc('chat').collection('items')

/** 한 번에 이만큼. 무전과 같다 — 최근 것부터 잘라 뒤집는다 */
const CHAT_PAGE = 300

type ChatRow = {
  id: string
  playerId: string
  name: string
  team: string
  /** 방. 복도에서 한 말이면 null 이고 hall 이 참이다 */
  tileId: string | null
  hall: boolean
  roomName: string
  atMs: number
  text: string
  /** 칠 때 지워져 있었다. 남에게는 안 갔다 */
  hidden: boolean
}

function chatRow(d: FirebaseFirestore.QueryDocumentSnapshot): ChatRow {
  const c = d.data() as ChatDocRaw
  const hall = c.hall === true || c.tileId === null
  return {
    id: d.id,
    playerId: c.playerId,
    name: c.name,
    team: c.team,
    tileId: hall ? null : c.tileId,
    hall,
    roomName: hall ? '복도' : roomName(c.tileId),
    atMs: c.atMs,
    text: c.text,
    hidden: c.invisible === true,
  }
}

/**
 * 운영자 — 방에서 오간 말.
 *
 * `room` 이 방 아이디면 그 방, `'hall'` 이면 복도, `'all'` 이면 전부 섞어서.
 * `sinceMs` 이후 것만(같은 시각도 준다 — 화면이 아이디로 거른다).
 * **시간 창이 없다.** 플레이어는 들어온 뒤의 말만 듣지만 운영자는
 * 그 방에서 나온 말을 처음부터 본다. 지워진 사람의 줄도 온다(hidden).
 *
 * `summary` 가 참이면 방마다 줄 수와 마지막 한 줄을 같이 준다.
 */
export const hostRoomChat = onCall<{ gameId: string; room?: string | null; sinceMs?: number; summary?: boolean }>(async (req) => {
  requireHost(req.auth)
  const gameId = String(req.data?.gameId ?? '')
  if (!gameId) throw new HttpsError('invalid-argument', '판이 없다.')
  await loadGame(gameId)
  const room = req.data?.room ?? null
  const since = Math.max(0, Number(req.data?.sinceMs ?? 0) || 0)
  if (room !== null && room !== 'all' && room !== 'hall' && !TILE_BY_ID[room as TileId]) {
    throw new HttpsError('invalid-argument', '그런 방은 없다.')
  }

  let lines: ChatRow[] | null = null
  if (room !== null) {
    const base = chatOf(gameId)
    const snap =
      room === 'all'
        ? await base.where('atMs', '>=', since).orderBy('atMs', 'desc').limit(CHAT_PAGE).get()
        : await base
            .where('tileId', '==', room === 'hall' ? null : room)
            .where('atMs', '>=', since)
            .orderBy('atMs', 'desc')
            .limit(CHAT_PAGE)
            .get()
    lines = [...snap.docs].reverse().map(chatRow)
  }

  let rooms: { room: string; lines: number; last: ChatRow | null }[] | null = null
  if (req.data?.summary === true) {
    const keys = [...Object.keys(TILE_BY_ID), 'hall']
    rooms = await Promise.all(
      keys.map(async (k) => {
        const q = chatOf(gameId).where('tileId', '==', k === 'hall' ? null : k)
        const [count, last] = await Promise.all([q.count().get(), q.orderBy('atMs', 'desc').limit(1).get()])
        return { room: k, lines: count.data().count, last: last.docs[0] ? chatRow(last.docs[0]) : null }
      }),
    )
    rooms = rooms.filter((r) => r.lines > 0)
  }

  return { lines, rooms }
})
