// 감독관 — 지금 점수. **가진 방 개수**(rules/score)를 방 주인(tiles)으로 바로 센다.
// 방 주인 문서를 실시간으로 받고 있으므로, 페이즈가 닫혀 주인이 바뀌는 순간 바뀐다.
// 「마지막 여섯 시간」에 참가자 점수판이 꺼져도 여기는 늘 보인다.
import { TEAMS } from '../../../shared/rules/lobby'
import { TILE_BY_ID, TILE_IDS, type TileId } from '../../../shared/rules/board'
import { publicScore, rankTeams } from '../../../shared/rules/score'
import { teamName } from '../../../shared/rules/bundan'
import { canHoldFlags } from '../../../shared/rules/flag'
import type { TileState } from '../../../shared/rules/resources'
import type { TileDoc } from '../../../shared/model'
import type { TeamId } from '../types'
import { TEAM_COLOR } from '../game/MapPlan'

export function ScoreDesk({ tiles, phaseOpen }: { tiles: Partial<Record<TileId, TileDoc>>; phaseOpen: boolean }) {
  const rows: TileState[] = TILE_IDS.map((id) => ({ tileId: id, ownerTeam: tiles[id]?.ownerTeam ?? null }) as TileState)
  const ranked = rankTeams(TEAMS.map((team) => publicScore({ tiles: rows, team })))
  const roomsOf = (team: TeamId) =>
    rows.filter((t) => t.ownerTeam === team).map((t) => TILE_BY_ID[t.tileId].name)
  // 2-3 교실처럼 가질 수 없는 방은 안 센다
  const nobody = rows.filter((t) => !t.ownerTeam && canHoldFlags(t.tileId)).length
  return (
    <section className="sc-ad__sec">
      <h2>지금 점수</h2>
      <p className="sc-ad__hint">
        가진 방 개수다. {phaseOpen ? '페이즈 중에는 지난 마감 기준이다 — 꽂힌 깃발은 닫을 때 센다.' : '페이즈가 닫히면 바로 바뀐다.'}
      </p>
      <ol className="sc-sd">
        {ranked.map((r) => (
          <li key={r.team} className="sc-sd__row">
            <span className="sc-sd__rank">{r.rank} 위</span>
            <span className="sc-sd__team">
              <i style={{ background: TEAM_COLOR[r.team as TeamId] }} />
              {teamName(r.team)}
            </span>
            <b className="sc-sd__n">{r.total} 곳</b>
            <span className="sc-sd__rooms">{roomsOf(r.team as TeamId).join(' · ') || '없음'}</span>
          </li>
        ))}
      </ol>
      <p className="sc-ad__hint">주인 없는 방 {nobody} 곳</p>
    </section>
  )
}
