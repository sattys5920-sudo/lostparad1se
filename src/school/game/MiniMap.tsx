// 미니맵 — 스물다섯 칸으로 판을 한눈에.
//
// 걸어 다니는 학교는 한 번에 한 방밖에 안 보인다. 그래서 위에 판
// 전체를 작게 얹는다. 내가 움직이면 여기 표시도 같이 움직인다.
//
// **숫자는 서버가 준 것을 그대로 쓴다.** 위장은 이미 반영돼 있다 —
// 진짜 수를 받아다 화면에서 부풀리면 개발자도구로 다 보인다.
// 안 보이는 방은 숫자가 없다. 없는 것과 0은 다르다.
import { ROOM_KIND, capacityOf } from '../../../shared/rules/occupy'
import { GRID } from '../../../shared/rules/v2'
import { TILES } from '../../../shared/rules/board'
import type { PlayerViewDoc, TileDoc } from '../../../shared/model'
import type { TeamId, TileId } from '../types'

export interface MiniMapProps {
  /** 지금 내가 선 방. 자유 시간에는 돌아다니는 자리다. */
  here: string | null
  /** 내 전투 자리. 자유 시간에 여기서 떨어져 있으면 같이 보인다. */
  post: string | null
  view: PlayerViewDoc | null
  tiles: Partial<Record<TileId, TileDoc>>
  onPick?: (id: TileId) => void
}

/** 방 종류를 한 글자로. 정원까지 적으면 칸이 비좁다. */
const MARK: Record<string, string> = { narrow: '좁', lab: '연', plant: '발', normal: '' }

export function MiniMap({ here, post, view, tiles, onPick }: MiniMapProps) {
  const counts = view?.roomCounts ?? {}
  const seen = new Set(view?.visibleTiles ?? [])
  const robots = new Set((view?.visibleRobots ?? []).map((r) => r.tileId))

  return (
    <div className="sc-mm" style={{ ['--mm-grid' as string]: GRID }}>
      {TILES.map((t) => {
        const owner = (tiles[t.id as TileId]?.ownerTeam ?? null) as TeamId | null
        const n = counts[t.id]
        const isHere = here === t.id
        const isPost = post === t.id && post !== here
        return (
          <button
            key={t.id}
            type="button"
            className={[
              'sc-mm__cell',
              owner ? `is-${owner.toLowerCase()}` : '',
              seen.has(t.id) ? '' : 'is-fog',
              isHere ? 'is-here' : '',
              isPost ? 'is-post' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => onPick?.(t.id as TileId)}
            aria-label={`${t.name}${owner ? ` ${owner}팀` : ''}${n != null ? ` ${n}명` : ''}`}
          >
            <span className="sc-mm__name">{t.name}</span>
            <span className="sc-mm__row">
              {MARK[ROOM_KIND[t.id]] && <em className="sc-mm__kind">{MARK[ROOM_KIND[t.id]]}</em>}
              {/* 안 보이는 방은 숫자가 없다. 0으로 적으면 「비어 있다」는
                  거짓말이 된다 */}
              {n != null && (
                <b className={n >= capacityOf(t.id) ? 'is-full' : ''}>
                  {n}
                  {robots.has(t.id) && <i aria-label="로봇">▪</i>}
                </b>
              )}
            </span>
            {isHere && <i className="sc-mm__me" aria-label="여기 있다" />}
          </button>
        )
      })}
    </div>
  )
}
