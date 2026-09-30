// 「나」 탭 — 알림 설정과 보관함.
//
//   설정   **셋 중 하나** — 안 받기 · 받기 · 앱 밖에서도 받기. 받으면 모든
//          종류가 다 온다(종류마다 고르지 않는다).
//          「앱 밖에서도 받기」를 누르는 그 순간에만 권한을 묻는다. 거절당하면
//          「받기」로 되돌리고 까닭을 적는다. 아이폰에서 홈 화면에 안 넣었으면
//          넣는 법을 적는다.
//   보관함 최근 20줄. 안 읽은 줄에 점. 펼치면 읽은 것으로 친다.
import { useState } from 'react'

import {
  DENIED_TEXT,
  IOS_GUIDE,
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
const LEVEL_LABEL: Record<NotifyMode, string> = { off: '안 받기', app: '받기', push: '앱 밖에서도 받기' }
const LEVEL_HINT: Record<NotifyMode, string> = {
  off: '아무 알림도 안 온다.',
  app: '모든 알림이 앱 안에 뜬다.',
  push: '모든 알림이 앱 안에 뜨고, 앱을 닫아 두어도 휴대폰 알림으로 온다.',
}

/** 지금 설정을 셋 중 하나로 본다. 앱 밖이 하나라도 있으면 앱 밖이다 */
const levelOf = (s: NotifySettings): NotifyMode =>
  !s.on ? 'off' : Object.values(s.modes).includes('push') ? 'push' : 'app'

/** 셋 중 하나를 모든 종류에 똑같이 */
const allAt = (m: NotifyMode): NotifySettings => ({
  on: m !== 'off',
  modes: Object.fromEntries(NOTIFY_TYPES.map((t) => [t, m === 'off' ? 'app' : m])) as Record<NotifyType, NotifyMode>,
})

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
  const level = levelOf(s)
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

  async function pick(m: NotifyMode) {
    if (busy) return
    setWhy(null)
    if (m === 'push') {
      setBusy(true)
      const got = await enablePush(act)
      setBusy(false)
      if (got !== 'ok') {
        // 못 켰다 — 받기로 되돌리고 까닭을 적는다
        setWhy(WHY[got] ?? WHY.failed)
        await save(allAt('app'))
        return
      }
    }
    await save(allAt(m))
    // 앱 밖을 안 쓰게 되면 이 기기를 뗀다
    if (m !== 'push') void disablePush(act)
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
      </div>
      <div className="sc-np__seg" role="radiogroup" aria-label="알림 받기">
        {MODES.map((m) => (
          <button
            key={m}
            role="radio"
            aria-checked={level === m}
            disabled={busy}
            className={level === m ? 'is-on' : ''}
            onClick={() => void pick(m)}
          >
            {LEVEL_LABEL[m]}
          </button>
        ))}
      </div>
      <p className="sc-np__hint">{LEVEL_HINT[level]}</p>
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
