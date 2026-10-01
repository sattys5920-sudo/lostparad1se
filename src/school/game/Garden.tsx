// 화분 — 정원에서 보는 여덟 자리.
//
// **심는 것은 운영자가 한다.** 여기서 할 수 있는 것은 자란 것을 보고,
// 열매를 따는 것뿐이다. **시들지 않는다** — 딸 때까지 달려 있다.
//
// 화면이 판단하지 않는다. 딸 수 있는지도 서버가 정하고, 여기서는
// 서버가 보내 준 단계만 그린다 — **무엇이 심겼는지는 싹이 나야
// 오므로 그릴 수도 없다.** 흙 앞에서 기다리는 것이 이 일이다.
import { useState } from 'react'

import { CROP_BY_ID } from '../../../shared/rules/crop'
import { cropIcon } from './goodArt'
import type { GameActions } from './useGame'
import type { PlayerViewDoc } from '../../../shared/model'
import { buzz } from './Controls'
import { josa } from '../../../shared/text'

type Pot = NonNullable<PlayerViewDoc['potsHere']>[number]

/** 단계마다 한 줄. 이름이 보이면 이름을 앞세운다 */
function lineOf(pot: Pot): string {
  if (pot.stage === 'empty') return '빈 화분'
  if (pot.stage === 'soil') return '흙뿐이다. 무엇이 날지 모른다'
  const what = pot.name ?? '무언가'
  if (pot.stage === 'sprout') return `${what} · 싹`
  if (pot.stage === 'leaf') return `${what} · 잎`
  return `${what} · 열매`
}

/**
 * 정원에서 여는 칸. 씨앗 상자와 화분 여덟이 한 목록이다.
 *
 * **자리가 멀면 단추가 안 뜬다** — 서버가 화분 앞(둘레 한 칸)을
 * 보고 거절하므로, 화면도 같은 자로 재서 헛누름을 줄인다.
 */
export function GardenSheet({
  view,
  act,
  onSaid,
  myCell,
  nearPot,
  phaseOpen = false,
}: {
  view: PlayerViewDoc | null
  act: GameActions
  onSaid: (t: string) => void
  myCell: { x: number; y: number } | null
  /** 그 화분 앞에 서 있는가. */
  nearPot: (i: number) => boolean
  /** 점령전 중이다 — 따기는 자유 시간에만 되므로 버튼을 안 그린다 */
  phaseOpen?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const pots = view?.potsHere ?? []
  const crops = Object.values(view?.myCrops ?? {}).reduce((a, n) => a + n, 0)

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true)
    try {
      await fn()
      buzz('ok')
      onSaid(label)
    } catch (e) {
      buzz('no')
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sc-gd">
      <p className="sc-gd__hand">
        딴 것 {crops} 개
      </p>

      <ul className="sc-gd__list">
        {pots.map((pot) => {
          const close = nearPot(pot.i)
          return (
            <li key={pot.i} className={`is-${pot.stage}`}>
              {/* 열매 그림. **이름이 보일 때만 붙인다** — 흙 앞에서
                  그림이 보이면 무엇인지 알아 버린다 */}
              {pot.cropId != null && CROP_BY_ID[pot.cropId] && (
                <img className="sc-gd__icon" src={cropIcon(pot.cropId)} alt="" width={16} height={16} />
              )}
              <b>{lineOf(pot)}</b>
              {!close && pot.stage !== 'empty' && <span className="sc-gd__far">앞으로 가야 한다</span>}
              {close && pot.stage === 'fruit' && !phaseOpen && (
                <button
                  className="is-go"
                  disabled={busy || !pot.canPick}
                  onClick={() =>
                    void run('땄다.', async () => {
                      const out = (await act.harvestPot(pot.i)) as { got?: string }
                      const got = out.got ?? '무언가'
                      onSaid(`${got}${josa(got, '을/를')} 땄다.`)
                    })
                  }
                >
                  따기
                </button>
              )}
            </li>
          )
        })}
      </ul>

      {/* **언제 열매가 되는지는 안 적는다.** 서버도 안 보내 준다 —
          알 수 있으면 화분 앞에 설 이유가 없어진다 */}
      {myCell === null && <p className="sc-gd__hint">정원 안에서 연다.</p>}
    </div>
  )
}
