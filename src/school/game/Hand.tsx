// 가방 — 주워 든 것.
//
// 카드는 없앴다. 가방이 카드 넉 장을 쥐던 자리였는데, 카드로 가는
// 입구(로봇이 태어날 때 한 장)가 바늘구멍이라 한 판에 한 장도 안
// 돌았다. 지금 손에 드는 것은 주운 문제 종이뿐이다.
//
// 거래는 여기 없다. 마주 선 사람을 맵에서 짚어 시작하고, 흥정은 따로
// 뜨는 거래창에서 한다.
import { Quiz } from './Quiz'
import type { TeamId } from '../../../shared/rules/v2'
import type { GameActions } from './useGame'
import type { PlayerViewDoc } from '../../../shared/model'

export interface HandProps {
  me: { playerId: string; team: TeamId }
  view: PlayerViewDoc | null
  act: GameActions
  onSaid: (text: string) => void
}

export function Hand({ view, act, onSaid }: HandProps) {
  const papers = view?.myQuizzes ?? []
  return (
    <div className="sc-hd">
      <h2>가방 <span>{papers.filter((q) => !q.solvedByOther).length} 장</span></h2>
      {papers.length === 0 && <p className="sc-hd__none">아직 문제 종이가 없다. 바닥을 살펴보세요.</p>}
      {/* 주워 든 문제. **주머니 속이라 여기 있다** — 자리도 안 보고
          푸는 것이라 맵과는 상관이 없다 */}
      <Quiz view={view} act={act} onSaid={onSaid} />
    </div>
  )
}
