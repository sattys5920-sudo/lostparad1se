// 운영자 — 투명인간 투표의 문(열면 투표 탭이 열리고, 닫으면 그 자리에서
// 센다)과 그날 누가 누구를 적었는지.
//
// **개별 표는 여기만 예외다.** 신뢰·호감표(VoteDesk)는 운영자에게도
// 사람별 합계까지만 나가지만, 이 투표는 서버(hostBallots)가 개별
// 표를 그대로 열어 준다 — 판을 지키는 운영자는 봐야 한다는 판단이다.
// 플레이어에게는 여전히 결과 한 줄뿐이다.
import { useCallback, useEffect, useState } from 'react'

import { TOTAL_DAYS } from '../../../shared/rules/v2'
import type { GameDoc } from '../../../shared/model'
import type { GameActions } from '../game/useGame'

interface Row {
  voterId: string
  voterName: string
  targetId: string
  targetName: string
  atMs: number
}

export function BallotDesk({ game, act, onSaid }: { game: GameDoc; act: GameActions; onSaid: (t: string) => void }) {
  const [busy, setBusy] = useState(false)
  const day = game.day
  const open = game.ballot?.open === true && game.ballot.day === day
  /*
   * **어제 연 투표가 아직 열려 있다.** 날을 먼저 넘기고 나서 닫으면 그때 발표된다 —
   * 투명인간을 다음 날부터 적용하려고 일부러 이렇게 쓴다. 그때는 오늘 것 대신
   * 그 투표의 「닫기」를 보여 준다. 안 그러면 「열기」가 떠서 어제 표를 세지도
   * 않고 덮어쓴다
   */
  const lagging = game.ballot?.open === true && game.ballot.day !== day ? game.ballot.day : null
  const counted = String(day + 1) in (game.invisibleByDay ?? {})
  const last = day >= TOTAL_DAYS
  const run = async (label: string, fn: () => Promise<unknown>) => {
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

  // 지금 투명인간. 운영자가 사유를 적고 바로 풀 수 있다(clearInvisible)
  const ghost = game.invisibleId ? (game.seats.find((s) => s.playerId === game.invisibleId)?.name ?? '?') : null
  const [why, setWhy] = useState('')

  const [seeDay, setSeeDay] = useState(day)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [rowsBusy, setRowsBusy] = useState(false)
  const loadRows = useCallback(async (d: number) => {
    setRowsBusy(true)
    try {
      setRows(((await act.hostBallots(d)) as { rows: Row[] }).rows)
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setRowsBusy(false)
    }
  }, [act, onSaid])
  useEffect(() => {
    setSeeDay(day)
    void loadRows(day)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day])

  return (
    <div>
      {lagging !== null && (
        <div className="sc-ad__row">
          <span className="sc-ad__pill">DAY {lagging} 투표 · 아직 열림</span>
          <button className="sc-ad__danger" disabled={busy} onClick={() => void run(`DAY ${lagging} 투표 닫기 · 집계`, () => act.hostCloseBallot())}>
            DAY {lagging} 투표 닫기
          </button>
        </div>
      )}
      <div className="sc-ad__row">
        <span className="sc-ad__pill">
          DAY {day} 투표 · {last ? '마지막 날 없음' : counted ? '셌다' : open ? '열림' : '닫힘'}
        </span>
        {!last && !counted && lagging === null && (
          open ? (
            <button className="sc-ad__danger" disabled={busy} onClick={() => void run('투표 닫기 · 집계', () => act.hostCloseBallot())}>
              투표 닫기
            </button>
          ) : (
            <button className="is-primary" disabled={busy} onClick={() => void run('투표 열기', () => act.hostOpenBallot())}>
              투표 열기
            </button>
          )
        )}
        {/* 투표를 열기 전에 정산을 넘겨 0 장으로 세어 버린 날 — 되돌리고 다시 연다 */}
        {!last && counted && (
          <button
            disabled={busy}
            onClick={() => {
              if (!window.confirm(`DAY ${day} 투표 결과를 되돌리고 다시 열까요? 그때 나간 결과 공지도 지운다.`)) return
              void run('투표 다시 열기', () => act.hostReopenBallot())
            }}
          >
            다시 열기
          </button>
        )}
      </div>

      <div className="sc-ad__row" style={{ marginTop: 'var(--sp-3)' }}>
        <span className="sc-ad__pill">지금 투명인간 · {ghost ?? '없음'}</span>
      </div>
      {ghost && (
        <div className="sc-ad__row">
          <input
            id="bd-why"
            aria-label="푸는 까닭"
            placeholder="푸는 까닭(감독관 기록에만 남는다)"
            value={why}
            onChange={(e) => setWhy(e.target.value)}
          />
          <button
            className="sc-ad__danger"
            disabled={busy || why.trim() === ''}
            onClick={() =>
              void run(`${ghost} 투명 풀기`, async () => {
                await act.clearInvisible(why.trim())
                setWhy('')
              })
            }
          >
            투명 풀기
          </button>
        </div>
      )}

      <div className="sc-vt" style={{ marginTop: 'var(--sp-3)' }}>
        <div className="sc-sd__sum" role="status">
          <span>
            보는 날 <b>DAY {seeDay}</b>
          </span>
          <button
            className="sc-pt__reload"
            disabled={rowsBusy || seeDay <= 1}
            onClick={() => {
              const d = seeDay - 1
              setSeeDay(d)
              void loadRows(d)
            }}
          >
            전날
          </button>
          <button
            className="sc-pt__reload"
            disabled={rowsBusy || seeDay >= day}
            onClick={() => {
              const d = seeDay + 1
              setSeeDay(d)
              void loadRows(d)
            }}
          >
            다음 날
          </button>
          <button className="sc-pt__reload" disabled={rowsBusy} onClick={() => void loadRows(seeDay)}>
            새로 읽기
          </button>
        </div>
        {!rows ? (
          <p className="sc-ad__hint">표를 읽는 중이다.</p>
        ) : rows.length === 0 ? (
          <p className="sc-ad__hint">그날 던져진 표가 없다.</p>
        ) : (
          <ul className="sc-pt__list">
            {rows.map((r) => (
              <li key={r.voterId}>
                <div className="sc-vt__row">
                  <span className="sc-vt__name">{r.voterName}</span>
                  <span>→</span>
                  <span className="sc-vt__name">{r.targetName}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
