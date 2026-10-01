// 미니맵과 전체 맵.
//
// 그림은 MapPlan 하나가 그린다. 여기서는 **어디에 띄우고 어떻게
// 만지는지**만 다룬다 — 미니맵은 구석에 떠 있고, 전체 맵은 화면을
// 덮고 손가락으로 넓혔다 줄였다 한다.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from 'react'

import {
  TEAM_COLOR,
  floorCells,
  readMap,
  roomName,
  type Cell,
  type MapFacts,
  type RoomFacts,
} from './MapPlan'
import { ALLEY_NAME, TILES, isAlleyCell } from '../../../shared/rules/board'
import { MAP_H, MAP_W, ROOMS, doorHere, roomAt, tileAt } from '../map/world'
import { ARCADE_COUNT, ARCADE_NAME } from '../../../shared/rules/arcade'
import { Snow } from '../reveal/Snow'
import { MINIMAP_ON_KEY } from './timing'
import { Sheet } from './Sheet'
import type { TeamId, TileId } from '../types'
import { teamName, teamNo } from '../../../shared/rules/bundan'

const KIND_NAME: Record<string, string> = {
  narrow: '좁은 방',
  lab: '연구실',
  normal: '일반 방',
}

/** 미니맵을 켜 두는가. 사람마다 다르고 이 기기에만 남는다. */
export function useMiniMapOn(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(MINIMAP_ON_KEY) !== 'off'
    } catch {
      // 사생활 보호 창에서는 읽지 못한다. 그럴 때는 켜 둔다
      return true
    }
  })
  const set = useCallback((v: boolean) => {
    setOn(v)
    try {
      localStorage.setItem(MINIMAP_ON_KEY, v ? 'on' : 'off')
    } catch {
      // 못 적어도 이번 판은 그대로 쓴다
    }
  }, [])
  return [on, set]
}

// ── 미니맵 ──────────────────────────────────────────────────────

/**
 * **실제 도면을 줄여 그린 미니맵.** 내가 늘 한가운데 점으로 서고, 걸으면
 * 지도가 나를 따라 밀린다 — 내 둘레 반경만큼(가로세로 WIN 칸)이 보인다.
 *
 * 벽·방·복도·문을 칸 하나에 한 화소로 한 번 그려 두고(방은 차지한 분단
 * 색), 매 프레임은 내 둘레만 떼어 확대해 옮긴다. 내 자리는 걸음이 칸을
 * 넘을 때마다 selfRef 로 온다 — 멈출 때까지 기다리지 않는다.
 */
const WIN = 21
export function LiveMiniMap({
  selfRef,
  fallback,
  tiles,
  pawns,
  meId,
  onOpen,
}: {
  selfRef: MutableRefObject<{ x: number; y: number } | null>
  /** 아직 한 걸음도 안 걸었을 때 — 서버가 아는 내 칸 */
  fallback: { x: number; y: number } | null
  tiles: MapFacts['tiles']
  /** 내 눈에 보이는 사람들. 여기 없는 사람은 미니맵에도 없다 */
  pawns: readonly { playerId: string; team: TeamId; at?: { x: number; y: number } | null; walking?: boolean }[]
  meId: string
  onOpen: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // 도면 한 장 — 주인이 바뀔 때만 다시 그린다
  const ownerKey = TILES.map((t) => tiles[t.id as TileId]?.ownerTeam ?? '-').join('')
  const plan = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = MAP_W
    c.height = MAP_H
    const ctx = c.getContext('2d') as CanvasRenderingContext2D
    const img = ctx.createImageData(MAP_W, MAP_H)
    const rgb = (hex: string): [number, number, number] => {
      const h = hex.replace('#', '')
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
    }
    const FLOOR: [number, number, number] = [74, 78, 96]
    const HALL: [number, number, number] = [124, 128, 146]
    const DOOR: [number, number, number] = [206, 196, 160]
    const teamRgb = Object.fromEntries(Object.entries(TEAM_COLOR).map(([k, v]) => [k, rgb(v)])) as Record<string, [number, number, number]>
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const k = tileAt(x, y)
        if (k === 'wall') continue
        let c3 = k === 'hall' ? HALL : k === 'door' ? DOOR : FLOOR
        if (k === 'floor') {
          const owner = tiles[roomAt(x, y)?.id as TileId]?.ownerTeam
          if (owner && teamRgb[owner]) {
            const t = teamRgb[owner]
            c3 = [Math.round(t[0] * 0.55 + FLOOR[0] * 0.45), Math.round(t[1] * 0.55 + FLOOR[1] * 0.45), Math.round(t[2] * 0.55 + FLOOR[2] * 0.45)]
          }
        }
        const i = (y * MAP_W + x) * 4
        img.data[i] = c3[0]
        img.data[i + 1] = c3[1]
        img.data[i + 2] = c3[2]
        img.data[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
    return c
  }, [ownerKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const pawnsRef = useRef(pawns)
  pawnsRef.current = pawns
  const fallbackRef = useRef(fallback)
  fallbackRef.current = fallback

  useEffect(() => {
    let raf = 0
    let drawn = ''
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame)
      const cv = canvasRef.current
      if (!cv) return
      const me = selfRef.current ?? fallbackRef.current
      const size = cv.clientWidth
      if (!me || size <= 0) return
      const blink = Math.floor(t / 450) % 2
      const others = pawnsRef.current.filter((p) => p.playerId !== meId && p.at && !p.walking)
      const key = `${me.x},${me.y},${size},${blink},${others.map((p) => `${p.at?.x},${p.at?.y}`).join(';')},${plan.width}`
      if (key === drawn) return
      drawn = key
      const dpr = Math.min(3, window.devicePixelRatio || 1)
      const px = Math.round(size * dpr)
      if (cv.width !== px) {
        cv.width = px
        cv.height = px
      }
      const ctx = cv.getContext('2d') as CanvasRenderingContext2D
      ctx.imageSmoothingEnabled = false
      ctx.clearRect(0, 0, px, px)
      const cell = px / WIN
      const half = Math.floor(WIN / 2)
      const sx = me.x - half
      const sy = me.y - half
      ctx.drawImage(plan, sx, sy, WIN, WIN, 0, 0, px, px)
      // 방 이름 — 창 안에 걸린 방마다 보이는 부분 한가운데에 적는다.
      // 점만 있으면 바로 위 칸이 미술실인지 음악실인지 도면을 외워야 안다
      ctx.save()
      ctx.font = `${Math.round(10 * dpr)}px Galmuri11, 'Apple SD Gothic Neo', sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.lineJoin = 'round'
      ctx.lineWidth = 3 * dpr
      ctx.strokeStyle = 'rgba(8, 10, 16, 0.9)'
      // 내가 선 방(문턱 포함)은 노란 글자 — 윗줄 방 이름은 서버가 확인한 뒤에야 바뀌어 걷는 동안 늦는다
      const hereId = roomAt(me.x, me.y)?.id ?? doorHere(me.x, me.y)?.a ?? null
      // 적을 이름을 모은다. 내 방이 먼저, 다음은 창에 많이 걸린 방부터
      const cands: { name: string; here: boolean; tx: number; ty: number; tw: number; area: number; lo: number; hi: number }[] = []
      for (const room of ROOMS) {
        for (const r of room.rects) {
          const x0 = Math.max(r.x, sx)
          const y0 = Math.max(r.y, sy)
          const x1 = Math.min(r.x + r.w, sx + WIN)
          const y1 = Math.min(r.y + r.h, sy + WIN)
          if (x1 - x0 < 3 || y1 - y0 < 2) continue
          const tw = ctx.measureText(room.name).width
          cands.push({
            name: room.name,
            here: room.id === hereId,
            tx: ((x0 + x1) / 2 - sx) * cell,
            ty: ((y0 + y1) / 2 - sy) * cell,
            tw,
            area: (x1 - x0) * (y1 - y0),
            lo: (x0 - sx) * cell,
            hi: (x1 - sx) * cell,
          })
        }
      }
      cands.sort((a, b) => Number(b.here) - Number(a.here) || b.area - a.area)
      const th = 12 * dpr
      const pad = 2 * dpr
      const placed: { l: number; r: number; t: number; b: number }[] = []
      for (const c of cands) {
        // 창 가장자리에 걸린 방은 글자를 안쪽으로 민다. 단 **글자 한가운데는
        // 그 방 위에 남아야 한다** — 넘어가면 옆방 이름처럼 읽힌다
        const tx = Math.min(Math.max(c.tx, c.tw / 2 + pad), px - c.tw / 2 - pad)
        if (tx < c.lo || tx > c.hi) continue
        const box = { l: tx - c.tw / 2 - pad, r: tx + c.tw / 2 + pad, t: c.ty - th / 2, b: c.ty + th / 2 }
        // 이미 적은 이름과 겹치면 적지 않는다 — 두 이름이 붙으면 둘 다 못 읽는다
        if (placed.some((p) => box.l < p.r && box.r > p.l && box.t < p.b && box.b > p.t)) continue
        placed.push(box)
        ctx.fillStyle = c.here ? '#ffe27a' : '#f3eed8'
        ctx.strokeText(c.name, tx, c.ty)
        ctx.fillText(c.name, tx, c.ty)
      }
      ctx.restore()
      // 보이는 사람 — 분단 색 작은 점
      for (const p of others) {
        const a = p.at as { x: number; y: number }
        const dx = a.x - sx
        const dy = a.y - sy
        if (dx < 0 || dy < 0 || dx >= WIN || dy >= WIN) continue
        ctx.fillStyle = TEAM_COLOR[p.team] ?? '#ccc'
        ctx.fillRect(dx * cell + cell * 0.15, dy * cell + cell * 0.15, cell * 0.7, cell * 0.7)
      }
      // 나 — 한가운데. 테두리 두른 흰 점이 깜박인다
      const cx = half * cell
      const r = cell * 1.5
      ctx.fillStyle = '#10121a'
      ctx.fillRect(cx - r * 0.5, half * cell - r * 0.5, cell + r, cell + r)
      ctx.fillStyle = blink ? '#ffffff' : '#ffe27a'
      ctx.fillRect(cx - r * 0.5 + dpr, half * cell - r * 0.5 + dpr, cell + r - 2 * dpr, cell + r - 2 * dpr)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [plan, meId, selfRef])

  return (
    <button className="sc-mini is-live" onClick={onOpen} aria-label="전체 맵 열기">
      <canvas ref={canvasRef} className="sc-mini__canvas" />
    </button>
  )
}

// ── 전체 맵 ─────────────────────────────────────────────────────
//
// **겨울 저녁의 학교 도면.** 어두운 복도에서 손전등으로 도면을 보는
// 느낌으로 둔다 — 짙은 남색 바탕에 방만 밝게 뜨고, 모서리는 굴리지
// 않고, 그림자 대신 1px 선으로만 가른다.
//
// 그림은 SVG 가 아니라 네모난 div 다. 픽셀 글꼴은 제 크기(11px)에서만
// 또렷한데, SVG 를 통째로 확대하면 글자도 같이 늘어나 뭉개진다.
// 그래서 **칸 크기만 바꾸고 글자는 늘 11px** 로 둔다 — 넓히면 글자가
// 커지는 게 아니라 이름이 덜 잘린다.

/** 왼쪽에 층 이름이 앉는 자리. */
const GUTTER = 26
/** 한 줄에 이만큼까지. 더 늘리면 칸이 좁아져 이름이 잘린다. */
const MAX_COLS = 4
/** 칸 사이. */
const TILE_GAP = 5
/** 같은 층의 줄 사이 — 여기에 복도가 깔린다. */
const ROW_GAP = 11
/** 층과 층 사이 — 여기에 계단이 놓인다. */
const FLOOR_GAP = 22
/** 도면 가장자리. */
const PAD = 6
/** 칸은 정사각형에 가깝게. 가로가 세로의 이만큼을 못 넘는다. */
const TILE_RATIO = 1.3
/** 픽셀 글꼴이 또렷한 크기. 갈무리11 은 이름 그대로 11px 이다. */
const NAME_PX = 11

/**
 * 그 글자가 몇 화소를 먹는가. 한글은 온폭, 숫자와 기호는 반폭이다.
 *
 * 한 글자를 11px 로 어림하면 「2-3 교실」처럼 숫자가 섞인 이름이
 * 들어가는데도 잘린다. 갈무리는 그런 글자를 반폭으로 그린다.
 */
const charPx = (ch: string) => (/[\uac00-\ud7a3\u3130-\u318f]/.test(ch) ? NAME_PX : NAME_PX / 2)

/**
 * 한 층을 **실제 도면의 줄 순서대로** 늘어놓는다.
 *
 * 도면 그대로 그리면 방 모양이 제각각이라 좁은 방은 이름이 잘린다.
 * 그렇다고 아무렇게나 늘어놓으면 어디가 어딘지 모른다. 그래서
 * 「위아래로 겹치는 방끼리 한 줄」로 묶고 줄 안에서는 왼쪽부터 —
 * 실제 학교를 걸으며 보는 순서 그대로다. 줄과 자리는 판 데이터에서
 * 나오므로 방을 옮기면 여기도 저절로 따라온다.
 */
function floorRows(floor: string): TileId[][] {
  const here = TILES.filter((t) => t.floor === floor)
    .slice()
    .sort((a, b) => a.plan.y - b.plan.y || a.plan.x - b.plan.x)
  // **줄의 기준은 맨 처음 방 하나다.** 「아무 방이든 겹치면 같은 줄」로
  // 두었더니 위아래에 걸친 방(동아리실) 하나가 두 줄을 이어 붙여
  // 일곱 칸짜리 줄이 나왔다. 그러면 이름이 도로 잘린다
  const rows: (typeof here)[] = []
  for (const t of here) {
    const row = rows.find(
      (r) => r[0].plan.y < t.plan.y + t.plan.h && t.plan.y < r[0].plan.y + r[0].plan.h,
    )
    if (row) row.push(t)
    else rows.push([t])
  }
  const out: TileId[][] = []
  for (const r of rows) {
    const line = r
      .slice()
      .sort((a, b) => a.plan.x - b.plan.x)
      .map((t) => t.id as TileId)
    // 그래도 넘치면 접는다. 한 줄이 길어질수록 칸이 좁아진다
    for (let i = 0; i < line.length; i += MAX_COLS) out.push(line.slice(i, i + MAX_COLS))
  }
  return out
}

/** 위층부터 아래층까지. 층마다 몇 줄인지까지 여기서 정해진다. */
function schematic(): { floor: string; name: string; rows: TileId[][] }[] {
  return [...floorCells()]
    .sort((a, b) => a.y - b.y)
    .map((f) => ({ floor: f.floor, name: f.name, rows: floorRows(f.floor) }))
}

export interface Placed {
  id: TileId
  x: number
  y: number
  w: number
  h: number
}
interface Laid {
  w: number
  h: number
  tiles: Placed[]
  /** 층 띠 — 이름과 구분선이 여기에 붙는다. */
  bands: { name: string; y: number; h: number }[]
  /** 복도. 같은 층 줄과 줄 사이에 깔린다. */
  lanes: Cell[]
  /** 계단. 층과 층 사이 양끝에 놓인다. */
  stairs: Cell[]
  /**
   * 뒷골목. **방이 아니라 복도라** 점령 칸(TILES)에 안 들어서 위 줄에 안
   * 나온다. 1층 띠 맨 아래에 따로 한 줄로 붙인다 — 실제로도 1층 동쪽 끝이다.
   */
  alley: Cell | null
}

/**
 * 도면을 화면에 앉힌다. **남은 자리를 재서 칸 크기를 정한다** —
 * 스물다섯 칸이 한 화면에 다 들어와야 하므로 크기는 고르는 것이
 * 아니라 나오는 것이다. 정수로 내림해 화소 격자에 맞춘다.
 */
function layout(boxW: number, boxH: number, zoom: number): Laid {
  const plan = schematic()
  const rowCount = plan.reduce((n, f) => n + f.rows.length, 0)
  const cols = Math.max(...plan.flatMap((f) => f.rows.map((r) => r.length)))
  const innerGaps = rowCount - plan.length
  const availW = boxW - GUTTER - PAD * 2
  const availH = boxH - PAD * 2 - (plan.length - 1) * FLOOR_GAP - innerGaps * ROW_GAP
  const wideMax = Math.floor((availW - (cols - 1) * TILE_GAP) / cols)
  const tallMax = Math.floor(availH / rowCount)
  // 넓히면 **가로 세로가 같이** 커진다. 세로만 키우면 칸이 길쭉해진다
  const grow = 1 + zoom * 0.6
  const base = Math.min(tallMax, wideMax)
  const tileH = Math.max(18, Math.floor(base * grow))
  const tileW = Math.max(24, Math.floor(Math.min(wideMax * grow, tileH * TILE_RATIO)))

  const tiles: Placed[] = []
  const bands: Laid['bands'] = []
  const lanes: Cell[] = []
  const stairs: Cell[] = []
  let alley: Cell | null = null
  const gridW = cols * tileW + (cols - 1) * TILE_GAP
  const left = GUTTER + PAD
  let y = PAD
  plan.forEach((f, fi) => {
    const top = y
    f.rows.forEach((row, ri) => {
      if (ri > 0) {
        lanes.push({ x: left, y: y - ROW_GAP, w: gridW, h: ROW_GAP })
      }
      // 줄이 짧으면 가운데로 모은다. 왼쪽에 붙이면 층마다 들쭉날쭉하다
      const rowW = row.length * tileW + (row.length - 1) * TILE_GAP
      const x0 = left + Math.floor((gridW - rowW) / 2)
      row.forEach((id, ci) => {
        tiles.push({ id, x: x0 + ci * (tileW + TILE_GAP), y, w: tileW, h: tileH })
      })
      y += tileH + (ri + 1 < f.rows.length ? ROW_GAP : 0)
    })
    if (f.floor === 'f1') {
      // 1층 동쪽 끝의 골목. 방 한 칸 높이의 반쯤 되는 띠로, 오른쪽에 붙인다
      const h = Math.max(18, Math.floor(tileH * 0.7))
      const w = Math.min(gridW, tileW * 2 + TILE_GAP)
      alley = { x: left + gridW - w, y: y + ROW_GAP, w, h }
      y += ROW_GAP + h
    }
    bands.push({ name: f.name, y: top, h: y - top })
    if (fi + 1 < plan.length) {
      // 층 사이 — 서·동 양끝에 계단 하나씩
      for (const side of [0, 1]) {
        stairs.push({ x: side === 0 ? left : left + gridW - 18, y, w: 18, h: FLOOR_GAP })
      }
      y += FLOOR_GAP
    }
  })
  return { w: left + gridW + PAD, h: y + PAD, tiles, bands, lanes, stairs, alley }
}

/** 그 너비에 들어가는 만큼만 남긴다. 나머지는 넓혀야 보인다. */
function clipName(name: string, px: number): string {
  let used = 0
  let out = ''
  for (const ch of name) {
    const w = charPx(ch)
    if (used + w > px) break
    used += w
    out += ch
  }
  return out
}
/** 한 칸을 몇 화소로 그리는가. 맨 처음은 「다 보이는 크기」다. */
const ZOOM_STEPS = 3

const KIND_DOT: Record<string, string> = {
  narrow: 'is-narrow',
  lab: 'is-lab',
}

/** 그 방에서 무엇을 할 수 있는가. **규칙에서 읽어 온다 — 새 규칙이 아니다.** */
function canDoIn(room: RoomFacts): string[] {
  const out: string[] = []
  // **자판기는 여기 안 적는다.** 복도에 서 있어서 어느 방의 일도
  // 아니다 — 방마다 무엇을 하는지를 적는 목록에 낄 자리가 없다
  if (room.kind === 'lab') out.push('연구실')
  if (room.kind === 'narrow') out.push('좁은 방 — 둘까지')
  return out
}

/** 인원 점. **분수 대신 네모를 늘어놓는다** — 얼마나 찼는지가 바로 보인다. */
function Seats({ room, big }: { room: RoomFacts; big?: boolean }) {
  // 머릿수는 들어가 있는 방에만 온다. 가 본 방이라도 지금 밖이면 모른다
  if (room.count === null) return null
  const count = room.count
  // 열린 칸은 정원이 없다. 찬 만큼만 찍는다
  const slots = room.open ? count : room.capacity
  const known = room.dots.filter((d) => !d.robot)
  const cells = Array.from({ length: Math.min(slots, 16) }, (_, i) => {
    if (i >= count) return null
    return known[i]?.team ?? null
  })
  return (
    <span className={big ? 'sc-at__seats is-big' : 'sc-at__seats'}>
      {cells.map((team, i) => (
        <i
          key={i}
          className={team ? 'is-on' : i < count ? 'is-on is-hidden' : ''}
          style={team ? { background: TEAM_COLOR[team] } : undefined}
        />
      ))}
      {slots > 16 && <em>+{slots - 16}</em>}
    </span>
  )
}

export function FullMap({
  facts,
  clock,
  snowLevel,
  onClose,
}: {
  facts: MapFacts
  /** 위 띠에 적을 것. 남은 시간이 여기서 온다. */
  clock: { open: boolean; no: number; endsAtMs: number | null; nowMs: number }
  /** 눈발의 세기(0~5). 판 문서가 알려 준다 — 0이면 그친 것이다. */
  snowLevel: number
  onClose: () => void
}) {
  const rooms = readMap(facts)
  const [picked, setPicked] = useState<TileId | null>(null)
  const [room, setRoom] = useState({ w: 360, h: 600 })
  const [zoom, setZoom] = useState(0)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const laid = useMemo(() => layout(room.w, room.h, zoom), [room.w, room.h, zoom])
  const byId = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms])
  const boxRef = useRef<HTMLDivElement | null>(null)
  const sheetRef = useRef<HTMLDivElement | null>(null)

  const closeRef = useRef(onClose)
  closeRef.current = onClose

  // 뒤로 가기로 닫는다. 전체 화면을 덮었으니 그게 자연스럽다
  useEffect(() => {
    history.pushState({ atlas: true }, '')
    const back = () => closeRef.current()
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
    }
    window.addEventListener('popstate', back)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('popstate', back)
      window.removeEventListener('keydown', esc)
      if (history.state?.atlas) history.back()
    }
  }, [])

  /**
   * **스물다섯 칸이 한 화면에 다 들어와야 한다.**
   *
   * 그래서 처음 크기는 고르는 것이 아니라 재는 것이다 — 남은 자리를
   * 칸 수로 나눈다. 내림해서 정수로 두면 도면이 화소 격자에 딱 맞는다.
   */
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const measure = () => {
      if (box.clientWidth <= 0 || box.clientHeight <= 0) return
      setRoom({ w: box.clientWidth, h: box.clientHeight })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(box)
    return () => ro.disconnect()
  }, [])

  /**
   * **누른 방이 시트에 가리면 지도를 위로 민다.**
   *
   * 시트는 맵을 밀어내지 않고 그 위에 뜬다 — 밀어내면 누를 때마다
   * 도면 크기가 바뀌어 어지럽다. 대신 가려질 때만 그만큼 올린다.
   */
  useEffect(() => {
    const box = boxRef.current
    const sheet = sheetRef.current
    if (!box || !sheet || !picked) return
    const r = laid.tiles.find((x) => x.id === picked)
    if (!r) return
    const bottom = mid.y + pan.y + r.y + r.h
    const free = box.clientHeight - sheet.offsetHeight - 6
    if (bottom > free) setPan((p) => ({ ...p, y: p.y - (bottom - free) }))
    // 누른 방이 바뀔 때만 본다. pan 을 의존성에 넣으면 스스로를 다시 민다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, laid])

  // 두 손가락으로 넓히고 끌어서 옮긴다
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const touches = new Map<number, { x: number; y: number }>()
    let startGap = 0
    let startZoom = zoom
    let startPan = pan
    let startMid = { x: 0, y: 0 }
    const gapOf = () => {
      const [a, b] = [...touches.values()]
      return Math.hypot(a.x - b.x, a.y - b.y)
    }
    const midOf = () => {
      const all = [...touches.values()]
      return {
        x: all.reduce((s, p) => s + p.x, 0) / all.length,
        y: all.reduce((s, p) => s + p.y, 0) / all.length,
      }
    }
    const down = (e: PointerEvent) => {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
      startZoom = zoom
      startPan = pan
      startMid = midOf()
      if (touches.size === 2) startGap = gapOf()
    }
    const move = (e: PointerEvent) => {
      if (!touches.has(e.pointerId)) return
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const mid = midOf()
      if (touches.size >= 2 && startGap > 0) {
        const grew = gapOf() / startGap
        setZoom(Math.min(ZOOM_STEPS, Math.max(0, startZoom + (grew - 1) * 2)))
      }
      if (touches.size >= 1) {
        setPan({ x: startPan.x + (mid.x - startMid.x), y: startPan.y + (mid.y - startMid.y) })
      }
    }
    const up = (e: PointerEvent) => {
      touches.delete(e.pointerId)
      startGap = 0
      startZoom = zoom
      startPan = pan
      if (touches.size > 0) startMid = midOf()
    }
    box.addEventListener('pointerdown', down)
    box.addEventListener('pointermove', move)
    box.addEventListener('pointerup', up)
    box.addEventListener('pointercancel', up)
    return () => {
      box.removeEventListener('pointerdown', down)
      box.removeEventListener('pointermove', move)
      box.removeEventListener('pointerup', up)
      box.removeEventListener('pointercancel', up)
    }
  }, [zoom, pan])

  // 도면이 상자보다 작으면 한가운데에 둔다. 왼쪽 위로 몰아 두면
  // 오른쪽이 통째로 빈 채로 남는다
  const mid = {
    x: Math.max(0, (room.w - laid.w) / 2),
    y: Math.max(0, (room.h - laid.h) / 2),
  }

  const one = rooms.find((r) => r.id === picked) ?? null
  const pawnsSeen = facts.view?.visiblePawns ?? []
  const inAlley = pawnsSeen.some((p) => p.playerId === facts.meId && p.at != null && isAlleyCell(p.at.x, p.at.y))
  const alleyCount = pawnsSeen.filter((p) => p.at != null && isAlleyCell(p.at.x, p.at.y)).length
  const ours = facts.myTeam == null ? 0 : rooms.filter((r) => r.owner === facts.myTeam).length
  const left = clock.open && clock.endsAtMs != null ? Math.max(0, clock.endsAtMs - clock.nowMs) : null

  return (
    <div className="sc-at">
      <header className="sc-at__bar">
        <span className="sc-at__when">
          {left == null
            ? '자유 시간'
            : `${clock.no} 교시 ${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`}
        </span>
        <span className="sc-at__stat">
          우리 방 <b>{ours}</b>
        </span>
        <span className="sc-at__stat">
          내 자리 <b>{facts.here ? roomName(facts.here as TileId) : '복도'}</b>
        </span>
        <button className="sc-at__close" onClick={onClose}>
          닫기
        </button>
      </header>
      {/* **닫기는 두 곳이다.** 한 손으로 쥐면 위쪽은 엄지가 안 닿는다 */}
      {!one && (
        <button className="sc-atlas__done" onClick={onClose}>
          닫기
        </button>
      )}

      {/* 빈 곳을 누르면 시트가 내려간다. 맵은 그대로 있다 */}
      <div className="sc-at__box" ref={boxRef} onClick={() => setPicked(null)}>
        <div
          className="sc-at__plan"
          style={{
            width: laid.w,
            height: laid.h,
            // **정수 화소로만 옮긴다.** 반 화소면 픽셀 글꼴이 뭉개진다
            transform: `translate(${Math.round(mid.x + pan.x)}px, ${Math.round(mid.y + pan.y)}px)`,
          }}
        >
          {laid.bands.map((f) => (
            <div key={f.name}>
              {/* 층을 가르는 굵은 선과 왼쪽에 세워 붙인 이름 */}
              <div className="sc-at__rule" style={{ top: f.y - 3, width: laid.w }} />
              <div className="sc-at__floor" style={{ top: f.y, height: f.h }}>
                {f.name}
              </div>
            </div>
          ))}

          {/* 복도 — 같은 층의 줄과 줄을 잇는다 */}
          {laid.lanes.map((g, i) => (
            <div
              key={i}
              className="sc-at__hall"
              style={{ left: g.x, top: g.y, width: g.w, height: g.h, backgroundSize: '5px 5px' }}
            />
          ))}

          {/* 계단 — 층과 층 사이 양끝 */}
          {laid.stairs.map((l, i) => (
            <div
              key={i}
              className="sc-at__stair"
              style={{ left: l.x, top: l.y, width: l.w, height: l.h }}
              aria-hidden="true"
            />
          ))}

          {/* 뒷골목 — 오락기 골목. 점령이 없는 복도라 완장도 정원도 없다.
              보이는 사람만 센다(보이는 것은 서버가 이미 걸렀다) */}
          {laid.alley && (
            <div
              className={'sc-at__alley' + (inAlley ? ' is-here' : '')}
              style={{ left: laid.alley.x, top: laid.alley.y, width: laid.alley.w, height: laid.alley.h }}
              aria-label={`${ALLEY_NAME} — ${ARCADE_NAME} ${ARCADE_COUNT} 대`}
            >
              <span className="sc-at__nm">{clipName(`${ALLEY_NAME} · ${ARCADE_NAME}`, laid.alley.w - 8)}</span>
              {alleyCount > 0 && <span className="sc-at__alleyN">{alleyCount}</span>}
              {inAlley && <i className="sc-at__me" />}
            </div>
          )}

          {laid.tiles.map((box) => {
            const r = byId.get(box.id)
            if (!r) return null
            const label = clipName(r.name, box.w - 8)
            return (
              <button
                key={r.id}
                type="button"
                className={[
                  'sc-at__room',
                  r.known ? '' : 'is-unseen',
                  r.owner ? 'is-owned' : '',
                  r.id === facts.here ? 'is-here' : '',
                  picked === r.id ? 'is-picked' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{
                  left: box.x,
                  top: box.y,
                  width: box.w,
                  height: box.h,
                  ...(r.owner ? ({ '--own': TEAM_COLOR[r.owner] } as CSSProperties) : {}),
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  setPicked(r.id)
                }}
              >
                {/* 완장. **테두리가 아니라 위에 두른 띠다** */}
                <i className="sc-at__band" style={r.owner ? { background: TEAM_COLOR[r.owner] } : undefined} />
                {/* 바탕 색만으로 주인을 가르지 않는다. 모서리에 팀 글자 */}
                {r.owner && (
                  <b className="sc-at__who" style={{ background: TEAM_COLOR[r.owner] }} aria-label={`${teamName(r.owner)} 방`}>
                    {teamNo(r.owner)}
                  </b>
                )}
                {label.length > 0 && <span className="sc-at__nm">{label}</span>}
                {/* **가리는 것은 머릿수뿐이다.** 이름도 정원도 차지한
                    팀도 판에 드러난 것이라 처음부터 보인다 */}
                {r.count !== null ? (
                  <Seats room={r} />
                ) : (
                  <span className="sc-at__q">{r.open ? '?' : `? / ${r.capacity}`}</span>
                )}
                {KIND_DOT[r.kind] && <i className={`sc-at__kind ${KIND_DOT[r.kind]}`} />}
                {r.id === facts.here && <i className="sc-at__me" />}
              </button>
            )
          })}
        </div>

        {/* 창밖 눈이 도면 위에도 옅게 내린다 */}
        <div className="sc-at__snow" aria-hidden="true">
          <Snow level={snowLevel} />
        </div>
      </div>

      {one && (
        <RoomSheet panelRef={sheetRef} room={one} myTeam={facts.myTeam} onClose={() => setPicked(null)} />
      )}
    </div>
  )
}


/**
 * 누른 방. **맵 위에 떠오르는 시트다** — 맵을 밀어내지 않는다.
 *
 * 높이를 화면의 40%로 묶는다. 더 올라오면 방금 누른 그 방이 시트에
 * 가려서, 무엇을 보고 있는지 모르게 된다.
 */
function RoomSheet({
  room,
  myTeam,
  onClose,
  panelRef,
}: {
  room: RoomFacts
  myTeam: TeamId
  onClose: () => void
  panelRef: MutableRefObject<HTMLDivElement | null>
}) {
  return (
    <Sheet peek title={`${room.name} · ${KIND_NAME[room.kind]}`} onClose={onClose} panelRef={panelRef}>
      <div className="sc-at__sheet">
      <dl>
        <div>
          <dt>차지한 분단</dt>
          <dd className={myTeam != null && room.owner === myTeam ? 'is-ours' : undefined}>
            {room.owner ? `${teamName(room.owner)}` : '없다'}
          </dd>
        </div>
        <div>
          <dt>지금 인원</dt>
          <dd>
            {room.count !== null ? (
              <>
                <Seats room={room} big />
                <em>
                  {room.count}
                  {room.open ? ' 명' : ` / ${room.capacity}`}
                </em>
              </>
            ) : (
              '모른다'
            )}
          </dd>
        </div>
        <div>
          <dt>정원</dt>
          <dd>{room.open ? '없다' : `${room.capacity} 명`}</dd>
        </div>
      </dl>
      <ul className="sc-at__can">
        {canDoIn(room).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {/* 모르는 까닭을 가른다 — 가 본 적이 없는 것과, 가 봤어도 지금
          밖이라 모르는 것은 다르다. 뒤엣것을 「안 가 봤다」로 적으면 거짓말이다 */}
      {room.count === null && (
        <p className="sc-at__why">
          {room.known ? '몇 명 있는지는 들어가야 안다.' : '아직 안을 본 적이 없다.'}
        </p>
      )}
      </div>
    </Sheet>
  )
}
