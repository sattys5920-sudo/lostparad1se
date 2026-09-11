// 운영자 도구 — 추리 지도 · 공지 · 텍스트 검수.
//
// 전부 서버가 인증을 확인한 뒤 내려보낸 것만 그린다. 이 화면에는
// 게임 상태를 바꾸는 버튼이 없다. 투명인간 해제 같은 것은 기존 운영자
// 도구로만 한다.
//
// 여기 없는 것 둘을 다시 적어 둔다. **표를 보낸 사람**과 **남의 추리
// 노트.** 서버가 담지 않으므로 화면이 그릴 수도 없다.
import { useState } from 'react'
import './reveal.css'
import { ROLE_NAMES, type RoleId } from '../../../shared/missions/roleNames'
import {
  checkNotice,
  NOTICE_REFUSAL_MESSAGE,
  NOTICE_MAX,
  NOTICE_TEMPLATES,
} from '../../../shared/reveal/notice'
import type { DashboardRow, LinkStatus, SuspicionRow } from '../../../shared/reveal/dashboard'

type HostTab = 'map' | 'notice' | 'audit'

const TABS: { id: HostTab; label: string }[] = [
  { id: 'map', label: '추리 지도' },
  { id: 'notice', label: '공지' },
  { id: 'audit', label: '텍스트 검수' },
]

export interface AuditRow {
  source: string
  where: string
  text: string
  tag: string | null
  places: string[]
}

export interface HostToolsProps {
  rules: readonly string[]
  rows: readonly DashboardRow[]
  links: readonly LinkStatus[]
  suspicion: readonly SuspicionRow[]
  audit: readonly AuditRow[]
  timeLabels: Record<string, string>
  sourceLabels: Record<string, string>
  /** 공지 보낼 상대를 고르는 목록. */
  players: readonly { id: string; name: string }[]
  onNotice: (text: string, toPlayerId: string | null) => void
}

const scopeLabel = (s: string) => (s === 'class' ? '전체' : '1:1')

function timeOf(atMs: number): string {
  const d = new Date(atMs)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function HostTools(props: HostToolsProps) {
  const [tab, setTab] = useState<HostTab>('map')

  return (
    <div className="sc-ho">
      {/* 운영자 수칙. 맨 위에 고정한다 */}
      <ul className="sc-ho__rules">
        {props.rules.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>

      <nav className="sc-ho__tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`sc-ho__tab ${tab === t.id ? 'is-on' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'map' && (
        <>
          <div className="sc-ho__scroll">
            <table className="sc-ho__table">
              <thead>
                <tr>
                  <th>이름</th>
                  <th>역할</th>
                  <th>가리켜진 날</th>
                  <th>털어놓기</th>
                  <th>적중 의심</th>
                  <th>투명인간</th>
                  <th>깨달음</th>
                  <th>공개 가능성</th>
                </tr>
              </thead>
              <tbody>
                {props.rows.map((r) => (
                  <tr key={r.playerId}>
                    <td>{r.name}</td>
                    <td>{ROLE_NAMES[r.role as RoleId]}</td>
                    <td>{r.hintDay ? `DAY ${r.hintDay}` : '—'}</td>
                    <td>
                      {r.reveal
                        ? `${scopeLabel(r.reveal.scope)} · ${timeOf(r.reveal.atMs)} · ${r.reveal.listeners}명`
                        : '—'}
                    </td>
                    <td className="sc-ho__num">{r.exactHits}</td>
                    <td>{r.invisibleDays.length > 0 ? r.invisibleDays.map((d) => `D${d}`).join(' ') : '—'}</td>
                    <td>{r.awakened ? '○' : '—'}</td>
                    <td className="sc-ho__dim">{r.exposure === 'onlyByOwnReveal' ? '본인 고백으로만' : r.exposure === 'byDeduction' ? '추리로 가능' : '가능'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* 표가 화면보다 넓다. 잘린 칸이 있다는 걸 알려 준다 */}
          <p className="sc-ho__hint">옆으로 밀면 나머지 칸</p>

          <h2 className="sc-ho__h2">연결 단서</h2>
          <ul className="sc-ho__links">
            {props.links.map((l) => (
              <li key={l.id} className={l.connectable ? 'is-open' : ''}>
                <span className={l.leftOpen ? 'is-on' : ''}>{l.leftLabel}</span>
                <span className="sc-ho__plus">+</span>
                <span className={l.rightOpen ? 'is-on' : ''}>{l.rightLabel}</span>
                <span className="sc-ho__arrow">→</span>
                <span className="sc-ho__conclusion">
                  {l.connectable ? l.conclusion : '아직 이을 수 없다'}
                </span>
              </li>
            ))}
          </ul>

          <h2 className="sc-ho__h2">
            받은 의심표 <span className="sc-ho__dim">· 사람별 합계. 보낸 사람은 보이지 않는다</span>
          </h2>
          <ul className="sc-ho__susp">
            {props.suspicion.map((s) => (
              <li key={s.playerId}>
                <span>{s.name}</span>
                <span className="sc-ho__num">{s.received}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {tab === 'notice' && <NoticeForm players={props.players} onSend={props.onNotice} />}

      {tab === 'audit' && (
        <AuditList rows={props.audit} timeLabels={props.timeLabels} sourceLabels={props.sourceLabels} />
      )}
    </div>
  )
}

function NoticeForm({
  players,
  onSend,
}: {
  players: readonly { id: string; name: string }[]
  onSend: (text: string, to: string | null) => void
}) {
  const [text, setText] = useState('')
  const [to, setTo] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState('')

  function send() {
    const out = checkNotice(text)
    if (!out.ok) {
      setError(NOTICE_REFUSAL_MESSAGE[out.reason as 'empty'])
      return
    }
    setError('')
    onSend(text.trim(), to || null)
    setSent(to ? `${players.find((p) => p.id === to)?.name ?? to}에게 보냈다.` : '전원에게 보냈다.')
    setText('')
    setTimeout(() => setSent(''), 2200)
  }

  return (
    <div className="sc-ho__notice">
      <div className="sc-ho__templates">
        {NOTICE_TEMPLATES.map((t) => (
          <button key={t.id} onClick={() => setText(t.text)}>
            {t.label}
          </button>
        ))}
      </div>

      <label className="sc-ho__field">
        <span>받는 사람</span>
        <select value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">전원</option>
          {players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <textarea
        rows={3}
        maxLength={NOTICE_MAX}
        value={text}
        placeholder="보낼 말"
        onChange={(e) => setText(e.target.value)}
      />
      <div className="sc-ho__send-row">
        {error && <span className="sc-ho__error">{error}</span>}
        {sent && <span className="sc-ho__sent">{sent}</span>}
        <button onClick={send} disabled={!text.trim()}>
          보내기
        </button>
      </div>
    </div>
  )
}

/** 장소를 굵게. 같은 장소가 다른 시각에 나오면 눈에 띈다. */
function Highlighted({ text, places }: { text: string; places: string[] }) {
  if (places.length === 0) return <>{text}</>
  const re = new RegExp(`(${places.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g')
  return (
    <>
      {text.split(re).map((part, i) =>
        places.includes(part) ? (
          <mark key={i} className="sc-ho__place">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  )
}

function AuditList({
  rows,
  timeLabels,
  sourceLabels,
}: {
  rows: readonly AuditRow[]
  timeLabels: Record<string, string>
  sourceLabels: Record<string, string>
}) {
  const missing = rows.filter((r) => r.tag === null)
  return (
    <div className="sc-ho__audit">
      {missing.length > 0 && (
        <p className="sc-ho__warn">시간 태그가 없는 문장 {missing.length}줄. 맨 위에 있다.</p>
      )}
      <ul>
        {rows.map((r, i) => (
          <li key={i} className={r.tag === null ? 'is-untagged' : ''}>
            <span className="sc-ho__tag">{r.tag ? (timeLabels[r.tag] ?? r.tag) : '태그 없음'}</span>
            <span className="sc-ho__src">
              {sourceLabels[r.source] ?? r.source} · {r.where}
            </span>
            <p>
              <Highlighted text={r.text} places={r.places} />
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}
