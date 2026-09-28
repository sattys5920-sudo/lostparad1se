// 운영자 — 표 집계. 열넷이 지금까지 받은 신뢰표·호감표를 사람별로 본다.
//
// **누가 줬는지는 여기도 안 온다.** 서버(functions/src/vote.ts 의
// hostVotes)가 애초에 종류별 합계만 만들어 보낸다 — 화면이 가리는
// 것이 아니라 문서에 안 담겨 온다. 오늘 것도 센다 — 운영자는 지금
// 상황을 보는 것이다(「나」 탭은 어제까지만 센다).
import { useCallback, useEffect, useMemo, useState } from 'react'

import { VOTE_LABEL, type TeamId } from '../../../shared/rules/v2'
import type { GameActions } from '../game/useGame'

const TEAMS: readonly TeamId[] = ['A', 'B', 'C', 'D']

interface Row {
  playerId: string
  name: string
  team: TeamId
  trust: number
  liking: number
}

export function VoteDesk({ act, onSaid }: { act: GameActions; onSaid: (t: string) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      setRows(((await act.hostVotes()) as { rows: Row[] }).rows)
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [act, onSaid])
  useEffect(() => {
    void load()
  }, [load])

  const sorted = useMemo(
    () => [...(rows ?? [])].sort((a, b) => TEAMS.indexOf(a.team) - TEAMS.indexOf(b.team) || a.name.localeCompare(b.name, 'ko')),
    [rows],
  )
  const sumTrust = sorted.reduce((n, r) => n + r.trust, 0)
  const sumLiking = sorted.reduce((n, r) => n + r.liking, 0)

  if (!rows) return <p className="sc-ad__hint">표를 읽는 중이다.</p>

  return (
    <div className="sc-vt">
      <div className="sc-sd__sum" role="status">
        <span>
          {VOTE_LABEL.trust} <b>{sumTrust}</b>
        </span>
        <span>
          {VOTE_LABEL.liking} <b>{sumLiking}</b>
        </span>
        <button className="sc-pt__reload" disabled={busy} onClick={() => void load()}>
          새로 읽기
        </button>
      </div>

      {sorted.length === 0 ? (
        <p className="sc-ad__hint">아직 배정 전이다.</p>
      ) : (
        <ul className="sc-pt__list">
          {sorted.map((r) => (
            <li key={r.playerId}>
              <div className="sc-vt__row">
                <i className={`sc-md__team is-${r.team}`}>{r.team}</i>
                <span className="sc-vt__name">{r.name}</span>
                <span className="sc-vt__count">
                  <b>{r.trust}</b>
                  {VOTE_LABEL.trust}
                </span>
                <span className="sc-vt__count">
                  <b>{r.liking}</b>
                  {VOTE_LABEL.liking}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
