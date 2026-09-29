// 덫 제조기 — 기술실의 기계 셋.
//
// 맵에서 제조기 옆에 서서 탭하면 열린다. 셋이 다 보이고, **옆에 선 것만
// 손이 닿는다**. 맡기는 것은 페이즈에만, 내 돈 3코인이다.
//
// 남이 맡긴 것은 「돌고 있다」까지다 — 몇 개가, 언제 나오는지는 맡긴
// 사람만 안다. **맡긴 페이즈가 끝나도록 안 찾아갔으면** 누구든 찾아간다.
// 그때부터는 몇 개인지도 보인다.
//
// **화면은 규칙을 판단하지 않는다.** 여기서 막는 것은 서버가 이미 보내
// 준 숫자뿐이고, 어긋나면 서버가 거절하고 그 말이 뜬다.
import { useState } from 'react'

import { TRAP_COIN_COST, TRAP_MAKE_MINUTES, beside } from '../../../shared/rules/trap'
import type { Cell } from '../../../shared/rules/board'
import type { GameActions } from './useGame'
import type { PlayerViewDoc } from '../../../shared/model'
import { leftText } from './Phase'
import { Cost } from './Cost'
import { buzz } from './Controls'

export interface MakerProps {
  view: PlayerViewDoc | null
  act: GameActions
  onSaid: (text: string) => void
  myCell: Cell | null
  phaseOpen: boolean
  nowMs: number
  /** 기술실을 우리가 쥐고 있나. 주인은 공개라 화면이 직접 봐도 된다 */
  ownsTech: boolean
}

export function MakerSheet({ view, act, onSaid, myCell, phaseOpen, nowMs, ownsTech }: MakerProps) {
  const [busy, setBusy] = useState(false)
  const makers = view?.makersHere ?? []
  const money = view?.myMoney ?? 0

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true)
    try {
      const out = (await fn()) as { count?: number; got?: number }
      buzz('ok')
      if (out.got !== undefined) onSaid(`덫 ${out.got}개를 찾았다.`)
      else if (out.count !== undefined) onSaid(`맡겼다. ${TRAP_MAKE_MINUTES}분 뒤에 ${out.count}개.`)
      else onSaid(`${label} 했다.`)
    } catch (e) {
      buzz('no')
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (makers.length === 0) return <p className="sc-mk__hint">제조기가 없다.</p>

  return (
    <div className="sc-mk">
      <p className="sc-mk__bill">
        <Cost of="money" n={TRAP_COIN_COST} />
        <span aria-hidden>→</span>
        <Cost of="trap" n={ownsTech ? 2 : 1} />
        <Cost of="clock" n={TRAP_MAKE_MINUTES} />
      </p>
      <ul className="sc-mk__list">
        {makers.map((m) => {
          const near = beside(myCell, m.cell)
          const left = m.readyAtMs === null ? 0 : Math.max(0, m.readyAtMs - nowMs)
          return (
            <li key={m.i} className={`is-${m.state}${near ? ' is-near' : ''}`}>
              <b>제조기 {m.i + 1}</b>
              {m.state === 'free' && (
                <>
                  <span>비어 있다</span>
                  <button
                    disabled={busy || !near || !phaseOpen || money < TRAP_COIN_COST}
                    onClick={() => void run('맡기기', () => act.commissionTrap(m.i))}
                  >
                    맡기기
                  </button>
                </>
              )}
              {m.state === 'busy' && <span>돌고 있다 — 남이 맡긴 것</span>}
              {(m.state === 'mine' || m.state === 'open') && (
                <>
                  <span>
                    {m.state === 'open' ? '임자 없음 · ' : '내 것 · '}
                    {left > 0 ? `${leftText(left)} 남았다` : `다 됐다 · ${m.count}개`}
                  </span>
                  <button
                    disabled={busy || !near || left > 0}
                    onClick={() => void run('찾기', () => act.takeTrap(m.i))}
                  >
                    찾기
                  </button>
                </>
              )}
              {!near && <em>옆에 서야 손이 닿는다</em>}
            </li>
          )
        })}
      </ul>
      {!phaseOpen && <p className="sc-mk__hint">맡기는 것은 페이즈에만 된다. 찾는 것은 지금도 된다.</p>}
      {phaseOpen && money < TRAP_COIN_COST && <p className="sc-mk__hint">돈이 모자란다. {TRAP_COIN_COST}코인이 든다.</p>}
      <p className="sc-mk__hint">맡긴 페이즈 동안에는 맡긴 사람만 찾아간다. 페이즈가 끝나도록 안 찾아가면 누구든 가져간다.</p>
    </div>
  )
}
