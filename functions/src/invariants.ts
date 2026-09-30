// 불변식 검사 — 판이 늘 지켜야 하는 것을 한 번에 훑는다. **운영자만.**
//
// 페이즈가 닫힐 때마다(phase.ts closePhase 끝) 그리고 운영자가 누를 때
// 돈다. 어긋난 것은 secret/qa/violations 에 **그 직전의 로그 한 줄**과 함께
// 남는다 — 무엇이 깨졌는가보다 「그 직전에 무슨 일이 있었나」가 고치는
// 단서다.
//
// 검사는 읽기뿐이다. 고치지 않는다 — 고치는 것은 사람이 원인을 본 뒤다.
import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'

import { canStandAt, roomOfCell, TILE_BY_ID, type Cell, type TileId } from '../../shared/rules/board'
import { isBlockedCell } from '../../shared/rules/blocked'
import { isFixture } from '../../shared/rules/fixtures'
import { TEAMS } from '../../shared/rules/lobby'
import { ROBOTS_PER_ROOM, ROBOTS_PER_TEAM, type Robot } from '../../shared/rules/occupy'
import { RESOURCES } from '../../shared/rules/v2'
import type { GameDoc, PawnDoc, TeamDoc, TileDoc } from '../../shared/model'
import { requireHost } from './host'
import { gameRef, nowOf } from './index'
import { lastEvent, qaDocOf, type LogRow } from './qaLog'
import { teamName } from '../../shared/rules/bundan'

const db = getFirestore()

export type ViolationKind =
  | 'pawnMissing'
  | 'pawnNowhere'
  | 'pawnCellRoomMismatch'
  | 'vaultNegative'
  | 'tokensNegative'
  | 'cellShared'
  | 'cellBlocked'
  | 'robotsOverTeam'
  | 'robotsOverRoom'
  | 'slipCountMismatch'
  | 'tileOwnerBad'

export interface Violation {
  atMs: number
  kind: ViolationKind
  /** 짧은 우리말 한 줄 */
  detail: string
  /** 그 직전의 로그 한 줄. 없으면 null */
  lastEvent: LogRow | null
}

export const VIOLATION_LABEL: Record<ViolationKind, string> = {
  pawnMissing: '자리는 있는데 말이 없다',
  pawnNowhere: '어느 방에도 없다',
  pawnCellRoomMismatch: '선 칸이 제 방 밖이다',
  vaultNegative: '금고가 음수다',
  tokensNegative: '토큰 상자가 음수다',
  cellShared: '한 칸에 둘이 섰다',
  cellBlocked: '설 수 없는 칸에 섰다',
  robotsOverTeam: '분단 로봇이 한도를 넘었다',
  robotsOverRoom: '방 로봇이 한도를 넘었다',
  slipCountMismatch: '쪽지 수가 어긋났다',
  tileOwnerBad: '방 주인이 이상하다',
}

export const violationsOf = (gameId: string) => qaDocOf(gameId).collection('violations')

const roomName = (id: string | null | undefined): string => (id ? (TILE_BY_ID[id as TileId]?.name ?? id) : '')

/**
 * 지금 판이 불변식을 지키는가. 어긋난 것을 돌려주고, 있었으면 기록한다.
 *
 * 쪽지 수는 **기대값을 따로 든다**(secret/qa.expectedSlips). 쪽지 문서는
 * 배포 · 운영자 메모 · 손글씨에서 생기고 운영자 회수에서만 지워지는데,
 * 그 넷이 bumpSlips 로 기대값을 같이 움직인다(qaLog.ts). 기록(records)에서
 * 되짚는 길도 있었지만 「놓았다」는 기록이 없어서 믿을 수 없다. 기대값이
 * 아직 없는 판(이 검사가 생기기 전 판)은 지금 수를 기대값으로 삼고 넘어간다.
 */
export async function checkInvariants(gameId: string, nowMs: number): Promise<Violation[]> {
  const ref = gameRef(gameId)
  const [snap, pawns, teams, tiles, robots, slips, qa] = await Promise.all([
    ref.get(),
    ref.collection('pawns').get(),
    ref.collection('teams').get(),
    ref.collection('tiles').get(),
    ref.collection('robots').get(),
    ref.collection('secret').doc('slips').collection('items').get(),
    qaDocOf(gameId).get(),
  ])
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  const game = snap.data() as GameDoc
  if (game.phase === 'lobby') return []
  const nameOf = (id: string) => game.seats.find((s) => s.playerId === id)?.name ?? id.slice(0, 6)

  const found: { kind: ViolationKind; detail: string }[] = []
  const bad = (kind: ViolationKind, detail: string) => found.push({ kind, detail })

  // ── 말 — 앉은 사람마다 하나, 방 하나 ──
  const pawnBy = new Map(pawns.docs.map((d) => [d.id, d.data() as PawnDoc]))
  for (const s of game.seats) {
    const p = pawnBy.get(s.playerId)
    if (!p) {
      bad('pawnMissing', `${s.name}의 말이 없다`)
      continue
    }
    if (p.tileId === null) {
      const walking = Array.isArray(p.path) && p.path.length > 0 && typeof p.arriveAtMs === 'number'
      if (!walking) bad('pawnNowhere', `${s.name} · tileId 없음 · 걷는 중도 아님`)
    } else if (p.at) {
      const room = roomOfCell(p.at.x, p.at.y)
      if (room !== null && room !== p.tileId) {
        bad('pawnCellRoomMismatch', `${s.name} · 방 ${roomName(p.tileId)} · 칸 (${p.at.x},${p.at.y})은 ${roomName(room)}`)
      }
    }
  }

  // ── 칸 — 한 칸에 하나, 설 수 있는 칸 ──
  // 투명인간은 칸을 차지하지 않는다(seat.ts) — 남이 그 칸에 서도 어긋난 것이 아니다
  const onCell = new Map<string, string[]>()
  for (const [id, p] of pawnBy) {
    if (p.tileId === null || !p.at) continue
    const at = p.at as Cell
    const key = `${at.x},${at.y}`
    if (id !== game.invisibleId) onCell.set(key, [...(onCell.get(key) ?? []), id])
    if (!canStandAt(at.x, at.y) || isFixture(at.x, at.y) || isBlockedCell(at.x, at.y)) {
      bad('cellBlocked', `${nameOf(id)} · (${at.x},${at.y})`)
    }
  }
  for (const [key, ids] of onCell) {
    if (ids.length > 1) bad('cellShared', `(${key}) · ${ids.map(nameOf).join(', ')}`)
  }

  // ── 사람 — 내 돈은 0 아래로 안 간다 ──
  for (const d of pawns.docs) {
    const m = Number((d.data() as { money?: number }).money ?? 0)
    if (m < 0) bad('vaultNegative', `${nameOf(d.id)} 돈 = ${m}`)
  }

  // ── 팀 — 금고와 토큰 상자는 0 아래로 안 간다 ──
  for (const d of teams.docs) {
    const t = d.data() as TeamDoc
    for (const r of RESOURCES) {
      const v = t.resources?.[r] ?? 0
      if (v < 0) bad('vaultNegative', `${teamName(d.id)} ${r} = ${v}`)
    }
    if ((t.phaseTokens ?? 0) < 0) bad('tokensNegative', `${teamName(d.id)} phaseTokens = ${t.phaseTokens}`)
  }

  // ── 로봇 — 팀 한도 · 방 한도 ──
  const byTeam = new Map<string, number>()
  const byRoom = new Map<string, number>()
  for (const d of robots.docs) {
    const r = d.data() as Robot
    byTeam.set(r.team, (byTeam.get(r.team) ?? 0) + 1)
    // 방 한도는 **놓인 것만** 먹는다. 든 로봇은 가방 속이다
    if (r.tileId && !r.carriedBy) byRoom.set(r.tileId, (byRoom.get(r.tileId) ?? 0) + 1)
  }
  for (const [team, n] of byTeam) if (n > ROBOTS_PER_TEAM) bad('robotsOverTeam', `${teamName(team)} 로봇 ${n} > ${ROBOTS_PER_TEAM}`)
  for (const [tile, n] of byRoom) if (n > ROBOTS_PER_ROOM) bad('robotsOverRoom', `${roomName(tile)} 로봇 ${n} > ${ROBOTS_PER_ROOM}`)

  // ── 쪽지 — 든 것 + 바닥 + 찢긴 것 = 기대값 ──
  const expected = (qa.data() as { expectedSlips?: number } | undefined)?.expectedSlips
  if (typeof expected !== 'number') {
    await qaDocOf(gameId).set({ expectedSlips: slips.size }, { merge: true })
  } else if (expected !== slips.size) {
    bad('slipCountMismatch', `문서 ${slips.size} 장 · 기대 ${expected} 장`)
  }

  // ── 방 — 주인은 네 팀 중 하나거나 없다 ──
  for (const d of tiles.docs) {
    const t = d.data() as TileDoc
    const o = t.ownerTeam ?? null
    if (o !== null && !TEAMS.includes(o)) bad('tileOwnerBad', `${roomName(d.id)} ownerTeam = ${String(o)}`)
  }

  if (found.length === 0) return []
  const last = await lastEvent(gameId, nowMs)
  const out: Violation[] = found.map((f) => ({ atMs: nowMs, kind: f.kind, detail: f.detail, lastEvent: last }))
  const batch = db.batch()
  for (const v of out) batch.set(violationsOf(gameId).doc(), v)
  await batch.commit()
  return out
}

/** 운영자 — 지금 검사하고, 지금 것과 쌓인 기록(최근 100)을 돌려준다 */
export const hostInvariants = onCall<{ gameId: string }>(async (req) => {
  requireHost(req.auth)
  const gameId = String(req.data?.gameId ?? '')
  if (!gameId) throw new HttpsError('invalid-argument', '판이 없다.')
  const snap = await gameRef(gameId).get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  const nowMs = nowOf(snap.data() as GameDoc)
  const violations = await checkInvariants(gameId, nowMs)
  const hist = await violationsOf(gameId).orderBy('atMs', 'desc').limit(100).get()
  return { nowMs, violations, history: hist.docs.map((d) => d.data() as Violation), labels: VIOLATION_LABEL }
})
