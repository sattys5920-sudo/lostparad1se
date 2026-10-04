// 감독관 — 공사 중인 2-3 교실. 판이 도는 동안 문이 닫혀 있고, 「열기」를 누르면
// 그때부터 페이즈든 자유 시간이든 드나든다(rules/construction).
import { useState } from 'react'

import type { GameDoc } from '../../../shared/model'
import { CONSTRUCTION_ROOM, isUnderConstruction } from '../../../shared/rules/construction'
import type { GameActions } from '../game/useGame'

export function PlazaDesk({ game, act, onSaid }: { game: GameDoc; act: GameActions; onSaid: (t: string) => void }) {
  const closed = isUnderConstruction(game, CONSTRUCTION_ROOM)
  const [busy, setBusy] = useState(false)

  async function run(open: boolean) {
    if (!window.confirm(open ? '2-3 교실을 열까요? 지금부터 모두 드나든다.' : '2-3 교실을 다시 닫을까요? 안에 있는 사람은 나갈 수만 있다.')) return
    setBusy(true)
    try {
      await act.hostSetPlazaOpen(open)
      onSaid(open ? '2-3 교실을 열었다.' : '2-3 교실을 닫았다.')
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sc-pz-desk">
      <p className="sc-ad__hint">
        닫혀 있는 동안 문에 「공사 중」 팻말이 붙고, 페이즈든 자유 시간이든 아무도 못 들어간다. 안에 있던 사람은 나갈 수 있다.
      </p>
      <div className="sc-ad__row">
        {closed ? (
          <button disabled={busy} onClick={() => void run(true)}>
            열기
          </button>
        ) : (
          <button disabled={busy} onClick={() => void run(false)}>
            다시 닫기
          </button>
        )}
        <span className="sc-ad__pill">{closed ? '공사 중 · 닫힘' : '열림'}</span>
      </div>
    </div>
  )
}
