// 미니맵과 전체 맵.
//
// 그림은 MapPlan 하나가 그린다. 여기서는 **어디에 띄우고 어떻게
// 만지는지**만 다룬다 — 미니맵은 구석에 떠 있고, 전체 맵은 화면을
// 덮고 손가락으로 넓혔다 줄였다 한다.
import { forwardRef, useCallback, useEffect, useRef, useState } from 'react'

import {
  MapPlan,
  PLAN_SCALE,
  TEAM_COLOR,
  floorCells,
  hallCells,
  nearbyOf,
  readMap,
  roomName,
  type Cell,
  type MapFacts,
  type RoomFacts,
} from './MapPlan'
import { PLAN_H, PLAN_W, STAIRWELLS, TILE_BY_ID } from '../../../shared/rules/board'
import { SHOP_TILE } from '../../../shared/rules/shop'
import { Snow } from '../reveal/Snow'
import { MINIMAP_ON_KEY } from './timing'
import type { TeamId, TileId } from '../types'

const KIND_NAME: Record<string, string> = {
  narrow: '좁은 방',
  lab: '연구실',
  plant: '발전소',
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
 * 화면 오른쪽 위에 떠 있는 작은 지도.
 *
 * 내 방과 거기서 한 칸까지만. 내가 늘 한가운데 오고, 내가 움직이면
 * 지도가 따라 움직인다 — 정확히는 그릴 방이 바뀌면서 저절로 그렇게 된다.
 */
export function MiniMap({ facts, onOpen }: { facts: MapFacts; onOpen: () => void }) {
  const rooms = readMap(facts)
  return (
    <button className="sc-mini" onClick={onOpen} aria-label="전체 맵 열기">
      <MapPlan rooms={rooms} only={nearbyOf(facts.here)} here={facts.here} compact />
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
/** 픽셀 글꼴이 또렷한 크기. 갈무리11 은 이름 그대로 11px 이다. */
const NAME_PX = 11

/**
 * 그 글자가 몇 화소를 먹는가. 한글은 온폭, 숫자와 기호는 반폭이다.
 *
 * 한 글자를 11px 로 어림하면 「2-3 교실」처럼 숫자가 섞인 이름이
 * 들어가는데도 잘린다. 갈무리는 그런 글자를 반폭으로 그린다.
 */
const charPx = (ch: string) => (/[\uac00-\ud7a3\u3130-\u318f]/.test(ch) ? NAME_PX : NAME_PX / 2)

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
  plant: 'is-plant',
}

/** 그 방에서 무엇을 할 수 있는가. **규칙에서 읽어 온다 — 새 규칙이 아니다.** */
function canDoIn(room: RoomFacts): string[] {
  const out: string[] = []
  if (room.id === SHOP_TILE) out.push('상점 — 서서 물건을 산다')
  if (room.kind === 'lab') out.push('연구실 — 페이즈에 연구한다')
  if (room.kind === 'plant') out.push('발전소 — 연구가 그 자리에서 난다')
  if (room.kind === 'narrow') out.push('좁은 방 — 둘까지만 선다')
  if (TILE_BY_ID[room.id]?.homeOf) out.push('기지 — 주인이 안 바뀐다')
  else out.push('페이즈가 닫힐 때 서 있으면 머릿수에 든다')
  return out
}

/** 인원 점. **분수 대신 네모를 늘어놓는다** — 얼마나 찼는지가 바로 보인다. */
function Seats({ room, big }: { room: RoomFacts; big?: boolean }) {
  if (!room.known) return null
  const count = room.count ?? 0
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
  const [fit, setFit] = useState(4)
  const [room, setRoom] = useState({ w: 0, h: 0 })
  const [zoom, setZoom] = useState(0)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const boxRef = useRef<HTMLDivElement | null>(null)
  const sheetRef = useRef<HTMLDivElement | null>(null)

  /** 한 칸을 몇 화소로. **정수로만 둔다** — 반 화소는 픽셀 그림을 뭉갠다. */
  const cell = Math.max(2, Math.round(fit * (1 + zoom * 0.6)))

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
      const w = box.clientWidth - GUTTER - 8
      const h = box.clientHeight - 8
      if (w <= 0 || h <= 0) return
      setRoom({ w: box.clientWidth, h: box.clientHeight })
      setFit(Math.max(2, Math.floor(Math.min(w / PLAN_W, h / PLAN_H))))
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
    const r = rooms.find((x) => x.id === picked)
    if (!r) return
    const bottom = mid.y + pan.y + ((r.box.y + r.box.h) / PLAN_SCALE) * cell
    const room = box.clientHeight - sheet.offsetHeight - 6
    if (bottom > room) setPan((p) => ({ ...p, y: p.y - (bottom - room) }))
    // 누른 방이 바뀔 때만 본다. pan 을 의존성에 넣으면 스스로를 다시 민다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, cell])

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
  const planW = PLAN_W * cell + GUTTER
  const planH = PLAN_H * cell
  const mid = {
    x: Math.max(0, (room.w - planW) / 2),
    y: Math.max(0, (room.h - planH) / 2),
  }

  const one = rooms.find((r) => r.id === picked) ?? null
  const ours = rooms.filter((r) => r.owner === facts.myTeam).length
  const left = clock.open && clock.endsAtMs != null ? Math.max(0, clock.endsAtMs - clock.nowMs) : null

  return (
    <div className="sc-at">
      <header className="sc-at__bar">
        <span className="sc-at__when">
          {left == null
            ? '자유 시간'
            : `${clock.no}교시 ${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`}
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

      {/* 빈 곳을 누르면 시트가 내려간다. 맵은 그대로 있다 */}
      <div className="sc-at__box" ref={boxRef} onClick={() => setPicked(null)}>
        <div
          className="sc-at__plan"
          style={{
            width: planW,
            height: planH,
            // **정수 화소로만 옮긴다.** 반 화소면 픽셀 글꼴이 뭉개진다
            transform: `translate(${Math.round(mid.x + pan.x)}px, ${Math.round(mid.y + pan.y)}px)`,
          }}
        >
          {floorCells().map((f) => (
            <div key={f.floor}>
              {/* 층을 가르는 굵은 선과 왼쪽에 세워 붙인 이름 */}
              <div className="sc-at__rule" style={{ top: f.y * cell - 2, width: PLAN_W * cell + GUTTER }} />
              <div className="sc-at__floor" style={{ top: f.y * cell, height: f.h * cell }}>
                {f.name}
              </div>
            </div>
          ))}

          {hallCells().map((g, i) => (
            <div
              key={i}
              className={g.stair ? 'sc-at__hall is-stair' : 'sc-at__hall'}
              style={{
                left: GUTTER + g.x * cell,
                top: g.y * cell,
                width: g.w * cell,
                height: g.h * cell,
                backgroundSize: `${cell}px ${cell}px`,
              }}
            />
          ))}

          {stairLinks().map((l, i) => (
            <div
              key={i}
              className="sc-at__stair"
              style={{ left: GUTTER + l.x * cell, top: l.y * cell, width: l.w * cell, height: l.h * cell }}
              aria-hidden="true"
            />
          ))}

          {rooms.map((r) => {
            const w = r.box.w / PLAN_SCALE
            const h = r.box.h / PLAN_SCALE
            const px = w * cell
            const label = clipName(r.name, px - 5)
            return (
              <button
                key={r.id}
                type="button"
                className={[
                  'sc-at__room',
                  r.known ? '' : 'is-unseen',
                  r.id === facts.here ? 'is-here' : '',
                  picked === r.id ? 'is-picked' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{
                  left: GUTTER + (r.box.x / PLAN_SCALE) * cell,
                  top: (r.box.y / PLAN_SCALE) * cell,
                  width: px,
                  height: h * cell,
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  setPicked(r.id)
                }}
              >
                {/* 완장. **테두리가 아니라 위에 두른 띠다** */}
                <i className="sc-at__band" style={r.owner ? { background: TEAM_COLOR[r.owner] } : undefined} />
                {label.length > 0 && <span className="sc-at__nm">{label}</span>}
                {/* **가리는 것은 머릿수뿐이다.** 이름도 자리도 정원도
                    차지한 팀도 판에 드러난 것이라 처음부터 보인다 */}
                {r.known ? <Seats room={r} /> : <span className="sc-at__q">?</span>}
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
        <RoomSheet ref={sheetRef} room={one} myTeam={facts.myTeam} onClose={() => setPicked(null)} />
      )}
    </div>
  )
}

/**
 * 층과 층 사이 계단. **어디로 오르내리는지**를 그 틈에 그린다.
 *
 * 계단통은 층마다 제자리에 있는데, 도면에서는 층이 위아래로 떨어져
 * 있어서 그 사이가 비어 있었다. 비어 있으면 위층과 아래층이 남남으로
 * 보인다. 칸 단위다.
 */
function stairLinks(): Cell[] {
  // **위에서 아래로 줄을 세운다.** FLOORS 는 지하부터라, 그대로 두면
  // 「윗층」과 「아랫층」이 뒤집혀 틈이 음수가 되고 한 줄도 안 그려진다
  const bands = [...floorCells()].sort((a, b) => a.y - b.y)
  const out: Cell[] = []
  for (let i = 0; i + 1 < bands.length; i++) {
    const upper = bands[i]
    const lower = bands[i + 1]
    const top = upper.y + upper.h
    const gap = lower.y - top
    if (gap <= 0) continue
    for (const w of STAIRWELLS) {
      if (w.floor !== lower.floor) continue
      out.push({ x: w.plan.x + 1, y: top, w: Math.max(1, w.plan.w - 2), h: gap })
    }
  }
  return out
}

/**
 * 누른 방. **맵 위에 떠오르는 시트다** — 맵을 밀어내지 않는다.
 *
 * 높이를 화면의 40%로 묶는다. 더 올라오면 방금 누른 그 방이 시트에
 * 가려서, 무엇을 보고 있는지 모르게 된다.
 */
const RoomSheet = forwardRef<
  HTMLDivElement,
  { room: RoomFacts; myTeam: TeamId; onClose: () => void }
>(function RoomSheet({ room, myTeam, onClose }, ref) {
  return (
    <div className="sc-at__sheet" ref={ref} onClick={(e) => e.stopPropagation()}>
      <h3>
        {room.name}
        <span>{KIND_NAME[room.kind]}</span>
        <button className="sc-at__x" onClick={onClose} aria-label="정보 닫기">
          ✕
        </button>
      </h3>
      <dl>
        <div>
          <dt>차지한 팀</dt>
          <dd className={room.owner === myTeam ? 'is-ours' : undefined}>
            {room.owner ? `${room.owner}팀` : '없다'}
          </dd>
        </div>
        <div>
          <dt>지금 인원</dt>
          <dd>
            {room.known ? (
              <>
                <Seats room={room} big />
                <em>
                  {room.count}
                  {room.open ? '명' : ` / ${room.capacity}`}
                </em>
              </>
            ) : (
              '모른다'
            )}
          </dd>
        </div>
      </dl>
      <ul className="sc-at__can">
        {canDoIn(room).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {!room.known && <p className="sc-at__why">아직 안을 본 적이 없다.</p>}
    </div>
  )
})
