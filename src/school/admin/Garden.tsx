// 화분 — 운영자가 심는 자리.
//
// **자동으로 자라는 화분은 없다.** 정원에 놓인 여덟 자리가 전부 이
// 화면을 거친다 — 게시판의 심부름과 같다. 안 심으면 정원은 종일
// 빈 화분 여덟이다.
//
// 작물을 고를 수 있고, 안 고르면 서버가 무게를 두고 뽑는다. 어느
// 쪽이든 **자랄 시간은 서버가 뽑고 여기에도 안 온다** — 언제 열매가
// 될지는 운영자도 모르는 편이 낫다. 알면 그 시각에 맞춰 사람을
// 부르게 되고, 그러면 그건 정원이 아니라 행사다.
import { useCallback, useEffect, useState } from 'react'

import type { GameActions } from '../game/useGame'

interface PotRow {
  i: number
  stage: 'empty' | 'soil' | 'sprout' | 'leaf' | 'fruit' | 'withered'
  name: string | null
}
interface CropRow {
  id: string
  name: string
  price: number
  /** 판에 몇 번 더 나올 수 있는가. 제한이 없으면 null */
  left: number | null
}

const STAGE_NAME: Record<PotRow['stage'], string> = {
  empty: '빈 화분',
  soil: '흙',
  sprout: '싹',
  leaf: '잎',
  fruit: '열매',
  withered: '시듦',
}

export function GardenDesk({ act, onSaid }: { act: GameActions; onSaid: (t: string) => void }) {
  const [pots, setPots] = useState<PotRow[]>([])
  const [crops, setCrops] = useState<CropRow[]>([])
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const out = (await act.hostGarden()) as { pots?: PotRow[]; crops?: CropRow[] }
      setPots(out.pots ?? [])
      setCrops(out.crops ?? [])
    } catch (e) {
      onSaid((e as Error).message)
    }
  }, [act, onSaid])

  useEffect(() => {
    void load()
  }, [load])

  async function run(what: string, fn: () => Promise<unknown>) {
    setBusy(true)
    try {
      await fn()
      onSaid(what)
      await load()
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const empty = pots.filter((p) => p.stage === 'empty').length

  return (
    <div className="sc-ga">
      <label className="sc-dr__row">
        <span>무엇을</span>
        <select value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">아무거나 (서버가 뽑는다)</option>
          {crops.map((c) => (
            <option key={c.id} value={c.id} disabled={c.left === 0}>
              {c.name} · {c.price}코인{c.left === null ? '' : ` · ${c.left}번 남음`}
            </option>
          ))}
        </select>
      </label>
      <p className="sc-ad__hint">
        빈 화분 {empty}자리. 심고 나면 <b>언제 열매가 될지는 여기에도 안 온다</b> — 서버만 안다.
      </p>

      <ul className="sc-ga__pots">
        {pots.map((p) => (
          <li key={p.i} className={`is-${p.stage}`}>
            <b>{p.i + 1}</b>
            <span>
              {STAGE_NAME[p.stage]}
              {p.name !== null && p.stage !== 'empty' ? ` · ${p.name}` : ''}
            </span>
            {p.stage === 'empty' ?
              <button disabled={busy} onClick={() => void run('심었다.', () => act.hostPlant(p.i, pick || undefined))}>
                심기
              </button>
            : <button disabled={busy} onClick={() => void run('뽑았다.', () => act.hostPullPot(p.i))}>
                뽑기
              </button>
            }
          </li>
        ))}
      </ul>
    </div>
  )
}
