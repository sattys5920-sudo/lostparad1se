// 손패와 동맹.
//
// 거래는 여기 없다. 마주 선 사람을 맵에서 짚어 시작하고, 흥정은 따로
// 뜨는 거래창에서 한다 — 손패와 동맹이 같은 창에 있으면 흥정하다 말고
// 카드를 내게 된다.
import { useState } from 'react'

import { CARD_BY_KIND } from '../../../shared/rules/v2'
import { TEAMS } from '../../../shared/rules/lobby'
import type { TeamId } from '../../../shared/rules/v2'
import type { GameActions } from './useGame'
import type { PlayerViewDoc, TeamDoc } from '../../../shared/model'

export interface HandProps {
  me: { playerId: string; team: TeamId }
  /** 지금 나와 같은 자리에 서 있는 팀들. 동맹은 팀끼리라 이걸 쓴다. */
  facingTeams: readonly TeamId[]
  view: PlayerViewDoc | null
  teams: Partial<Record<TeamId, TeamDoc>>
  act: GameActions
  onSaid: (text: string) => void
  /** 되돌릴 수 없는 것은 한 번 묻는다. */
  ask: (text: string) => Promise<boolean>
}

export function Hand({ me, view, teams, facingTeams, act, onSaid, ask }: HandProps) {
  const facing = new Set(facingTeams)
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
  const proposals = view?.proposals ?? []
  const ally = teams[me.team]?.allyTeam ?? null

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

      <h2>동맹 {ally && <span>{ally}팀과</span>}</h2>
      {ally ? (
        <button className="is-danger" disabled={busy} onClick={() => {
            void ask('동맹을 파기한다. 되돌릴 수 없다.').then((ok) => {
              if (ok) void run('파기', () => act.breakAlliance())
            })
          }}>
          먼저 깬다 (열두 시간 동안 새 동맹을 못 맺는다)
        </button>
      ) : (
        <div className="sc-ac__row">
          {TEAMS.filter((t) => t !== me.team).map((t) => (
            <button key={t} disabled={busy || !facing.has(t)} onClick={() => run('제안', () => act.proposeAlliance(t))}>
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
