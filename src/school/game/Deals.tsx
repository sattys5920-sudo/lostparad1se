// 손패 · 교역 · 동맹.
//
// 손패는 우리 팀만 보고, 제안은 관련된 두 팀만 본다. 둘 다 서버가
// 그렇게 깎아 보낸 것이라 화면에서 거를 것이 없다.
import { useState } from 'react'

import { CARD_BY_KIND } from '../../../shared/rules/v2'
import { Trade, pileText, type GoodKey } from './Trade'
import { TEAMS } from '../../../shared/rules/lobby'
import type { TeamId } from '../../../shared/rules/v2'
import type { GameActions } from './useGame'
import type { PlayerViewDoc, TeamDoc } from '../../../shared/model'

export interface DealsProps {
  me: { playerId: string; team: TeamId }
  /** 지금 나와 같은 자리에 서 있는 팀들. 동맹은 팀끼리라 이걸 쓴다. */
  facingTeams: readonly TeamId[]
  /** 지금 나와 마주 선 사람들. **거래는 이 목록에서만 고른다.** */
  herePeople: readonly { playerId: string; name: string; team: TeamId }[]
  view: PlayerViewDoc | null
  teams: Partial<Record<TeamId, TeamDoc>>
  act: GameActions
  onSaid: (text: string) => void
  /** 되돌릴 수 없는 것은 한 번 묻는다. */
  ask: (text: string) => Promise<boolean>
  /** 페이즈 중에는 흥정하지 않는다. */
  phaseOpen: boolean
}

/** 자루와 주머니를 한 더미로 합친다. 화면에서는 넷이 나란히 보여야 한다. */
const pileOf = (
  bag: Record<string, number> | null | undefined,
  purse: Record<string, number> | null | undefined,
): Partial<Record<GoodKey, number>> => ({
  money: bag?.money ?? 0,
  knowledge: bag?.knowledge ?? 0,
  tokens: purse?.tokens ?? 0,
  robots: purse?.robots ?? 0,
})

export function Deals({ me, view, teams, facingTeams, herePeople, act, onSaid, ask, phaseOpen }: DealsProps) {
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
  const trades = view?.trades ?? []
  const proposals = view?.proposals ?? []
  const ally = teams[me.team]?.allyTeam ?? null

  return (
    <div className="sc-dl">
      <h2>마주 선 사람과 <span>{herePeople.length}명</span></h2>
      <Trade
        view={view}
        herePeople={herePeople}
        phaseOpen={phaseOpen}
        busy={busy}
        onOffer={(toPlayerId, give, want) => {
          // 돈·지식은 재화 자루로, 토큰·짝은 손에서 손으로 가는 주머니로
          void run('제안', () =>
            act.offerTrade(
              toPlayerId,
              { money: give.money, knowledge: give.knowledge },
              { money: want.money, knowledge: want.knowledge },
              { tokens: give.tokens, robots: give.robots },
              { tokens: want.tokens, robots: want.robots },
            ),
          )
        }}
      />

      {trades.length > 0 && (
        <ul className="sc-dl__offers">
          {trades.map((t) => {
            const mineToRead = t.toPlayerId ? t.toPlayerId === me.playerId : t.toTeam === me.team
            // **읽는 사람 기준으로 뒤집는다.** 「주는 것」이 제안한
            // 쪽 기준이면, 받는 사람은 매번 머릿속으로 뒤집어야 한다
            const theirs = pileOf(t.give, t.givePurse)
            const ours = pileOf(t.want, t.wantPurse)
            return (
              <li key={t.id}>
                <span className="sc-dl__from">
                  {t.fromTeam}팀 → {t.toTeam}팀
                </span>
                <span className="sc-dl__bag">
                  {mineToRead ? '받는 것' : '주는 것'} {pileText(theirs)}
                </span>
                <span className="sc-dl__bag">
                  {mineToRead ? '주는 것' : '받는 것'} {pileText(ours)}
                </span>
                {t.note && <span className="sc-dl__note">{t.note}</span>}
                {mineToRead && (
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
            )
          })}
        </ul>
      )}

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
