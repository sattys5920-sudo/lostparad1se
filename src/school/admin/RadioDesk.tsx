// 운영자 — 무전 엿듣기. 네 팀 무전과 전원 채널을 다 본다.
//
//   목록   채널 다섯이 한 줄씩 — 줄 수 · 켜 둔 사람 · 마지막 한 줄
//   채널   누르면 그 채널로 들어간다. 몇 초마다 새 줄만 받아 아래에 붙인다 —
//          참가자 화면이 무전을 받는 것과 같은 방식이라 거의 실시간이다
//
// **운영자만.** 서버가 운영자 표시를 보고 준다(hostRadioOverview · hostRadioLines).
// 채팅 내용은 어떤 판정에도 안 쓴다 — 여기는 보기만 하는 자리다.
import { useCallback, useEffect, useRef, useState } from 'react'

import type { GameActions } from '../game/useGame'
import { teamName } from '../../../shared/rules/bundan'

type Channel = 'A' | 'B' | 'C' | 'D' | 'ALL'

interface Overview {
  channel: Channel
  lines: number
  last: { name: string; text: string; atMs: number; system: boolean } | null
  members: number
  here: number
}

interface Line {
  playerId: string
  name: string
  team: Channel
  atMs: number
  text: string
  hidden: boolean
  system: boolean
}

/** 목록을 다시 읽는 간격 · 채널 안에서 새 줄을 받는 간격 */
const LIST_MS = 5000
const LIVE_MS = 2000

const CHANNEL_NAME: Record<Channel, string> = { A: `${teamName('A')} 무전`, B: `${teamName('B')} 무전`, C: `${teamName('C')} 무전`, D: `${teamName('D')} 무전`, ALL: '전원 채널' }

function hhmm(ms: number): string {
  const f = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(ms))
  return `${f.find((p) => p.type === 'hour')?.value ?? ''}:${f.find((p) => p.type === 'minute')?.value ?? ''}`
}

export function RadioDesk({ act, onSaid }: { act: GameActions; onSaid: (t: string) => void }) {
  const [list, setList] = useState<Overview[] | null>(null)
  /** 전원 채널이 열려 있는가. 목록과 같이 온다 */
  const [allOpen, setAllOpen] = useState(true)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<Channel | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const sinceRef = useRef(0)
  const boxRef = useRef<HTMLOListElement | null>(null)

  const loadList = useCallback(async () => {
    try {
      const out = (await act.hostRadioOverview()) as { channels: Overview[]; allOpen?: boolean }
      setList(out.channels)
      setAllOpen(out.allOpen !== false)
    } catch (e) {
      onSaid((e as Error).message)
    }
  }, [act, onSaid])

  // 목록 — 채널 안에 들어가 있지 않을 때만 돈다
  useEffect(() => {
    if (open) return
    void loadList()
    const t = window.setInterval(() => void loadList(), LIST_MS)
    return () => window.clearInterval(t)
  }, [open, loadList])

  // 채널 — 들어가면 처음부터 받고, 그다음은 새 줄만
  useEffect(() => {
    if (!open) return
    let alive = true
    sinceRef.current = 0
    setLines([])
    const pull = async () => {
      try {
        const out = (await act.hostRadioLines(open, sinceRef.current)) as { lines: Line[] }
        if (!alive || out.lines.length === 0) return
        sinceRef.current = out.lines[out.lines.length - 1].atMs
        setLines((had) => [...had, ...out.lines])
      } catch (e) {
        if (alive) onSaid((e as Error).message)
      }
    }
    void pull()
    const t = window.setInterval(() => void pull(), LIVE_MS)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [open, act, onSaid])

  // 새 줄이 오면 맨 아래로
  useEffect(() => {
    const el = boxRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  if (open) {
    return (
      <div className="sc-rk">
        <div className="sc-rk__bar">
          <button className="sc-rk__back" onClick={() => setOpen(null)}>
            ‹ 목록
          </button>
          <b className={`sc-rk__name is-${open}`}>{CHANNEL_NAME[open]}</b>
          <span className="sc-rk__live" aria-label="실시간">
            실시간
          </span>
        </div>
        {lines.length === 0 ? (
          <p className="sc-rk__empty">아직 아무도 말하지 않았다</p>
        ) : (
          <ol className="sc-rk__log" ref={boxRef}>
            {lines.map((l, i) => (
              <li key={`${l.atMs}-${i}`} className={l.system ? 'is-sys' : ''}>
                <time>{hhmm(l.atMs)}</time>
                {!l.system && (
                  <b className={`is-${l.team === 'ALL' ? 'all' : l.team}`}>
                    {l.name || '이름 없음'}
                    {l.hidden ? ' · 안 보임' : ''}
                  </b>
                )}
                <span>{l.text}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    )
  }

  if (!list) return <p className="sc-ad__hint">무전을 읽는 중이다.</p>

  const toggleAll = async () => {
    setBusy(true)
    try {
      await act.hostSetAllChannel(!allOpen)
      setAllOpen(!allOpen)
      onSaid(allOpen ? '전원 채널을 닫았다.' : '전원 채널을 열었다.')
      void loadList()
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
    <div className="sc-rk__gate">
      <span>
        전원 채널 <b className={allOpen ? 'is-open' : 'is-shut'}>{allOpen ? '열림' : '닫힘'}</b>
      </span>
      <button disabled={busy} onClick={() => void toggleAll()}>
        {allOpen ? '닫기' : '열기'}
      </button>
    </div>
    <ul className="sc-rk__list">
      {list.map((c) => (
        <li key={c.channel}>
          <button className="sc-rk__row" onClick={() => setOpen(c.channel)}>
            <span className={`sc-rk__dot is-${c.channel}`} aria-hidden="true" />
            <span className="sc-rk__main">
              <span className="sc-rk__title">
                {CHANNEL_NAME[c.channel]} <em>{c.lines}줄</em>
              </span>
              <span className="sc-rk__last">
                {c.last ? `${hhmm(c.last.atMs)} ${c.last.name ? `${c.last.name}: ` : ''}${c.last.text}` : '아직 아무도 말하지 않았다'}
              </span>
            </span>
            <span className="sc-rk__here" title="지금 무전을 켜 둔 사람">
              {c.here}/{c.members}
            </span>
            <span aria-hidden="true">›</span>
          </button>
        </li>
      ))}
    </ul>
    </>
  )
}
