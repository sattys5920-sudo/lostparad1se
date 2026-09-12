// 고른 칸에 할 수 있는 일.
//
// **화면이 무엇을 할 수 있는지 판단하지 않는다.** 단추는 다 보이고,
// 안 되는 것은 서버가 거절하며 그 이유를 말해 준다. 화면이 미리
// 막으면 서버와 화면이 두 벌의 규칙을 갖게 되고, 둘이 어긋나는 날
// 사람은 왜 안 되는지 알 수 없다.
import { useState } from 'react'

import { TILE_BY_ID, type TileId } from '../../../shared/rules/board'
import { ACTION_TOKEN_COST } from '../../../shared/rules/actions'
import { BUILDINGS, SABOTAGE_LABEL, type BuildingKind, type SabotageKind } from '../../../shared/rules/v2'
import type { GameActions } from './useGame'

export interface ActionsProps {
  tileId: TileId
  act: GameActions
  onSaid: (text: string) => void
}

/** 서버가 한 말을 그대로 올린다. 화면이 문구를 지어내지 않는다. */
function useRun(onSaid: (t: string) => void) {
  const [busy, setBusy] = useState(false)
  return {
    busy,
    run: async (label: string, fn: () => Promise<unknown>) => {
      setBusy(true)
      try {
        await fn()
        onSaid(`${label} 했다.`)
      } catch (e) {
        onSaid((e as Error).message)
      } finally {
        setBusy(false)
      }
    },
  }
}

/**
 * 연구와 생산은 **내가 선 자리**에서 한다. 고른 칸과 상관없다.
 *
 * 처음에는 이 둘도 칸 패널에 넣었는데, 「교실」을 골라 두고 생산을
 * 누르면 교실에서 무언가 나는 것처럼 보였다. 실제로는 내가 선 칸이
 * 우리 땅이기만 하면 된다. 자리를 갈라 놓는다.
 */
export function Standing({ standingOn, act, onSaid }: { standingOn: TileId | null; act: GameActions; onSaid: (t: string) => void }) {
  const { busy, run } = useRun(onSaid)
  return (
    <div className="sc-ac__standing">
      <span className="sc-ac__where">
        {standingOn ? `${TILE_BY_ID[standingOn].name}에 서 있다` : '걷는 중'}
      </span>
      <button disabled={busy || !standingOn} onClick={() => run('연구', () => act.research(standingOn as TileId))}>
        연구 <em>{ACTION_TOKEN_COST.research}</em>
      </button>
      <button disabled={busy || !standingOn} onClick={() => run('생산', () => act.produce(standingOn as TileId))}>
        생산 <em>{ACTION_TOKEN_COST.produce}</em>
      </button>
    </div>
  )
}

export function Actions({ tileId, act, onSaid }: ActionsProps) {
  const { busy, run } = useRun(onSaid)
  const [open, setOpen] = useState<'build' | 'sabotage' | null>(null)
  const spec = TILE_BY_ID[tileId]

  return (
    <div className="sc-ac">
      <h2>
        {spec.name} <span>{spec.value}점</span>
      </h2>

      <div className="sc-ac__row">
        <button disabled={busy} onClick={() => run('이동', () => act.moveTo(tileId))}>
          걸어가기
        </button>
        <button disabled={busy} onClick={() => run('예약', () => act.planCommute(tileId))}>
          등교 예약
        </button>
      </div>

      <div className="sc-ac__row">
        <button disabled={busy} onClick={() => run('깃발', () => act.plantFlag(tileId))}>
          깃발 <em>{ACTION_TOKEN_COST.flag}</em>
        </button>
        <button disabled={busy} onClick={() => run('탐색', () => act.scout(tileId))}>
          탐색 <em>{ACTION_TOKEN_COST.scout}</em>
        </button>
      </div>

      <div className="sc-ac__row">
        <button disabled={busy} onClick={() => setOpen(open === 'build' ? null : 'build')}>
          짓기
        </button>
        <button disabled={busy} onClick={() => setOpen(open === 'sabotage' ? null : 'sabotage')}>
          견제
        </button>
      </div>

      {open === 'build' && (
        <ul className="sc-ac__menu">
          {BUILDINGS.map((b) => (
            <li key={b.kind}>
              <button disabled={busy} onClick={() => run(b.name, () => act.build(tileId, b.kind as BuildingKind))}>
                {b.name}
                <span>
                  {Object.entries(b.cost)
                    .map(([r, n]) => `${r === 'money' ? '돈' : r === 'knowledge' ? '지식' : '영향력'} ${n}`)
                    .join(' · ')}
                </span>
              </button>
              <button
                className="sc-ac__up"
                disabled={busy}
                onClick={() => run(`${b.name} 개조`, () => act.upgrade(tileId, b.kind as BuildingKind))}
              >
                개조
              </button>
            </li>
          ))}
        </ul>
      )}

      {open === 'sabotage' && (
        <ul className="sc-ac__menu">
          {(Object.keys(SABOTAGE_LABEL) as SabotageKind[]).map((k) => (
            <li key={k}>
              <button disabled={busy} onClick={() => run(SABOTAGE_LABEL[k], () => act.sabotage(tileId, k))}>
                {SABOTAGE_LABEL[k]}
                <span>영향력 1</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
