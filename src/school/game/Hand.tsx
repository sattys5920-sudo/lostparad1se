// 손패.
//
// 거래는 여기 없다. 마주 선 사람을 맵에서 짚어 시작하고, 흥정은 따로
// 뜨는 거래창에서 한다 — 손패와 흥정이 같은 창에 있으면 흥정하다 말고
// 카드를 내게 된다.
//
// 동맹도 여기 있었다. 걷어냈다 — 「깃발 판정에서 우리 편으로 센다」고
// 적어 놓고 그 계산을 아무도 안 불러서, 맺어도 판에 아무 일이 없었다.
import { useState } from 'react'

import { CARD_BY_KIND } from '../../../shared/rules/v2'
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
  const [busy, setBusy] = useState(false)
  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true)
    try {
      await fn()
      onSaid(`${label} 했다.`)
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const hand = view?.hand ?? []

  return (
    <div className="sc-dl">
      <h2>손패 <span>{hand.length}장</span></h2>
      {hand.length === 0 && <p className="sc-dl__none">페이즈에 연구실에서 연구를 하면 한 장 들어온다.</p>}
      <ul className="sc-ac__menu">
        {hand.map((c) => (
          <li key={c.id}>
            <button disabled={busy} onClick={() => run(CARD_BY_KIND[c.kind].name, () => act.playCard(c.kind))}>
              {CARD_BY_KIND[c.kind].name}
              <span>{CARD_BY_KIND[c.kind].text}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
