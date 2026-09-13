// 전개도 — 미니맵과 전체 맵이 **같은 그림**을 다른 크기로 그린 것이다.
//
// 두 벌로 만들면 반드시 어긋난다. 미니맵에서는 주인이 바뀌었는데 전체
// 맵에서는 안 바뀐 채로 며칠 굴러가는 식이다. 그래서 그리는 함수는
// 하나고, 「어느 방까지」와 「얼마나 크게」만 다르다.
//
// 좌표는 이미 판 데이터에 있다(board.ts 의 row·col). 3D도 원근도 없이
// 격자 그대로 편다 — 이 학교는 실제로 5×5 격자다.
//
// **안 아는 방은 서버가 숫자를 안 보낸다.** 여기서 감추는 것이 아니라
// 애초에 없다. 받아다 가리면 개발자도구로 다 보인다.
import { ADJACENCY, TILES, TILE_BY_ID } from '../../../shared/rules/board'
import { ROOM_KIND, capacityOf } from '../../../shared/rules/occupy'
import type { PlayerViewDoc, TileDoc } from '../../../shared/model'
import type { TeamId, TileId } from '../types'

/** 방 네모 한 변과 방 사이 간격. 전개도의 모든 크기가 여기서 나온다. */
export const ROOM_BOX = 40
export const ROOM_GAP = 22
const STEP = ROOM_BOX + ROOM_GAP

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
  row: number
  col: number
  owner: TeamId | null
  /** 가 봤거나 지금 보이는 방. 어느 쪽도 아니면 지도에 검게 남는다. */
  known: boolean
  /** 서버가 준 머릿수. 위장이 이미 반영돼 있다. 모르는 방은 null. */
  count: number | null
  capacity: number
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
      name: t.name,
      row: t.row,
      col: t.col,
      owner: (f.tiles[id]?.ownerTeam ?? null) as TeamId | null,
      known,
      count: known ? (counts[id] ?? 0) : null,
      capacity: capacityOf(id),
      kind: ROOM_KIND[id],
      dots,
    }
  })
}

/** 서로 이웃한 방 쌍. 선을 두 번 긋지 않도록 한 번씩만 낸다. */
export function corridors(): [TileId, TileId][] {
  const out: [TileId, TileId][] = []
  for (const t of TILES) {
    for (const n of ADJACENCY[t.id] ?? []) {
      if (t.id < n) out.push([t.id as TileId, n as TileId])
    }
  }
  return out
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

  const xs = shown.map((r) => r.col)
  const ys = shown.map((r) => r.row)
  const pad = ROOM_GAP
  const x0 = Math.min(...xs) * STEP - pad
  const y0 = Math.min(...ys) * STEP - pad
  const w = (Math.max(...xs) - Math.min(...xs)) * STEP + ROOM_BOX + pad * 2
  const h = (Math.max(...ys) - Math.min(...ys)) * STEP + ROOM_BOX + pad * 2
  const inScope = new Set(shown.map((r) => r.id))
  const byId = new Map(rooms.map((r) => [r.id, r]))

  const at = (r: RoomFacts) => ({ x: r.col * STEP, y: r.row * STEP })

  return (
    <svg
      className={compact ? 'sc-mp sc-mp--small' : 'sc-mp'}
      viewBox={`${x0} ${y0} ${w} ${h}`}
      role="img"
      aria-label="학교 전개도"
    >
      {/* 통로. 방보다 먼저 그려야 네모 밑으로 들어간다 */}
      {corridors()
        .filter(([a, b]) => inScope.has(a) && inScope.has(b))
        .map(([a, b]) => {
          const ra = byId.get(a) as RoomFacts
          const rb = byId.get(b) as RoomFacts
          const pa = at(ra)
          const pb = at(rb)
          return (
            <line
              key={`${a}-${b}`}
              x1={pa.x + ROOM_BOX / 2}
              y1={pa.y + ROOM_BOX / 2}
              x2={pb.x + ROOM_BOX / 2}
              y2={pb.y + ROOM_BOX / 2}
              className="sc-mp__hall"
            />
          )
        })}

      {shown.map((r) => {
        const { x, y } = at(r)
        const isHere = r.id === here
        return (
          <g
            key={r.id}
            className={[
              'sc-mp__room',
              r.known ? '' : 'is-dark',
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
              width={ROOM_BOX}
              height={ROOM_BOX}
              rx={3}
              style={r.owner ? { stroke: TEAM_COLOR[r.owner] } : undefined}
            />

            {!r.known ? (
              // 가 본 적 없는 방. 이름도 숫자도 없다 — 서버가 안 보냈다
              !compact && (
                <text x={x + ROOM_BOX / 2} y={y + ROOM_BOX / 2 + 4} className="sc-mp__unknown">
                  ?
                </text>
              )
            ) : compact ? (
              <Dots x={x} y={y} dots={r.dots} />
            ) : (
              <>
                <text x={x + ROOM_BOX / 2} y={y + 13} className="sc-mp__name">
                  {r.name}
                </text>
                {KIND_MARK[r.kind] && (
                  <text x={x + ROOM_BOX / 2} y={y + 25} className="sc-mp__kind">
                    {KIND_MARK[r.kind]}
                  </text>
                )}
                <text
                  x={x + ROOM_BOX / 2}
                  y={y + ROOM_BOX - 6}
                  className={`sc-mp__count${(r.count ?? 0) >= r.capacity ? ' is-full' : ''}`}
                >
                  {r.count} / {r.capacity}
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
function Dots({ x, y, dots }: { x: number; y: number; dots: RoomFacts['dots'] }) {
  const shown = dots.slice(0, DOTS_MAX)
  const extra = dots.length - shown.length
  const gap = 9
  const startX = x + ROOM_BOX / 2 - ((shown.length - 1) * gap) / 2
  return (
    <>
      {shown.map((d, i) => (
        <circle
          key={d.key}
          cx={startX + i * gap}
          cy={y + ROOM_BOX / 2}
          r={d.robot ? 2.4 : 4}
          className={d.me ? 'sc-mp__me' : 'sc-mp__dot'}
          style={d.me ? undefined : { fill: TEAM_COLOR[d.team] }}
        />
      ))}
      {extra > 0 && (
        <text x={x + ROOM_BOX - 5} y={y + ROOM_BOX - 5} className="sc-mp__more">
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
