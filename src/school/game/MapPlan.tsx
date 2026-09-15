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
import { ADJACENCY, FLOOR_NAME, FLOORS, HALLS, STAIRWELLS, TILES, TILE_BY_ID } from '../../../shared/rules/board'
import { OPEN_TILES, ROOM_KIND, capacityOf } from '../../../shared/rules/occupy'
import type { PlayerViewDoc, TileDoc } from '../../../shared/model'
import type { TeamId, TileId } from '../types'

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

/** 방 종류 표시. 좁은 방·연구실·발전소만 따로 그린다. */
const KIND_MARK: Record<string, string> = { narrow: '▮', lab: '⚗', plant: '⚡', normal: '' }

export const TEAM_COLOR: Record<TeamId, string> = {
  A: '#e0453f',
  B: '#3f7ae0',
  C: '#2fa866',
  D: '#e0a02a',
}

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
  /** 전개도에서의 네모. 걸어 다니는 지도와 같은 자리, 같은 크기다. */
  box: { x: number; y: number; w: number; h: number }
  owner: TeamId | null
  /** 가 봤거나 지금 보이는 방. 어느 쪽도 아니면 지도에 검게 남는다. */
  known: boolean
  /** 서버가 준 머릿수. 위장이 이미 반영돼 있다. 모르는 방은 null. */
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
    const dots: RoomFacts['dots'] = []
    if (known) {
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
      box: {
        x: t.plan.x * PLAN_SCALE,
        y: t.plan.y * PLAN_SCALE,
        w: t.plan.w * PLAN_SCALE,
        h: t.plan.h * PLAN_SCALE,
      },
      owner: (f.tiles[id]?.ownerTeam ?? null) as TeamId | null,
      known,
      count: known ? (counts[id] ?? 0) : null,
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
export function halls(): { x: number; y: number; w: number; h: number; stair: boolean }[] {
  const stairAt = new Set(STAIRWELLS.map((w) => `${w.plan.x},${w.plan.y}`))
  return HALLS.map((h) => ({
    x: h.rect.x * PLAN_SCALE,
    y: h.rect.y * PLAN_SCALE,
    w: h.rect.w * PLAN_SCALE,
    h: h.rect.h * PLAN_SCALE,
    stair: stairAt.has(`${h.rect.x},${h.rect.y}`),
  }))
}

/** 층마다의 바닥판. 쌓아 놓은 것이 한 건물로 읽히게 깔아 준다. */
export function slabs(): { floor: string; name: string; x: number; y: number; w: number; h: number }[] {
  return FLOORS.map((floor) => {
    const boxes = [
      ...TILES.filter((t) => t.floor === floor).map((t) => t.plan),
      ...HALLS.filter((h) => h.floor === floor).map((h) => h.rect),
    ]
    const x = Math.min(...boxes.map((b) => b.x)) - 1
    const y = Math.min(...boxes.map((b) => b.y)) - 1
    const w = Math.max(...boxes.map((b) => b.x + b.w)) + 1 - x
    const h = Math.max(...boxes.map((b) => b.y + b.h)) + 1 - y
    return {
      floor,
      name: FLOOR_NAME[floor],
      x: x * PLAN_SCALE,
      y: y * PLAN_SCALE,
      w: w * PLAN_SCALE,
      h: h * PLAN_SCALE,
    }
  })
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
  const shown = only ? rooms.filter((r) => only.has(r.id)) : rooms
  if (shown.length === 0) return null

  const x0 = Math.min(...shown.map((r) => r.box.x)) - PLAN_PAD
  const y0 = Math.min(...shown.map((r) => r.box.y)) - PLAN_PAD
  const w = Math.max(...shown.map((r) => r.box.x + r.box.w)) + PLAN_PAD - x0
  const h = Math.max(...shown.map((r) => r.box.y + r.box.h)) + PLAN_PAD - y0
  /** 방 한가운데. 이름과 점이 여기를 기준으로 놓인다. */
  const mid = (r: RoomFacts) => ({ x: r.box.x + r.box.w / 2, y: r.box.y + r.box.h / 2 })

  /** 지금 그리는 테두리 안에 걸치는가. 미니맵은 둘레만 잘라 보여 준다. */
  const inView = (b: { x: number; y: number; w: number; h: number }) =>
    b.x < x0 + w && b.x + b.w > x0 && b.y < y0 + h && b.y + b.h > y0

  return (
    <svg
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
            className={g.stair ? 'sc-mp__hall is-stair' : 'sc-mp__hall'}
          />
        ))}

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
            <rect
              x={x}
              y={y}
              width={bw}
              height={bh}
              rx={2}
              style={r.owner ? { stroke: TEAM_COLOR[r.owner] } : undefined}
            />

            {/* **가리는 것은 안에 누가 있는지뿐이다.**
                이름도 자리도 정원도 차지한 팀도 판에 드러난 것이라
                처음부터 보인다. 전에는 안 가 본 방을 통째로 검게 칠해
                「?」만 찍었는데, 그러면 배치도의 절반이 검은 네모라
                어디가 어딘지 못 읽는다. 머릿수만 물음표로 남긴다 */}
            {compact ? (
              <Dots cx={c.x} cy={c.y} dots={r.dots} />
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
                  className={`sc-mp__count${r.known && !r.open && (r.count ?? 0) >= r.capacity ? ' is-full' : ''}`}
                >
                  {!r.known
                    ? r.open
                      ? '?명'
                      : `? / ${r.capacity}`
                    : r.open
                      ? `${r.count}명`
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
