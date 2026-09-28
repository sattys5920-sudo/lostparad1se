// 운영자 — 알림 보낸 기록. 종류 · 받은 사람 · 시각 · 길(앱 안/밖) · 성공 여부.
//
// 위에는 종류마다 실패 수, 앱 밖 알림을 건 기기 수, 열쇠가 있는지.
// **알림 내용은 원래 없다** — 여기서도 종류만 보인다.
import { useCallback, useEffect, useState } from 'react'

import { NOTIFY_LABEL, NOTIFY_TYPES, type NotifyType } from '../../../shared/notify/notifyData'
import type { GameActions } from '../game/useGame'

interface Row {
  type: NotifyType | 'batch'
  target: string
  name: string
  atMs: number
  channel: 'app' | 'push'
  ok: boolean
  err?: string
  skip?: boolean
}
interface Out {
  canPush: boolean
  skipped: number
  devices: number
  fails: Record<string, { app: number; push: number }>
  rows: Row[]
}

const REFRESH_MS = 15_000

function hhmm(ms: number): string {
  const d = new Date(ms + 9 * 3_600_000)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`
}

const typeName = (t: Row['type']) => (t === 'batch' ? '모아 보냄' : NOTIFY_LABEL[t])

export function NotifyDesk({ act, onSaid }: { act: GameActions; onSaid: (t: string) => void }) {
  const [out, setOut] = useState<Out | null>(null)
  const [onlyFails, setOnlyFails] = useState(false)

  const load = useCallback(async () => {
    try {
      setOut((await act.hostNotifyLog()) as unknown as Out)
    } catch (e) {
      onSaid((e as Error).message)
    }
  }, [act, onSaid])

  useEffect(() => {
    void load()
    const t = window.setInterval(() => void load(), REFRESH_MS)
    return () => window.clearInterval(t)
  }, [load])

  if (!out) return <p className="sc-ad__hint">알림 기록을 읽는 중이다.</p>
  const rows = onlyFails ? out.rows.filter((r) => !r.ok && !r.skip) : out.rows
  return (
    <div className="sc-nd">
      <p className="sc-ad__hint">
        앱 밖 알림 {out.canPush ? '준비됨' : '열쇠 없음 — 앱 안에서만 간다'} · 건 기기 {out.devices}대 · 길이 없어 안 보낸 것 {out.skipped}건
      </p>
      <table className="sc-nd__fails">
        <thead>
          <tr>
            <th>실패</th>
            <th>앱 안</th>
            <th>앱 밖</th>
          </tr>
        </thead>
        <tbody>
          {[...NOTIFY_TYPES, 'batch' as const].map((t) => (
            <tr key={t}>
              <td>{typeName(t)}</td>
              <td className={out.fails[t]?.app ? 'is-bad' : ''}>{out.fails[t]?.app ?? 0}</td>
              <td className={out.fails[t]?.push ? 'is-bad' : ''}>{out.fails[t]?.push ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="sc-nd__bar">
        <label>
          <input id="nd-fails" type="checkbox" checked={onlyFails} onChange={(e) => setOnlyFails(e.target.checked)} /> 실패만
        </label>
        <button onClick={() => void load()}>
          새로 읽기
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="sc-ad__hint">기록이 없다.</p>
      ) : (
        <ol className="sc-nd__log">
          {rows.map((r, i) => (
            <li key={`${r.atMs}-${i}`} className={r.ok ? '' : r.skip ? 'is-skip' : 'is-bad'}>
              <time>{hhmm(r.atMs)}</time>
              <span>{typeName(r.type)}</span>
              <b>{r.name || r.target.slice(0, 6)}</b>
              <span>{r.channel === 'app' ? '앱 안' : '앱 밖'}</span>
              <span>{r.ok ? '성공' : (r.err ?? '실패')}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
