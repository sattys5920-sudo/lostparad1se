// 심부름 — 게시판 앞과, 받아 둔 한 장.
//
// 화면이 판단하지 않는다. 받을 수 있는지도 집을 수 있는지도 서버가
// 정하고, 여기서는 서버가 보내 준 것만 그린다 — **받은 사람이 몇인지
// 안 보내 주므로 그릴 수도 없다.** 경주하는 중이라 그게 맞다.
import { useState } from 'react'

import { TILE_BY_ID } from '../../../shared/rules/board'
import type { GameActions } from './useGame'
import type { PlayerViewDoc } from '../../../shared/model'

/** 게시판 앞에 섰을 때 올라오는 목록. */
export function BoardSheet({
  view,
  act,
  onSaid,
  onClose,
}: {
  view: PlayerViewDoc | null
  act: GameActions
  onSaid: (t: string) => void
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const rows = view?.errandsHere ?? []

  async function take(id: string) {
    setBusy(true)
    try {
      const out = (await act.takeErrand(id)) as { from?: string }
      onSaid(`받았다. ${out.from ?? ''}로.`)
      onClose()
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (rows.length === 0) return <p className="sc-pl__none">붙어 있는 것이 없다.</p>

  return (
    <ul className="sc-er__list">
      {rows.map((e) => (
        <li key={e.id}>
          <b>{e.thing}</b>
          <span className="sc-er__way">
            {TILE_BY_ID[e.from]?.name} → {TILE_BY_ID[e.to]?.name}
          </span>
          <em>{e.coins}코인</em>
          <p>{e.text}</p>
          <div className="sc-er__row">
            <span className="sc-er__left">{e.minutesLeft}분 남음</span>
            {e.mine ?
              <span className="sc-er__got">받아 뒀다</span>
            : <button disabled={busy} onClick={() => void take(e.id)}>
                받기
              </button>
            }
          </div>
        </li>
      ))}
    </ul>
  )
}

/**
 * 받아 둔 한 장. 지도 아래 한 줄로 늘 떠 있다.
 *
 * **여럿이 같은 것을 받았을 수 있다.** 그 사실은 안 보인다 — 먼저
 * 놓은 사람이 가진다는 것만 알고 달리는 것이 이 일의 전부다.
 */
export function ErrandStrip({
  view,
  act,
  onSaid,
  ask,
}: {
  view: PlayerViewDoc | null
  act: GameActions
  onSaid: (t: string) => void
  ask: (t: string) => Promise<boolean>
}) {
  const [busy, setBusy] = useState(false)
  const e = view?.myErrand ?? null
  if (!e) return null

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true)
    try {
      await fn()
      onSaid(label)
    } catch (err) {
      onSaid((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const where =
    e.carrying ? `${TILE_BY_ID[e.to]?.name}로` : `${TILE_BY_ID[e.from]?.name}에서 집는다`

  // 줄 안에 끼는 단추라 `is-inline` 이다 — 44px 로 밀면 머리 판이
  // 그만큼 두꺼워져 방을 가린다. 손가락 자리는 보이지 않는 여백이 낸다
  return (
    <div className={`sc-er__strip${e.minutesLeft <= 5 ? ' is-soon' : ''}`}>
      <b>{e.thing}</b>
      <span>{where}</span>
      <i>{e.minutesLeft}분</i>
      {e.thingHere && (
        <button className="is-inline" disabled={busy} onClick={() => void run('집었다.', () => act.pickUpThing())}>
          집기
        </button>
      )}
      {e.canDrop && (
        <button
          className="is-go is-inline"
          disabled={busy}
          onClick={() => void run(`놓았다. ${e.coins}코인.`, () => act.dropThing())}
        >
          놓기
        </button>
      )}
      <button
        className="sc-er__quit is-inline"
        disabled={busy}
        aria-label="포기"
        onClick={() => {
          void ask('그만두면 들고 있던 것이 사라진다. 그만둘까?').then(async (yes) => {
            if (yes) await run('그만뒀다.', () => act.giveUpErrand())
          })
        }}
      >
        ✕
      </button>
    </div>
  )
}
