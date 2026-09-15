// 거래창. **마주 선 사람과 그 자리에서 흥정한다.**
//
// 전에는 돈과 지식 칸 넷이 전부였다. 서버는 토큰도 짝도 받을 수
// 있는데 화면에 그 칸이 없어서, 있는 줄도 모르고 아무도 안 썼다.
// 주고받을 수 있는 것 넷을 다 펴 놓고, 내가 가진 만큼만 집게 한다.
//
// **받는 쪽은 상한이 없다.** 남이 무엇을 얼마나 쥐었는지는 안 보이는
// 것이 이 게임이라, 부르는 것은 자유고 되는지는 서버가 답한다.
import { useState } from 'react'

import { TRADE_COST } from '../../../shared/rules/occupy'
import type { TeamId } from '../../../shared/rules/v2'
import type { PlayerViewDoc } from '../../../shared/model'

/** 주고받을 수 있는 것 넷. 서버가 아는 것과 하나씩 맞는다. */
export const GOODS = [
  { key: 'money', name: '돈', hint: '팀 금고' },
  { key: 'knowledge', name: '지식', hint: '팀 금고' },
  { key: 'tokens', name: '팀 토큰', hint: '페이즈 상자' },
  { key: 'robots', name: '짝', hint: '내가 데리고 있는' },
] as const

export type GoodKey = (typeof GOODS)[number]['key']
type Pile = Record<GoodKey, number>

const EMPTY: Pile = { money: 0, knowledge: 0, tokens: 0, robots: 0 }
const total = (p: Pile) => GOODS.reduce((n, g) => n + p[g.key], 0)

/** 내가 실제로 내놓을 수 있는 양. 이만큼만 집힌다. */
export function haveOf(view: PlayerViewDoc | null): Pile {
  return {
    money: view?.myVault?.money ?? 0,
    knowledge: view?.myVault?.knowledge ?? 0,
    tokens: view?.myTeamTokens ?? 0,
    robots: view?.myCarriedRobots ?? 0,
  }
}

/** 더미 하나를 사람이 읽는 말로. 빈 더미는 「없음」이다. */
export function pileText(p: Partial<Pile>): string {
  const parts = GOODS.filter((g) => (p[g.key] ?? 0) > 0).map((g) => `${g.name} ${p[g.key]}`)
  return parts.length > 0 ? parts.join(' · ') : '없음'
}

export interface TradeProps {
  view: PlayerViewDoc | null
  /** 지금 나와 마주 선 사람들. **여기 있는 사람에게만 건다.** */
  herePeople: readonly { playerId: string; name: string; team: TeamId }[]
  /** 페이즈 중에는 흥정하지 않는다. */
  phaseOpen: boolean
  busy: boolean
  onOffer: (toPlayerId: string, give: Pile, want: Pile) => void
}

export function Trade({ view, herePeople, phaseOpen, busy, onOffer }: TradeProps) {
  const [to, setTo] = useState<string>('')
  const [give, setGive] = useState<Pile>(EMPTY)
  const [want, setWant] = useState<Pile>(EMPTY)

  const have = haveOf(view)
  const left = view?.myDealTokens ?? 0
  const partner = herePeople.find((p) => p.playerId === to) ?? null
  const ready = partner !== null && total(give) + total(want) > 0 && left >= TRADE_COST

  if (phaseOpen) {
    return <p className="sc-dl__none">페이즈 중에는 흥정하지 않는다. 종이 치면 다시 말을 꺼낼 수 있다.</p>
  }
  if (herePeople.length === 0) {
    return <p className="sc-dl__none">지금 같은 자리에 아무도 없다. 마주 서야 말을 꺼낼 수 있다.</p>
  }

  const step = (side: 'give' | 'want', key: GoodKey, by: number) => {
    const cur = side === 'give' ? give : want
    const max = side === 'give' ? have[key] : 99
    const next = { ...cur, [key]: Math.min(max, Math.max(0, cur[key] + by)) }
    if (side === 'give') setGive(next)
    else setWant(next)
  }

  return (
    <div className="sc-tr">
      {/* 누구와. **마주 선 사람 중에서만** — 목록에서 고르는 원격 제안은 없다 */}
      <div className="sc-tr__who">
        {herePeople.map((p) => (
          <button
            key={p.playerId}
            type="button"
            className={p.playerId === to ? 'is-inline is-on' : 'is-inline'}
            onClick={() => setTo(p.playerId)}
          >
            {p.name}
            <span>{p.team}팀</span>
          </button>
        ))}
      </div>

      <div className="sc-tr__deal">
        {(['give', 'want'] as const).map((side) => (
          <section key={side} className={`sc-tr__side is-${side}`}>
            <h3>{side === 'give' ? '내가 준다' : '내가 받는다'}</h3>
            {GOODS.map((g) => {
              const n = (side === 'give' ? give : want)[g.key]
              const cap = side === 'give' ? have[g.key] : null
              return (
                <div key={g.key} className={`sc-tr__row${n > 0 ? ' is-set' : ''}`}>
                  <span className="sc-tr__name">
                    {g.name}
                    {cap !== null && <em>{cap}</em>}
                  </span>
                  <span className="sc-tr__step">
                    <button
                      type="button"
                      className="is-inline"
                      disabled={n <= 0}
                      onClick={() => step(side, g.key, -1)}
                      aria-label={`${g.name} 줄이기`}
                    >
                      −
                    </button>
                    <b>{n}</b>
                    <button
                      type="button"
                      className="is-inline"
                      disabled={cap !== null && n >= cap}
                      onClick={() => step(side, g.key, 1)}
                      aria-label={`${g.name} 늘리기`}
                    >
                      ＋
                    </button>
                  </span>
                </div>
              )
            })}
          </section>
        ))}
      </div>

      <p className="sc-tr__sum">
        {partner ? (
          <>
            <b>{partner.name}</b>에게 {pileText(give)} 을(를) 주고 {pileText(want)} 을(를) 받는다
          </>
        ) : (
          '누구에게 걸지 먼저 고른다'
        )}
      </p>

      <button className="sc-tr__go" disabled={busy || !ready} onClick={() => partner && onOffer(partner.playerId, give, want)}>
        말을 꺼낸다
        <span>
          거는 값 개인 토큰 {TRADE_COST} · 오늘 {left}개 남았다
        </span>
      </button>
      <p className="sc-dl__none">
        받는 쪽이 무엇을 쥐었는지는 안 보인다. 부르는 것은 자유고, 없으면 서버가 거절한다. 수락하면 그 자리에서
        끝나고, 거절하거나 둘 중 하나가 자리를 뜨면 그냥 사라진다.
      </p>
    </div>
  )
}
