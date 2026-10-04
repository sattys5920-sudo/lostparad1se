// 감독관 — 최종 점수. 게임이 매기지 않는다 — 감독관이 계산해 사람마다 적는다.
// **적어도 아직 안 보인다.** 다 적고 「성적통지표 보내기」를 누르면 열넷 화면에
// 성적통지표(내 점수 · 석차 · 날마다 미션 → 전체 석차표)가 한 번에 뜬다.
import { useCallback, useEffect, useState } from 'react'

import type { GameActions } from '../game/useGame'

interface Row {
  playerId: string
  name: string
  score: number | null
}

export function FinalScoreDesk({ act, onSaid, sentAtMs }: { act: GameActions; onSaid: (t: string) => void; sentAtMs?: number | null }) {
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

  const missing = rows.filter((r) => r.score === null).map((r) => r.name)
  async function release() {
    const ask =
      (sentAtMs ? '성적통지표를 다시 보낼까요? 지금 점수로 모두에게 또 뜬다.' : '성적통지표를 보낼까요? 모두의 화면에 한 번에 뜬다.') +
      (missing.length > 0 ? `\n\n아직 안 적은 사람 ${missing.length} 명: ${missing.join(', ')}` : '')
    if (!window.confirm(ask)) return
    setBusy('release')
    try {
      const out = (await act.hostReleaseReportCards()) as { scored?: number }
      onSaid(`성적통지표를 보냈다 · ${out.scored ?? 0} 명.`)
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="sc-fs-desk">
      <p className="sc-ad__hint">
        적어도 아직 안 보인다. 다 적고 「성적통지표 보내기」를 누르면 모두에게 한 번에 뜬다. 비우고 저장하면 지운다.
      </p>
      <div className="sc-ad__row">
        <button disabled={busy !== null || rows.every((r) => r.score === null)} onClick={() => void release()}>
          {sentAtMs ? '성적통지표 다시 보내기' : '성적통지표 보내기'}
        </button>
        <span className="sc-ad__pill">
          {sentAtMs ? `보냄 · ${new Date(sentAtMs).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}` : '안 보냄'}
          {missing.length > 0 ? ` · 안 적음 ${missing.length} 명` : ''}
        </span>
      </div>
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
