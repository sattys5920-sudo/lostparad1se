// 손패 · 교역 · 동맹.
//
// 손패는 우리 팀만 보고, 제안은 관련된 두 팀만 본다. 둘 다 서버가
// 그렇게 깎아 보낸 것이라 화면에서 거를 것이 없다.
import { useState } from 'react'

import { CARD_BY_KIND } from '../../../shared/rules/v2'
import { TEAMS } from '../../../shared/rules/lobby'
import type { TeamId } from '../../../shared/rules/v2'
import type { GameActions } from './useGame'
import type { PlayerViewDoc, TeamDoc } from '../../../shared/model'

export interface DealsProps {
  me: { playerId: string; team: TeamId }
  view: PlayerViewDoc | null
  teams: Partial<Record<TeamId, TeamDoc>>
  act: GameActions
  onSaid: (text: string) => void
}

const RES_LABEL: Record<string, string> = { money: '돈', knowledge: '지식', influence: '영향력' }

export function Deals({ me, view, teams, act, onSaid }: DealsProps) {
  const [busy, setBusy] = useState(false)
  const [to, setTo] = useState<TeamId>(TEAMS.find((t) => t !== me.team) as TeamId)
  const [give, setGive] = useState({ money: 0, knowledge: 0, influence: 0 })
  const [want, setWant] = useState({ money: 0, knowledge: 0, influence: 0 })

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
  const trades = view?.trades ?? []
  const proposals = view?.proposals ?? []
  const ally = teams[me.team]?.allyTeam ?? null

  return (
    <div className="sc-dl">
      <h2>손패 <span>{hand.length}장</span></h2>
      {hand.length === 0 && <p className="sc-dl__none">연구를 하면 한 장 들어온다.</p>}
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

      <h2>교역</h2>
      <div className="sc-dl__trade">
        <label>
          <span>누구에게</span>
          <select value={to} onChange={(e) => setTo(e.target.value as TeamId)}>
            {TEAMS.filter((t) => t !== me.team).map((t) => (
              <option key={t} value={t}>
                {t}팀
              </option>
            ))}
          </select>
        </label>
        {(['money', 'knowledge', 'influence'] as const).map((r) => (
          <div key={r} className="sc-dl__pair">
            <span>{RES_LABEL[r]}</span>
            <label>
              준다
              <input
                type="number"
                min={0}
                value={give[r]}
                onChange={(e) => setGive({ ...give, [r]: Math.max(0, Number(e.target.value) || 0) })}
              />
            </label>
            <label>
              받는다
              <input
                type="number"
                min={0}
                value={want[r]}
                onChange={(e) => setWant({ ...want, [r]: Math.max(0, Number(e.target.value) || 0) })}
              />
            </label>
          </div>
        ))}
        <button disabled={busy} onClick={() => run('제안', () => act.offerTrade(to, give, want))}>
          제안 보내기
        </button>
      </div>

      {trades.length > 0 && (
        <ul className="sc-dl__offers">
          {trades.map((t) => (
            <li key={t.id}>
              <span>
                {t.fromTeam} → {t.toTeam}
              </span>
              <span className="sc-dl__bag">
                주는 것{' '}
                {Object.entries(t.give)
                  .map(([r, n]) => `${RES_LABEL[r]} ${n}`)
                  .join(' · ') || '없음'}
              </span>
              <span className="sc-dl__bag">
                받는 것{' '}
                {Object.entries(t.want)
                  .map(([r, n]) => `${RES_LABEL[r]} ${n}`)
                  .join(' · ') || '없음'}
              </span>
              {t.note && <span className="sc-dl__note">{t.note}</span>}
              {t.toTeam === me.team && (
                <div className="sc-ac__row">
                  <button disabled={busy} onClick={() => run('거절', () => act.respondTrade(t.id, false))}>
                    거절
                  </button>
                  <button disabled={busy} onClick={() => run('수락', () => act.respondTrade(t.id, true))}>
                    받는다
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <h2>동맹 {ally && <span>{ally}팀과</span>}</h2>
      {ally ? (
        <button className="is-danger" disabled={busy} onClick={() => run('파기', () => act.breakAlliance())}>
          먼저 깬다 (영향력 2를 잃는다)
        </button>
      ) : (
        <div className="sc-ac__row">
          {TEAMS.filter((t) => t !== me.team).map((t) => (
            <button key={t} disabled={busy} onClick={() => run('제안', () => act.proposeAlliance(t))}>
              {t}팀에
            </button>
          ))}
        </div>
      )}
      {proposals.map((p) => (
        <div key={p.id} className="sc-dl__prop">
          <span>
            {p.fromTeam} → {p.toTeam}
          </span>
          {p.toTeam === me.team && (
            <div className="sc-ac__row">
              <button disabled={busy} onClick={() => run('거절', () => act.respondAlliance(p.id, false))}>
                거절
              </button>
              <button disabled={busy} onClick={() => run('수락', () => act.respondAlliance(p.id, true))}>
                손잡는다
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
