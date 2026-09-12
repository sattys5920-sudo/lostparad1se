// 5×5 판.
//
// 안개 밖 칸은 **어둡게 덮는다.** 서버가 visibleTiles에 담아 준 것만
// 밝다. 거기 없는 칸의 주인도 건물도 화면은 모른다 — 가리는 것이 아니라
// 받지 않은 것이다.
//
// 말도 같다. visiblePawns에 있는 것만 그린다.
import { useMemo } from 'react'

import { TILES, type TileId } from '../../../shared/rules/board'
import { BUILDING_BY_KIND, type TeamId } from '../../../shared/rules/v2'
import type { PlayerViewDoc, TileDoc } from '../../../shared/model'
import './board.css'

export interface BoardProps {
  view: PlayerViewDoc | null
  tiles: Partial<Record<TileId, TileDoc>>
  /** A의 기록이 열어 준 칸. 모두가 안다. */
  openedTiles: readonly string[]
  /** 기록이 지목해 가치가 오른 칸. */
  boostedTiles: readonly string[]
  /** 지금 골라 둔 칸. */
  picked: TileId | null
  onPick: (tileId: TileId) => void
}

const TEAM_CLASS: Record<TeamId, string> = { A: 'is-a', B: 'is-b', C: 'is-c', D: 'is-d' }

export function Board(props: BoardProps) {
  const visible = useMemo(() => new Set(props.view?.visibleTiles ?? []), [props.view])
  const pawnsAt = useMemo(() => {
    const out = new Map<string, { team: TeamId; asleep: boolean }[]>()
    for (const p of props.view?.visiblePawns ?? []) {
      // 걷는 말은 어느 칸에도 세우지 않는다
      if (!p.tileId) continue
      const list = out.get(p.tileId) ?? []
      list.push({ team: p.team, asleep: p.asleep })
      out.set(p.tileId, list)
    }
    return out
  }, [props.view])

  return (
    <div className="sc-bd">
      {TILES.map((t) => {
        const seen = visible.has(t.id)
        const tile = seen ? props.tiles[t.id] : undefined
        const here = pawnsAt.get(t.id) ?? []
        const boosted = props.boostedTiles.includes(t.id)
        const closed = (t.tier === 'core' || t.tier === 'plaza') && !props.openedTiles.includes(t.id)
        return (
          <button
            key={t.id}
            className={[
              'sc-bd__tile',
              seen ? '' : 'is-fog',
              tile?.ownerTeam ? TEAM_CLASS[tile.ownerTeam] : '',
              props.picked === t.id ? 'is-picked' : '',
              t.tier === 'base' ? 'is-base' : '',
              closed ? 'is-closed' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => props.onPick(t.id)}
            style={{ gridRow: t.row + 1, gridColumn: t.col + 1 }}
          >
            <span className="sc-bd__name">{t.name}</span>
            {seen && (
              <>
                <span className="sc-bd__value">
                  {t.value}
                  {boosted && <b>+</b>}
                </span>
                {(tile?.buildings ?? []).length > 0 && (
                  <span className="sc-bd__built">
                    {(tile?.buildings ?? []).map((b) => BUILDING_BY_KIND[b.kind]?.name.slice(0, 1)).join('')}
                  </span>
                )}
              </>
            )}
            {here.length > 0 && (
              <span className="sc-bd__pawns">
                {here.slice(0, 4).map((p, i) => (
                  <i key={i} className={`${TEAM_CLASS[p.team]} ${p.asleep ? 'is-asleep' : ''}`} />
                ))}
                {here.length > 4 && <em>+{here.length - 4}</em>}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
