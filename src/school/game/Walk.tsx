// 걸어 다니는 학교.
//
// 방 안에서는 자유롭게 걷는다. **문을 넘는 것이 이동이다** — 문에
// 들어서는 순간 서버에 이동을 걸고, 15분이 지나야 옆 방에 선다.
// 그동안은 걷는 그림과 함께 기다린다.
//
// 화면은 남의 픽셀 위치를 모른다. 서버가 아는 것은 「누가 어느 방에
// 있는가」뿐이고, 그보다 자세한 것을 주고받으면 안개가 의미를 잃는다.
// 그래서 남은 방 한가운데에 선 것으로 그린다.
import { useEffect, useRef, useState, type RefObject } from 'react'

import {
  DOORS,
  type Door,
  MAP_H,
  MAP_W,
  ROOMS,
  TILE,
  centerOf,
  doorHere,
  doorIsHorizontal,
  floorOf,
  isWalkable,
  markAt,
  propAt,
  roomAt,
  spawnFor,
  stairHere,
  tileAt,
} from '../map/world'
import { PAL, buildSprites, type Dir } from '../map/sprites'
import { pixelFrame } from '../char/pixel'
import { TILE_BY_ID } from '../../../shared/rules/board'
import {
  CHAR_PX,
  CROSS_TIMEOUT_MS,
  MAX_SCALE,
  MIN_VIEW_PX,
  PAD_HOLD_MS,
  STEP_MS,
  WALK_POSES_PER_SEC,
} from './timing'
import type { AvatarLook, TeamId, TileId } from '../types'
import type { PlayerViewDoc, TileDoc } from '../../../shared/model'

export interface WalkProps {
  me: { playerId: string; team: TeamId; look: AvatarLook | null }
  view: PlayerViewDoc | null
  tiles: Partial<Record<TileId, TileDoc>>
  nowMs: number
  /** 문을 넘었다. 여기서부터는 서버가 15분을 센다. */
  /**
   * 문을 넘자고 서버에 말한다. **거절당하면 반드시 알려 줘야 한다** —
   * 성공했는지 모르면 화면이 「아직 대답을 기다리는 중」에 갇히고,
   * 그 뒤로는 어느 문도 못 넘는다. 실제로 그렇게 막혔다.
   */
  onCross: (to: TileId) => Promise<boolean> | void
  /** 지금 선 방이 바뀌면 알려 준다. 행동 패널이 이걸 본다. */
  onRoom: (id: TileId | null) => void
  /** 맵에서 방을 눌렀다. 먼 방이면 거기로 갈지 묻는다. */
  onTapRoom: (id: TileId) => void
  /**
   * 십자키가 놓인 자리. 방 화면 위가 아니라 아래 컨트롤 바에 있어서
   * 그림 쪽에서 만들지 않고 **부모가 만든 자리를 건네받는다**.
   * 단추의 data-dir 만 보고 붙으므로 생김새는 부모가 정한다.
   */
  padRef: RefObject<HTMLDivElement | null>
  /**
   * 서버가 나를 **옮겨 세운** 시각. 페이즈가 열린 시각을 넘긴다.
   *
   * 종이 치면 자유 시간에 어디까지 갔든 전선으로 돌아간다. 그때는
   * 화면도 군말 없이 따라가야 한다 — 평소의 맞추기는 「방 안에 있을
   * 때만」이라 복도에 서 있던 사람을 안 옮긴다. 옮겨 세운 것을 모른
   * 채로 두면 서버는 전선에, 아바타는 복도에 있고 그 뒤로 어느 문도
   * 안 열린다.
   */
  placeAtMs?: number | null
}

const DIR_OF: Record<string, Dir> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right',
}
const STEP: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }

/** 지금 글을 쓰고 있는 자리인가. 거기서는 방향키를 가져가지 않는다. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  const tag = el?.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable === true
}

/**
 * 규칙 쪽 TileId 는 그냥 string 이고 지도 쪽은 스물다섯 개 유니온이다.
 * 같은 스물다섯 개를 가리키지만 타입은 남남이라, 넘어오는 자리를
 * 여기 하나로 모아 둔다. 없는 이름이 들어오면 지도가 그냥 못 찾는다.
 */
const asRoom = (id: string | null | undefined): TileId | null => (id ? (id as TileId) : null)
const asRooms = (ids: readonly string[]): TileId[] => ids as TileId[]

/**
 * 그 문을 지나면 어느 방에 들어가는가.
 *
 * **문은 방과 복도를 잇는다.** 그래서 나가는 문에서는 갈 곳이 없고
 * (복도는 방이 아니다), 복도에서 들어가는 문에서만 그 방이 나온다.
 */
function acrossFrom(door: { a: TileId; b: TileId | null }, here: TileId | null): TileId | null {
  if (here === door.a) return door.b
  return door.a
}

export function Walk({ me, view, tiles, nowMs, onCross, onRoom, onTapRoom, padRef, placeAtMs = null }: WalkProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  /**
   * 글자만 따로 그리는 겹판.
   *
   * 지도는 도트를 정수 배로 키워 그리므로 속살이 186화소밖에 안 된다.
   * 거기에 7px 글자를 찍으면 **기기 화소로는 여섯 배로 부푼 뭉개진
   * 덩어리**가 된다 — 방 이름이 글자로 안 보였다. 실제로 그랬다.
   *
   * 그래서 글자는 기기 해상도 그대로인 판에 따로 찍는다. 지도는
   * 도트대로, 글자는 또렷하게.
   */
  const labelRef = useRef<HTMLCanvasElement | null>(null)

  // 그리기 루프가 매 프레임 읽는 것들. state로 두면 프레임마다 다시
  // 그려져서 걸음이 끊긴다
  const viewRef = useRef(view)
  const tilesRef = useRef(tiles)
  const crossRef = useRef(onCross)
  const roomRef = useRef(onRoom)
  const tapRef = useRef(onTapRoom)
  viewRef.current = view
  tilesRef.current = tiles
  crossRef.current = onCross
  roomRef.current = onRoom
  tapRef.current = onTapRoom

  // 서버가 말하는 내 자리. 걷는 중이면 null이다
  const myPawn = view?.visiblePawns.find((p) => p.playerId === me.playerId) ?? null
  const standingOn = asRoom(myPawn?.tileId)
  const walking = myPawn?.walking === true
  const walkingRef = useRef(walking)
  walkingRef.current = walking
  const placeRef = useRef(placeAtMs)
  placeRef.current = placeAtMs

  const [ready, setReady] = useState(false)

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const g2d = cv.getContext('2d')
    if (!g2d) return
    // 안쪽 함수들이 매 프레임 쓴다. null 검사를 지나온 값으로 묶어 둔다
    const canvas: HTMLCanvasElement = cv
    const ctx: CanvasRenderingContext2D = g2d
    const sprites = buildSprites()
    setReady(true)

    const start = spawnFor(me.team)
    const self = {
      px: start.x * TILE + TILE / 2,
      py: start.y * TILE + TILE / 2,
      tx: start.x,
      ty: start.y,
      dir: 'down' as Dir,
      moving: false,
      phase: 0,
    }
    let lastRoom: TileId | null = null

    /**
     * 한 번 누른 것. 십자키도 방향키도 여기로 들어온다.
     *
     * **톡 누르고 떼면 keyup 이 다음 프레임보다 먼저 온다.** 그러면
     * 누르고 있는 것만 보는 쪽은 이미 빈 손이라 한 칸도 안 간다 —
     * 방향키를 아무리 눌러도 꿈쩍 않는 것처럼 보였다. 실제로 그랬다.
     */
    let tap: Dir | null = null

    const held = new Set<Dir>()
    const onDown = (e: KeyboardEvent) => {
      // **글을 쓰는 중이면 방향키는 글자 사이를 오가는 키다.** 뺏으면
      // 쪽지도 시험지 답도 가운데를 고칠 수가 없다
      if (isTyping(e.target)) return
      const d = DIR_OF[e.key]
      if (!d) return
      e.preventDefault()
      held.add(d)
      tap = d
    }
    const onUp = (e: KeyboardEvent) => {
      const d = DIR_OF[e.key]
      if (d) held.delete(d)
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)

    // 십자키는 두 가지로 쓴다.
    //
    //   톡 누르면 **한 칸.** 지나치지 않게
    //   꾹 누르면 **이어 걷는다.** 방을 가로지르는 데 열 번 두드리지
    //   않게
    //
    // 가르는 것은 시간뿐이다. 손가락이 단추에서 떨어지기 전에
    // PAD_HOLD_MS 가 지나면 그때부터 이어 걷는다 — 그 전에 떼면
    // 처음에 준 한 칸으로 끝난다
    const offPad: (() => void)[] = []
    for (const btn of Array.from(padRef.current?.querySelectorAll('button') ?? [])) {
      const d = btn.dataset.dir as Dir
      let timer = 0
      const press = (e: PointerEvent) => {
        e.preventDefault()
        // **손가락을 이 단추에 묶는다.** 안 묶으면 단추가 손가락
        // 밑에서 조금만 움직여도 pointerleave 가 와서 걸음이 끊겼다 —
        // 문을 넘으면 방 이름이 바뀌고 그만큼 아래가 밀리는데, 손은
        // 가만히 있는데도 문 위에서 딱 멈춰 섰다. 실제로 그랬다
        btn.setPointerCapture(e.pointerId)
        tap = d
        clearTimeout(timer)
        timer = window.setTimeout(() => held.add(d), PAD_HOLD_MS)
      }
      const release = () => {
        clearTimeout(timer)
        held.delete(d)
      }
      // 손가락이 미끄러져 단추 밖으로 나가면 멈춘다. 안 그러면 화면에서
      // 손을 뗀 뒤에도 혼자 걸어간다. **손이 움직였을 때만 본다** —
      // 화면이 밀려서 벌어진 일은 손을 뗀 것이 아니다
      const slid = (e: PointerEvent) => {
        const r = btn.getBoundingClientRect()
        const out = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom
        if (out) release()
      }
      btn.addEventListener('pointerdown', press)
      btn.addEventListener('pointermove', slid)
      btn.addEventListener('pointerup', release)
      btn.addEventListener('pointercancel', release)
      offPad.push(() => {
        clearTimeout(timer)
        btn.removeEventListener('pointerdown', press)
        btn.removeEventListener('pointermove', slid)
        btn.removeEventListener('pointerup', release)
        btn.removeEventListener('pointercancel', release)
      })
    }

    /** 걷는 동안 쌓인 걸음. 한 칸을 STEP_MS에 걷는다. */
    let stepLeft = 0
    let last = performance.now()
    let raf = 0

    /**
     * 지금 쓰는 배율과 기기 화소비. 글자 겹판이 이걸 본다.
     *
     * **resize 보다 먼저 만든다.** resize 는 정의하자마자 한 번 도는데,
     * 그때 아직 없는 값을 읽으면 화면이 통째로 터진다. 실제로 그랬다
     */
    const screen = { scale: 2, dpr: 1 }

    /**
     * 캔버스를 방 화면 크기에 맞춘다. **배율은 정수만 쓴다.**
     *
     * 소수 배율이면 한 픽셀이 1.4픽셀이 되어 어떤 줄은 굵고 어떤 줄은
     * 가늘어진다. 도트 그림에서는 그게 바로 뭉개져 보인다. 그래서
     * 들어갈 수 있는 가장 큰 정수 배율을 고르고, 그 배율에서 화면에
     * 들어가는 만큼을 그린다. 남는 자리는 바탕색으로 둔다.
     */
    const resize = () => {
      const box = canvas.parentElement
      const w = box?.clientWidth ?? canvas.clientWidth
      const h = box?.clientHeight ?? canvas.clientHeight
      if (w <= 0 || h <= 0) return
      // 논리 화소 기준으로 몇 배까지 들어가는가
      // **정수 배율만 쓴다.** 소수 배율은 픽셀을 뭉갠다
      const fit = Math.min(w / MIN_VIEW_PX, h / MIN_VIEW_PX)
      const scale = Math.max(1, Math.min(MAX_SCALE, Math.floor(fit)))
      // 배율을 정한 뒤에는 남는 자리를 검게 두지 않고 **방을 더 보여 준다.**
      // 160×160 을 고집하면 위아래로 손가락만 한 검은 띠가 남는다
      const vw = Math.max(MIN_VIEW_PX, Math.floor(w / scale))
      const vh = Math.max(MIN_VIEW_PX, Math.floor(h / scale))
      canvas.width = vw
      canvas.height = vh
      canvas.style.width = `${vw * scale}px`
      canvas.style.height = `${vh * scale}px`
      ctx.imageSmoothingEnabled = false

      // 글자 겹판은 **기기 화소 그대로** 잡는다. 지도와 겹쳐 놓되
      // 속살은 여섯 배 촘촘하다
      screen.scale = scale
      screen.dpr = Math.min(3, Math.max(1, Math.round(devicePixelRatio || 1)))
      const lab = labelRef.current
      if (lab) {
        lab.style.width = `${vw * scale}px`
        lab.style.height = `${vh * scale}px`
        lab.width = Math.round(vw * scale * screen.dpr)
        lab.height = Math.round(vh * scale * screen.dpr)
      }
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas.parentElement ?? canvas)

    /**
     * 캔버스를 누르면 거기로 걸어간다.
     *
     * 옆방을 누르면 **그 방으로 간다** — 사이의 문까지 걸어가서 넘는다.
     * 사람은 「과학실에 가야지」라고 생각하지 「문이 저기 있으니 세 칸
     * 위로 가서 왼쪽으로」라고 생각하지 않는다. 십자키만 있던 동안은
     * 문보다 한 칸 옆에 서면 위를 눌러도 아무 일이 없었다.
     *
     * 옆방이 아닌 먼 방을 누르면 걸어가지 않고 고르기만 한다 — 거기에
     * 할 일을 시키는 자리다.
     */
    const onTap = (e: PointerEvent) => {
      if (walkingRef.current) return
      const r = canvas.getBoundingClientRect()
      const sx = ((e.clientX - r.left) / r.width) * canvas.width + camRef.x
      const sy = ((e.clientY - r.top) / r.height) * canvas.height + camRef.y
      const tx = Math.floor(sx / TILE)
      const ty = Math.floor(sy / TILE)
      const here = roomAt(self.tx, self.ty)?.id ?? null
      const id = roomAt(tx, ty)?.id ?? null

      // 옆방(또는 그 방으로 가는 문)을 눌렀다 — 문까지 걸어가서 넘는다
      const toward = id && id !== here ? id : (doorHere(tx, ty) ? acrossFrom(doorHere(tx, ty) as Door, here) : null)
      if (here && toward && toward !== here) {
        // **문이 여럿인 방이 있다.** 2층 가운데 방들은 사방이 복도라
        // 문이 서넛이다 — 제일 가까운 문으로 간다.
        // **계단참에는 문이 아예 없다.** 복도에 그대로 열려 있어서
        // 뚫을 벽이 없다. 그럴 때는 그 칸 한가운데로 간다
        const gates = DOORS.filter((d) => d.a === toward).flatMap((d) => d.tiles)
        const marks = gates.length > 0 ? gates : [centerOf(toward)]
        let best: { x: number; y: number }[] = []
        for (const t of marks) {
          const found = pathTo(t.x, t.y)
          if (found.length > 0 && (best.length === 0 || found.length < best.length)) best = found
        }
        if (best.length > 0) {
          autoPath = best
          return
        }
      }

      // 지금 방 안이다 — 그 자리로 걸어간다. 정확히 그 칸이 막혀 있으면
      // 바로 옆 칸이라도 간다. 손가락은 한 칸을 정확히 못 짚는다
      if (id === here) {
        for (const [dx, dy] of [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
          const found = pathTo(tx + dx, ty + dy)
          if (found.length > 0) {
            autoPath = found
            return
          }
        }
        return
      }
      if (id) tapRef.current(id)
    }
    canvas.addEventListener('pointerdown', onTap)

    function tryStep(d: Dir): void {
      const [dx, dy] = STEP[d]
      const nx = self.tx + dx
      const ny = self.ty + dy

      // 계단이다. 한 칸 밟으면 다른 층으로 간다 — 걸어서는 못 잇는다.
      // 서버에 말하는 것은 여기서 하지 않는다. 옮겨 놓기만 하면
      // **선 방이 바뀐 것을 보고** 아래에서 알아서 말한다
      const stair = stairHere(nx, ny)
      if (stair) {
        standAt(stair.toX, stair.toY)
        autoPath = []
        return
      }

      // **문은 그냥 지나간다.** 문은 방과 복도를 잇는 구멍일 뿐이라,
      // 밟는 것만으로는 어디로 가는지 알 수 없다. 어느 방에 들어갔는지는
      // 들어가고 나서 선 자리를 보면 된다
      if (!isWalkable(nx, ny)) {
        // **문 옆 한 칸에서 벽을 밀면 문 쪽으로 비켜 준다.**
        //
        // 문이 한 칸이라 방을 가로질러 온 사람은 문보다 한 칸 옆에
        // 서 있기 쉽다. 그 자리에서 밀면 벽이고, 아무 일도 안 일어나면
        // 게임이 고장 난 것처럼 보인다 — 전에 그래서 문을 세 칸으로
        // 넓혔었다. 이번에는 문 대신 걸음을 비켜 준다
        const side: [number, number][] = d === 'up' || d === 'down' ? [[-1, 0], [1, 0]] : [[0, -1], [0, 1]]
        for (const [sx, sy] of side) {
          if (!doorHere(nx + sx, ny + sy)) continue
          if (!isWalkable(self.tx + sx, self.ty + sy)) continue
          self.tx += sx
          self.ty += sy
          self.moving = true
          stepLeft = STEP_MS
          return
        }
        return
      }
      self.tx = nx
      self.ty = ny
      self.moving = true
      stepLeft = STEP_MS
    }

    /**
     * 저절로 걸어갈 길. 화면을 누르면 거기까지, 문으로 들어오면 방
     * 한가운데까지 이것으로 간다.
     *
     * **십자키만으로는 못 쓴다.** 방은 열한 칸인데 문은 벽 한가운데
     * 세 칸이다. 방을 가로질러 온 사람은 문보다 몇 칸 옆에 서 있기 쉽고,
     * 그 자리에서 위를 누르면 벽에 막혀 아무 일도 안 일어난다. 게임이
     * 고장 난 것처럼 보인다 — 실제로 그랬다. 그래서 가고 싶은 곳을
     * 누르면 알아서 걸어가게 한다.
     */
    let autoPath: { x: number; y: number }[] = []

    /**
     * 저기까지 가는 가장 짧은 길. 가구와 벽을 피해 돌아간다.
     *
     * 문 너머까지는 찾지 않는다 — 문을 밟는 순간 서버가 방을 옮기고,
     * 그쪽 길은 도착한 뒤에 새로 찾는다
     */
    function pathTo(gx: number, gy: number): { x: number; y: number }[] {
      const startKey = `${self.tx},${self.ty}`
      const goal = `${gx},${gy}`
      if (startKey === goal) return []
      const prev = new Map<string, string>()
      const seen = new Set([startKey])
      let edge = [{ x: self.tx, y: self.ty }]
      while (edge.length > 0) {
        const next: { x: number; y: number }[] = []
        for (const cur of edge) {
          for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
            const nx = cur.x + dx
            const ny = cur.y + dy
            const k = `${nx},${ny}`
            if (seen.has(k)) continue
            const onDoor = doorHere(nx, ny) !== null
            if (!onDoor && !isWalkable(nx, ny)) continue
            seen.add(k)
            prev.set(k, `${cur.x},${cur.y}`)
            if (k === goal) {
              const out: { x: number; y: number }[] = []
              for (let at = goal; at !== startKey; at = prev.get(at) as string) {
                const [px, py] = at.split(',').map(Number)
                out.unshift({ x: px, y: py })
              }
              return out
            }
            // 문 너머로는 더 안 뻗는다. 거기서 방이 바뀐다
            if (!onDoor) next.push({ x: nx, y: ny })
          }
        }
        edge = next
      }
      return []
    }

    /** 그 문의 이 방 쪽 한 칸. 문을 넘어 들어서는 자리다. */
    function doorSpot(id: TileId, door: Door): { x: number; y: number } | null {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const cx = door.x + dx
        const cy = door.y + dy
        if (roomAt(cx, cy)?.id === id && isWalkable(cx, cy)) return { x: cx, y: cy }
      }
      return null
    }

    /** 그 자리에 세운다. 걷던 것은 멈춘다. */
    function standAt(x: number, y: number): void {
      self.tx = x
      self.ty = y
      self.px = x * TILE + TILE / 2
      self.py = y * TILE + TILE / 2
      self.moving = false
      stepLeft = 0
    }

    /** 서버가 「너는 이 방에 있다」고 하면 그 방 안으로 옮겨 놓는다. */
    function placeIn(id: TileId): void {
      const r = ROOMS.find((x) => x.id === id)
      if (!r) return
      const rect = r.rects[0]
      // **방금 넘은 문 바로 안쪽에 세운다.** 문으로 들어갔으면 문으로
      // 나와야 한다 — 방 한가운데로 순간이동하면 걸어 들어온 것이 아니라
      // 순간이동한 것이 된다
      //
      // **방마다 문이 하나다.** 복도로만 드나드니 어느 문으로 들어왔는지
      // 고민할 것이 없다. 계단참과 옥상은 문이 없어 한가운데에 선다
      const door = DOORS.find((d) => d.a === id) ?? null
      const spot = door ? doorSpot(id, door) : null
      standAt(
        spot ? spot.x : rect.x + Math.floor(rect.w / 2),
        spot ? spot.y : rect.y + Math.floor(rect.h / 2),
      )
      // **여기서 더 걷게 하지 않는다.**
      //
      // 전에는 들어서자마자 방 한가운데까지 저절로 걸어갔다. 한가운데가
      // 그 방의 모든 문과 일직선이라 다음 문을 찾기 쉽다는 이유였는데,
      // 밖에서 보면 문을 넘을 때마다 사람이 방 복판으로 끌려간다 —
      // 걷는 게임이 아니라 방을 고르는 게임처럼 보인다.
      //
      // 문 옆에서 벽을 밀면 문으로 비켜 주므로 한가운데에 서 있을
      // 이유도 없어졌다. 들어선 자리에서 그대로 걸으면 된다
      autoPath = []
    }

    /**
     * 다음 한 칸을 뗀다. 눌린 방향이 있으면 그리로, 없으면 저절로
     * 걸어가던 길을 따라. 갈 데가 없으면 아무 일도 안 하고 돌아온다.
     *
     * 한 칸이 끝난 바로 그 프레임에서 불린다 — 걸음과 걸음 사이를
     * 비우지 않으려고 따로 뺐다.
     */
    function nextStep(): void {
      const d = [...held][held.size - 1] ?? tap
      if (d) {
        // 눌린 한 번은 여기서 쓴다. 남겨 두면 손을 떼도 계속 걷는다
        tap = null
        // 손이 움직이면 저절로 걷던 것은 그만둔다. 조작을 빼앗기면 안 된다
        autoPath = []
        self.dir = d
        tryStep(d)
        return
      }
      if (autoPath.length === 0) return
      const to = autoPath[0]
      const wantX = to.x - self.tx
      const wantY = to.y - self.ty
      if (wantX === 0 && wantY === 0) {
        autoPath.shift()
        return
      }
      const dir: Dir = wantX !== 0 ? (wantX > 0 ? 'right' : 'left') : wantY > 0 ? 'down' : 'up'
      const was = `${self.tx},${self.ty}`
      self.dir = dir
      tryStep(dir)
      // 한 칸도 못 갔다. 길이 막혔거나 문 앞이다 — 더 밀어도 소용없다
      if (`${self.tx},${self.ty}` === was) autoPath = []
      else autoPath.shift()
    }

    /**
     * 문을 넘자고 서버에 말한 순간부터, 서버가 「걷는 중」이라고
     * 대답할 때까지의 틈. 이 틈을 안 막으면 방향키를 누르고 있는
     * 동안 같은 요청이 몇 번이고 나가고, 서버는 「이미 걷는 중이다」를
     * 그만큼 돌려준다
     */
    let asked = false
    /**
     * 언제 말을 걸었나. 대답이 아예 안 오는 경우(끊긴 연결, 잃어버린
     * 응답)를 대비한 마지막 그물이다 — 이게 없으면 한 번 놓친 대답이
     * 그 판 내내 문을 잠근다.
     */
    let askedAtMs = 0
    let lastServerTile: TileId | null = null
    // 옮겨 세운 것을 이미 따라갔는지. 처음 값은 지금 것이라, 화면을
    // 켤 때 괜히 한 번 튀지 않는다
    let lastPlaceAt: number | null = placeRef.current
    /** 그리기가 쓴 카메라. 탭한 자리를 지도 좌표로 되돌릴 때 쓴다. */
    const camRef = { x: 0, y: 0 }

    function frame(now: number) {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(64, now - last)
      last = now

      // 서버가 말하는 방으로 따라간다.
      //
      // **처음 한 번도 빼먹지 않는다.** 전에는 첫 번째만 건너뛰었다 —
      // 화면을 열면 아바타는 늘 우리 팀 출발 자리에 섰고, 서버는
      // 그 사이 걸어간 방을 기억하고 있었다. 둘이 어긋난 채로
      // 문을 넘으려 하면 「이미 그 방이다」가 뜬다. 내가 선 방으로
      // 가자고 말하고 있었으니까. DAY 3쯤 되면 어느 문도 안 열린다
      const pawn = viewRef.current?.visiblePawns.find((p) => p.playerId === me.playerId) ?? null
      const serverTile = asRoom(pawn?.tileId)

      // **옮겨 세웠다. 군말 없이 따라간다.**
      //
      // 아래 맞추기들은 「방 안에 있을 때만」이라 복도에 선 사람을
      // 그냥 둔다. 평소에는 그게 맞다 — 복도로 나서자마자 도로
      // 방 안으로 튕기면 걸을 수가 없으니까. 그런데 종이 쳐서 서버가
      // 사람을 통째로 옮긴 순간만은 예외다
      if (placeRef.current !== lastPlaceAt) {
        lastPlaceAt = placeRef.current
        if (serverTile) {
          placeIn(serverTile)
          lastServerTile = serverTile
          asked = false
        }
      }

      if (serverTile && serverTile !== lastServerTile) {
        // **이미 제 발로 가 있으면 건드리지 않는다.**
        //
        // 걸어서 넘는 동안 대답이 온다. 그때 또 세우면 그 사이 걸어간
        // 만큼을 문 앞으로 도로 끌어당긴다 — 없애려던 튐이 되레 커진다.
        // 방금 넘은 문 위에 서 있는 것도 「가는 중」이라 그냥 둔다
        // **어느 방에도 없으면 건드리지 않는다.** 복도와 문턱이 그렇다 —
        // 거기 선 사람을 서버가 아는 방으로 끌어다 놓으면, 복도로
        // 나서자마자 도로 방 안으로 튕겨 들어간다. 실제로 그랬다
        const standing = roomAt(self.tx, self.ty)?.id ?? null
        if (standing !== null && standing !== serverTile) placeIn(serverTile)
        lastServerTile = serverTile
        // 도착했다. 다음 문을 넘을 수 있다
        asked = false
      }

      // 그래도 어긋났으면 서버 쪽으로 맞춘다. **어긋난 채로 두면
      // 어느 문도 안 열리는데 이유는 아무 데도 안 나온다**
      if (
        serverTile &&
        !asked &&
        !self.moving &&
        !walkingRef.current &&
        // **방 안에 있을 때만 본다.** 복도와 문턱은 어느 방도 아니라,
        // 거기 선 것을 어긋난 것으로 치면 복도를 걸을 수가 없다
        roomAt(self.tx, self.ty) !== null &&
        roomAt(self.tx, self.ty)?.id !== serverTile
      ) {
        placeIn(serverTile)
      }
      // 대답이 영영 안 오면 스스로 푼다
      if (asked && performance.now() - askedAtMs > CROSS_TIMEOUT_MS) asked = false

      // 걷는 중에는 조작을 받지 않는다. 몸은 이미 문 사이에 있다
      if (!walkingRef.current) {
        // **한 칸이 끝난 그 프레임에서 다음 칸을 바로 시작한다.**
        //
        // 전에는 끝난 프레임에서는 멈추기만 하고 다음 칸은 그다음
        // 프레임에 떠났다. 한 칸이 160ms 니까 열 프레임에 한 프레임씩
        // 걸음이 비었다 — 누르고만 있어도 한 칸 걸러 한 번씩 튀었다.
        // 남은 시간도 버리지 않고 다음 칸으로 넘긴다. 그래야 몇
        // 칸을 걸어도 한 칸에 딱 160ms 다
        let budget = dt
        for (let guard = 0; guard < 8 && budget > 0; guard++) {
          if (!self.moving) {
            nextStep()
            // 갈 데가 없다. 남은 시간은 그냥 버린다
            if (!self.moving) break
          }
          const use = Math.min(budget, stepLeft)
          stepLeft -= use
          budget -= use
          self.phase += (use / 1000) * WALK_POSES_PER_SEC
          if (stepLeft <= 0) self.moving = false
        }
        // 선 자리는 늘 칸 한가운데. 걷는 중이면 남은 만큼만 뒤로 물린다
        const t = self.moving ? Math.max(0, stepLeft) / STEP_MS : 0
        const [dx, dy] = STEP[self.dir]
        self.px = self.tx * TILE + TILE / 2 - dx * TILE * t
        self.py = self.ty * TILE + TILE / 2 - dy * TILE * t
      }

      // 내가 선 칸. 화면에는 안 쓰고 주행 시험이 읽는다 — 「방은 맞는데
      // 문에서 한 칸 옆」 같은 것은 방 이름만 봐서는 알 수가 없다
      canvas.dataset.at = `${self.tx},${self.ty}`
      const room = roomAt(self.tx, self.ty)?.id ?? null
      if (room !== lastRoom) {
        lastRoom = room
        roomRef.current(room)
      }

      // **방이 바뀌면 그때 서버에 말한다.**
      //
      // 전에는 문을 밟는 순간 말했다. 복도가 생기면서 그 방법이 깨졌다 —
      // 문은 방과 복도를 이을 뿐이라 어디로 가는지 모르고, 계단참처럼
      // 문이 아예 없는 방도 있다. 들어가고 나서 선 자리를 보는 편이
      // 한 가지로 다 된다
      if (room !== null && serverTile !== null && room !== serverTile && !asked && !walkingRef.current) {
        asked = true
        askedAtMs = performance.now()
        const back = { x: self.tx, y: self.ty }
        const said = crossRef.current(room)
        // 거절당하면 그 자리에서 푼다. 안 그러면 한 번 막힌 뒤로
        // 영영 못 움직인다
        if (said && typeof said.then === 'function') {
          void said.then((ok) => {
            if (ok) return
            asked = false
            autoPath = []
            standAt(back.x, back.y)
          })
        }
      }

      draw()
    }

    function draw(): void {
      const w = canvas.width
      const h = canvas.height
      const camX = Math.round(Math.max(0, Math.min(MAP_W * TILE - w, self.px - w / 2)))
      const camY = Math.round(Math.max(0, Math.min(MAP_H * TILE - h, self.py - h / 2)))
      camRef.x = camX
      camRef.y = camY

      ctx.fillStyle = PAL.ink
      ctx.fillRect(0, 0, w, h)

      const x0 = Math.max(0, Math.floor(camX / TILE))
      const y0 = Math.max(0, Math.floor(camY / TILE))
      const x1 = Math.min(MAP_W - 1, Math.ceil((camX + w) / TILE))
      const y1 = Math.min(MAP_H - 1, Math.ceil((camY + h) / TILE))
      const seen = new Set<TileId>(asRooms(viewRef.current?.visibleTiles ?? []))

      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const kind = tileAt(x, y)
          const room = roomAt(x, y)?.id ?? null
          // 벽은 어느 방에도 속하지 않는다. 둘러싼 방을 찾아 같이 칠한다
          const owner = ownerAround(x, y)
          let img: CanvasImageSource | null
          if (kind === 'wall') {
            img = tileAt(x, y - 1) === 'wall' ? sprites.tiles.wallBody : sprites.tiles.wall
          } else if (kind === 'door') {
            // 잠긴 문 그림은 안 쓴다. 화면은 어느 문이 열렸는지 모른다 —
            // 문을 넘어 보고 서버가 뭐라 하는지 듣는다.
            // 벽이 누운 방향에 따라 널빤지도 눕거나 선다
            img = doorIsHorizontal(x, y) ? sprites.tiles.doorH : sprites.tiles.doorV
          } else {
            const f = room ? floorOf(room) : 'room'
            img =
              f === 'hall' ? sprites.tiles.floorHall
              : f === 'outdoor' ? sprites.tiles.floorOutdoor
              : f === 'wood' ? sprites.tiles.floorWood
              : sprites.tiles.floorRoom
            ctx.drawImage(img, x * TILE - camX, y * TILE - camY)
            const team = room ? tilesRef.current[room]?.ownerTeam : null
            img = team ? sprites.tiles.floorTeam[team] : null
          }
          if (img) ctx.drawImage(img, x * TILE - camX, y * TILE - camY)
          // 계단은 바닥 위에 층계를 덧그린다. 오르는 쪽과 내려가는 쪽이
          // 화살표와 밝기로 갈린다 — 밟기 전에 어디로 가는지 보인다
          const step = stairHere(x, y)
          if (step) {
            ctx.drawImage(
              step.up ? sprites.tiles.stairUp : sprites.tiles.stairDown,
              x * TILE - camX,
              y * TILE - camY,
            )
          }
          // 점령한 방은 흑백이 아니라 그 팀 색이다. 벽도 바닥도 같이
          // 물든다 — 지나가다 벽 색만 봐도 누구 땅인지 안다
          if (owner) {
            ctx.globalCompositeOperation = 'multiply'
            ctx.fillStyle = TEAM_WASH[owner]
            ctx.fillRect(x * TILE - camX, y * TILE - camY, TILE, TILE)
            ctx.globalCompositeOperation = 'source-over'
          }
          const mark = markAt(x, y)
          if (mark) ctx.drawImage(sprites.marks[mark], x * TILE - camX, y * TILE - camY)
          const prop = propAt(x, y)
          if (prop) ctx.drawImage(sprites.props[prop], x * TILE - camX, y * TILE - camY)

          // 안개. 못 받은 방은 덮는다 — 화면에서 가리는 것이 아니라
          // 애초에 그 방 정보가 오지 않았다
          if (room && !seen.has(room)) {
            ctx.fillStyle = 'rgba(12,14,18,0.78)'
            ctx.fillRect(x * TILE - camX, y * TILE - camY, TILE, TILE)
          }
        }
      }

      // 방 이름은 겹판에. **여기 찍으면 뭉개진다**
      drawLabels(camX, camY, seen)

      // 남들. 방 한가운데에 선 것으로 그린다 — 서버가 아는 것도 거기까지다.
      //
      // **걷는 사람은 그리지 않는다.** 문과 문 사이에 있는 사람은 어느
      // 방에도 없다. 규칙에서도 그렇다 — 걷는 말은 깃발 판정에 세지
      // 않고, 표도 교역도 그 사람과는 할 수 없다. 화면에만 서 있으면
      // 누를 수 있을 것처럼 보인다
      for (const p of viewRef.current?.visiblePawns ?? []) {
        if (p.playerId === me.playerId || p.walking) continue
        const at = centerPx(asRoom(p.tileId))
        if (!at) continue
        dot(at.x - camX, at.y - camY, p.team as TeamId, p.asleep === true)
      }

      // 나
      const look = me.look
      if (look) {
        const img = pixelFrame(look, me.team, self.dir, self.moving ? Math.floor(self.phase) : 0)
        // 한 칸 반으로 줄여 그린다. 발끝은 칸 바닥에 그대로 둔다 —
        // 크기가 달라져도 서 있는 자리는 같아야 한다
        const k = CHAR_PX / img.width
        const dw = Math.round(img.width * k)
        const dh = Math.round(img.height * k)
        ctx.drawImage(
          img,
          Math.round(self.px - camX - dw / 2),
          Math.round(self.py - camY - dh + 6 * k),
          dw,
          dh,
        )
      } else {
        dot(self.px - camX, self.py - camY, me.team, false)
      }
    }

    /**
     * 이 칸을 쥔 팀. 벽과 문은 방에 속하지 않으므로 옆 칸을 본다 —
     * 방과 방 사이 벽이면 양쪽이 다를 수 있는데, 그때는 칠하지 않는다.
     */
    function ownerAround(x: number, y: number): TeamId | null {
      const own = (id: TileId | null | undefined) => (id ? (tilesRef.current[id]?.ownerTeam ?? null) : null)
      const here = roomAt(x, y)?.id
      if (here) return own(here) as TeamId | null
      const around = [own(roomAt(x - 1, y)?.id), own(roomAt(x + 1, y)?.id), own(roomAt(x, y - 1)?.id), own(roomAt(x, y + 1)?.id)]
      const teams = [...new Set(around.filter(Boolean))]
      return teams.length === 1 ? (teams[0] as TeamId) : null
    }

    function centerPx(id: TileId | null): { x: number; y: number } | null {
      if (!id) return null
      const r = ROOMS.find((x) => x.id === id)
      if (!r) return null
      const rect = r.rects[0]
      return { x: (rect.x + rect.w / 2) * TILE, y: (rect.y + rect.h / 2) * TILE }
    }


    /**
     * 방 이름. 기기 화소 그대로인 겹판에 찍는다.
     *
     * 지도 좌표를 화면 좌표로 옮길 때 배율을 곱한다 — 지도 한 도트가
     * 화면에서는 scale 화소이고, 겹판은 거기에 dpr 배 더 촘촘하다.
     */
    function drawLabels(camX: number, camY: number, seen: Set<TileId>): void {
      const lab = labelRef.current
      const lx = lab?.getContext('2d')
      if (!lab || !lx) return
      lx.setTransform(1, 0, 0, 1, 0, 0)
      lx.clearRect(0, 0, lab.width, lab.height)
      const k = screen.scale * screen.dpr
      lx.font = `600 ${Math.round(6 * k)}px "Gothic A1", sans-serif`
      lx.textAlign = 'center'
      lx.textBaseline = 'top'
      lx.fillStyle = PAL.mid
      for (const r of ROOMS) {
        if (!seen.has(r.id)) continue
        const rect = r.rects[0]
        lx.fillText(
          TILE_BY_ID[r.id].name,
          Math.round(((rect.x + rect.w / 2) * TILE - camX) * k),
          Math.round(((rect.y + 0.3) * TILE - camY) * k),
        )
      }
    }

    function dot(x: number, y: number, team: TeamId, asleep: boolean): void {
      ctx.globalAlpha = asleep ? 0.5 : 1
      ctx.fillStyle = PAL.paper
      ctx.beginPath()
      ctx.arc(Math.round(x), Math.round(y), 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = TEAM_DOT[team]
      ctx.beginPath()
      ctx.arc(Math.round(x), Math.round(y), 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
    }

    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      canvas.removeEventListener('pointerdown', onTap)
      ro.disconnect()
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      offPad.forEach((f) => f())
    }
    // 한 번만 세운다. 바뀌는 값은 전부 ref로 읽는다 — 여기에 의존성을
    // 더 넣으면 그릴 때마다 캔버스가 다시 서고 걸음이 처음으로 돌아간다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.playerId, me.team])

  const leftMin = view?.myArriveAtMs != null ? Math.max(0, Math.ceil((view.myArriveAtMs - nowMs) / 60000)) : null

  return (
    <div className="sc-wk">
      <canvas ref={canvasRef} className="sc-wk__canvas" />
      {/* 글자만 또렷하게. 누르는 것은 아래 지도가 받는다 */}
      <canvas ref={labelRef} className="sc-wk__labels" aria-hidden="true" />

      {walking && (
        <div className="sc-wk__transit">
          {me.look && <img alt="" src={pixelFrame(me.look, me.team, 'right', 1).toDataURL()} />}
          <p>이동 중…</p>
          {leftMin != null && <span>{leftMin}분 남았다</span>}
        </div>
      )}

      {!ready && <p className="sc-pl__wait">지도를 그리는 중</p>}
      {standingOn && !walking && <p className="sc-wk__here">{TILE_BY_ID[standingOn].name}</p>}
    </div>
  )
}

/** 완장 색. char/palette.ts 의 TEAMS 와 같다. */
const TEAM_DOT: Record<TeamId, string> = { A: '#e0453f', B: '#3f7ae0', C: '#2fa866', D: '#e0a02a' }

/**
 * 점령한 방에 덧씌우는 색. 곱하기로 얹으므로 밝을수록 옅다.
 *
 * 완장 색을 그대로 곱하면 바닥 무늬가 다 죽어 한 덩어리 색판이 된다.
 * 무늬가 비쳐야 「칠해진 교실」이지 「색칠된 사각형」이 아니다.
 */
const TEAM_WASH: Record<TeamId, string> = {
  A: '#ffd8d6',
  B: '#d6e2ff',
  C: '#d2f0e0',
  D: '#ffeccc',
}
