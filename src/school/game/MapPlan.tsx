// 전개도 — 미니맵과 전체 맵이 **같은 그림**을 다른 크기로 그린 것이다.
//
// 두 벌로 만들면 반드시 어긋난다. 미니맵에서는 주인이 바뀌었는데 전체
// 맵에서는 안 바뀐 채로 며칠 굴러가는 식이다. 그래서 그리는 함수는
// 하나고, 「어느 방까지」와 「얼마나 크게」만 다르다.
//
// 좌표는 이미 판 데이터에 있다(board.ts 의 plan 네모). 3D도 원근도 없이
// 도면 그대로 편다 — 걸어 다니는 지도와 같은 네모, 같은 크기다. 방이
// 다 같은 정사각형이던 때에는 도서관도 창고도 똑같아 보였다.
//
// **안 아는 방은 서버가 숫자를 안 보낸다.** 여기서 감추는 것이 아니라
// 애초에 없다. 받아다 가리면 개발자도구로 다 보인다.
import { useEffect, useRef, useState } from 'react'

import { TEAMS } from '../char/palette'
import { ADJACENCY, ALLEY, ALLEY_NAME, FLOOR_NAME, FLOORS, HALLS, STAIRWELLS, TILES, TILE_BY_ID } from '../../../shared/rules/board'
import { OPEN_TILES, ROOM_KIND, capacityOf } from '../../../shared/rules/occupy'
import type { PlayerViewDoc, TileDoc } from '../../../shared/model'
import type { TeamId, TileId } from '../types'

/**
 * 미니맵 글자의 **화면** 크기(px).
 *
 * 88px 미니맵에 8px 로 적으면 이름끼리 겹치는 화면이 25 개 중 하나고,
 * 그 하나는 아래(miniLabels)가 방 아래쪽으로 비켜 준다. 9px 로 올리면
 * 여섯이 겹친다 — 재 본 값이다(MapPlan.test.ts).
 */
export const MINI_FONT_PX = 8

/** 글자 하나의 폭(글자 크기 배수). 한글은 네모 한 칸, 나머지는 좁다. */
const glyphEm = (ch: string) => (/[\uac00-\ud7a3\u3130-\u318f]/.test(ch) ? 1 : 0.6)
export const textWidth = (s: string, font: number) => [...s].reduce((a, c) => a + glyphEm(c) * font, 0)

export interface MiniLabel {
  id: TileId
  text: string
  /** 글자 가운데 x 와 밑줄 y. SVG text 가 그대로 받는다. */
  x: number
  y: number
  /** 방 위쪽에 앉았나. 아니면 아래쪽 — 점은 그 반대편으로 비킨다. */
  top: boolean
  box: { l: number; r: number; t: number; b: number }
}

/**
 * 미니맵 방 이름을 놓는다. **서로 안 겹치게.**
 *
 * 먼저 방 위쪽에 앉혀 보고, 앞서 놓은 이름과 부딪치면 방 아래쪽으로
 * 내린다. 방 폭을 조금 넘는 것은 괜찮다 — 방 사이가 복도라 옆 방
 * 이름과 안 부딪치는 한 읽힌다. 겹치는 것만 안 된다.
 *
 * **위도 아래도 막힌 이웃 방은 이름을 안 적는다.** 강당에 서서 볼 때의
 * 운동장이 그렇다 — 두 방이 88px 에서 17px 높이라 위·아래에 나눠 앉혀도
 * 2px 가 겹치고, 옆으로 밀면 미니맵 밖으로 나간다. 겹친 두 이름은 둘 다
 * 안 읽히므로 하나를 빼는 편이 낫다. 한 칸 다가가면 다시 나오고, 전체
 * 맵에는 늘 있다. **내 방 이름은 절대 안 뺀다.**
 *
 * 좌표는 전개도 단위다. font 도 단위로 받는다(화면 px 를 배율로 나눈 값).
 *
 * **내 방(first)을 맨 먼저 놓는다** — 겹쳐서 비켜야 한다면 비키는 쪽은
 * 남의 방이다. 순서를 여기서 정해야 그리는 쪽과 시험이 같은 순서를 본다.
 */
export function miniLabels(
  rooms: readonly { id: TileId; mini: string; box: { x: number; y: number; w: number; h: number } }[],
  font: number,
  first: string | null = null,
): MiniLabel[] {
  const pad = font * 0.2
  const out: MiniLabel[] = []
  const order = [...rooms].sort((a, b) => Number(b.id === first) - Number(a.id === first))
  const hits = (b: MiniLabel['box']) =>
    out.some((o) => o.box.l < b.r && b.l < o.box.r && o.box.t < b.b && b.t < o.box.b)
  for (const r of order) {
    const w = textWidth(r.mini, font)
    const cx = r.box.x + r.box.w / 2
    const at = (top: boolean): MiniLabel['box'] => {
      const t = top ? r.box.y + pad : r.box.y + r.box.h - pad - font
      return { l: cx - w / 2, r: cx + w / 2, t, b: t + font }
    }
    let top = true
    let box = at(true)
    if (hits(box)) {
      const low = at(false)
      if (!hits(low)) {
        top = false
        box = low
      } else if (r.id !== first) {
        continue
      }
    }
    // 한글의 윗선은 글자 크기의 0.86 쯤 위다 — 밑줄을 거기에 맞춘다
    out.push({ id: r.id, text: r.mini, x: cx, y: box.t + font * 0.86, top, box })
  }
  return out
}

/**
 * 그릴 방들을 감싸는 테두리 — SVG 의 viewBox 다.
 *
 * **그리는 쪽과 시험이 같은 것을 부른다.** 시험이 이 계산을 따로 베껴
 * 두면, 여백을 고친 날 시험만 옛 여백으로 「안 겹친다」고 말한다.
 */
export function planFrame(shown: readonly { box: { x: number; y: number; w: number; h: number } }[]) {
  const x0 = Math.min(...shown.map((r) => r.box.x)) - PLAN_PAD
  const y0 = Math.min(...shown.map((r) => r.box.y)) - PLAN_PAD
  const w = Math.max(...shown.map((r) => r.box.x + r.box.w)) + PLAN_PAD - x0
  const h = Math.max(...shown.map((r) => r.box.y + r.box.h)) + PLAN_PAD - y0
  return { x0, y0, w, h }
}

/** 걸어 다니는 칸 하나를 전개도에서 몇으로 그리는가. */
export const PLAN_SCALE = 6
/**
 * 전개도 가장자리 여백.
 *
 * 층 이름이 바닥판 **위에** 앉으므로 그만큼은 비어 있어야 한다 —
 * 좁게 두었더니 맨 위 층(옥상) 이름이 테두리에 잘렸다.
 */
export const PLAN_PAD = 20

/** 한 방에 점을 이만큼까지 그리고, 넘으면 +N 으로 적는다. */
export const DOTS_MAX = 3

/** 방 종류 표시. 좁은 방·연구실만 따로 그린다. */
export const KIND_MARK: Record<string, string> = { narrow: '▮', lab: '⚗', normal: '' }

/**
 * 완장 색. **char/palette.ts 의 TEAMS 가 정본이다** — 도트로 그린
 * 완장과 화면의 색이 어긋나면 안 된다. 전에는 같은 네 값을 여기에
 * 또 적어 두었다.
 */
export const TEAM_COLOR: Record<TeamId, string> = Object.fromEntries(
  TEAMS.map((t) => [t.id, t.color]),
) as Record<TeamId, string>

/** 아직 팀이 없는 자리. 배정 전 로비의 명단이 이 색으로 선다. */
export const NO_TEAM_COLOR = 'var(--sc-ink-dim, #6b6b6b)'

export const colorOfTeam = (team: TeamId | null): string =>
  team === null ? NO_TEAM_COLOR : TEAM_COLOR[team]

export interface MapFacts {
  /** 내가 선 방. 규칙 쪽에서 온 string 을 여기서 받아 지도 이름으로 쓴다. */
  here: string | null
  meId: string
  myTeam: TeamId
  view: PlayerViewDoc | null
  tiles: Partial<Record<TileId, TileDoc>>
}

/** 그 방에 대해 내가 아는 것 전부. 모르는 방은 null 이 아니라 known: false 다. */
export interface RoomFacts {
  id: TileId
  name: string
  /** 미니맵에 적는 두세 글자(board.ts 의 miniName). */
  mini: string
  /** 전개도에서의 네모. 걸어 다니는 지도와 같은 자리, 같은 크기다. */
  box: { x: number; y: number; w: number; h: number }
  owner: TeamId | null
  /** 가 봤거나 지금 보이는 방. 어느 쪽도 아니면 지도에 검게 남는다. */
  known: boolean
  /**
   * 서버가 준 머릿수. 위장이 이미 반영돼 있다. **내가 들어가 있는 방
   * 말고는 null** — 머릿수는 들어가야만 안다(fog.ts).
   */
  count: number | null
  capacity: number
  /** 인원 제한이 없는 방. 머릿수만 적고 정원은 안 적는다. */
  open: boolean
  kind: string
  /** 그 방에 보이는 점들. 그릴 순서대로. */
  dots: { key: string; team: TeamId; me: boolean; robot: boolean }[]
}

/** 판 전체를 내가 아는 만큼으로 바꾼다. 두 지도가 같은 것을 본다. */
export function readMap(f: MapFacts): RoomFacts[] {
  const visited = new Set(f.view?.visitedTiles ?? [])
  const visible = new Set(f.view?.visibleTiles ?? [])
  const counts = f.view?.roomCounts ?? {}
  const pawns = f.view?.visiblePawns ?? []
  const robots = f.view?.visibleRobots ?? []

  return TILES.map((t) => {
    const id = t.id as TileId
    const known = visited.has(id) || visible.has(id)
    /*
     * **머릿수와 점은 서버가 보여 준 방에서만.** 전에는 「가 본 방」이면
     * `counts[id] ?? 0` 을 적었다 — 서버가 그 방 숫자를 안 보냈을 뿐인데
     * 화면이 「0명」이라고 단정했다. 이제 서버는 내가 들어가 있는 방
     * 하나만 보내므로, 그대로 두면 가 본 방이 전부 빈방으로 거짓말한다.
     */
    const inside = visible.has(id)
    const dots: RoomFacts['dots'] = []
    if (inside) {
      for (const p of pawns) {
        if (p.tileId !== id) continue
        dots.push({ key: p.playerId, team: p.team as TeamId, me: p.playerId === f.meId, robot: false })
      }
      for (const r of robots) {
        if (r.tileId !== id) continue
        dots.push({ key: r.id, team: r.team as TeamId, me: false, robot: true })
      }
    }
    // 나는 늘 먼저 그린다. 가려지면 내가 어디 있는지 못 찾는다
    dots.sort((a, b) => Number(b.me) - Number(a.me))
    return {
      id,
      name: t.shortName,
      mini: t.miniName,
      box: {
        x: t.plan.x * PLAN_SCALE,
        y: t.plan.y * PLAN_SCALE,
        w: t.plan.w * PLAN_SCALE,
        h: t.plan.h * PLAN_SCALE,
      },
      owner: (f.tiles[id]?.ownerTeam ?? null) as TeamId | null,
      known,
      count: inside ? (counts[id] ?? 0) : null,
      capacity: capacityOf(id),
      open: OPEN_TILES.has(id),
      kind: ROOM_KIND[id],
      dots,
    }
  })
}

/**
 * 복도와 계단통. **선이 아니라 바닥이다.**
 *
 * 전에는 이웃한 방의 한가운데끼리 선을 그었다. 그러면 가계도지
 * 배치도가 아니다 — 복도가 실제로 어디를 지나가는지, 어느 방이
 * 같은 복도에 붙어 있는지가 안 보였다. 판 데이터에 복도 네모가
 * 그대로 있으니 그것을 깐다.
 */
export interface Cell {
  x: number
  y: number
  w: number
  h: number
}

/** 복도와 계단통 — **칸 단위다.** 몇 배로 그릴지는 부르는 쪽이 정한다. */
export function hallCells(): (Cell & { stair: boolean; alley: boolean })[] {
  const stairAt = new Set(STAIRWELLS.map((w) => `${w.plan.x},${w.plan.y}`))
  const alleyAt = new Set(ALLEY.map((r) => `${r.x},${r.y}`))
  return HALLS.map((h) => ({
    x: h.rect.x,
    y: h.rect.y,
    w: h.rect.w,
    h: h.rect.h,
    stair: stairAt.has(`${h.rect.x},${h.rect.y}`),
    alley: alleyAt.has(`${h.rect.x},${h.rect.y}`),
  }))
}

export function halls(): (Cell & { stair: boolean; alley: boolean })[] {
  return hallCells().map((c) => ({ ...c, x: c.x * PLAN_SCALE, y: c.y * PLAN_SCALE, w: c.w * PLAN_SCALE, h: c.h * PLAN_SCALE }))
}

/** 층마다의 바닥판. 쌓아 놓은 것이 한 건물로 읽히게 깔아 준다. */
export function floorCells(): (Cell & { floor: string; name: string })[] {
  return FLOORS.map((floor) => {
    const boxes = [
      ...TILES.filter((t) => t.floor === floor).map((t) => t.plan),
      ...HALLS.filter((h) => h.floor === floor).map((h) => h.rect),
    ]
    const x = Math.min(...boxes.map((b) => b.x)) - 1
    const y = Math.min(...boxes.map((b) => b.y)) - 1
    const w = Math.max(...boxes.map((b) => b.x + b.w)) + 1 - x
    const h = Math.max(...boxes.map((b) => b.y + b.h)) + 1 - y
    return { floor, name: FLOOR_NAME[floor], x, y, w, h }
  })
}

export function slabs(): (Cell & { floor: string; name: string })[] {
  return floorCells().map((c) => ({ ...c, x: c.x * PLAN_SCALE, y: c.y * PLAN_SCALE, w: c.w * PLAN_SCALE, h: c.h * PLAN_SCALE }))
}

export interface PlanProps {
  rooms: readonly RoomFacts[]
  /** 그릴 방만 추린 것. 미니맵은 내 주변 한 칸까지다. */
  only?: ReadonlySet<TileId>
  here: string | null
  /** 작게 그릴 때는 이름과 숫자를 빼고 점만 남긴다. */
  compact: boolean
  picked?: TileId | null
  onPick?: (id: TileId) => void
}

/**
 * 전개도 한 장. 미니맵도 전체 맵도 이 함수가 그린다.
 *
 * SVG 로 그리는 이유는 크기가 둘이기 때문이다. 같은 좌표로 그려 놓고
 * viewBox 만 바꾸면 100px 짜리와 화면 가득한 것이 같은 그림이 된다.
 */
export function MapPlan({ rooms, only, here, compact, picked, onPick }: PlanProps) {
  /*
   * **그려진 크기를 잰다.** SVG 는 viewBox 를 상자에 맞춰 늘리므로,
   * 전개도 단위로 글자 크기를 적으면 화면에서 몇 px 이 될지 모른다 —
   * 미니맵은 88~140px 이고 보이는 방 수에 따라 배율이 또 바뀐다.
   * 재어 두고 거꾸로 나눠서 늘 MINI_FONT_PX 가 되게 한다.
   */
  const svgRef = useRef<SVGSVGElement>(null)
  const [px, setPx] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    const el = svgRef.current
    if (!compact || !el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) setPx({ w: r.width, h: r.height })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [compact])

  const shown = only ? rooms.filter((r) => only.has(r.id)) : rooms
  if (shown.length === 0) return null

  const { x0, y0, w, h } = planFrame(shown)
  /** 방 한가운데. 이름과 점이 여기를 기준으로 놓인다. */
  const mid = (r: RoomFacts) => ({ x: r.box.x + r.box.w / 2, y: r.box.y + r.box.h / 2 })

  /*
   * 미니맵 이름. 재기 전(첫 그림)에는 안 그린다 — 틀린 크기로 한 번
   * 번쩍 그렸다가 고쳐 그리면 그게 더 눈에 띈다.
   */
  const fontUnits = compact && px ? MINI_FONT_PX / Math.min(px.w / w, px.h / h) : null
  const labels = fontUnits ? new Map(miniLabels(shown, fontUnits, here).map((l) => [l.id, l])) : null

  /** 지금 그리는 테두리 안에 걸치는가. 미니맵은 둘레만 잘라 보여 준다. */
  const inView = (b: { x: number; y: number; w: number; h: number }) =>
    b.x < x0 + w && b.x + b.w > x0 && b.y < y0 + h && b.y + b.h > y0

  return (
    <svg
      ref={svgRef}
      className={compact ? 'sc-mp sc-mp--small' : 'sc-mp'}
      viewBox={`${x0} ${y0} ${w} ${h}`}
      role="img"
      aria-label="학교 전개도"
    >
      {/* 층 바닥. 맨 밑에 깔아야 방과 복도가 그 위에 얹힌다 */}
      {!compact &&
        slabs()
          .filter(inView)
          .map((f) => (
            <g key={f.floor} className="sc-mp__slab">
              <rect x={f.x} y={f.y} width={f.w} height={f.h} rx={4} />
              <text x={f.x + 4} y={f.y - 4} className="sc-mp__floor">
                {f.name}
              </text>
            </g>
          ))}

      {/* 복도와 계단통. **선이 아니라 바닥이다** — 방보다 먼저 깐다 */}
      {halls()
        .filter(inView)
        .map((g, i) => (
          <rect
            key={i}
            x={g.x}
            y={g.y}
            width={g.w}
            height={g.h}
            className={g.stair ? 'sc-mp__hall is-stair' : g.alley ? 'sc-mp__hall is-alley' : 'sc-mp__hall'}
          />
        ))}
      {/* 뒷골목. **방이 아니라 이름표만 단다** — 차지할 수 없는 자리라
          주인 색도 머릿수도 없다. 오락기가 거기 있다는 것만 알면 된다 */}
      {(() => {
        const r = ALLEY[ALLEY.length - 1]
        const box = { x: r.x * PLAN_SCALE, y: r.y * PLAN_SCALE, w: r.w * PLAN_SCALE, h: r.h * PLAN_SCALE }
        if (!inView(box) || (compact && !fontUnits)) return null
        return (
          <text
            x={box.x + box.w / 2}
            y={box.y + box.h / 2}
            className="sc-mp__alley"
            style={compact && fontUnits ? { fontSize: fontUnits } : undefined}
          >
            {ALLEY_NAME}
          </text>
        )
      })()}

      {shown.map((r) => {
        const { x, y, w: bw, h: bh } = r.box
        const c = mid(r)
        const isHere = r.id === here
        return (
          <g
            key={r.id}
            className={[
              'sc-mp__room',
              r.known ? '' : 'is-unseen',
              isHere ? 'is-here' : '',
              picked === r.id ? 'is-picked' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={onPick ? () => onPick(r.id) : undefined}
            style={onPick ? { cursor: 'pointer' } : undefined}
          >
            {/*
              차지한 팀. **미니맵은 면을 칠한다** — 88px 에서 1~2px 테두리
              색은 안 읽힌다. 전체 맵은 방 안에 글자가 많아 테두리로 둔다.
            */}
            <rect
              x={x}
              y={y}
              width={bw}
              height={bh}
              rx={2}
              className={compact && r.owner ? 'is-owned' : undefined}
              style={
                r.owner
                  ? compact
                    ? { fill: TEAM_COLOR[r.owner] }
                    : { stroke: TEAM_COLOR[r.owner] }
                  : undefined
              }
            />

            {/* **가리는 것은 안에 누가 있는지뿐이다.**
                이름도 자리도 정원도 차지한 팀도 판에 드러난 것이라
                처음부터 보인다. 전에는 안 가 본 방을 통째로 검게 칠해
                「?」만 찍었는데, 그러면 배치도의 절반이 검은 네모라
                어디가 어딘지 못 읽는다. 머릿수만 물음표로 남긴다 */}
            {compact ? (
              (() => {
                const l = labels?.get(r.id)
                if (!l || !fontUnits) return <Dots cx={c.x} cy={c.y} dots={r.dots} />
                /*
                 * 점은 **이름 반대편**으로 비킨다. 가장 낮은 방이 88px 에서
                 * 11px 인데, 이름이 8px 이라 한가운데 점이 이름 위에 얹힌다.
                 */
                const cy = l.top
                  ? Math.min(y + bh - 5, Math.max(c.y, l.box.b + 5))
                  : Math.max(y + 5, Math.min(c.y, l.box.t - 5))
                return (
                  <>
                    <Dots cx={c.x} cy={cy} dots={r.dots} />
                    <text
                      x={l.x}
                      y={l.y}
                      fontSize={fontUnits}
                      strokeWidth={fontUnits * 0.3}
                      className="sc-mp__mini"
                    >
                      {l.text}
                    </text>
                  </>
                )
              })()
            ) : (
              <>
                <text x={c.x} y={c.y - 4} className="sc-mp__name">
                  {r.name}
                </text>
                {KIND_MARK[r.kind] && (
                  <text x={c.x} y={c.y + 8} className="sc-mp__kind">
                    {KIND_MARK[r.kind]}
                  </text>
                )}
                <text
                  x={c.x}
                  y={y + bh - 5}
                  className={`sc-mp__count${r.count !== null && !r.open && r.count >= r.capacity ? ' is-full' : ''}`}
                >
                  {r.count === null
                    ? r.open
                      ? '? 명'
                      : `? / ${r.capacity}`
                    : r.open
                      ? `${r.count} 명`
                      : `${r.count} / ${r.capacity}`}
                </text>
              </>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/**
 * 방 안의 점들. **겹치지 않게 나란히** 둔다.
 *
 * 겹쳐 놓으면 둘인지 넷인지 알 수 없고, 미니맵은 숫자가 없으니
 * 점 개수가 곧 정보다.
 */
function Dots({ cx, cy, dots }: { cx: number; cy: number; dots: RoomFacts['dots'] }) {
  const shown = dots.slice(0, DOTS_MAX)
  const extra = dots.length - shown.length
  const gap = 9
  const startX = cx - ((shown.length - 1) * gap) / 2
  return (
    <>
      {shown.map((d, i) => (
        <circle
          key={d.key}
          cx={startX + i * gap}
          cy={cy}
          r={d.robot ? 2.4 : 4}
          className={d.me ? 'sc-mp__me' : 'sc-mp__dot'}
          style={d.me ? undefined : { fill: TEAM_COLOR[d.team] }}
        />
      ))}
      {extra > 0 && (
        <text x={cx + 14} y={cy + 12} className="sc-mp__more">
          +{extra}
        </text>
      )}
    </>
  )
}

/** 내 방과 거기서 한 칸. 미니맵이 보여 주는 범위다. */
export function nearbyOf(here: string | null): Set<TileId> {
  if (!here) return new Set<TileId>()
  return new Set<TileId>([here as TileId, ...((ADJACENCY[here] ?? []) as TileId[])])
}

export const roomName = (id: TileId) => TILE_BY_ID[id]?.name ?? id
