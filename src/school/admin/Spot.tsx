// 자리를 짚는 작은 판.
//
// 층 하나를 작게 그려 놓고 칸을 찍는다. **복도가 같이 그려진다** —
// 문제 종이는 복도에도 놓이는데, 방 이름을 고르는 목록으로는 복도를
// 가리킬 수가 없다(복도는 어느 방에도 안 속한다).
//
// 진짜 맵을 붙이지 않은 까닭은 그게 걸음·안개·사람까지 딸려 오는
// 물건이라서다. 여기서 필요한 것은 **어디에 놓을 수 있나** 하나뿐이다.
import { useEffect, useMemo, useRef, useState } from 'react'

import { FLOORS, FLOOR_NAME, HALLS, TILES, roomOfCell, type Floor } from '../../../shared/rules/board'
import { isFixture } from '../../../shared/rules/fixtures'
import { canDropQuizAt } from '../../../shared/rules/quiz'

/** 한 칸을 몇 화소로 그리나. 손가락으로 찍을 만한 크기다. */
const PX = 9

export interface Spot {
  x: number
  y: number
}

/** 이미 놓여 있는 종이. 겹쳐 놓지 않게 점으로 찍는다. */
export interface SpotMark {
  x: number
  y: number
  taken: boolean
}

export interface SpotPickProps {
  value: Spot | null
  onPick: (at: Spot) => void
  marks?: readonly SpotMark[]
}

/** 그 층이 차지하는 칸 범위. 판 크기를 여기서 잰다. */
function boundsOf(floor: Floor): { x0: number; y0: number; w: number; h: number } {
  const rects = [
    ...TILES.filter((t) => t.floor === floor).map((t) => t.plan),
    ...HALLS.filter((h) => h.floor === floor).map((h) => h.rect),
  ]
  const x0 = Math.min(...rects.map((r) => r.x))
  const y0 = Math.min(...rects.map((r) => r.y))
  const x1 = Math.max(...rects.map((r) => r.x + r.w))
  const y1 = Math.max(...rects.map((r) => r.y + r.h))
  return { x0, y0, w: x1 - x0, h: y1 - y0 }
}

export function SpotPick({ value, onPick, marks = [] }: SpotPickProps) {
  const [floor, setFloor] = useState<Floor>('f1')
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const b = useMemo(() => boundsOf(floor), [floor])

  /*
   * 고른 자리가 다른 층이면 판을 그 층으로 옮긴다. 안 그러면 「고른
   * 자리」 글줄과 눈에 보이는 판이 서로 다른 데를 가리킨다.
   */
  useEffect(() => {
    if (!value) return
    const room = TILES.find((t) => t.id === roomOfCell(value.x, value.y))
    if (room) {
      setFloor(room.floor)
      return
    }
    const hall = HALLS.find(
      (h) =>
        value.x >= h.rect.x &&
        value.x < h.rect.x + h.rect.w &&
        value.y >= h.rect.y &&
        value.y < h.rect.y + h.rect.h,
    )
    if (hall) setFloor(hall.floor)
  }, [value])

  useEffect(() => {
    const c = canvasRef.current
    const g = c?.getContext('2d')
    if (!c || !g) return
    c.width = b.w * PX
    c.height = b.h * PX
    g.clearRect(0, 0, c.width, c.height)

    for (let y = 0; y < b.h; y++) {
      for (let x = 0; x < b.w; x++) {
        const cx = b.x0 + x
        const cy = b.y0 + y
        const room = roomOfCell(cx, cy)
        const can = canDropQuizAt(cx, cy)
        // 벽은 아예 안 그린다. 판이 학교 모양으로 보여야 짚을 수 있다
        if (!can && !isFixture(cx, cy)) continue
        g.fillStyle = !can ? '#4a4336' : room ? '#cdc5b0' : '#8c8571'
        g.fillRect(x * PX, y * PX, PX - 1, PX - 1)
      }
    }

    // 이미 놓인 종이. 주워 간 것은 흐리게
    for (const m of marks) {
      const x = m.x - b.x0
      const y = m.y - b.y0
      if (x < 0 || y < 0 || x >= b.w || y >= b.h) continue
      g.fillStyle = m.taken ? '#7b7364' : '#b8922f'
      g.beginPath()
      g.arc(x * PX + PX / 2 - 0.5, y * PX + PX / 2 - 0.5, PX / 3, 0, Math.PI * 2)
      g.fill()
    }

    // 고른 자리. 테로 표시한다 — 점은 이미 놓인 것이 쓰고 있다
    if (value) {
      const x = value.x - b.x0
      const y = value.y - b.y0
      if (x >= 0 && y >= 0 && x < b.w && y < b.h) {
        g.strokeStyle = '#9a3b33'
        g.lineWidth = 2
        g.strokeRect(x * PX - 1, y * PX - 1, PX + 1, PX + 1)
      }
    }
  }, [b, value, marks])

  const tap = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current
    if (!c) return
    const r = c.getBoundingClientRect()
    const x = b.x0 + Math.floor(((e.clientX - r.left) / r.width) * b.w)
    const y = b.y0 + Math.floor(((e.clientY - r.top) / r.height) * b.h)
    if (!canDropQuizAt(x, y)) return
    onPick({ x, y })
  }

  const where = value
    ? (() => {
        const room = TILES.find((t) => t.id === roomOfCell(value.x, value.y))
        return room ? `${FLOOR_NAME[room.floor]} · ${room.name}` : `${FLOOR_NAME[floor]} · 복도`
      })()
    : null

  return (
    <div className="sc-sp">
      <div className="sc-sp__floors">
        {FLOORS.map((f) => (
          <button key={f} className={f === floor ? 'is-on' : ''} onClick={() => setFloor(f)}>
            {FLOOR_NAME[f]}
          </button>
        ))}
      </div>
      <div className="sc-sp__board">
        <canvas ref={canvasRef} onClick={tap} />
      </div>
      <p className="sc-sp__where">
        {where ? (
          <>
            고른 자리 <b>{where}</b> <span>({value?.x}, {value?.y})</span>
          </>
        ) : (
          '판에서 칸을 짚는다. 복도에도 놓을 수 있다.'
        )}
      </p>
    </div>
  )
}
