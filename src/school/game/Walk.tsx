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
import { signSheet } from '../map/signs'

import {
  centerOf,
  doorHere,
  doorIsHorizontal,
  DOORS,
  drawPiece,
  isWalkable,
  MAP_H,
  MAP_W,
  markAt,
  propAt,
  roomAt,
  ROOMS,
  signAt,
  spawnFor,
  stairHere,
  TILE,
  tileAt,
  type Door,
} from '../map/world'
import { PAL, buildSprites, type Dir } from '../map/sprites'
import { pixelFrame } from '../char/pixel'
// 명단에서 온 생김새는 어떤 값이 들어 있을지 모른다. 서버는 검사하지
// 않고 옮기기만 하므로, 그리기 직전에 여기서 접어 넣는다
import { normalizeLook } from '../char/look'
import { TEAM_COLOR } from './MapPlan'
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
import type { TeamId, TileId } from '../types'
import type { AvatarLook } from '../../../shared/look'
import type { LiveDoc, PlayerViewDoc, TileDoc } from '../../../shared/model'
import { LIVE_BEAT_MS, LIVE_EVERY_MS, LIVE_LOBBY_STALE_MS, LIVE_STALE_MS } from './useLive'

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
   * 내 방에 선 사람을 눌렀다. **거래는 여기서 시작한다** — 열세 명이
   * 늘어선 목록에서 고르는 것이 아니라, 눈앞에 선 사람을 짚는다.
   */
  onTapPerson: (playerId: string) => void
  /**
   * 걸음을 멈춘 자리. **서버가 이것으로 「옆에 있다」를 판정한다.**
   *
   * 칸마다 보내지 않는다 — 한 칸에 160ms 인 걸음을 칸마다 적으면
   * 열넷이 종일 서버를 두드린다. 멈춰 선 뒤 한 번만 보낸다.
   */
  onStand: (x: number, y: number) => void
  /**
   * 걸음을 묶어 둔다. **거래창이 열려 있는 동안 쓴다** — 마주 선 채로만
   * 흥정하는데, 시트 위로 삐져나온 지도를 잘못 누르면 한 걸음 물러나
   * 탁자가 접힌다. 나가기를 누르면 풀린다.
   */
  frozen?: boolean
  /**
   * 이 방 밖으로 못 나간다.
   *
   * 시작 전에 쓴다. 판이 열리기 전에는 서버가 말을 안 세워서 문을
   * 넘어도 아무도 막지 않는데, 그대로 두면 **시작도 안 한 학교를
   * 혼자 다 돌아 본 뒤에 닷새가 시작된다.** 첫 아침에 다 같이 한
   * 교실에서 여는 것이 규칙이라, 그때까지는 그 교실에 있는다.
   *
   * 막는 자리는 걸음 자체다 — 문을 넘게 두었다가 되돌리면 튕긴다.
   */
  stayIn?: TileId | null
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
  /**
   * 남들이 만들어 둔 캐릭터. playerId → 생김새.
   *
   * 명단(games/{id}.seats)에서 온다 — 이름이 거기 있으니 얼굴도 거기
   * 있다. 안개는 **그 사람이 화면에 나타나는지**를 정하고, 나타난
   * 사람이 어떻게 생겼는지는 감출 것이 아니다.
   *
   * 없는 사람(캐릭터를 아직 안 만든 계정)은 예전처럼 팀 색 점이다.
   */
  looks?: Readonly<Record<string, AvatarLook | null | undefined>>
  /**
   * 남들이 지금 어디서 어디를 보고 걷는가. useLive 가 채워 두는 통이다.
   *
   * **state 가 아니라 ref 다.** 열셋이 초에 세 번씩 바뀌는 것을 state 로
   * 두면 그 수만큼 화면 전체가 다시 그려진다. 지도는 어차피 매 프레임
   * 제 손으로 그린다.
   */
  live?: RefObject<Map<string, LiveDoc>>
  /**
   * 내 자리를 적어 보낸다. **걷는 동안에만 부른다.**
   *
   * 판정과는 상관이 없다 — 서버가 「바로 옆 칸인가」를 보는 것은
   * 여전히 onStand 로 적은 pawns 다. 이쪽은 남의 화면에 내가 걷는
   * 모습이 보이게 하는 것뿐이다.
   */
  onLive?: (at: LiveDoc) => void
  /**
   * 지금 선 칸에서 어느 쪽으로 갈 수 있는가.
   *
   * 십자키가 이것으로 갈 수 없는 쪽을 어둡게 둔다. **벽을 미는 단추를
   * 멀쩡하게 두면 눌러 보고 나서야 벽인 줄 안다** — 그 전에는 게임이
   * 고장 난 것처럼 보인다.
   *
   * 바뀔 때만 부른다. 한 칸 옮길 때마다 달라지므로 프레임마다 보내면
   * 화면이 그 수만큼 다시 그려진다.
   */
  onDirs?: (ways: Record<Dir, DirWay>) => void
  /**
   * 시작 전에 같이 걸어 다니는 사람들.
   *
   * **판이 열리기 전에는 view 가 없다** — 서버가 아직 말을 안 세웠고,
   * 안개도 없다. 그래서 「누가 보이는가」를 서버가 가려 줄 것이 없고,
   * 명단에 앉은 사람이 곧 보이는 사람이다.
   *
   * 열넷이 다 차기를 기다리는 동안 서로가 안 보이면, 같은 교실에
   * 둘이 서 있어도 각자 빈 학교를 걷는다. 기다리는 시간이 그대로
   * 죽는다 — 실제로 그렇게 보였다.
   *
   * 판이 시작하면 이 자리는 view 가 가져간다. 그때부터는 안개가
   * 가린 사람이 정말로 안 온다.
   */
  roster?: readonly { playerId: string; team: TeamId }[]
}

/**
 * 그쪽이 어떤 쪽인가.
 *
 * - `shut` 벽이다. 눌러도 아무 일도 안 일어난다.
 * - `open` 방 안에서 한 칸 옮긴다. 값이 안 든다.
 * - `door` 문이나 계단을 넘는다 — **페이즈 중에는 여기에만 값이 붙는다.**
 */
export type DirWay = 'shut' | 'open' | 'door'

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

export function Walk({ me, view, tiles, nowMs, onCross, onRoom, onTapRoom, onTapPerson, onStand, padRef, placeAtMs = null, frozen = false, looks = {}, live, onLive, onDirs, roster, stayIn = null }: WalkProps) {
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

  // 그리기 루프가 매 프레임 읽는 것들. state로 두면 프레임마다 다시
  // 그려져서 걸음이 끊긴다
  const viewRef = useRef(view)
  const tilesRef = useRef(tiles)
  const crossRef = useRef(onCross)
  const roomRef = useRef(onRoom)
  const tapRef = useRef(onTapRoom)
  const personRef = useRef(onTapPerson)
  const standRef = useRef(onStand)
  const frozenRef = useRef(frozen)
  const stayRef = useRef(stayIn)
  const looksRef = useRef(looks)
  const rosterRef = useRef(roster)
  const liveOutRef = useRef(onLive)
  const dirsRef = useRef(onDirs)
  viewRef.current = view
  tilesRef.current = tiles
  crossRef.current = onCross
  roomRef.current = onRoom
  tapRef.current = onTapRoom
  personRef.current = onTapPerson
  standRef.current = onStand
  frozenRef.current = frozen
  stayRef.current = stayIn
  looksRef.current = looks
  rosterRef.current = roster
  liveOutRef.current = onLive
  dirsRef.current = onDirs

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
      // 거래 중에는 자리를 뜨지 않는다. 사람을 짚는 것만 남긴다
      if (frozenRef.current) return
      const r = canvas.getBoundingClientRect()
      const sx = ((e.clientX - r.left) / r.width) * canvas.width + camRef.x
      const sy = ((e.clientY - r.top) / r.height) * canvas.height + camRef.y
      const tx = Math.floor(sx / TILE)
      const ty = Math.floor(sy / TILE)
      const here = roomAt(self.tx, self.ty)?.id ?? null
      const id = roomAt(tx, ty)?.id ?? null

      // **사람이 먼저다.** 내 방에 선 사람을 짚었으면 걸음이 아니라
      // 그 사람 쪽이 열린다 — 거래는 여기서 시작한다
      const who = personAt(sx, sy, here)
      if (who) {
        personRef.current(who)
        return
      }

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
      // 거래 중에는 십자키도 안 먹는다. 마주 선 채로만 흥정한다
      if (frozenRef.current) return
      const [dx, dy] = STEP[d]
      const nx = self.tx + dx
      const ny = self.ty + dy

      // 아직 못 나간다. 문도 계단도 이 방 밖이면 한 칸도 안 간다
      if (shutIn(nx, ny)) return

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

    /** 갇혀 있는데 그 칸이 이 방 밖인가. 벽도 문도 복도도 다 밖이다. */
    function shutIn(x: number, y: number): boolean {
      const keep = stayRef.current
      return keep !== null && roomAt(x, y)?.id !== keep
    }

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
            // 갇혀 있으면 길도 이 방 안에서만 찾는다. 문 한 칸도 안 밟는다
            if (shutIn(nx, ny)) continue
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
    /** 지금 남들이 서 있는 칸들. 내 자리를 고를 때 피한다. */
    function takenCells(): Set<string> {
      const out = new Set<string>()
      for (const p of viewRef.current?.visiblePawns ?? []) {
        if (p.playerId === me.playerId || p.walking || !p.at) continue
        out.add(`${p.at.x},${p.at.y}`)
      }
      return out
    }

    /**
     * 그 자리에서 가장 가까운 **빈 칸**.
     *
     * 한 칸에 둘이 서면 거래가 영영 안 된다 — 같은 칸은 「바로 옆」이
     * 아니다. 열넷이 같은 문으로 들어오는 첫 교실이 특히 그렇다.
     * 남이 선 칸을 피해 한 칸씩 비켜 세운다.
     */
    function freeSpot(x: number, y: number, id: TileId): { x: number; y: number } {
      const taken = takenCells()
      if (!taken.has(`${x},${y}`) && isWalkable(x, y)) return { x, y }
      for (let r = 1; r <= 6; r++) {
        for (let dx = -r; dx <= r; dx++) {
          for (let dy = -r; dy <= r; dy++) {
            if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue
            const cx = x + dx
            const cy = y + dy
            if (roomAt(cx, cy)?.id !== id) continue
            if (!isWalkable(cx, cy)) continue
            if (taken.has(`${cx},${cy}`)) continue
            return { x: cx, y: cy }
          }
        }
      }
      return { x, y }
    }

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
      const want = freeSpot(
        spot ? spot.x : rect.x + Math.floor(rect.w / 2),
        spot ? spot.y : rect.y + Math.floor(rect.h / 2),
        id,
      )
      standAt(want.x, want.y)
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

    /** 마지막으로 내 자리를 적어 보낸 시각. 걷는 동안에만 오간다. */
    let lastLiveMs = 0
    /** 직전 프레임에 걷고 있었나. 멈추는 순간 한 번 더 적으려고 본다. */
    let toldLive = false
    /** 마지막으로 십자키에 알려 준 네 쪽. 바뀔 때만 다시 알린다. */
    let toldDirs = ''

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

      /*
       * 걷는 모습을 남에게 보낸다.
       *
       * **걷는 동안에만, 그것도 띄엄띄엄.** 한 칸이 160ms 인데 칸마다
       * 적으면 가만히 선 열넷도 문서를 계속 두드린다. 받는 쪽이 사이를
       * 메워 그리므로 320ms 면 눈에 매끄럽다.
       *
       * 멈추면 마지막으로 한 번 더 적고 그친다. 그 한 번이 없으면
       * 남의 화면에서 내가 마지막으로 보낸 자리에 어정쩡하게 선다.
       */
      if (liveOutRef.current) {
        const movingNow = self.moving || autoPath.length > 0
        const due = now - lastLiveMs >= LIVE_EVERY_MS
        /*
         * **시작 전에는 가만히 서 있어도 맥이 뛴다.**
         *
         * 판이 돌 때는 멈추면 그친다 — 서버가 아는 칸이 밑바탕으로
         * 깔려 있어서, 실시간 자리가 끊겨도 그 자리에 선 것으로
         * 그려진다. 시작 전에는 그 밑바탕이 없다. 안 적으면 같은
         * 교실에 마주 선 사람이 몇 초 뒤에 사라진다.
         */
        const beat = rosterRef.current !== undefined && now - lastLiveMs >= LIVE_BEAT_MS
        if ((movingNow && due) || (!movingNow && toldLive) || beat) {
          lastLiveMs = now
          toldLive = movingNow
          liveOutRef.current({
            tileId: roomAt(self.tx, self.ty)?.id ?? null,
            x: self.px / TILE,
            y: self.py / TILE,
            dir: self.dir,
            moving: movingNow,
            ms: Date.now(),
          })
        }
      }

      // 내가 선 칸. 화면에는 안 쓰고 주행 시험이 읽는다 — 「방은 맞는데
      // 문에서 한 칸 옆」 같은 것은 방 이름만 봐서는 알 수가 없다
      canvas.dataset.at = `${self.tx},${self.ty}`

      // **갈 수 있는 쪽을 십자키에 알려 준다.**
      //
      // 계단과 문은 갈 수 있는 쪽이다 — 걸어서 못 잇는 층도 계단
      // 한 칸을 밟으면 넘어간다. 벽 옆에서 문 쪽으로 비켜 주는
      // 걸음(tryStep 의 side)도 갈 수 있는 것으로 센다. 화면에
      // 「막혔다」고 해 놓고 실제로는 걸어지면 그쪽이 더 나쁘다.
      //
      // 셋을 가른다. **문이나 계단을 넘는 걸음만 값이 든다** — 방
      // 안에서 한 칸 옮기는 것까지 「1」이라 적어 두면 화면이 없는
      // 값을 부르는 셈이다.
      const canGo = (d: Dir): DirWay => {
        const [dx, dy] = STEP[d]
        const nx = self.tx + dx
        const ny = self.ty + dy
        // 갇혀 있으면 이 방 테두리가 곧 벽이다 — 십자키도 어둡게 둔다
        if (shutIn(nx, ny)) return 'shut'
        if (stairHere(nx, ny)) return 'door'
        if (doorHere(nx, ny)) return 'door'
        if (isWalkable(nx, ny)) return 'open'
        const side: [number, number][] = d === 'up' || d === 'down' ? [[-1, 0], [1, 0]] : [[0, -1], [0, 1]]
        const slip = side.some(([sx, sy]) => doorHere(nx + sx, ny + sy) && isWalkable(self.tx + sx, self.ty + sy))
        return slip ? 'door' : 'shut'
      }
      const ways: Record<Dir, DirWay> = {
        up: canGo('up'),
        down: canGo('down'),
        left: canGo('left'),
        right: canGo('right'),
      }
      const nowDirs = `${ways.up}|${ways.down}|${ways.left}|${ways.right}`
      if (nowDirs !== toldDirs) {
        toldDirs = nowDirs
        dirsRef.current?.(ways)
      }

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

      draw(dt, now)
    }

    /**
     * dt 와 now 를 받는다. **남들을 밀어 주려면 시간이 필요하다** —
     * 실시간 자리는 띄엄띄엄 오고, 그 사이를 매 프레임 조금씩 메운다.
     */
    function draw(dt: number, now: number): void {
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

      const plates = signSheet()
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
            // 방 바닥은 어디나 같은 흰색이다. 점령한 팀 색만 그 위에 얹는다
            ctx.drawImage(sprites.tiles.floorRoom, x * TILE - camX, y * TILE - camY)
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
          if (prop) drawPiece(ctx, sprites.props[prop.kind], prop.ox, prop.oy, x * TILE - camX, y * TILE - camY)
          const sign = signAt(x, y)
          if (sign) drawPiece(ctx, plates[sign.id], sign.ox, 0, x * TILE - camX, y * TILE - camY)

          // 안개. 못 받은 방은 덮는다 — 화면에서 가리는 것이 아니라
          // 애초에 그 방 정보가 오지 않았다
          if (room && !seen.has(room)) {
            ctx.fillStyle = 'rgba(12,14,18,0.78)'
            ctx.fillRect(x * TILE - camX, y * TILE - camY, TILE, TILE)
          }
        }
      }

      // 남들. 방 한가운데에 선 것으로 그린다 — 서버가 아는 것도 거기까지다.
      //
      // **걷는 사람은 그리지 않는다.** 문과 문 사이에 있는 사람은 어느
      // 방에도 없다. 규칙에서도 그렇다 — 걷는 말은 깃발 판정에 세지
      // 않고, 표도 교역도 그 사람과는 할 수 없다. 화면에만 서 있으면
      // 누를 수 있을 것처럼 보인다
      // 아래에 선 사람이 나중에 그려져야 앞으로 온다. 안 그러면
      // 뒷줄 사람의 머리가 앞줄 사람 몸을 뚫고 나온다
      const line = standees(dt)
        .filter((p) => p.playerId !== me.playerId)
        .sort((a, b) => a.y - b.y)
      for (const p of line) {
        // 걷는 사람은 다리가 움직인다. 멈춘 사람은 첫 자세로 선다
        const pose = p.moving ? Math.floor((now / 1000) * WALK_POSES_PER_SEC) : 0
        person(p.x - camX, p.y - camY, p.team as TeamId, p.look, p.asleep, p.dir, pose)
      }

      // 나는 늘 맨 위다. 앞줄에 누가 서더라도 **나를 잃어버리면 안 된다**
      person(
        self.px - camX,
        self.py - camY,
        me.team,
        me.look,
        false,
        self.dir,
        self.moving ? Math.floor(self.phase) : 0,
      )
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

    /**
     * 서버가 아직 칸을 모르는 사람들을 방 가운데 격자로 세울 때의 간격.
     *
     * 캐릭터 한 몸 너비다. 점이던 시절에는 10이면 넉넉했는데, 이제는
     * 몸이 있어서 그만큼 붙여 놓으면 서로 겹쳐 한 덩어리가 된다.
     */
    const DOT_PX = CHAR_PX
    /** 짚었다고 볼 반경. 몸통 반 너비다. */
    const GRAB_PX = Math.round(CHAR_PX / 2)

    /** 그 사람이 만들어 둔 캐릭터. 나는 계정에서 바로 온 것이 더 새롭다. */
    function lookOf(playerId: string): AvatarLook | null {
      if (playerId === me.playerId) return me.look
      return looksRef.current?.[playerId] ?? null
    }

    /**
     * 지금 서 있는 사람들이 각자 어디에 서 있는가.
     *
     * **서버가 아는 칸에 그대로 세운다.** 사람마다 방 안 어디에 섰는지를
     * 서버가 들고 있고, 거래도 그 칸으로 「바로 옆인가」를 판정한다 —
     * 화면이 딴 자리에 그리면 눈에 보이는 것과 되는 일이 어긋난다.
     *
     * 아직 자리를 안 적은 사람(막 들어와서, 옛 판이라서)은 방 한가운데에
     * 격자로 흩어 세운다. 겹쳐 그리면 넷이 서 있어도 하나로 보인다.
     *
     * **그림과 손끝이 이 함수 하나를 같이 본다.** 자리를 따로 셈하면
     * 보이는 곳과 눌리는 곳이 어긋난다.
     */
    interface Standee {
      playerId: string
      team: string
      asleep: boolean
      here: TileId
      x: number
      y: number
      look: AvatarLook | null
      /** 보고 선 쪽. 실시간 자리가 온 사람만 안다. */
      dir: Dir
      /** 걷는 중인가. 다리를 움직일지 정한다. */
      moving: boolean
    }

    /**
     * 남들을 그리는 자리. **받은 자리로 곧장 튀지 않고 밀어 준다.**
     *
     * 실시간 자리는 320ms 에 한 번 온다. 오는 대로 찍으면 초에 세 번씩
     * 순간이동한다 — 사이를 메워야 걷는 것으로 보인다. 목표까지 남은
     * 거리를 매 프레임 조금씩 줄이는 쪽이 앞질러 가지 않아 안전하다.
     */
    const shown = new Map<string, { x: number; y: number }>()

    /** 지금 보고 있는 실시간 자리. 오래된 것은 안 쓴다. */
    function liveOf(playerId: string): LiveDoc | null {
      const d = live?.current?.get(playerId)
      if (!d) return null
      // 시작 전에는 맥이 느리게 뛴다. 그만큼 오래 믿어 준다
      const keep = rosterRef.current === undefined ? LIVE_STALE_MS : LIVE_LOBBY_STALE_MS
      return Date.now() - d.ms > keep ? null : d
    }

    /**
     * 목표를 향해 한 프레임만큼 민다.
     *
     * 한 걸음보다 훨씬 멀면(방을 건넜거나 서버가 옮겨 세웠으면) 그냥
     * 찍는다. 밀어 봐야 학교를 가로질러 미끄러지는 꼴이 된다.
     */
    function ease(playerId: string, tx: number, ty: number, dt: number): { x: number; y: number } {
      const had = shown.get(playerId)
      if (!had || Math.hypot(tx - had.x, ty - had.y) > TILE * 4) {
        const now = { x: tx, y: ty }
        shown.set(playerId, now)
        return now
      }
      // 내 걸음과 같은 속도로 따라붙는다. 한 칸에 STEP_MS
      const step = (TILE * dt) / STEP_MS
      const dx = tx - had.x
      const dy = ty - had.y
      const far = Math.hypot(dx, dy)
      if (far <= step) {
        had.x = tx
        had.y = ty
      } else {
        had.x += (dx / far) * step
        had.y += (dy / far) * step
      }
      return had
    }
    function standees(dt = 0): Standee[] {
      const out: Standee[] = []
      const byRoom = new Map<string, Omit<Standee, 'here' | 'x' | 'y'>[]>()
      const gone = new Set(shown.keys())

      /*
       * **시작 전에는 실시간 자리가 전부다.**
       *
       * 서버가 아직 말을 안 세워서 view 가 없다. 안개도 없으니
       * 가릴 것도 없고, 명단에 앉은 사람 중 지금 걷고 있는 사람이
       * 곧 보이는 사람이다. 판이 열리면 이 가지는 안 쓰인다.
       */
      if (!viewRef.current) {
        for (const m of rosterRef.current ?? []) {
          if (m.playerId === me.playerId) continue
          const now = liveOf(m.playerId)
          if (!now) continue
          gone.delete(m.playerId)
          const at = ease(m.playerId, now.x * TILE, now.y * TILE, dt)
          out.push({
            playerId: m.playerId,
            team: m.team,
            asleep: false,
            look: lookOf(m.playerId),
            dir: now.dir,
            moving: now.moving,
            here: now.tileId as TileId,
            x: at.x,
            y: at.y,
          })
        }
        for (const id of gone) shown.delete(id)
        return out
      }

      for (const p of viewRef.current?.visiblePawns ?? []) {
        if (p.walking || !p.tileId) continue
        gone.delete(p.playerId)
        const who = {
          playerId: p.playerId,
          team: p.team,
          asleep: p.asleep === true,
          look: lookOf(p.playerId),
          dir: 'down' as Dir,
          moving: false,
        }
        /*
         * **실시간 자리가 있으면 그쪽이 먼저다.**
         *
         * 서버가 아는 것은 멈춰 선 칸뿐이라 걷는 도중이 통째로 빈다.
         * 다만 서버가 말하는 방과 다른 방을 가리키면 안 믿는다 —
         * 화면이 적는 값이라, 안 보이는 방에 서 있다고 우길 수 있다.
         * 우겨 봐야 여기서 걸러지고, 판정은 애초에 pawns 만 본다.
         */
        const now = liveOf(p.playerId)
        if (now && now.tileId === p.tileId) {
          const at = ease(p.playerId, now.x * TILE, now.y * TILE, dt)
          out.push({ ...who, dir: now.dir, moving: now.moving, here: p.tileId as TileId, x: at.x, y: at.y })
          continue
        }
        if (p.at) {
          const at = ease(p.playerId, p.at.x * TILE + TILE / 2, p.at.y * TILE + TILE / 2, dt)
          out.push({ ...who, here: p.tileId as TileId, x: at.x, y: at.y })
          continue
        }
        const row = byRoom.get(p.tileId) ?? []
        row.push(who)
        byRoom.set(p.tileId, row)
      }
      // 안 보이게 된 사람의 자리는 버린다. 다시 나타나면 그 자리에 찍힌다
      for (const id of gone) shown.delete(id)
      for (const [tileId, mates] of byRoom) {
        const at = centerPx(asRoom(tileId))
        if (!at) continue
        const order = [...mates].sort((a, b) => (a.playerId < b.playerId ? -1 : 1))
        const cols = Math.ceil(Math.sqrt(order.length))
        const rows = Math.ceil(order.length / cols)
        order.forEach((p, i) => {
          out.push({
            ...p,
            here: tileId as TileId,
            x: at.x + Math.round(((i % cols) - (cols - 1) / 2) * DOT_PX),
            y: at.y + Math.round((Math.floor(i / cols) - (rows - 1) / 2) * DOT_PX),
          })
        })
      }
      return out
    }

    /** 손끝이 짚은 사람. **내 방에 선 사람만** — 먼 방 사람에게는 할 것이 없다. */
    function personAt(sx: number, sy: number, here: TileId | null): string | null {
      if (!here) return null
      let best: string | null = null
      let front = -Infinity
      for (const p of standees()) {
        if (p.playerId === me.playerId || p.here !== here) continue
        // **짚는 자리는 보이는 자리다.** 몸이 있는 사람은 발끝이 아니라
        // 머리끝까지가 그 사람이다 — 얼굴을 눌렀는데 아무 일도 안
        // 일어나면 눌러야 할 곳을 찾아 더듬게 된다
        const hit = p.look
          ? Math.abs(p.x - sx) <= GRAB_PX && sy <= p.y + 4 && sy >= p.y - CHAR_PX
          : Math.hypot(p.x - sx, p.y - sy) <= GRAB_PX
        // 겹쳐 서 있으면 앞에 선 사람이다. 그리는 순서와 같아야 한다
        if (hit && p.y > front) {
          front = p.y
          best = p.playerId
        }
      }
      return best
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
      ctx.fillStyle = TEAM_COLOR[team]
      ctx.beginPath()
      ctx.arc(Math.round(x), Math.round(y), 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
    }

    /**
     * 사람 하나. **나도 남도 여기로 그린다.**
     *
     * 전에는 나만 캐릭터였고 남들은 팀 색 점이었다. 그러면 열넷이
     * 저마다 얼굴을 만들어 놓고 정작 서로는 못 본다 — 얼굴을 만드는
     * 화면이 무슨 소용인지 알 수 없어진다.
     *
     * 남이 어디를 보고 섰는지는 서버가 안 보낸다. 보내려면 걸음마다
     * 방향을 적어 올려야 하는데, 그건 「옆에 있는가」 하나 때문에
     * 서버를 두드리는 것과 같은 값을 치르는 일이다. 서 있는 사람은
     * 정면(down)으로 둔다 — 마주 선 것처럼 보인다.
     *
     * (x, y) 는 **발끝이다.** 그림 크기가 달라져도 서 있는 자리는 같다.
     */
    function person(
      x: number,
      y: number,
      team: TeamId,
      look: AvatarLook | null,
      asleep: boolean,
      dir: Dir = 'down',
      frame = 0,
    ): void {
      if (!look) {
        dot(x, y, team, asleep)
        return
      }
      const img = pixelFrame(normalizeLook(look), team, dir, frame)
      const k = CHAR_PX / img.width
      const dw = Math.round(img.width * k)
      const dh = Math.round(img.height * k)
      ctx.globalAlpha = asleep ? 0.5 : 1
      ctx.drawImage(img, Math.round(x - dw / 2), Math.round(y - dh + 6 * k), dw, dh)
      ctx.globalAlpha = 1
    }

    /**
     * 멈춰 선 자리를 서버에 알린다.
     *
     * **멈춘 뒤에 한 번만.** 걷는 동안에도, 갈 길이 남아 있는 동안에도
     * 안 보낸다 — 한 칸에 160ms 인 걸음을 칸마다 적으면 열넷이 종일
     * 서버를 두드린다. 같은 칸을 두 번 보내지도 않는다.
     */
    let told = ''
    const tellTimer = window.setInterval(() => {
      if (self.moving || autoPath.length > 0) return
      // **한 칸에 둘이 서 있으면 한쪽이 비킨다.** 둘이 동시에 들어오면
      // 서로의 자리를 모른 채 같은 칸을 고를 수 있다. 아이디가 뒤인
      // 쪽이 비킨다 — 둘 다 비키면 둘 다 계속 어긋난다
      const clash = (viewRef.current?.visiblePawns ?? []).some(
        (p) =>
          p.playerId !== me.playerId &&
          !p.walking &&
          p.at?.x === self.tx &&
          p.at?.y === self.ty &&
          p.playerId < me.playerId,
      )
      if (clash) {
        const room = roomAt(self.tx, self.ty)?.id ?? null
        if (room) {
          const aside = freeSpot(self.tx, self.ty, room)
          if (aside.x !== self.tx || aside.y !== self.ty) standAt(aside.x, aside.y)
        }
      }
      const here = `${self.tx},${self.ty}`
      if (here === told) return
      told = here
      standRef.current(self.tx, self.ty)
    }, 500)

    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      window.clearInterval(tellTimer)
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
