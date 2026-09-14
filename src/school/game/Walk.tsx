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
  doorHere,
  floorOf,
  isWalkable,
  lockedDoorKeys,
  markAt,
  propAt,
  roomAt,
  spawnFor,
  tileAt,
} from '../map/world'
import { PAL, buildSprites, type Dir } from '../map/sprites'
import { pixelFrame } from '../char/pixel'
import { TILE_BY_ID } from '../../../shared/rules/board'
import { CROSS_TIMEOUT_MS, MAX_SCALE, MIN_VIEW_PX, STEP_MS, WALK_POSES_PER_SEC } from './timing'
import type { AvatarLook, TeamId, TileId } from '../types'
import type { GameDoc, PlayerViewDoc, TileDoc } from '../../../shared/model'

export interface WalkProps {
  me: { playerId: string; team: TeamId; look: AvatarLook | null }
  game: GameDoc
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
}

const DIR_OF: Record<string, Dir> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right',
}
const STEP: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }

/**
 * 규칙 쪽 TileId 는 그냥 string 이고 지도 쪽은 스물다섯 개 유니온이다.
 * 같은 스물다섯 개를 가리키지만 타입은 남남이라, 넘어오는 자리를
 * 여기 하나로 모아 둔다. 없는 이름이 들어오면 지도가 그냥 못 찾는다.
 */
const asRoom = (id: string | null | undefined): TileId | null => (id ? (id as TileId) : null)
const asRooms = (ids: readonly string[]): TileId[] => ids as TileId[]

/** 그 문의 건너편 방. 내가 선 방이 아닌 쪽이다. */
function acrossFrom(door: { a: TileId; b: TileId }, here: TileId | null): TileId | null {
  if (here === door.a) return door.b
  if (here === door.b) return door.a
  return null
}

export function Walk({ me, game, view, tiles, nowMs, onCross, onRoom, onTapRoom, padRef }: WalkProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  // 그리기 루프가 매 프레임 읽는 것들. state로 두면 프레임마다 다시
  // 그려져서 걸음이 끊긴다
  const viewRef = useRef(view)
  const tilesRef = useRef(tiles)
  const lockedRef = useRef(lockedDoorKeys(asRooms(game.openedTiles)))
  const crossRef = useRef(onCross)
  const roomRef = useRef(onRoom)
  const tapRef = useRef(onTapRoom)
  viewRef.current = view
  tilesRef.current = tiles
  lockedRef.current = lockedDoorKeys(asRooms(game.openedTiles))
  crossRef.current = onCross
  roomRef.current = onRoom
  tapRef.current = onTapRoom

  // 서버가 말하는 내 자리. 걷는 중이면 null이다
  const myPawn = view?.visiblePawns.find((p) => p.playerId === me.playerId) ?? null
  const standingOn = asRoom(myPawn?.tileId)
  const walking = myPawn?.walking === true
  const walkingRef = useRef(walking)
  walkingRef.current = walking

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

    const held = new Set<Dir>()
    const onDown = (e: KeyboardEvent) => {
      const d = DIR_OF[e.key]
      if (!d) return
      e.preventDefault()
      held.add(d)
    }
    const onUp = (e: KeyboardEvent) => {
      const d = DIR_OF[e.key]
      if (d) held.delete(d)
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)

    // **십자키는 한 번 누르면 한 칸이다.** 길게 눌러도 이어 걷지 않는다 —
    // 손가락은 키보드가 아니라서, 누르고 있는 시간으로 거리를 재면
    // 열에 아홉은 지나친다. 먼 데는 지도에서 방을 눌러 간다
    let tap: Dir | null = null
    const offPad: (() => void)[] = []
    for (const btn of Array.from(padRef.current?.querySelectorAll('button') ?? [])) {
      const d = btn.dataset.dir as Dir
      const press = (e: Event) => {
        e.preventDefault()
        tap = d
      }
      btn.addEventListener('pointerdown', press)
      offPad.push(() => btn.removeEventListener('pointerdown', press))
    }

    /** 걷는 동안 쌓인 걸음. 한 칸을 STEP_MS에 걷는다. */
    let stepLeft = 0
    let last = performance.now()
    let raf = 0

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
        const gate = DOORS.find(
          (d) => (d.a === here && d.b === toward) || (d.b === here && d.a === toward),
        )
        if (gate) {
          for (const t of gate.tiles) {
            const found = pathTo(t.x, t.y)
            if (found.length > 0) {
              autoPath = found
              return
            }
          }
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
      const here = roomAt(self.tx, self.ty)?.id ?? null

      // 문이다. 여기서부터는 내가 걷는 것이 아니라 서버가 센다
      const door = doorHere(nx, ny)
      if (door) {
        if (lockedRef.current.has(`${nx},${ny}`)) return
        const to = acrossFrom(door, here)
        if (to && !asked) {
          asked = true
          askedAtMs = performance.now()
          const said = crossRef.current(to)
          // 거절당하면 그 자리에서 푼다. 안 그러면 한 번 막힌 뒤로
          // 영영 못 움직인다
          if (said && typeof said.then === 'function') {
            void said.then((ok) => {
              if (!ok) asked = false
            })
          }
        }
        return
      }
      if (!isWalkable(nx, ny, lockedRef.current)) return
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
            if (onDoor ? lockedRef.current.has(k) : !isWalkable(nx, ny, lockedRef.current)) continue
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

    /** 서버가 「너는 이 방에 있다」고 하면 그 방 안으로 옮겨 놓는다. */
    function placeIn(id: TileId): void {
      const r = ROOMS.find((x) => x.id === id)
      if (!r) return
      const rect = r.rects[0]
      // 그 방에서 온 문 쪽에 세운다 — 방 한가운데로 순간이동하면
      // 걸어 들어온 것처럼 보이지 않는다
      const from = asRoom(viewRef.current?.visiblePawns.find((p) => p.playerId === me.playerId)?.fromTile)
      const door = from ? DOORS.find((d) => (d.a === id && d.b === from) || (d.b === id && d.a === from)) : null
      let x = rect.x + Math.floor(rect.w / 2)
      let y = rect.y + Math.floor(rect.h / 2)
      if (door) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const cx = door.x + dx
          const cy = door.y + dy
          if (roomAt(cx, cy)?.id === id && isWalkable(cx, cy, lockedRef.current)) {
            x = cx
            y = cy
            break
          }
        }
      }
      self.tx = x
      self.ty = y
      self.px = x * TILE + TILE / 2
      self.py = y * TILE + TILE / 2
      self.moving = false
      stepLeft = 0
      // 문 앞에 섰으면 방 한가운데까지 마저 걸어 들어간다. 한가운데는
      // 그 방의 모든 문과 일직선이라, 거기서는 어느 쪽을 눌러도 문으로 간다
      autoPath = pathTo(rect.x + Math.floor(rect.w / 2), rect.y + Math.floor(rect.h / 2))
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
    /** 그리기가 쓴 카메라. 탭한 자리를 지도 좌표로 되돌릴 때 쓴다. */
    const camRef = { x: 0, y: 0 }

    function frame(now: number) {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(64, now - last)
      last = now

      // 서버가 새 방으로 옮겼으면 따라간다
      const pawn = viewRef.current?.visiblePawns.find((p) => p.playerId === me.playerId) ?? null
      const serverTile = asRoom(pawn?.tileId)
      if (serverTile && serverTile !== lastServerTile) {
        if (lastServerTile !== null) placeIn(serverTile)
        lastServerTile = serverTile
        // 도착했다. 다음 문을 넘을 수 있다
        asked = false
      }
      // 대답이 영영 안 오면 스스로 푼다
      if (asked && performance.now() - askedAtMs > CROSS_TIMEOUT_MS) asked = false

      // 걷는 중에는 조작을 받지 않는다. 몸은 이미 문 사이에 있다
      if (!walkingRef.current) {
        if (self.moving) {
          stepLeft -= dt
          const t = Math.max(0, stepLeft) / STEP_MS
          const cx = self.tx * TILE + TILE / 2
          const cy = self.ty * TILE + TILE / 2
          const [dx, dy] = STEP[self.dir]
          self.px = cx - dx * TILE * t
          self.py = cy - dy * TILE * t
          self.phase += (dt / 1000) * WALK_POSES_PER_SEC
          if (stepLeft <= 0) self.moving = false
        } else {
          const d = [...held][held.size - 1] ?? tap
          if (d) {
            // 눌린 한 번은 여기서 쓴다. 남겨 두면 손을 떼도 계속 걷는다
            tap = null
            // 손이 움직이면 저절로 걷던 것은 그만둔다. 조작을 빼앗기면 안 된다
            autoPath = []
            self.dir = d
            tryStep(d)
          } else if (autoPath.length > 0) {
            const to = autoPath[0]
            const wantX = to.x - self.tx
            const wantY = to.y - self.ty
            if (wantX === 0 && wantY === 0) {
              autoPath.shift()
            } else {
              const dir: Dir = wantX !== 0 ? (wantX > 0 ? 'right' : 'left') : wantY > 0 ? 'down' : 'up'
              const was = `${self.tx},${self.ty}`
              self.dir = dir
              tryStep(dir)
              // 한 칸도 못 갔다. 길이 막혔거나 문 앞이다 — 더 밀어도 소용없다
              if (`${self.tx},${self.ty}` === was) autoPath = []
              else autoPath.shift()
            }
          }
        }
      }

      // 내가 선 칸. 화면에는 안 쓰고 주행 시험이 읽는다 — 「방은 맞는데
      // 문에서 한 칸 옆」 같은 것은 방 이름만 봐서는 알 수가 없다
      canvas.dataset.at = `${self.tx},${self.ty}`
      const room = roomAt(self.tx, self.ty)?.id ?? null
      if (room !== lastRoom) {
        lastRoom = room
        roomRef.current(room)
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
            img = lockedRef.current.has(`${x},${y}`) ? sprites.tiles.doorLocked : sprites.tiles.door
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

      // 방 이름
      ctx.font = '7px "Gothic A1", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      for (const r of ROOMS) {
        if (!seen.has(r.id)) continue
        const rect = r.rects[0]
        ctx.fillStyle = PAL.mid
        ctx.fillText(TILE_BY_ID[r.id].name, Math.round((rect.x + rect.w / 2) * TILE - camX), Math.round((rect.y + 0.3) * TILE - camY))
      }

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
        ctx.drawImage(img, Math.round(self.px - camX - img.width / 2), Math.round(self.py - camY - img.height + 6))
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
