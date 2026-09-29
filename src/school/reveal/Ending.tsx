// 엔딩 탭 — 전원 송출과 같은 쪽지를 다시 본다.
//
// 송출 자체는 화면 어디에 있든 덮는 오버레이(FinalNoteOverlay)가 한다.
// 이 탭은 그 순간을 놓쳤거나 한 번 더 보고 싶은 사람을 위한 자리다 —
// 재생 끝에 닫기를 누를 필요 없이, 다시 누르면 다시 돈다.
import { useState } from 'react'
import { FinalNoteScene } from './FinalNoteScene'
import type { GameActions } from '../game/useGame'

export function Ending({ act }: { act: GameActions }) {
  // 매번 새 key로 다시 그려 처음부터 돈다. React 는 key 가 바뀐
  // 자식을 새로 만들지, 같은 컴포넌트를 다시 마운트하지 않는다
  const [round, setRound] = useState(0)
  return (
    <div className="sc-en" role="region" aria-label="엔딩">
      <FinalNoteScene key={round} act={act} />
      <button className="sc-en__replay" onClick={() => setRound((n) => n + 1)}>
        다시 보기
      </button>
    </div>
  )
}
