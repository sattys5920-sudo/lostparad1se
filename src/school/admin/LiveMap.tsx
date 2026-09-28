// 운영자 — 쯔꾸르 지도. 열넷이 어디서 무엇을 하는가.
//
//   지도   플레이어가 걷는 그 도트 그림을 층 하나씩 통째로 그린다. 끌어서
//          옮기고, 두 손가락이나 ± 로 넓힌다. 사람은 제 얼굴로 선다
//   사람   누르면 이름 · 팀 · 자리 · 하는 일 · 언제부터
//   방     누르면 그 방에 선 사람과 그 방에서 오간 말. 「전체」는 방을 섞어서
//   목록   열넷을 방마다 묶어서. 팀으로 거른다
//
// **몇 초마다 새로 읽는다**(hostLiveMap). 탭을 떠나거나 화면이 꺼지면 멈춘다.
// 한 줄(doing)은 서버가 붙인다 — 화면은 규칙을 모른다. 역할도 노트도
// 여기 오지 않는다. 말은 운영자만 시간 창 없이 본다(hostRoomChat).
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

import type { GameActions } from '../game/useGame'
import {
  BOARDS,
} from '../../../shared/rules/errand'
import {
  FLOORS,
  FLOOR_NAME,
  HALLS,
  TILES,
  TILE_BY_ID,
  isAlleyCell,
  isHallCell,
  roomOfCell,
  type Floor,
  type TileId,
} from '../../../shared/rules/board'
import { VENDINGS } from '../../../shared/rules/shop'
import { LAB_MACHINES, MAKERS } from '../../../shared/rules/trap'
import { ARCADE_MACHINES } from '../../../shared/rules/arcade'
import type { AvatarLook } from '../../../shared/look'
import { TILE, doorIsHorizontal, drawPiece, markAt, propAt, roomAt, signAt, stairHere, tileAt } from '../map/world'
import { PAL, buildSprites, type SpriteSet } from '../map/sprites'
import { signSheet } from '../map/signs'
import { pixelFrame } from '../char/pixel'
import { normalizeLook } from '../char/look'
import { TEAM_COLOR } from '../game/MapPlan'
import type { TeamId } from '../types'
import './liveMap.css'

// ── 서버가 주는 것 ─────────────────────────────────────────────

type Kind = 'walk' | 'trap' | 'busy' | 'deal' | 'arcade' | 'errand' | 'bound' | 'hidden' | 'idle'
interface Cell {
  x: number
  y: number
}
export interface LivePerson {
  playerId: string
  name: string
  team: TeamId | null
  look: AvatarLook | null
  tileId: TileId | null
  roomName: string | null
  at: Cell | null
  inHall: boolean
  walk: { fromTile: TileId | null; nextTile: TileId | null; destTile: TileId | null; arriveAtMs: number | null } | null
  busy: { kind: string; untilMs: number } | null
  invisible: boolean
  asleep: boolean
  deal: { id: string; status: string; withId: string | null; withName: string } | null
  arcade: { game: string; status: string; state: string } | null
  errand: { thing: string; from: TileId; to: TileId; carrying: boolean } | null
  live: { x: number; y: number; dir: string; moving: boolean } | null
  seenAgoMs: number | null
  roomSinceMs: number | null
  kind: Kind
  doing: string
  sinceMs: number | null
  untilMs: number | null
}
interface RoomState {
  owner: TeamId | null
  lockedBy: TeamId | null
  flags: Partial<Record<TeamId, number>>
  robots: number
}
interface LiveMapData {
  nowMs: number
  phaseNow: { no: number; open: boolean; endsAtMs: number | null } | null
  people: LivePerson[]
  rooms: Record<string, RoomState>
  floor: { x: number; y: number; kind: 'quiz' | 'slip' | 'thing'; icon?: string }[]
}
interface ChatLine {
  id: string
  playerId: string
  name: string
  team: string
  tileId: string | null
  hall: boolean
  roomName: string
  atMs: number
  text: string
  hidden: boolean
}
interface ChatSum {
  room: string
  lines: number
  last: ChatLine | null
}

/** 지도를 다시 읽는 간격 · 말을 다시 읽는 간격 · 방마다 줄 수를 다시 세는 간격 */
const MAP_MS = 3000
const CHAT_MS = 2500
const SUM_MS = 10_000

/** 넓히는 끝. 한 칸이 48px 이면 얼굴이 또렷하다 */
const MAX_SCALE = 3
/** 이보다 좁으면 얼굴 대신 팀 점으로 선다. 얼굴이 방보다 커진다 */
const DOT_BELOW = 0.55
/** 이보다 좁으면 팻말이 안 읽힌다. 방 이름을 따로 띄운다 */
const LABEL_BELOW = 0.9
/** 도트 사람 한 몸(판 화소). 플레이어 화면(CHAR_PX)과 같다 */
const CHAR_PX = 24

const TEAMS: TeamId[] = ['A', 'B', 'C', 'D']
const TOP_DOWN: Floor[] = [...FLOORS].reverse()

// ── 시각 ────────────────────────────────────────────────────────

function hhmm(ms: number): string {
  const f = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(ms))
  return `${f.find((p) => p.type === 'hour')?.value ?? ''}:${f.find((p) => p.type === 'minute')?.value ?? ''}`
}
function agoText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}초 전`
  if (s < 3600) return `${Math.floor(s / 60)}분 전`
  return `${Math.floor(s / 3600)}시간 전`
}
function spanText(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000))
  return m < 60 ? `${m}분` : `${Math.floor(m / 60)}시간 ${m % 60}분`
}

// ── 판 ──────────────────────────────────────────────────────────

/** 층마다 그릴 네모(칸). 방과 복도를 다 덮고 벽 한 칸을 더 둔다 */
const BOUNDS: Record<Floor, { x0: number; y0: number; x1: number; y1: number }> = Object.fromEntries(
  FLOORS.map((f) => {
    const rs = [...TILES.filter((t) => t.floor === f).map((t) => t.plan), ...HALLS.filter((h) => h.floor === f).map((h) => h.rect)]
    return [
      f,
      {
        x0: Math.min(...rs.map((r) => r.x)) - 1,
        y0: Math.min(...rs.map((r) => r.y)) - 1,
        x1: Math.max(...rs.map((r) => r.x + r.w)),
        y1: Math.max(...rs.map((r) => r.y + r.h)),
      },
    ]
  }),
) as Record<Floor, { x0: number; y0: number; x1: number; y1: number }>

function floorOfY(y: number): Floor | null {
  for (const f of FLOORS) if (y >= BOUNDS[f].y0 && y <= BOUNDS[f].y1) return f
  return null
}

/**
 * 방 순서 — 위층부터, 도면의 줄마다 왼쪽에서 오른쪽. 줄은 **위아래로
 * 겹치는 방끼리**다(전체 맵과 같은 셈). y 로만 줄 세우면 한두 칸 높이가
 * 다른 옆방이 앞뒤로 뒤집힌다.
 */
const ROOM_ORDER: TileId[] = TOP_DOWN.flatMap((f) => {
  const here = TILES.filter((t) => t.floor === f)
    .slice()
    .sort((a, b) => a.plan.y - b.plan.y || a.plan.x - b.plan.x)
  const rows: (typeof here)[] = []
  for (const t of here) {
    const row = rows.find((r) => r[0].plan.y < t.plan.y + t.plan.h && t.plan.y < r[0].plan.y + r[0].plan.h)
    if (row) row.push(t)
    else rows.push([t])
  }
  return rows.flatMap((r) => r.slice().sort((a, b) => a.plan.x - b.plan.x).map((t) => t.id as TileId))
})

const OUTDOOR: ReadonlySet<string> = new Set(['playground', 'garden', 'rooftop'])
const TEAM_WASH: Record<TeamId, string> = { A: '#ffd8d6', B: '#d6e2ff', C: '#d2f0e0', D: '#ffeccc' }
const VENDING_CELLS = new Set(VENDINGS.map((v) => `${v.cell.x},${v.cell.y}`))
const MAKER_CELLS = new Set(MAKERS.map((m) => `${m.cell.x},${m.cell.y}`))
const LAB_CELLS = new Set(LAB_MACHINES.map((c) => `${c.x},${c.y}`))
const BOARD_CELLS = new Set(BOARDS.map((b) => `${b.cell.x},${b.cell.y}`))
const ARCADE_CELLS: ReadonlyMap<string, number> = new Map(ARCADE_MACHINES.map((m) => [`${m.cell.x},${m.cell.y}`, m.i]))
const CABINETS = ['arcade', 'arcadeB', 'arcadeC'] as const

let SPRITES: SpriteSet | null = null
const sprites = (): SpriteSet => (SPRITES ??= buildSprites())

/** 걷는 칸이 옆에 있는 벽만 그린다. 건물 밖까지 벽돌로 채우면 도면이 안 읽힌다 */
function nearWalk(x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (tileAt(x + dx, y + dy) !== 'wall') return true
  return false
}

/**
 * 한 층을 도트 그대로 그린다. **플레이어 화면(Walk)과 같은 조각을 쓴다** —
 * 바닥 · 벽 · 문 · 계단 · 소품 · 팻말 · 기물. 안개와 눈은 없다.
 */
function paintFloor(cv: HTMLCanvasElement, floor: Floor, rooms: Record<string, RoomState>, items: LiveMapData['floor']): void {
  const b = BOUNDS[floor]
  const w = (b.x1 - b.x0 + 1) * TILE
  const h = (b.y1 - b.y0 + 1) * TILE
  if (cv.width !== w) cv.width = w
  if (cv.height !== h) cv.height = h
  const ctx = cv.getContext('2d')
  if (!ctx) return
  ctx.imageSmoothingEnabled = false
  const sp = sprites()
  const plates = signSheet()
  ctx.fillStyle = PAL.ink
  ctx.fillRect(0, 0, w, h)
  const own = (id: string | null | undefined) => (id ? (rooms[id]?.owner ?? null) : null)
  const ownerAround = (x: number, y: number): TeamId | null => {
    const here = roomAt(x, y)?.id
    if (here) return own(here)
    const around = [own(roomAt(x - 1, y)?.id), own(roomAt(x + 1, y)?.id), own(roomAt(x, y - 1)?.id), own(roomAt(x, y + 1)?.id)]
    const t = [...new Set(around.filter(Boolean))]
    return t.length === 1 ? (t[0] as TeamId) : null
  }
  const signs: { img: HTMLCanvasElement; ox: number; dx: number; dy: number }[] = []
  for (let y = b.y0; y <= b.y1; y++) {
    for (let x = b.x0; x <= b.x1; x++) {
      const dx = (x - b.x0) * TILE
      const dy = (y - b.y0) * TILE
      const kind = tileAt(x, y)
      const room = roomAt(x, y)?.id ?? null
      if (kind === 'wall') {
        if (!nearWalk(x, y)) continue
        ctx.drawImage(tileAt(x, y - 1) === 'wall' ? sp.tiles.wallBody : sp.tiles.wall, dx, dy)
      } else if (kind === 'door') {
        ctx.drawImage(doorIsHorizontal(x, y) ? sp.tiles.doorH : sp.tiles.doorV, dx, dy)
      } else {
        const base =
          kind === 'hall'
            ? isAlleyCell(x, y) ? sp.tiles.floorAlley : sp.tiles.floorHall
            : room !== null && OUTDOOR.has(room) ? sp.tiles.floorOut : sp.tiles.floorRoom
        ctx.drawImage(base, dx, dy)
        const team = own(room)
        if (team) ctx.drawImage(sp.tiles.floorTeam[team], dx, dy)
      }
      const step = stairHere(x, y)
      if (step) ctx.drawImage(step.up ? sp.tiles.stairUp : sp.tiles.stairDown, dx, dy)
      const owner = ownerAround(x, y)
      if (owner && kind !== 'hall') {
        ctx.globalCompositeOperation = 'multiply'
        ctx.fillStyle = TEAM_WASH[owner]
        ctx.fillRect(dx, dy, TILE, TILE)
        ctx.globalCompositeOperation = 'source-over'
      }
      const mark = markAt(x, y)
      if (mark) ctx.drawImage(sp.marks[mark], dx, dy)
      const prop = propAt(x, y)
      if (prop) drawPiece(ctx, sp.props[prop.kind], prop.ox, prop.oy, dx, dy)
      const k = `${x},${y}`
      if (BOARD_CELLS.has(k)) ctx.drawImage(sp.props.noticeBoard, dx, dy - TILE)
      if (MAKER_CELLS.has(k)) ctx.drawImage(sp.props.trapMaker, dx, dy)
      if (LAB_CELLS.has(k)) ctx.drawImage(sp.props.labMachine, dx, dy)
      if (VENDING_CELLS.has(k)) ctx.drawImage(sp.props.vending, dx, dy - TILE)
      const cab = ARCADE_CELLS.get(k)
      if (cab !== undefined) ctx.drawImage(sp.props[CABINETS[cab % CABINETS.length]], dx, dy - TILE)
      const sign = signAt(x, y)
      if (sign) signs.push({ img: plates[sign.id], ox: sign.ox, dx, dy })
    }
  }
  for (const s of signs) drawPiece(ctx, s.img, s.ox, 0, s.dx, s.dy)
  // 바닥에 놓인 종이 · 심부름 물건 — 자리만
  for (const it of items) {
    if (floorOfY(it.y) !== floor) continue
    const img = it.kind === 'quiz' ? sp.paper : it.kind === 'slip' ? sp.slip : sp.things[it.icon as keyof SpriteSet['things']]
    if (!img) continue
    const inset = Math.round((TILE - img.width) / 2)
    ctx.drawImage(img, (it.x - b.x0) * TILE + inset, (it.y - b.y0) * TILE + inset)
  }
}

// ── 사람을 어디에 세우나 ────────────────────────────────────────

interface Spot {
  floor: Floor
  /** 판 화소(층 네모 기준 아님 — 판 전체 기준). 발끝이다 */
  x: number
  y: number
  /** 칸을 모른다 — 방 가운데 근처에 흩어 세웠다 */
  guess: boolean
}

function roomCenter(id: TileId): { x: number; y: number } {
  const r = TILE_BY_ID[id].plan
  return { x: (r.x + r.w / 2) * TILE, y: (r.y + r.h / 2) * TILE }
}

/** 층마다 복도 칸. 걷는 사람을 세울 자리다 */
const HALL_CELLS = new Map<Floor, Cell[]>()
function nearestHall(floor: Floor, x: number, y: number, taken: Set<string>): Cell {
  let cells = HALL_CELLS.get(floor)
  if (!cells) {
    cells = []
    for (const h of HALLS) {
      if (h.floor !== floor) continue
      for (let cy = h.rect.y; cy < h.rect.y + h.rect.h; cy++) for (let cx = h.rect.x; cx < h.rect.x + h.rect.w; cx++) cells.push({ x: cx, y: cy })
    }
    HALL_CELLS.set(floor, cells)
  }
  let best: Cell = { x: Math.round(x), y: Math.round(y) }
  let d = Infinity
  for (const c of cells) {
    if (taken.has(`${c.x},${c.y}`)) continue
    const e = Math.hypot(c.x - x, c.y - y)
    if (e < d) {
      d = e
      best = c
    }
  }
  return best
}

function spotsOf(people: readonly LivePerson[]): Map<string, Spot> {
  const out = new Map<string, Spot>()
  const guessed = new Map<string, number>()
  const walkers = new Set<string>()
  for (const p of people) {
    if (p.live && p.tileId !== null) {
      const f = floorOfY(p.live.y)
      if (f) {
        out.set(p.playerId, { floor: f, x: (p.live.x + 0.5) * TILE, y: (p.live.y + 1) * TILE - 2, guess: false })
        continue
      }
    }
    if (p.at && p.tileId !== null) {
      const f = floorOfY(p.at.y)
      if (f) {
        out.set(p.playerId, { floor: f, x: (p.at.x + 0.5) * TILE, y: (p.at.y + 1) * TILE - 2, guess: false })
        continue
      }
    }
    // 걷는 중 — 떠난 방과 다음 방 사이. 층이 다르면 떠난 방 문간
    if (p.walk) {
      const from = p.walk.fromTile && TILE_BY_ID[p.walk.fromTile] ? p.walk.fromTile : null
      const next = p.walk.nextTile && TILE_BY_ID[p.walk.nextTile] ? p.walk.nextTile : null
      const a = from ?? next
      if (!a) continue
      const ca = roomCenter(a)
      const same = from && next && TILE_BY_ID[from].floor === TILE_BY_ID[next].floor
      const cb = same ? roomCenter(next) : ca
      // 방과 방 사이는 벽이다. 가운데서 제일 가까운 복도 칸에 세운다
      const h = nearestHall(TILE_BY_ID[a].floor, (ca.x + cb.x) / 2 / TILE, (ca.y + cb.y) / 2 / TILE, walkers)
      walkers.add(`${h.x},${h.y}`)
      out.set(p.playerId, { floor: TILE_BY_ID[a].floor, x: (h.x + 0.5) * TILE, y: (h.y + 1) * TILE - 2, guess: true })
      continue
    }
    // 방은 아는데 칸을 모른다 — 가운데서부터 세 줄로 흩는다
    if (p.tileId && TILE_BY_ID[p.tileId]) {
      const i = guessed.get(p.tileId) ?? 0
      guessed.set(p.tileId, i + 1)
      const c = roomCenter(p.tileId)
      out.set(p.playerId, {
        floor: TILE_BY_ID[p.tileId].floor,
        x: c.x + ((i % 3) - 1) * TILE * 1.6,
        y: c.y + Math.floor(i / 3) * TILE * 1.6,
        guess: true,
      })
    }
  }
  return out
}

/** 얼굴 한 장. 사람마다 한 번만 굽는다 */
const faceCache = new Map<string, string>()
function faceOf(p: LivePerson): string | null {
  if (!p.look) return null
  const key = `${p.playerId}-${p.team ?? '-'}`
  const hit = faceCache.get(key)
  if (hit) return hit
  try {
    const url = pixelFrame(normalizeLook(p.look), p.team, 'down', 0).toDataURL()
    faceCache.set(key, url)
    return url
  } catch {
    return null
  }
}

/** 목록에서 묶는 이름 */
const groupOf = (p: LivePerson): string => (p.walk ? '걷는 중' : p.inHall ? '복도' : (p.roomName ?? '어딘가'))
const roomKeyOf = (p: LivePerson): string | null => (p.walk ? null : p.inHall ? 'hall' : p.tileId)
const chatRoomName = (room: string): string => (room === 'all' ? '전체' : room === 'hall' ? '복도' : (TILE_BY_ID[room as TileId]?.name ?? room))

// ── 화면 ────────────────────────────────────────────────────────

/** 화면이 보이는가. 꺼지면 읽기를 멈춘다 */
function useVisible(): boolean {
  const [on, setOn] = useState(() => document.visibilityState !== 'hidden')
  useEffect(() => {
    const f = () => setOn(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', f)
    return () => document.removeEventListener('visibilitychange', f)
  }, [])
  return on
}

type Pane = { kind: 'person'; id: string } | { kind: 'room'; room: string } | null
interface View {
  s: number
  x: number
  y: number
}

export function LiveMap({ act, onSaid }: { act: GameActions; onSaid: (t: string) => void }) {
  const visible = useVisible()
  const [data, setData] = useState<LiveMapData | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [floor, setFloor] = useState<Floor | null>(null)
  const [pane, setPane] = useState<Pane>(null)
  const [team, setTeam] = useState<TeamId | 'all'>('all')
  const [sums, setSums] = useState<ChatSum[]>([])

  // 지도 — 몇 초마다
  useEffect(() => {
    if (!visible) return
    let alive = true
    const pull = async () => {
      try {
        const out = (await act.hostLiveMap()) as LiveMapData
        if (!alive) return
        setData(out)
        setFailed(null)
      } catch (e) {
        if (alive) setFailed((e as Error).message)
      }
    }
    void pull()
    const t = window.setInterval(() => void pull(), MAP_MS)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [act, visible])

  // 방마다 말 줄 수 — 가끔
  useEffect(() => {
    if (!visible) return
    let alive = true
    const pull = async () => {
      try {
        const out = (await act.hostRoomChat(null, 0, true)) as { rooms: ChatSum[] | null }
        if (alive) setSums(out.rooms ?? [])
      } catch {
        // 줄 수는 곁가지다. 못 세도 지도는 선다
      }
    }
    void pull()
    const t = window.setInterval(() => void pull(), SUM_MS)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [act, visible])

  const people = useMemo(() => data?.people ?? [], [data])
  const spots = useMemo(() => spotsOf(people), [people])
  const perFloor = useMemo(() => {
    const n: Record<Floor, number> = { roof: 0, f2: 0, f1: 0, b1: 0 }
    for (const s of spots.values()) n[s.floor] += 1
    return n
  }, [spots])

  // 처음 연 층 — 사람이 제일 많은 층
  useEffect(() => {
    if (floor !== null || !data) return
    const best = TOP_DOWN.slice().sort((a, b) => perFloor[b] - perFloor[a])[0]
    setFloor(best ?? 'f1')
  }, [data, floor, perFloor])

  const sumBy = useMemo(() => new Map(sums.map((s) => [s.room, s])), [sums])
  const picked = pane?.kind === 'person' ? (people.find((p) => p.playerId === pane.id) ?? null) : null

  const [focus, setFocus] = useState<{ x: number; y: number; n: number } | null>(null)
  const pickPerson = useCallback(
    (id: string, center: boolean) => {
      setPane({ kind: 'person', id })
      const s = spots.get(id)
      if (s && center) {
        setFloor(s.floor)
        setFocus({ x: s.x, y: s.y, n: Date.now() })
      }
    },
    [spots],
  )

  if (failed && !data) return <p className="sc-ad__hint">{failed}</p>
  if (!data || !floor) return <p className="sc-ad__hint">지도를 읽는 중이다.</p>

  const shown = team === 'all' ? people : people.filter((p) => p.team === team)
  const groups = new Map<string, LivePerson[]>()
  const order = ['걷는 중', ...ROOM_ORDER.map((id) => TILE_BY_ID[id].name), '복도', '어딘가']
  for (const p of shown) {
    const g = groupOf(p)
    groups.set(g, [...(groups.get(g) ?? []), p])
  }
  const groupList = [...groups.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))

  return (
    <div className="sc-lvm">
      <div className="sc-lvm__floors" role="tablist" aria-label="층">
        {TOP_DOWN.map((f) => (
          <button key={f} className={f === floor ? 'is-on' : ''} onClick={() => setFloor(f)}>
            {FLOOR_NAME[f]}
            <em>{perFloor[f]}</em>
          </button>
        ))}
        <button className={`sc-lvm__chatall${pane?.kind === 'room' && pane.room === 'all' ? ' is-on' : ''}`} onClick={() => setPane({ kind: 'room', room: 'all' })}>
          채팅
        </button>
      </div>

      <Board
        floor={floor}
        data={data}
        spots={spots}
        team={team}
        pickedId={picked?.playerId ?? null}
        pickedRoom={pane?.kind === 'room' ? pane.room : null}
        sumBy={sumBy}
        focus={focus}
        onPerson={(id) => pickPerson(id, false)}
        onRoom={(room) => setPane({ kind: 'room', room })}
      />

      {failed && <p className="sc-lvm__warn">다시 읽지 못했다 — {failed}</p>}

      {picked && <PersonCard p={picked} nowMs={data.nowMs} onRoom={(r) => setPane({ kind: 'room', room: r })} onClose={() => setPane(null)} />}
      {pane?.kind === 'room' && (
        <RoomCard
          key={pane.room}
          act={act}
          room={pane.room}
          data={data}
          sums={sums}
          onPick={(r) => setPane({ kind: 'room', room: r })}
          onPerson={(id) => pickPerson(id, true)}
          onClose={() => setPane(null)}
          onSaid={onSaid}
        />
      )}

      <div className="sc-lvm__chips" role="group" aria-label="팀 거르기">
        {(['all', ...TEAMS] as const).map((t) => (
          <button key={t} className={team === t ? 'is-on' : ''} onClick={() => setTeam(t)}>
            {t !== 'all' && <i style={{ background: TEAM_COLOR[t] }} />}
            {t === 'all' ? `전체 ${people.length}` : `${t} ${people.filter((p) => p.team === t).length}`}
          </button>
        ))}
      </div>

      <div className="sc-lvm__list">
        {groupList.map(([g, rows]) => (
          <section key={g}>
            <h3>
              {g}
              <em>{rows.length}명</em>
            </h3>
            <ul>
              {rows.map((p) => (
                <li key={p.playerId}>
                  <button className={`sc-lvm__row is-${p.kind}${picked?.playerId === p.playerId ? ' is-on' : ''}`} onClick={() => pickPerson(p.playerId, true)}>
                    <i className="sc-lvm__dot" style={{ background: p.team ? TEAM_COLOR[p.team] : undefined }} />
                    <b>
                      {p.name}
                      {p.invisible && <small className="sc-lvm__inv">투명</small>}
                    </b>
                    <span>{p.doing}</span>
                    <time>{p.seenAgoMs !== null ? agoText(p.seenAgoMs) : ''}</time>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}

// ── 지도 상자 ───────────────────────────────────────────────────

function Board({
  floor,
  data,
  spots,
  team,
  pickedId,
  pickedRoom,
  sumBy,
  focus,
  onPerson,
  onRoom,
}: {
  floor: Floor
  data: LiveMapData
  spots: Map<string, Spot>
  team: TeamId | 'all'
  pickedId: string | null
  pickedRoom: string | null
  sumBy: Map<string, ChatSum>
  focus: { x: number; y: number; n: number } | null
  onPerson: (id: string) => void
  onRoom: (room: string) => void
}) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const cvRef = useRef<HTMLCanvasElement | null>(null)
  const b = BOUNDS[floor]
  const cw = (b.x1 - b.x0 + 1) * TILE
  const ch = (b.y1 - b.y0 + 1) * TILE
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [view, setView] = useState<View>({ s: 0, x: 0, y: 0 })
  const viewRef = useRef(view)
  viewRef.current = view

  const fit = box.w > 0 ? Math.min(box.w / cw, box.h / ch) : 0
  const clampView = useCallback(
    (v: View): View => {
      const s = Math.min(MAX_SCALE, Math.max(fit, v.s))
      const w = cw * s
      const h = ch * s
      const x = w <= box.w ? (box.w - w) / 2 : Math.min(0, Math.max(box.w - w, v.x))
      const y = h <= box.h ? (box.h - h) / 2 : Math.min(0, Math.max(box.h - h, v.y))
      return { s, x, y }
    },
    [fit, cw, ch, box.w, box.h],
  )

  // 상자 크기 — 너비는 틀이 정하고, 높이는 층 모양에 맞춘다
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const measure = () => {
      const w = el.clientWidth
      if (w <= 0) return
      setBox((had) => (had.w === w && had.h === el.clientHeight ? had : { w, h: el.clientHeight }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const wantH = box.w > 0 ? Math.round(Math.min(window.innerHeight * 0.55, Math.max(230, (box.w * ch) / cw + 28))) : 260

  // 층이 바뀌면 통째로 맞춰 본다
  useEffect(() => {
    if (fit > 0) setView({ s: fit, x: (box.w - cw * fit) / 2, y: (box.h - ch * fit) / 2 })
    // 층과 상자가 바뀔 때만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor, fit])

  // 목록에서 누른 사람에게 다가간다
  useEffect(() => {
    if (!focus || fit <= 0) return
    const s = Math.max(1, viewRef.current.s)
    const px = focus.x - b.x0 * TILE
    const py = focus.y - b.y0 * TILE
    setView(clampView({ s, x: box.w / 2 - px * s, y: box.h / 2 - py * s }))
    // 누른 때만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, floor])

  // 그림 — 층이나 방 주인, 바닥 물건이 바뀔 때만 다시 그린다
  const paintKey = JSON.stringify([floor, Object.entries(data.rooms).map(([k, r]) => [k, r.owner]), data.floor])
  useEffect(() => {
    const cv = cvRef.current
    if (!cv) return
    paintFloor(cv, floor, data.rooms, data.floor)
    // 팻말 글꼴이 늦게 오면 한 번 더
    const t = window.setTimeout(() => paintFloor(cv, floor, data.rooms, data.floor), 600)
    return () => window.clearTimeout(t)
    // paintKey 가 곧 그림의 재료다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paintKey])

  const zoomAt = useCallback(
    (factor: number, cx: number, cy: number) => {
      const v = viewRef.current
      const s = Math.min(MAX_SCALE, Math.max(fit, v.s * factor))
      setView(clampView({ s, x: cx - (cx - v.x) * (s / v.s), y: cy - (cy - v.y) * (s / v.s) }))
    },
    [fit, clampView],
  )

  // 끌어서 옮기고, 두 손가락으로 넓히고, 짧게 누르면 방을 고른다
  const onRoomRef = useRef(onRoom)
  onRoomRef.current = onRoom
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const pts = new Map<number, { x: number; y: number }>()
    let start: { x: number; y: number; t: number; moved: number } | null = null
    let base = { v: viewRef.current, gap: 0, mid: { x: 0, y: 0 } }
    const local = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const midGap = () => {
      const all = [...pts.values()]
      const mid = { x: all.reduce((s, p) => s + p.x, 0) / all.length, y: all.reduce((s, p) => s + p.y, 0) / all.length }
      const gap = all.length >= 2 ? Math.hypot(all[0].x - all[1].x, all[0].y - all[1].y) : 0
      return { mid, gap }
    }
    const rebase = () => {
      const { mid, gap } = midGap()
      base = { v: viewRef.current, gap, mid }
    }
    const down = (e: PointerEvent) => {
      pts.set(e.pointerId, local(e))
      if (pts.size === 1) start = { ...local(e), t: Date.now(), moved: 0 }
      else start = null
      rebase()
    }
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return
      const p = local(e)
      const was = pts.get(e.pointerId)
      pts.set(e.pointerId, p)
      if (start && was) start.moved += Math.hypot(p.x - was.x, p.y - was.y)
      if (start && start.moved < 6) return
      const { mid, gap } = midGap()
      const v = base.v
      let s = v.s
      if (pts.size >= 2 && base.gap > 0) s = Math.min(MAX_SCALE, Math.max(fit, v.s * (gap / base.gap)))
      const x = mid.x - (base.mid.x - v.x) * (s / v.s)
      const y = mid.y - (base.mid.y - v.y) * (s / v.s)
      setView(clampView({ s, x, y }))
      e.preventDefault()
    }
    const up = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return
      pts.delete(e.pointerId)
      const tap = start && start.moved < 6 && Date.now() - start.t < 600 && pts.size === 0
      // 사람 · 넓히기 단추를 누른 것은 방을 고른 것이 아니다
      const onButton = (e.target as HTMLElement | null)?.closest?.('button')
      if (tap && !onButton) {
        const v = viewRef.current
        const p = local(e)
        const cx = Math.floor((p.x - v.x) / v.s / TILE) + b.x0
        const cy = Math.floor((p.y - v.y) / v.s / TILE) + b.y0
        const room = roomOfCell(cx, cy)
        if (room) onRoomRef.current(room)
        else if (isHallCell(cx, cy)) onRoomRef.current('hall')
      }
      start = null
      if (pts.size > 0) rebase()
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top)
    }
    el.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    el.addEventListener('wheel', wheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      el.removeEventListener('wheel', wheel)
    }
  }, [fit, clampView, zoomAt, b.x0, b.y0])

  const s = view.s || fit
  const toScreen = (mx: number, my: number) => ({ x: view.x + (mx - b.x0 * TILE) * s, y: view.y + (my - b.y0 * TILE) * s })
  const dots = s < DOT_BELOW
  const here = data.people
    .filter((p) => spots.get(p.playerId)?.floor === floor)
    // 아래에 선 사람이 앞으로 온다
    .sort((a, c) => (spots.get(a.playerId)?.y ?? 0) - (spots.get(c.playerId)?.y ?? 0))
  const rooms = TILES.filter((t) => t.floor === floor)
  /*
   * 이름표가 겹치면 아래로 한 줄씩 비킨다. 옆 칸에 붙어 선 둘(거래하는
   * 둘이 그렇다)은 이름표가 서로를 덮는다 — 누가 누구인지가 이 화면의 전부다.
   */
  const tagDy = new Map<string, number>()
  {
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = []
    const faceSize = Math.max(18, Math.round(CHAR_PX * s))
    for (const p of [...here].sort((a, c) => (spots.get(a.playerId)?.y ?? 0) - (spots.get(c.playerId)?.y ?? 0) || (spots.get(a.playerId)?.x ?? 0) - (spots.get(c.playerId)?.x ?? 0))) {
      if (dots && p.playerId !== pickedId) continue
      const at = toScreen(spots.get(p.playerId)!.x, spots.get(p.playerId)!.y)
      const w = [...p.name].length * 11 + (p.kind !== 'idle' ? 9 : 0) + 14
      const top = at.y + (dots ? 6 : Math.round(faceSize * (6 / 32))) + 1
      let dy = 0
      const hit = (y: number) => placed.some((r) => r.x0 < at.x + w / 2 && at.x - w / 2 < r.x1 && r.y0 < y + 14 && y < r.y1)
      while (dy < 60 && hit(top + dy)) dy += 15
      placed.push({ x0: at.x - w / 2, x1: at.x + w / 2, y0: top + dy, y1: top + dy + 14 })
      tagDy.set(p.playerId, dy)
    }
  }
  const pr = pickedRoom && pickedRoom !== 'all' && pickedRoom !== 'hall' ? TILE_BY_ID[pickedRoom as TileId] : null

  return (
    <div className="sc-lvm__box" ref={boxRef} style={{ height: wantH }}>
      <canvas
        ref={cvRef}
        className="sc-lvm__cv"
        style={{
          width: cw * s,
          height: ch * s,
          transform: `translate(${Math.round(view.x)}px, ${Math.round(view.y)}px)`,
          imageRendering: s >= 1 ? 'pixelated' : 'auto',
        }}
      />
      {/* 팻말이 안 읽히는 크기에서는 방 이름을 따로 띄운다 */}
      {s < LABEL_BELOW &&
        rooms.map((t) => {
          const at = toScreen(t.plan.x * TILE, t.plan.y * TILE)
          const r = data.rooms[t.id]
          const n = sumBy.get(t.id)?.lines ?? 0
          return (
            <span
              key={t.id}
              className="sc-lvm__rn"
              style={{ left: Math.round(at.x) + 2, top: Math.round(at.y) + 2, maxWidth: Math.max(24, t.plan.w * TILE * s - 4), ...(r?.owner ? ({ '--own': TEAM_COLOR[r.owner] } as CSSProperties) : {}) }}
            >
              {r?.owner && <i />}
              {t.name}
              {n > 0 && <em>{n}</em>}
            </span>
          )
        })}
      {pr && (() => {
        const a = toScreen(pr.plan.x * TILE, pr.plan.y * TILE)
        return <span className="sc-lvm__pick" style={{ left: a.x, top: a.y, width: pr.plan.w * TILE * s, height: pr.plan.h * TILE * s }} />
      })()}
      {here.map((p) => {
        const sp = spots.get(p.playerId) as Spot
        const at = toScreen(sp.x, sp.y)
        const face = dots ? null : faceOf(p)
        const size = Math.max(18, Math.round(CHAR_PX * s))
        const off = team !== 'all' && p.team !== team
        const cls = [
          'sc-lvm__who',
          `is-${p.kind}`,
          sp.guess ? 'is-guess' : '',
          p.playerId === pickedId ? 'is-on' : '',
          off ? 'is-off' : '',
          p.invisible ? 'is-invis' : '',
        ]
          .filter(Boolean)
          .join(' ')
        const color = p.team ? TEAM_COLOR[p.team] : '#888'
        return (
          <button
            key={p.playerId}
            className={cls}
            style={{ left: Math.round(at.x), top: Math.round(at.y), '--tm': color } as CSSProperties}
            onClick={(e) => {
              e.stopPropagation()
              onPerson(p.playerId)
            }}
            aria-label={`${p.name} · ${p.doing}`}
          >
            {face ? (
              <img src={face} alt="" width={size} height={size} style={{ marginTop: -Math.round(size * (26 / 32)) }} draggable={false} />
            ) : (
              <i className="sc-lvm__pin" />
            )}
            {(!dots || p.playerId === pickedId) && (
              <span className="sc-lvm__tag" style={tagDy.get(p.playerId) ? { marginTop: 1 + (tagDy.get(p.playerId) ?? 0) } : undefined}>
                {p.kind !== 'idle' && <i className="sc-lvm__k" />}
                {p.name}
              </span>
            )}
          </button>
        )
      })}
      <div className="sc-lvm__zoom">
        <button aria-label="줄이기" onClick={() => zoomAt(1 / 1.5, box.w / 2, box.h / 2)} disabled={s <= fit + 0.001}>
          −
        </button>
        <button aria-label="넓히기" onClick={() => zoomAt(1.5, box.w / 2, box.h / 2)} disabled={s >= MAX_SCALE - 0.001}>
          +
        </button>
        <button aria-label="층 전체" onClick={() => setView(clampView({ s: fit, x: 0, y: 0 }))}>
          ⤢
        </button>
      </div>
    </div>
  )
}

// ── 누른 사람 ───────────────────────────────────────────────────

function PersonCard({ p, nowMs, onRoom, onClose }: { p: LivePerson; nowMs: number; onRoom: (r: string) => void; onClose: () => void }) {
  const room = roomKeyOf(p)
  const where = p.walk
    ? `${p.walk.fromTile ? TILE_BY_ID[p.walk.fromTile]?.name : '?'} → ${p.walk.destTile ? TILE_BY_ID[p.walk.destTile]?.name : '?'}`
    : `${p.roomName ?? '?'}${p.at ? ` (${p.at.x},${p.at.y})` : ' · 칸 모름'}`
  const since =
    p.untilMs !== null
      ? `${hhmm(p.untilMs)}까지 (${spanText(p.untilMs - nowMs)} 남음)`
      : p.sinceMs !== null
        ? `${hhmm(p.sinceMs)}부터 (${spanText(nowMs - p.sinceMs)})`
        : '—'
  return (
    <div className="sc-lvm__card">
      <header>
        <i className="sc-lvm__dot" style={{ background: p.team ? TEAM_COLOR[p.team] : undefined }} />
        <b>{p.name}</b>
        <span className="sc-lvm__team">{p.team ? `${p.team}팀` : '팀 없음'}</span>
        {p.invisible && <span className="sc-lvm__badge is-invis">투명</span>}
        <button className="sc-lvm__x" onClick={onClose} aria-label="닫기">
          ✕
        </button>
      </header>
      <dl>
        <div>
          <dt>자리</dt>
          <dd>{where}</dd>
        </div>
        <div>
          <dt>하는 일</dt>
          <dd className={`is-${p.kind}`}>{p.doing}</dd>
        </div>
        <div>
          <dt>{p.untilMs !== null ? '언제까지' : '언제부터'}</dt>
          <dd>{since}</dd>
        </div>
        {p.roomSinceMs !== null && p.sinceMs !== p.roomSinceMs && (
          <div>
            <dt>이 방에</dt>
            <dd>{`${hhmm(p.roomSinceMs)}부터`}</dd>
          </div>
        )}
        {p.errand && (
          <div>
            <dt>심부름</dt>
            <dd>{`${p.errand.thing} · ${TILE_BY_ID[p.errand.from]?.name ?? p.errand.from} → ${TILE_BY_ID[p.errand.to]?.name ?? p.errand.to}${p.errand.carrying ? ' · 들고 있다' : ''}`}</dd>
          </div>
        )}
        <div>
          <dt>마지막 움직임</dt>
          <dd>{p.seenAgoMs !== null ? agoText(p.seenAgoMs) : '기록 없음'}</dd>
        </div>
      </dl>
      {room && (
        <button className="sc-lvm__go" onClick={() => onRoom(room)}>
          {chatRoomName(room)} 채팅 보기
        </button>
      )}
    </div>
  )
}

// ── 누른 방 · 그 방의 말 ─────────────────────────────────────────

function RoomCard({
  act,
  room,
  data,
  sums,
  onPick,
  onPerson,
  onClose,
  onSaid,
}: {
  act: GameActions
  room: string
  data: LiveMapData
  sums: ChatSum[]
  onPick: (r: string) => void
  onPerson: (id: string) => void
  onClose: () => void
  onSaid: (t: string) => void
}) {
  const [lines, setLines] = useState<ChatLine[] | null>(null)
  const logRef = useRef<HTMLOListElement | null>(null)
  const stickRef = useRef(true)
  const [below, setBelow] = useState(false)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const visible = useVisible()

  // 열리면 보이게 끌어온다
  useEffect(() => {
    cardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [])

  // 말 — 처음엔 최근 300줄, 그다음은 새 줄만
  useEffect(() => {
    if (!visible) return
    let alive = true
    let since = 0
    const seen = new Set<string>()
    const pull = async () => {
      try {
        const out = (await act.hostRoomChat(room, since)) as { lines: ChatLine[] | null }
        if (!alive) return
        const fresh = (out.lines ?? []).filter((l) => !seen.has(l.id))
        for (const l of fresh) seen.add(l.id)
        if (fresh.length > 0) since = fresh[fresh.length - 1].atMs
        setLines((had) => (fresh.length === 0 && had ? had : [...(had ?? []), ...fresh]))
      } catch (e) {
        if (alive) onSaid((e as Error).message)
      }
    }
    void pull()
    const t = window.setInterval(() => void pull(), CHAT_MS)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [act, room, visible, onSaid])

  // 새 줄이 오면 맨 아래로 — 위로 올려 읽는 중이면 그대로 둔다
  useEffect(() => {
    const el = logRef.current
    if (!el) return
    if (stickRef.current) el.scrollTop = el.scrollHeight
    else setBelow(true)
  }, [lines])

  const tile = room !== 'all' && room !== 'hall' ? TILE_BY_ID[room as TileId] : null
  const state = tile ? data.rooms[room] : null
  const inside = data.people.filter((p) => roomKeyOf(p) === room)
  const flags = state ? (Object.entries(state.flags) as [TeamId, number][]).filter(([, n]) => n > 0) : []
  const options = ['all', 'hall', ...ROOM_ORDER].filter((r) => r === room || r === 'all' || (sums.find((s) => s.room === r)?.lines ?? 0) > 0)

  return (
    <div className="sc-lvm__card" ref={cardRef}>
      <header>
        <b>{chatRoomName(room)}</b>
        {state?.owner && (
          <span className="sc-lvm__team" style={{ color: TEAM_COLOR[state.owner] }}>
            {state.owner}팀 방
          </span>
        )}
        {room !== 'all' && <span className="sc-lvm__team">{inside.length}명</span>}
        <button className="sc-lvm__x" onClick={onClose} aria-label="닫기">
          ✕
        </button>
      </header>
      {state && (flags.length > 0 || state.robots > 0 || state.lockedBy) && (
        <p className="sc-lvm__facts">
          {flags.map(([t, n]) => (
            <span key={t} style={{ color: TEAM_COLOR[t] }}>
              깃발 {t} {n}
            </span>
          ))}
          {state.robots > 0 && <span>로봇 {state.robots}</span>}
          {state.lockedBy && <span>{state.lockedBy}팀 자물쇠</span>}
        </p>
      )}
      {inside.length > 0 && (
        <ul className="sc-lvm__inside">
          {inside.map((p) => (
            <li key={p.playerId}>
              <button onClick={() => onPerson(p.playerId)}>
                <i className="sc-lvm__dot" style={{ background: p.team ? TEAM_COLOR[p.team] : undefined }} />
                {p.name}
                <em>{p.doing}</em>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="sc-lvm__chatbar">
        <label>
          <span>채팅</span>
          <select value={room} onChange={(e) => onPick(e.target.value)}>
            {options.map((r) => {
              const n = r === 'all' ? sums.reduce((a, s) => a + s.lines, 0) : (sums.find((s) => s.room === r)?.lines ?? 0)
              return (
                <option key={r} value={r}>
                  {chatRoomName(r)}
                  {n > 0 ? ` · ${n}줄` : ''}
                </option>
              )
            })}
          </select>
        </label>
        <span className="sc-rk__live">실시간</span>
      </div>
      {lines === null ? (
        <p className="sc-ad__hint">말을 읽는 중이다.</p>
      ) : lines.length === 0 ? (
        <p className="sc-lvm__empty">아직 아무도 말하지 않았다</p>
      ) : (
        <div className="sc-lvm__logwrap">
          <ol
            className="sc-lvm__log"
            ref={logRef}
            onScroll={(e) => {
              const el = e.currentTarget
              stickRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 24
              if (stickRef.current) setBelow(false)
            }}
          >
            {lines.map((l) => (
              <li key={l.id} className={l.hidden ? 'is-hidden' : ''}>
                <time>{hhmm(l.atMs)}</time>
                {room === 'all' && <em className="sc-lvm__where">{l.roomName}</em>}
                <b style={{ color: TEAM_COLOR[l.team as TeamId] ?? undefined }}>
                  {l.name || '이름 없음'}
                  {l.hidden && <small>안 보임</small>}
                </b>
                <span>{l.text}</span>
              </li>
            ))}
          </ol>
          {below && (
            <button
              className="sc-lvm__down"
              onClick={() => {
                const el = logRef.current
                if (el) el.scrollTop = el.scrollHeight
                stickRef.current = true
                setBelow(false)
              }}
            >
              새 줄 ↓
            </button>
          )}
        </div>
      )}
    </div>
  )
}
