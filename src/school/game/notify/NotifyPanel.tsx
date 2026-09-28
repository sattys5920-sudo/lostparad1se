// 「나」 탭 — 알림 설정과 보관함.
//
//   설정   전체 스위치 하나, 종류마다 끄기 · 앱 안에서만 · 앱 밖에서도.
//          「앱 밖에서도」를 누르는 그 순간에만 권한을 묻는다. 거절당하면
//          「앱 안에서만」으로 되돌리고 까닭을 적는다. 아이폰에서 홈 화면에
//          안 넣었으면 넣는 법을 적는다.
//   보관함 최근 20줄. 안 읽은 줄에 점. 펼치면 읽은 것으로 친다.
import { useState } from 'react'

import {
  DENIED_TEXT,
  IOS_GUIDE,
  MODE_LABEL,
  NOTIFY_HINT,
  NOTIFY_LABEL,
  NOTIFY_TYPES,
  settingsOf,
  type NoteItem,
  type NotifyLink,
  type NotifyMode,
  type NotifySettings,
  type NotifyType,
} from '../../../../shared/notify/notifyData'
import type { InboxDoc } from '../../../../shared/missions/mail'
import type { GameActions } from '../useGame'
import { unreadOf } from './banner'
import { disablePush, enablePush } from './push'
import './notify.css'

const MODES: readonly NotifyMode[] = ['off', 'app', 'push']

const WHY: Record<string, string> = {
  denied: DENIED_TEXT,
  iosInstall: IOS_GUIDE,
  unsupported: '이 브라우저는 앱 밖 알림을 못 받는다. 앱 안에서만 알린다.',
  noKey: '앱 밖 알림이 아직 준비되지 않았다. 앱 안에서만 알린다.',
  failed: '앱 밖 알림을 켜지 못했다. 잠시 뒤 다시 눌러 본다.',
}

function when(ms: number): string {
  const d = new Date(ms + 9 * 3_600_000)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

export function NotifyPanel({
  act,
  inbox,
  onGo,
}: {
  act: GameActions
  inbox: InboxDoc | null
  onGo: (link: NotifyLink) => void
}) {
  const saved = settingsOf(inbox?.settings)
  const [draft, setDraft] = useState<NotifySettings | null>(null)
  const s = draft ?? saved
  const [why, setWhy] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const notes: NoteItem[] = inbox?.notes ?? []
  const unread = unreadOf(notes, inbox?.notesReadAtMs)

  async function save(next: NotifySettings) {
    setDraft(next)
    try {
      await act.setNotifySettings(next)
    } catch (e) {
      setWhy((e as Error).message)
    } finally {
      setDraft(null)
    }
  }

  async function pick(t: NotifyType, m: NotifyMode) {
    if (busy) return
    setWhy(null)
    const next: NotifySettings = { ...s, modes: { ...s.modes, [t]: m } }
    if (m === 'push' && s.on) {
      setBusy(true)
      const got = await enablePush(act)
      setBusy(false)
      if (got !== 'ok') {
        // 못 켰다 — 앱 안에서만으로 되돌리고 까닭을 적는다
        setWhy(WHY[got] ?? WHY.failed)
        await save({ ...next, modes: { ...next.modes, [t]: 'app' } })
        return
      }
    }
    await save(next)
    // 앱 밖을 하나도 안 쓰게 되면 이 기기를 뗀다
    if (!Object.values(next.modes).includes('push')) void disablePush(act)
  }

  function toggleArchive() {
    const next = !open
    setOpen(next)
    if (next && unread > 0) {
      void act.readNotes().catch(() => undefined)
      void (navigator as unknown as { clearAppBadge?: () => Promise<void> }).clearAppBadge?.().catch(() => undefined)
    }
  }

  return (
    <section className="sc-np" aria-label="알림">
      <div className="sc-np__head">
        <b>알림</b>
        <label className="sc-np__master">
          <input
            id="np-on"
            type="checkbox"
            checked={s.on}
            onChange={(e) => void save({ ...s, on: e.target.checked })}
          />
          <span>{s.on ? '켜짐' : '꺼짐'}</span>
        </label>
      </div>

      <ul className={'sc-np__list' + (s.on ? '' : ' is-off')}>
        {NOTIFY_TYPES.map((t) => (
          <li key={t}>
            <div className="sc-np__row">
              <span className="sc-np__name">{NOTIFY_LABEL[t]}</span>
              <div className="sc-np__seg" role="radiogroup" aria-label={`${NOTIFY_LABEL[t]} 알림`}>
                {MODES.map((m) => (
                  <button
                    key={m}
                    role="radio"
                    aria-checked={s.modes[t] === m}
                    disabled={!s.on || busy}
                    className={s.modes[t] === m ? 'is-on' : ''}
                    onClick={() => void pick(t, m)}
                  >
                    {MODE_LABEL[m]}
                  </button>
                ))}
              </div>
            </div>
            <p className="sc-np__hint">{NOTIFY_HINT[t]}</p>
          </li>
        ))}
      </ul>
      {why && (
        <p className="sc-np__why" role="alert">
          {why}
        </p>
      )}

      <button className="sc-np__archive" aria-expanded={open} onClick={toggleArchive}>
        받은 알림 {notes.length > 0 ? notes.length : ''}
        {unread > 0 && <i className="sc-np__dot" aria-label={`안 읽은 알림 ${unread}`} />}
        <span aria-hidden="true">{open ? '▲' : '▼'}</span>
      </button>
      {open &&
        (notes.length === 0 ? (
          <p className="sc-np__hint">아직 받은 알림이 없다.</p>
        ) : (
          <ol className="sc-np__notes">
            {notes.map((n) => (
              <li key={n.id + n.atMs}>
                <button onClick={() => onGo(n.link)}>
                  {n.atMs > (inbox?.notesReadAtMs ?? 0) && <i className="sc-np__dot" aria-hidden="true" />}
                  <span>{n.text}</span>
                  <time>{when(n.atMs)}</time>
                </button>
              </li>
            ))}
          </ol>
        ))}
    </section>
  )
}
