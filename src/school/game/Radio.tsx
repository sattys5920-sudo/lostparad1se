// 무전 — 주파수 하나에 팀 넷.
//
// **분위기보다 읽히는 것이 먼저다.** 작전을 짜는 자리라 누가 무슨
// 말을 했는지가 한눈에 갈려야 한다. 그래서 이름은 강조색으로 굵게
// 세우고, 시각은 뒤로 물리고, 본문은 어두운 바탕 위에서 충분히 밝게
// 둔다. 노이즈는 위 상태 바에만 있고 글자 위로는 안 온다.
//
// **대화는 어떤 판정에도 쓰이지 않는다.** 판이 적는 시스템 줄도
// 마찬가지다 — 이미 그 팀이 아는 것을 한 줄로 옮겨 적을 뿐이다.
import { useCallback, useEffect, useRef, useState } from 'react'

import { secondsIntoSeoulDay } from '../../../shared/rules/clock'
import { CHAT_MAX_LEN } from '../../../shared/rules/v2'
import {
  RADIO_NOTE,
  TEAM_FREQ,
  WAVE_BARS,
  WAVE_MAX,
  stampOf,
  waveAt,
} from '../../../shared/rules/radio'
import type { TeamId } from '../types'
import { CHAT_POLL_MS } from './timing'
import type { GameActions } from './useGame'
import './radio.css'

export interface RadioLine {
  playerId: string
  name: string
  team: string
  atMs: number
  text: string
  /** 칠 때 지워져 있었다. 이름 옆에 「안 보임」이 붙는다 */
  hidden: boolean
  /** 판이 적은 줄 */
  system: boolean
}

/** 새 줄이 왔을 때 파형이 크게 튀는 시간. */
const SPIKE_MS = 500
/** 파형이 한 걸음 가는 데 걸리는 시간. 초당 여덟 번이다 */
const WAVE_STEP_MS = 125

/**
 * 수신 상태 바의 파형.
 *
 * React 로 그리지 않는다 — 초당 여덟 번 열세 칸을 다시 그리면 그때마다
 * 목록까지 새로 그려진다. 막대 높이만 직접 만진다.
 *
 * **화면이 안 보이면 멈춘다.** 주머니 속에서 도는 애니메이션만큼
 * 배터리를 헛되게 쓰는 것이 없다.
 */
function Wave({ connected, spikeAt, on }: { connected: number; spikeAt: number; on: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const state = useRef({ connected, spikeAt })
  state.current = { connected, spikeAt }

  useEffect(() => {
    const host = ref.current
    if (!host) return
    const bars = [...host.children] as HTMLElement[]
    const flat = () => {
      for (const b of bars) b.style.height = '1px'
    }
    if (!on) {
      flat()
      return
    }

    let frame = 0
    let timer = 0
    const tick = () => {
      const { connected: n, spikeAt: at } = state.current
      const spiking = Date.now() - at < SPIKE_MS
      for (const [i, b] of bars.entries()) b.style.height = `${waveAt(i, frame, n, spiking)}px`
      frame += 1
    }
    const start = () => {
      if (timer) return
      tick()
      timer = window.setInterval(tick, WAVE_STEP_MS)
    }
    const stop = () => {
      window.clearInterval(timer)
      timer = 0
    }
    const onVisible = () => (document.visibilityState === 'visible' ? start() : stop())
    document.addEventListener('visibilitychange', onVisible)
    onVisible()
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      stop()
      flat()
    }
  }, [on])

  return (
    <div className="sc-rd__wave" aria-hidden="true" ref={ref} style={{ height: WAVE_MAX }}>
      {Array.from({ length: WAVE_BARS }, (_, i) => (
        <span key={i} />
      ))}
    </div>
  )
}

export interface RadioProps {
  me: { playerId: string; team: TeamId; name: string }
  act: GameActions
  onSaid: (text: string) => void
  /** 열린 페이즈가 시작한 시각. 자유 시간이면 null */
  phaseOpenedAtMs: number | null
  /** 지금 이 탭을 보고 있는가. 아니면 파형을 멈추고 안 읽은 수를 센다 */
  active: boolean
  onUnread: (n: number) => void
}

export function Radio({
  me,
  act,
  onSaid,
  phaseOpenedAtMs,
  active,
  onUnread,
}: RadioProps) {
  const [lines, setLines] = useState<RadioLine[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [spikeAt, setSpikeAt] = useState(0)
  /**
   * 지금 무전을 켜 둔 팀원 수. **나는 안 센다** — 내가 말하면 들을
   * 사람 수다. 서버가 세어 준다(무전을 가져가는 일 자체가 맥이다).
   */
  const [here, setHere] = useState(0)
  /** 위로 올려 읽는 중에 쌓인 줄 수 */
  const [behind, setBehind] = useState(0)
  const sinceRef = useRef(0)
  const pullingRef = useRef(false)
  const logRef = useRef<HTMLDivElement>(null)
  /** 맨 아래에 붙어 있는가. 붙어 있을 때만 따라 내려간다 */
  const stuckRef = useRef(true)

  const toBottom = useCallback((smooth = false) => {
    const el = logRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    stuckRef.current = true
    setBehind(0)
  }, [])

  const pull = useCallback(async () => {
    // 보내고 나서 바로 한 번, 그리고 주기적으로 한 번. 둘이 겹치면
    // 같은 줄을 두 번 붙인다 — 먼저 들어온 쪽이 끝날 때까지 기다린다
    if (pullingRef.current) return
    pullingRef.current = true
    try {
      const res = (await act.radioLines(sinceRef.current)) as { lines?: RadioLine[]; here?: number }
      setHere(Math.max(0, Math.floor(res.here ?? 0)))
      const fresh = res.lines ?? []
      if (fresh.length === 0) return
      sinceRef.current = Math.max(sinceRef.current, ...fresh.map((l) => l.atMs))
      setLines((old) => [...old, ...fresh])
      setSpikeAt(Date.now())
      if (!stuckRef.current) setBehind((n) => n + fresh.length)
    } catch {
      // 잠깐 끊긴 것뿐이다. 다음 번에 다시 가져온다
    } finally {
      pullingRef.current = false
    }
  }, [act])

  useEffect(() => {
    void pull()
    const t = setInterval(() => void pull(), CHAT_POLL_MS)
    return () => clearInterval(t)
  }, [pull])

  // 맨 아래에 붙어 있을 때만 따라 내려간다. 올려 읽는 중이면 안 건드린다
  useEffect(() => {
    if (stuckRef.current) toBottom()
  }, [lines.length, toBottom])

  /**
   * 안 읽은 줄이 몇인가. 탭 그림 모서리의 점이 이것을 본다.
   *
   * **읽은 자리를 기억한다.** 「이 효과가 몇 번 돌았나」를 세면 줄이
   * 한 줄 왔는데 셋이 왔다고 하거나, 들어오자마자 점이 찍힌다.
   */
  const readTo = useRef(0)
  useEffect(() => {
    if (active) {
      readTo.current = lines.length
      onUnread(0)
      return
    }
    onUnread(Math.max(0, lines.length - readTo.current))
  }, [lines.length, active, onUnread])

  function onScroll() {
    const el = logRef.current
    if (!el) return
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight
    stuckRef.current = gap < 24
    if (stuckRef.current) setBehind(0)
  }

  async function send() {
    const text = draft.trim()
    if (!text) return
    setBusy(true)
    try {
      await act.radio(text)
      setDraft('')
      stuckRef.current = true
      await pull()
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sc-rd">
      {/* ── 수신 상태 ───────────────────────────────────── */}
      <header className="sc-rd__top">
        <div className="sc-rd__row">
          <span className="sc-rd__freq">
            <b>{TEAM_FREQ[me.team]}</b> MHz · {me.team}팀
          </span>
          <span className={`sc-rd__conn${here > 0 ? ' is-on' : ''}`}>
            {here > 0 ? `수신 ${here}` : '수신 없음'}
          </span>
        </div>
        <Wave connected={here} spikeAt={spikeAt} on={active} />
      </header>

      {/* ── 오간 말 ─────────────────────────────────────── */}
      <div className="sc-rd__log" ref={logRef} onScroll={onScroll}>
        {lines.length === 0 && <p className="sc-rd__none">오늘 오간 무전이 없다.</p>}
        <ul>
          {lines.map((l, i) => {
            if (l.system) {
              return (
                <li key={`${l.atMs}-s-${i}`} className="sc-rd__sys">
                  <span>{l.text}</span>
                </li>
              )
            }
            // 같은 사람이 잇달아 말하면 이름을 지운다. 읽는 눈이
            // 같은 이름을 세 번 지나가지 않아도 된다
            const prev = lines[i - 1]
            const run = prev !== undefined && !prev.system && prev.playerId === l.playerId
            const inPhase = phaseOpenedAtMs !== null && l.atMs >= phaseOpenedAtMs
            return (
              <li
                key={`${l.atMs}-${l.playerId}-${i}`}
                className={[
                  'sc-rd__line',
                  run ? 'is-run' : '',
                  l.playerId === me.playerId ? 'is-me' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span className="sc-rd__at">
                  {stampOf(l.atMs, inPhase ? phaseOpenedAtMs : null, secondsIntoSeoulDay(l.atMs))}
                </span>
                {run ? (
                  <span className="sc-rd__who" aria-hidden="true" />
                ) : (
                  <span className="sc-rd__who" title={l.name}>
                    {l.name}
                    {/* 칠 때 지워져 있었다. 오늘 판정에서 빠진 사람이라,
                        셋이 넷인 줄 알고 방을 나누면 그날 작전이 통째로
                        어긋난다 — 무전은 막지 않는 대신 이것을 붙인다 */}
                    {l.hidden && <i>안 보임</i>}
                  </span>
                )}
                <span className="sc-rd__text">{l.text}</span>
              </li>
            )
          })}
        </ul>
      </div>

      {behind > 0 && (
        <button className="sc-rd__behind" onClick={() => toBottom(true)}>
          새 메시지 {behind}
        </button>
      )}

      {/* ── 송신 ────────────────────────────────────────── */}
      <div className="sc-rd__bar">
        <input
          id="rd-say"
          value={draft}
          maxLength={CHAT_MAX_LEN}
          placeholder="송신…"
          enterKeyHint="send"
          onFocus={() => setTimeout(() => toBottom(), 300)}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void send()
          }}
        />
        {/*
          누를 때 적던 칸에서 손을 떼지 않는다. 떼면 탭바가 도로
          올라오면서 단추가 뛰고, 그 사이에 손을 뗀 자리에는 단추가
          없다 — 누른 것이 눌리지 않는다
        */}
        <button
          className="sc-rd__send"
          aria-label="송신"
          disabled={busy || draft.trim().length === 0}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void send()}
        >
          ▲
        </button>
      </div>
      <p className="sc-rd__note">{RADIO_NOTE}</p>
    </div>
  )
}
