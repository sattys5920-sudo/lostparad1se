// 미니맵과 전체 맵.
//
// 그림은 MapPlan 하나가 그린다. 여기서는 **어디에 띄우고 어떻게
// 만지는지**만 다룬다 — 미니맵은 구석에 떠 있고, 전체 맵은 화면을
// 덮고 손가락으로 넓혔다 줄였다 한다.
import { useCallback, useEffect, useRef, useState } from 'react'

import { MapPlan, nearbyOf, readMap, roomName, type MapFacts, type RoomFacts } from './MapPlan'
import { ROOM_KIND } from '../../../shared/rules/occupy'
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

const ZOOM_MIN = 0.6
const ZOOM_MAX = 3

export function FullMap({ facts, onClose }: { facts: MapFacts; onClose: () => void }) {
  const rooms = readMap(facts)
  const [picked, setPicked] = useState<TileId | null>((facts.here as TileId | null) ?? null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const boxRef = useRef<HTMLDivElement | null>(null)

  // 닫는 일은 ref 로 들고 간다. onClose 는 렌더마다 새 함수라, 의존성에
  // 그대로 넣으면 아래 effect 가 매 렌더 다시 돌고 **정리 단계의
  // history.back() 이 열자마자 도로 닫는다.** 실제로 그랬다
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
      // 우리가 쌓은 것이 아직 위에 있으면 걷어낸다
      if (history.state?.atlas) history.back()
    }
  }, [])

  // 두 손가락으로 넓히고 끌어서 옮긴다
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const touches = new Map<number, { x: number; y: number }>()
    let startGap = 0
    let startZoom = 1
    let startPan = { x: 0, y: 0 }
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
        const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, startZoom * (gapOf() / startGap)))
        setZoom(next)
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
    box.addEventListener('pointerleave', up)
    return () => {
      box.removeEventListener('pointerdown', down)
      box.removeEventListener('pointermove', move)
      box.removeEventListener('pointerup', up)
      box.removeEventListener('pointercancel', up)
      box.removeEventListener('pointerleave', up)
    }
  }, [zoom, pan])

  const one = rooms.find((r) => r.id === picked) ?? null

  return (
    <div className="sc-atlas" onClick={onClose}>
      <div className="sc-atlas__sheet" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>학교</h2>
          <button className="sc-atlas__x" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </header>

        <div className="sc-atlas__box" ref={boxRef}>
          <div
            className="sc-atlas__inner"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
          >
            <MapPlan
              rooms={rooms}
              here={facts.here}
              compact={false}
              picked={picked}
              onPick={setPicked}
            />
          </div>
        </div>

        {one && <RoomCard room={one} myTeam={facts.myTeam} />}
      </div>
    </div>
  )
}

/** 누른 방의 속. 모르는 방은 모른다고만 말한다. */
function RoomCard({ room, myTeam }: { room: RoomFacts; myTeam: TeamId }) {
  if (!room.known) {
    return (
      <div className="sc-atlas__card">
        <h3>{roomName(room.id)}</h3>
        <p>아직 가 본 적이 없다. 안이 어떤지 모른다.</p>
      </div>
    )
  }
  const mine = room.dots.filter((d) => d.team === myTeam && !d.robot).length
  const others = room.dots.filter((d) => d.team !== myTeam && !d.robot).length
  const bots = room.dots.filter((d) => d.robot).length
  return (
    <div className="sc-atlas__card">
      <h3>
        {room.name} <span>{KIND_NAME[ROOM_KIND[room.id]]}</span>
      </h3>
      <dl>
        <div>
          <dt>주인</dt>
          <dd>{room.owner ? `${room.owner}팀` : '없다'}</dd>
        </div>
        <div>
          <dt>사람</dt>
          <dd>
            {room.count} / {room.capacity}
          </dd>
        </div>
        <div>
          <dt>보이는 것</dt>
          <dd>
            우리 {mine} · 남 {others} · 로봇 {bots}
          </dd>
        </div>
      </dl>
      <p className="sc-atlas__why">숫자는 위장이 섞여 있을 수 있다. 눈으로 센 것이 아니다.</p>
    </div>
  )
}
