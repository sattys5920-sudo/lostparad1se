// 판정 팝업 — 운영자가 보낸 그날의 내 미션 결과 한 장.
//
// **우편함(inbox)에서만 읽는다.** 남의 것은 거기 없다 — 서버가 본인
// 우편함에 본인 몫(view)만 적는다(functions/src/missionDays.ts).
//
// 두 군데가 같은 종이를 띄운다.
//   - Play.tsx 의 MissionMailbox — 아직 안 닫은 날이 있으면 어느 탭에서든
//     뜬다. 오래된 날부터 한 장씩. 닫으면 서버에 「봤다」를 적는다
//   - 「나」 탭의 지난 판정 — 누르면 다시 띄운다. 「봤다」는 안 건드린다
import { useEffect, useLayoutEffect, useRef, useState, type TouchEvent } from 'react'

import { STATUS_LABEL } from '../../../shared/missions/roleNames'
import type { DayClauseView, DayStatus } from '../../../shared/missions/daily'
import type { InboxDoc, MissionMail } from '../../../shared/missions/mail'
import { Snow } from '../reveal/Snow'
import { motionOff } from './Controls'
import { PaperSheet } from './Paper'
import './missionPopup.css'

// ── 셈 ──────────────────────────────────────────────────────────

/** 결과 한 마디. 종이 한가운데 크게 찍힌다 */
export const RESULT_WORD: Record<DayStatus, string> = {
  met: '해냈다',
  running: '아직이다',
  failed: '끝났다',
  endOnly: '아직 모른다',
}

export const resultWord = (s: DayStatus): string => RESULT_WORD[s] ?? RESULT_WORD.running

/** 우편함의 날 열쇠. 서버가 d1 · d2 … 로 적는다 */
export const dayKey = (day: number): string => `d${day}`

/**
 * 받은 판정 전부, 날짜순.
 *
 * 열쇠가 아니라 **안에 적힌 day** 로 줄 세운다 — 「d10」이 「d2」보다
 * 앞에 서면 안 된다.
 */
export function receivedMails(inbox: InboxDoc | null | undefined): MissionMail[] {
  const all = Object.values(inbox?.missions ?? {}).filter(
    (m): m is MissionMail => !!m && typeof m.day === 'number',
  )
  return all.sort((a, b) => a.day - b.day)
}

/** 아직 안 닫은 날. 오래된 날부터 */
export function unseenMails(inbox: InboxDoc | null | undefined): MissionMail[] {
  const seen = inbox?.seen ?? {}
  return receivedMails(inbox).filter((m) => seen[dayKey(m.day)] !== true)
}

/**
 * 한 장을 가르는 열쇠. **보낸 시각까지 넣는다** — 운영자가 다시 보내면
 * 같은 날이라도 새 종이다. 전에 닫았어도 다시 떠야 한다.
 */
export const mailKey = (m: MissionMail): string => `${dayKey(m.day)}@${m.sentAtMs}`

/** 마지막 날 판정이 왔는가. 오면 나흘 표를 편다 */
export function finalMail(inbox: InboxDoc | null | undefined): MissionMail | null {
  return receivedMails(inbox).find((m) => m.final) ?? null
}

/** 조항 한 줄의 숫자. **숫자가 안 온 줄은 「—」** — 가린 것이 아니라 안 온 것이다 */
export function amountText(c: Pick<DayClauseView, 'have' | 'bar' | 'unit'>): string {
  if (c.have === null) return '—'
  if (c.unit === 'flag') return c.have >= Math.max(1, c.bar) ? '했다' : '아직'
  return `${c.have}/${c.bar}${c.unit === 'minutes' ? '분' : ''}`
}

/** 보낸 시각. 월/일 시:분 */
export function sentText(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// ── 우편함 ──────────────────────────────────────────────────────

/**
 * 아직 안 닫은 판정을 한 장씩 띄운다. Play.tsx 가 탭 바깥에 세운다.
 *
 * 닫으면 **여기서 먼저 치운다** — 서버에 「봤다」를 적는 것은 던져만
 * 두고 기다리지 않는다. 기다리면 한 박자 늦게 사라지고, 실패하면 못
 * 닫는다.
 */
export function MissionMailbox({
  inbox,
  act,
}: {
  inbox: InboxDoc | null
  act: { seenMissionDay: (day: number) => Promise<unknown> }
}) {
  const [shut, setShut] = useState<ReadonlySet<string>>(() => new Set())
  const next = unseenMails(inbox).find((m) => !shut.has(mailKey(m)))
  if (!next) return null
  const key = mailKey(next)
  return (
    <MissionPopup
      key={key}
      mail={next}
      onClose={() => {
        setShut((s) => new Set(s).add(key))
        void act.seenMissionDay(next.day).catch(() => undefined)
      }}
    />
  )
}

// ── 종이 한 장 ─────────────────────────────────────────────────

/** 결과 한 마디가 찍히기 시작하는 때. 종이가 다 올라온 뒤다 */
const TYPE_AFTER_MS = 400
const TYPE_MS = 110
/** 이만큼 아래로 쓸면 닫는다 */
const SWIPE_PX = 80

export function MissionPopup({ mail, onClose }: { mail: MissionMail; onClose: () => void }) {
  // 연출 줄이기(앱 · 기기)가 켜져 있으면 처음부터 끝 모습이다
  const [still] = useState(motionOff)
  const word = resultWord(mail.status)
  const [typed, setTyped] = useState(still ? word.length : 0)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const sheetRef = useRef<HTMLElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const touch = useRef<{ y: number; top: boolean } | null>(null)

  useEffect(() => {
    if (still || typed >= word.length) return
    const t = window.setTimeout(() => setTyped((n) => n + 1), typed === 0 ? TYPE_AFTER_MS : TYPE_MS)
    return () => window.clearTimeout(t)
  }, [still, typed, word.length])

  // 열리면 닫기 단추에 손을 둔다. Esc 로도 닫힌다
  const closeFn = useRef(onClose)
  useEffect(() => {
    closeFn.current = onClose
  }, [onClose])
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true })
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeFn.current()
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [])

  /*
   * **종이를 온 화소에 세운다.** 가운데 맞춤이면 0.5px 에 서기 쉬운데,
   * 그러면 모서리 조각과 평면 사이에 한 줄 틈이 벌어져 뒤의 어둠이
   * 비친다(375 폭에서 340 짜리 종이가 17.5px 에 섰다). 잰 만큼 되민다.
   */
  useLayoutEffect(() => {
    const el = sheetRef.current
    if (!el) return
    const snap = () => {
      el.style.left = ''
      el.style.top = ''
      // 떠오르는 걸음(36 · 24 · 12 · 0)도 끌어내리기도 온 화소라 소수 자리는 그대로다
      const r = el.getBoundingClientRect()
      const fx = r.left - Math.floor(r.left)
      const fy = r.top - Math.floor(r.top)
      if (fx > 0.01) el.style.left = `${-fx}px`
      if (fy > 0.01) el.style.top = `${-fy}px`
    }
    snap()
    addEventListener('resize', snap)
    return () => removeEventListener('resize', snap)
  }, [])

  const done = typed >= word.length
  const titleId = `sc-jd-${mail.day}`

  /*
   * 아래로 쓸어 닫기. **터치 이벤트로 잰다** — 포인터를 붙잡으면 닫기
   * 단추의 누름이 종이로 넘어가 안 눌린다. 안이 굴러 내려가 있으면
   * 쓸어도 안 닫는다 — 그건 위로 굴리는 손짓이다.
   */
  const onTouchStart = (e: TouchEvent) => {
    touch.current = { y: e.touches[0].clientY, top: (bodyRef.current?.scrollTop ?? 0) <= 0 }
  }
  const onTouchMove = (e: TouchEvent) => {
    const t = touch.current
    const el = sheetRef.current
    if (!t || !t.top || !el || still) return
    const dy = e.touches[0].clientY - t.y
    el.style.transform = dy > 0 ? `translateY(${Math.round(dy / 4) * 4}px)` : ''
  }
  const onTouchEnd = (e: TouchEvent) => {
    const t = touch.current
    touch.current = null
    if (sheetRef.current) sheetRef.current.style.transform = ''
    if (!t || !t.top) return
    const dy = (e.changedTouches[0]?.clientY ?? t.y) - t.y
    if (dy > SWIPE_PX) onClose()
  }

  return (
    <div className={'sc-jd' + (still ? ' is-still' : '')} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <Snow level={2} />
      {/* 종이 밖은 전부 닫기 자리다 */}
      <button type="button" className="sc-jd__back" aria-label="닫기" tabIndex={-1} onClick={onClose} />
      <section
        ref={sheetRef}
        className={`sc-jd__sheet is-${mail.status}` + (done ? ' is-done' : '')}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        <PaperSheet cls="sc-mi" />
        <span className="sc-jd__frame" aria-hidden />
        <div className="sc-jd__in" ref={bodyRef}>
          <p className="sc-jd__day">DAY {mail.day}</p>
          <p className="sc-jd__role">{mail.roleName}</p>
          <h2 id={titleId} className="sc-jd__word" aria-label={`DAY ${mail.day} ${word}`}>
            <span aria-hidden>{word.slice(0, typed)}</span>
            {/* 자리를 미리 잡아 둔다 — 글자가 찍히는 동안 아래 줄이 안 밀린다 */}
            <span className="sc-jd__ghost" aria-hidden>
              {word.slice(typed)}
            </span>
          </h2>

          <Lines rows={mail.clauses} />

          {mail.final && (
            <p className="sc-jd__choice">
              <span>마지막 선택</span>
              <b className={`is-${mail.choice}`}>{STATUS_LABEL[mail.choice]}</b>
            </p>
          )}

          <p className="sc-jd__line">{mail.line}</p>

          <button type="button" ref={closeRef} className="sc-jd__close" onClick={onClose}>
            닫기
          </button>
        </div>
      </section>
    </div>
  )
}

function Lines({ rows }: { rows: readonly DayClauseView[] }) {
  return (
    <ul className="sc-jd__lines">
      {rows.map((c, i) => (
        <li key={`${i}-${c.text}`}>
          <p>{c.text}</p>
          <span className="sc-jd__have">{amountText(c)}</span>
          <span className={`sc-jd__st is-${c.status}`}>{STATUS_LABEL[c.status]}</span>
        </li>
      ))}
    </ul>
  )
}
