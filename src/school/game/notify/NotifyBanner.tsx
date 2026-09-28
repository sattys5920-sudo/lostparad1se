// 앱 안 알림 배너 — 우편함(inbox.notes)에 새 줄이 오면 위에 잠깐 뜬다.
//
//   한 줄 · 점 · 시각. 3초 뒤 저절로 들어간다. 누르면 그 화면으로 간다.
//   위로 밀면 닫힌다. 한 번에 둘까지 — 셋째가 오면 오래된 것이 내려간다.
//   페이즈 시작 · 종료는 크게, 가운데에, 소리와 진동을 곁들여.
//
// **무엇을 띄울지는 서버가 이미 정했다.** 설정에서 끈 것은 우편함에 아예 안
// 온다 — 여기서 받아서 숨기지 않는다.
import { useEffect, useRef, useState } from 'react'

import { BANNER_MS, type NoteItem, type NotifyLink } from '../../../../shared/notify/notifyData'
import { freshNotes, isBig, stack } from './banner'
import './notify.css'

const SWIPE_PX = 24

function hhmm(ms: number): string {
  const d = new Date(ms + 9 * 3_600_000)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

/** 페이즈 종 — 짧은 두 음. 파일 없이 만든다 */
function chime(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const at = ctx.currentTime
    for (const [i, f] of [660, 880].entries()) {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'square'
      o.frequency.value = f
      g.gain.setValueAtTime(0.06, at + i * 0.14)
      g.gain.exponentialRampToValueAtTime(0.001, at + i * 0.14 + 0.12)
      o.connect(g).connect(ctx.destination)
      o.start(at + i * 0.14)
      o.stop(at + i * 0.14 + 0.13)
    }
    window.setTimeout(() => void ctx.close(), 600)
  } catch {
    /* 소리를 못 내는 기기 */
  }
}

export function NotifyBanner({ notes, onGo }: { notes: readonly NoteItem[] | undefined; onGo: (link: NotifyLink) => void }) {
  const [shown, setShown] = useState<NoteItem[]>([])
  // 켜기 전에 와 있던 것은 안 띄운다 — 보관함에 있다
  const sinceRef = useRef(Date.now())
  const timers = useRef(new Map<string, number>())

  useEffect(() => {
    const fresh = freshNotes(notes ?? [], sinceRef.current)
    if (fresh.length === 0) return
    sinceRef.current = Math.max(sinceRef.current, ...fresh.map((n) => n.atMs))
    setShown((s) => stack(s, fresh))
    if (fresh.some(isBig)) {
      chime()
      try {
        navigator.vibrate?.([80, 60, 80])
      } catch {
        /* 진동이 없는 기기 */
      }
    }
  }, [notes])

  // 3초 뒤 저절로 — 줄마다 따로 잰다
  useEffect(() => {
    for (const n of shown) {
      if (timers.current.has(n.id + n.atMs)) continue
      const t = window.setTimeout(() => {
        setShown((s) => s.filter((x) => !(x.id === n.id && x.atMs === n.atMs)))
        timers.current.delete(n.id + n.atMs)
      }, BANNER_MS)
      timers.current.set(n.id + n.atMs, t)
    }
  }, [shown])
  useEffect(() => {
    const all = timers.current
    return () => all.forEach((t) => window.clearTimeout(t))
  }, [])

  const close = (n: NoteItem) => setShown((s) => s.filter((x) => x !== n))
  const startY = useRef<number | null>(null)

  if (shown.length === 0) return null
  return (
    <div className="sc-ntb" aria-live="polite">
      {shown.map((n) => (
        <button
          key={n.id + n.atMs}
          className={'sc-ntb__one' + (isBig(n) ? ' is-big' : '')}
          onClick={() => {
            close(n)
            onGo(n.link)
          }}
          onPointerDown={(e) => (startY.current = e.clientY)}
          onPointerUp={(e) => {
            if (startY.current !== null && startY.current - e.clientY > SWIPE_PX) {
              e.preventDefault()
              close(n)
            }
            startY.current = null
          }}
        >
          <i className="sc-ntb__dot" aria-hidden="true" />
          <span className="sc-ntb__text">{n.text}</span>
          <time className="sc-ntb__at">{hhmm(n.atMs)}</time>
        </button>
      ))}
    </div>
  )
}
