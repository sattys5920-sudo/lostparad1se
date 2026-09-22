// 「이적하시겠습니까」 — 불린 쪽 화면에만 뜨는 물음 하나.
//
// 거래를 청하는 띠와 같은 자리, 같은 모양이다. 다른 것은 **되돌릴 수
// 없다는 말**을 적어 둔 것뿐이다. 거래는 물건이 오가고 끝나지만 이것은
// 닷새의 편이 갈리는 일이라, 열다섯 초 안에 누르는 손이 그걸 알아야 한다.
import { TRANSFER_ASK_MS } from '../../../shared/rules/transfer'
import type { TeamId } from '../../../shared/rules/v2'

export interface TransferAskProps {
  /** 부른 사람. */
  fromName: string
  /** 가게 될 팀. 부른 사람의 팀이다. */
  toTeam: TeamId
  /** 지금 내 팀. 떠날 팀이다. */
  askedAtMs: number
  nowMs: number
  onAnswer: (accept: boolean) => void
}

export function TransferAsk({ fromName, toTeam, askedAtMs, nowMs, onAnswer }: TransferAskProps) {
  const left = Math.max(0, askedAtMs + TRANSFER_ASK_MS - nowMs)
  const secs = Math.ceil(left / 1000)
  return (
    <div className="sc-da sc-da--move">
      <p className="sc-da__who">
        <b>{fromName}</b>
        <span>{toTeam}팀</span>
      </p>
      <p className="sc-da__say">
        <b>{toTeam}팀으로 오라고 한다.</b> 이적하시겠습니까?
      </p>
      <p className="sc-da__fine">다음 점령전이 열릴 때 넘어간다.</p>
      {/* 남은 시간을 줄로 보인다. 숫자만으로는 급한 줄 모른다 */}
      <div className="sc-da__bar" aria-hidden="true">
        <i style={{ width: `${(left / TRANSFER_ASK_MS) * 100}%` }} />
      </div>
      <div className="sc-da__row">
        <button onClick={() => onAnswer(false)}>남는다</button>
        <button className="is-on" onClick={() => onAnswer(true)}>
          간다 <em>{secs}</em>
        </button>
      </div>
    </div>
  )
}
