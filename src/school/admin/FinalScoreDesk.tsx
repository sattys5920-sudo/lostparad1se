// 감독관 — 최종 점수. 게임이 매기지 않는다 — 감독관이 계산해 사람마다 적는다.
// 적는 대로 그 사람의 「나」 탭에 뜬다(남의 점수는 안 보인다).
import { useCallback, useEffect, useState } from 'react'

import type { GameActions } from '../game/useGame'

interface Row {
  playerId: string
  name: string
  score: number | null
}

export function FinalScoreDesk({ act, onSaid }: { act: GameActions; onSaid: (t: string) => void }) {
  const [rows, setRows] = useState<Row[]>([])
  /** 고쳐 적는 중인 칸. playerId → 입력값 */
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = (await act.hostFinalScores()) as { rows?: Row[] }
      setRows(r.rows ?? [])
    } catch (e) {
      onSaid((e as Error).message)
    }
  }, [act, onSaid])
  useEffect(() => {
    void load()
  }, [load])

  async function save(id: string) {
    const text = (draft[id] ?? '').trim()
    const score = text === '' ? null : Number(text)
    if (score !== null && !Number.isFinite(score)) {
      onSaid('숫자로 적는다.')
      return
    }
    setBusy(id)
    try {
      await act.hostSetFinalScore(id, score)
      onSaid(score === null ? '점수를 지웠다.' : '점수를 적었다.')
      setDraft((d) => {
        const next = { ...d }
        delete next[id]
        return next
      })
      await load()
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="sc-fs-desk">
      <p className="sc-ad__hint">적는 대로 그 사람의 「나」 탭에 뜬다. 비우고 저장하면 지운다.</p>
      <ul className="sc-fs-desk__list">
        {rows.map((r) => {
          const value = draft[r.playerId] ?? (r.score === null ? '' : String(r.score))
          const dirty = r.playerId in draft
          return (
            <li key={r.playerId}>
              <label htmlFor={`fs-${r.playerId}`}>{r.name}</label>
              <input
                id={`fs-${r.playerId}`}
                inputMode="decimal"
                value={value}
                placeholder="—"
                onChange={(e) => setDraft((d) => ({ ...d, [r.playerId]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void save(r.playerId)
                }}
              />
              <button disabled={!dirty || busy !== null} onClick={() => void save(r.playerId)}>
                저장
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
