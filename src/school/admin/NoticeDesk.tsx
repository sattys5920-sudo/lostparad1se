// 운영자 — 모두에게 한마디. 「1위 발표」와 공지.
//
// **1위 발표**는 누르는 순간의 방 수로 센다(서버 hostAnnounceLeader).
// 정산과 같은 자라 동점이면 공동 1위다. 공지도 발표도 플레이어 화면에
// 팝업으로 뜨고 「나」 탭 공지 칸에 남는다.
import { useState } from 'react'

import { NOTICE_MAX, NOTICE_TEMPLATES, checkNotice } from '../../../shared/reveal/notice'
import type { SeatEntry } from '../../../shared/model'
import type { GameActions } from '../game/useGame'

export function NoticeDesk({ seats, act, onSaid }: { seats: readonly SeatEntry[]; act: GameActions; onSaid: (t: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState('')
  const [to, setTo] = useState('')
  const ok = checkNotice(text).ok

  async function run(fn: () => Promise<unknown>, said: (r: unknown) => string) {
    setBusy(true)
    try {
      onSaid(said(await fn()))
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sc-nd">
      <div className="sc-ad__row">
        <button
          className="is-primary"
          disabled={busy}
          onClick={() =>
            void run(
              () => act.hostAnnounceLeader(),
              (r) => `발표했다 — ${(r as { text?: string }).text ?? ''}`,
            )
          }
        >
          1 위 발표
        </button>
        <span className="sc-ad__hint">지금 가진 방 수로 센 1 위를 모두의 화면에 띄운다.</span>
      </div>

      <div className="sc-nd__tpl">
        {NOTICE_TEMPLATES.map((t) => (
          <button key={t.id} disabled={busy} onClick={() => setText(t.text)}>
            {t.label}
          </button>
        ))}
      </div>
      <textarea
        id="nd-text"
        aria-label="공지"
        rows={3}
        maxLength={NOTICE_MAX}
        placeholder="공지할 말"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="sc-ad__row">
        <select id="nd-to" aria-label="받는 사람" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">전원</option>
          {seats.map((s) => (
            <option key={s.playerId} value={s.playerId}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          disabled={busy || !ok}
          onClick={() =>
            void run(
              () => act.hostNotice(text.trim(), to || null),
              () => {
                setText('')
                return to ? `${seats.find((s) => s.playerId === to)?.name ?? ''}에게 보냈다.` : '전원에게 보냈다.'
              },
            )
          }
        >
          공지 보내기
        </button>
        <span className="sc-ad__hint">
          {text.trim().length}/{NOTICE_MAX}
        </span>
      </div>
    </div>
  )
}
