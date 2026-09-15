// 「거래하자」는 말 한 줄.
//
// 열다섯 초 안에 답하지 않으면 사라진다. 값은 들지 않는다 — 말을
// 꺼냈다가 무시당하는 데까지 돈이 들면 아무도 말을 못 꺼낸다.
import { DEAL_ASK_MS } from '../../../shared/rules/deal'
import type { TeamId } from '../../../shared/rules/v2'

export interface DealAskProps {
  /** 건 사람. 받는 쪽 화면에만 뜬다. */
  fromName: string
  fromTeam: TeamId
  askedAtMs: number
  nowMs: number
  onAnswer: (accept: boolean) => void
}

export function DealAsk({ fromName, fromTeam, askedAtMs, nowMs, onAnswer }: DealAskProps) {
  const left = Math.max(0, askedAtMs + DEAL_ASK_MS - nowMs)
  const secs = Math.ceil(left / 1000)
  return (
    <div className="sc-da">
      <p className="sc-da__who">
        <b>{fromName}</b>
        <span>{fromTeam}팀</span>
      </p>
      <p className="sc-da__say">거래하자고 한다.</p>
      {/* 남은 시간을 줄로 보인다. 숫자만으로는 급한 줄 모른다 */}
      <div className="sc-da__bar" aria-hidden="true">
        <i style={{ width: `${(left / DEAL_ASK_MS) * 100}%` }} />
      </div>
      <div className="sc-da__row">
        <button onClick={() => onAnswer(false)}>안 한다</button>
        <button className="is-on" onClick={() => onAnswer(true)}>
          앉는다 <em>{secs}</em>
        </button>
      </div>
    </div>
  )
}
