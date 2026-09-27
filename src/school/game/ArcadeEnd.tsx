// 오락기 끝 화면 조각. 게임마다 같은 두 단추와 같은 큰 글자를 쓴다.
import type { ArcadeOutcome } from '../../../shared/rules/arcade'

export const BIG: Record<ArcadeOutcome, string> = { win: 'YOU WIN', lose: 'YOU LOSE', draw: 'DRAW' }

export function EndRow({ busy, onAgain, onMenu }: { busy?: boolean; onAgain: () => void; onMenu: () => void }) {
  return (
    <div className="sc-ar__row">
      <button disabled={busy} onClick={onMenu}>게임 고르기</button>
      <button className="is-go" disabled={busy} onClick={onAgain}>한 판 더</button>
    </div>
  )
}
