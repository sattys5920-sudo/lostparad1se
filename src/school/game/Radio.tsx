// 무전 — 주파수 하나에 팀 넷.
//
// **분위기보다 읽히는 것이 먼저다.** 작전을 짜는 자리라 누가 무슨
// 말을 했는지가 한눈에 갈려야 한다. 그래서 이름은 강조색으로 굵게
// 세우고, 시각은 뒤로 물리고, 본문은 어두운 바탕 위에서 충분히 밝게
// 둔다. 노이즈는 위 상태 바에만 있고 글자 위로는 안 온다.
//
// **대화는 어떤 판정에도 쓰이지 않는다.** 판이 적는 시스템 줄도
// 마찬가지다 — 이미 그 팀이 아는 것을 한 줄로 옮겨 적을 뿐이다.
//
// **입력줄은 키보드 위에 앉는다.** 전에는 목록 아래 흐름 안에 있어서
// 키보드가 올라오면 그 뒤에 숨었다 — 무엇을 치는지 안 보이는 채로 쳤다.
// 지금은 맵 탭 말줄과 같은 훅(useKeyboardInset)이 적는 --kb 를 따라
// 떠 있고, 목록은 그만큼 줄면서 맨 아래에 붙어 있는다.
//
// **채널은 둘이다.** 우리 팀 무전과 열넷이 다 듣는 전원 채널. 맵 위
// 말풍선은 가까이 선 사람끼리만 닿고 금방 사라져서 판 전체가 이야기할
// 자리가 못 된다 — 그 자리가 전원 채널이다. 위 띠에서 고른다. 안 보는
// 쪽 채널도 가끔 확인해서 새 줄이 있으면 띠에 점을 찍는다.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { secondsIntoSeoulDay } from '../../../shared/rules/clock'
import { CHAT_MAX_LEN } from '../../../shared/rules/v2'
import {
  ALL_FREQ,
  ALL_NOTE,
  ALL_MUTE,
  ALL_SHUT,
  RADIO_NOTE,
  TEAM_FREQ,
  WAVE_BARS,
  WAVE_MAX,
  stampOf,
  waveAt,
} from '../../../shared/rules/radio'
import type { TeamId } from '../types'
import { buzz } from './Controls'
import { TEAM_COLOR } from './MapPlan'
import { CHAT_POLL_MS } from './timing'
import type { GameActions } from './useGame'
import { useKeyboardInset } from './useKeyboardInset'
import { useOutbox, useSendBox, type Outgoing } from './useOutbox'
import { insertMention, mentionPicks, mentionQuery } from './mention'
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

export type RadioChannel = 'team' | 'all'

/** 안 보는 채널을 확인하는 간격. 보는 채널보다 느슨하게 */
const OTHER_POLL_MS = CHAT_POLL_MS * 2

const CHANNEL_KEY = 'sc-rd-channel'

function savedChannel(): RadioChannel {
  try {
    return window.localStorage.getItem(CHANNEL_KEY) === 'all' ? 'all' : 'team'
  } catch {
    return 'team'
  }
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
  /** 판의 자리들 — 「@이름」 태그 후보. 이름과 팀은 누구나 아는 것이다 */
  people?: readonly { name: string; team: string | null }[]
  /** 전원 채널이 열려 있는가. 운영자가 여닫는다 */
  allOpen?: boolean
  /** 내가 오늘 지워졌는가. 전원 채널은 듣기만 한다 */
  invisible?: boolean
}

/**
 * 무전 탭 — 채널을 고르고, 고른 채널을 연다.
 *
 * 채널을 바꾸면 그 채널을 처음부터 다시 받는다(key). 두 채널을 늘 같이
 * 받아 두면 맥이 두 배로 든다 — 안 보는 쪽은 새 줄이 있는지만 느슨하게 본다.
 */
export function Radio(props: RadioProps) {
  const { me, act, active, onUnread } = props
  const [channel, setChannel] = useState<RadioChannel>(savedChannel)
  const other: RadioChannel = channel === 'team' ? 'all' : 'team'
  /** 안 보는 채널에 쌓인 남의 줄 수 */
  const [otherNew, setOtherNew] = useState(0)
  /** 안 보는 채널을 어디까지 확인했나. 채널별로 — 돌아왔다 다시 가도 이어서 센다 */
  const seenRef = useRef<Record<RadioChannel, number>>({ team: 0, all: 0 })
  const [roomNew, setRoomNew] = useState(0)

  const pick = (ch: RadioChannel) => {
    if (ch === channel) return
    try {
      window.localStorage.setItem(CHANNEL_KEY, ch)
    } catch {
      /* 저장이 막혀 있어도 채널은 바뀐다 */
    }
    setOtherNew(0)
    setRoomNew(0)
    setChannel(ch)
  }

  // 안 보는 채널 — 새 줄이 있는지만 본다
  useEffect(() => {
    let alive = true
    // 처음 한 번은 기준만 잡는다 — 들어오자마자 지난 줄 전부를 새 줄이라 하지 않는다
    let first = true
    const tick = async () => {
      try {
        const res = (await act.radioLines(seenRef.current[other], other)) as { lines?: RadioLine[] }
        const fresh = res.lines ?? []
        if (!alive || fresh.length === 0) return
        seenRef.current[other] = Math.max(seenRef.current[other], ...fresh.map((l) => l.atMs))
        const theirs = fresh.filter((l) => l.playerId !== me.playerId).length
        if (!first && theirs > 0) setOtherNew((n) => n + theirs)
      } catch {
        /* 보는 채널이 끊긴 것은 그쪽이 알린다. 여기서는 조용히 넘어간다 */
      } finally {
        first = false
      }
    }
    void tick()
    const t = window.setInterval(() => void tick(), OTHER_POLL_MS)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [act, other, me.playerId])

  const onSeen = useCallback(
    (atMs: number) => {
      seenRef.current[channel] = Math.max(seenRef.current[channel], atMs)
    },
    [channel],
  )

  // 탭 그림의 점 — 보는 채널에서 안 읽은 줄 + 안 보는 채널의 새 줄
  useEffect(() => {
    onUnread(roomNew + (active ? 0 : otherNew))
  }, [roomNew, otherNew, active, onUnread])

  return (
    <RadioRoom
      key={channel}
      {...props}
      channel={channel}
      otherNew={otherNew}
      onPick={pick}
      onUnread={setRoomNew}
      onSeen={onSeen}
    />
  )
}

function RadioRoom({
  me,
  act,
  onSaid,
  phaseOpenedAtMs,
  active,
  onUnread,
  channel,
  otherNew,
  onPick,
  onSeen,
  people = [],
  allOpen = true,
  invisible = false,
}: RadioProps & {
  channel: RadioChannel
  otherNew: number
  onPick: (ch: RadioChannel) => void
  onSeen: (atMs: number) => void
}) {
  const [lines, setLines] = useState<RadioLine[]>([])
  const [stuck, setStuck] = useState<string | null>(null)
  const failsRef = useRef(0)
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
      const res = (await act.radioLines(sinceRef.current, channel)) as { lines?: RadioLine[]; here?: number }
      setHere(Math.max(0, Math.floor(res.here ?? 0)))
      const fresh = res.lines ?? []
      if (fresh.length === 0) return
      sinceRef.current = Math.max(sinceRef.current, ...fresh.map((l) => l.atMs))
      onSeen(sinceRef.current)
      setLines((old) => [...old, ...fresh])
      setSpikeAt(Date.now())
      if (!stuckRef.current) setBehind((n) => n + fresh.length)
    } catch (e) {
      // 한두 번은 잠깐 끊긴 것이다. 계속 그러면 거절이다 — 화면에 낸다.
      // 방 안 말줄과 같은 병을 같은 자리에서 앓았다(useChat.ts)
      failsRef.current += 1
      if (failsRef.current >= 3) setStuck((e as Error).message || '서버가 대답하지 않는다.')
      return
    } finally {
      pullingRef.current = false
    }
    failsRef.current = 0
    setStuck(null)
  }, [act, channel, onSeen])

  useEffect(() => {
    void pull()
    const t = setInterval(() => void pull(), CHAT_POLL_MS)
    return () => clearInterval(t)
  }, [pull])


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

  // ── 보내기 — 누르는 순간 줄이 먼저 선다(useOutbox) ─────────────
  const mine = useCallback(
    (l: RadioLine, text: string) => !l.system && l.playerId === me.playerId && l.text === text,
    [me.playerId],
  )
  const post = useCallback(
    async (text: string) => {
      try {
        await act.radio(text, channel)
        buzz('ok')
      } catch (e) {
        onSaid((e as Error).message)
        buzz('no')
        throw e
      }
      void pull()
    },
    [act, onSaid, pull, channel],
  )
  const outbox = useOutbox({ lines, mine, post })
  const { draft, setDraft, box, button } = useSendBox({
    max: CHAT_MAX_LEN,
    send: (text) => {
      // 비어 있어도 단추는 눌린다. 눌리면 까닭을 한 줄로 말한다
      if (!text) {
        onSaid('내용을 적어 주세요.')
        buzz('no')
        return false
      }
      // 내가 말했으면 올려 읽던 중이어도 맨 아래로 간다 — 내 말이 보여야 한다
      stuckRef.current = true
      return outbox.submit(text)
    },
  })

  // ── 태그 — 「@」를 치면 이름을 고른다. 팀 채널은 팀원, 전원 채널은 열넷 ──
  const query = mentionQuery(draft)
  const picks =
    query === null
      ? []
      : mentionPicks(
          people.filter((p) => channel === 'all' || p.team === me.team).map((p) => p.name),
          query,
          me.name,
        )
  const shut = channel === 'all' && (!allOpen || invisible)

  // 맨 아래에 붙어 있을 때만 따라 내려간다. 올려 읽는 중이면 안 건드린다.
  // 먼저 세운 줄이 붉게 바뀌며 한 줄 길어져도 따라간다 — 그래서 수가 아니라 목록을 본다
  useEffect(() => {
    if (stuckRef.current) toBottom()
  }, [lines.length, outbox.waiting, toBottom])

  /*
   * ── 키보드 ─────────────────────────────────────────────────
   *
   * 입력줄은 `bottom: max(--kb, --rd-floor)` 에 떠 있다(radio.css).
   * --rd-floor 는 이 판 아래에 깔린 것(탭바 + 안전 영역)의 높이다 —
   * **재서 적는다.** 탭바 높이를 여기 숫자로 적어 두면 어느 기기에선가
   * 어긋나고, 그 차이만큼 입력줄이 탭바를 덮거나 떠 버린다.
   * 판의 틀은 키보드가 떠도 안 변하므로(100dvh) 재는 값도 안 흔들린다.
   */
  const kb = useKeyboardInset()
  const rootRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el || !active) return
    const fit = () => {
      // 적는 중에는 판이 보이는 창에 붙어 있다(radio.css) — 그때 재면 탭바 대신
      // 키보드 높이를 바닥으로 적어서, 키보드가 내려간 뒤 입력줄이 공중에 뜬다
      if (document.documentElement.hasAttribute('data-typing')) return
      const floor = Math.max(0, Math.round(window.innerHeight - el.getBoundingClientRect().bottom))
      el.style.setProperty('--rd-floor', `${floor}px`)
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [active])

  /*
   * 키보드가 올라오면 목록이 그만큼 준다. 줄어드는 동안 스크롤 자리는
   * 그대로라 **맨 아래 줄들이 키보드 쪽으로 밀려 안 보이게 된다.** 목록의
   * 크기가 바뀔 때마다, 맨 아래에 붙어 있던 중이면 다시 붙인다.
   * 전환(0.2초) 동안 여러 번 불리므로 끝까지 따라간다.
   */
  useEffect(() => {
    const el = logRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (stuckRef.current) el.scrollTop = el.scrollHeight
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /*
   * 그릴 줄 — 서버 줄 뒤에 먼저 세운 내 줄을 잇는다. 먼저 세운 줄은
   * 서버 줄이 오면 그 줄로 바뀐다(useOutbox 가 짝을 지어 빼 준다).
   */
  const rows: { key: string; l: RadioLine; out: Outgoing | null }[] = [
    ...lines.map((l, i) => ({ key: `${l.atMs}-${l.playerId}-${i}`, l, out: null })),
    ...outbox.waiting.map((o) => ({
      key: `o-${o.id}`,
      l: { playerId: me.playerId, name: me.name, team: me.team, atMs: 0, text: o.text, hidden: false, system: false },
      out: o,
    })),
  ]
  const empty = !stuck && rows.length === 0

  return (
    <div className={'sc-rd' + (kb > 0 ? ' is-kb' : '')} ref={rootRef}>
      {/* ── 수신 상태 ───────────────────────────────────── */}
      {/* ── 채널 ─────────────────────────────────────────── */}
      <div className="sc-rd__ch" role="tablist" aria-label="무전 채널">
        {(['team', 'all'] as const).map((ch) => (
          <button
            key={ch}
            role="tab"
            aria-selected={ch === channel}
            className={'sc-rd__chtab' + (ch === channel ? ' is-on' : '')}
            onClick={() => onPick(ch)}
          >
            {ch === 'team' ? `${me.team}팀` : allOpen ? '전원' : '전원 · 닫힘'}
            {ch !== channel && otherNew > 0 && <i className="sc-rd__chdot" aria-label={`새 줄 ${otherNew}`} />}
          </button>
        ))}
      </div>

      <header className="sc-rd__top">
        <div className="sc-rd__row">
          <span className="sc-rd__freq">
            {channel === 'team' ? (
              <>
                <b>{TEAM_FREQ[me.team]}</b> MHz · {me.team}팀
              </>
            ) : (
              <>
                <b>{ALL_FREQ}</b> MHz · 전원
              </>
            )}
          </span>
          <span className={`sc-rd__conn${here > 0 ? ' is-on' : ''}`}>
            {here > 0 ? `수신 ${here}` : '수신 없음'}
          </span>
        </div>
        <Wave connected={here} spikeAt={spikeAt} on={active} />
      </header>

      {/* ── 오간 말 ─────────────────────────────────────── */}
      <div className={'sc-rd__log' + (empty ? ' is-empty' : '')} ref={logRef} onScroll={onScroll}>
        {/* 이 주파수가 무엇인지. 목록 맨 위에 두어 말이 쌓이면 위로 밀려
            사라진다 — 입력줄 밑에 늘 붙어 있으면 키보드 위 자리를 먹는다 */}
        <p className="sc-rd__note">{channel === 'team' ? RADIO_NOTE : ALL_NOTE}</p>
        {stuck && <p className="sc-rd__none" role="alert">무전을 못 받아온다 — {stuck}</p>}
        {empty && <p className="sc-rd__none sc-rd__empty">아직 아무도 말하지 않았다</p>}
        <ul>
          {rows.map(({ key, l, out }, i) => {
            if (l.system) {
              return (
                <li key={key} className="sc-rd__sys">
                  <span>{l.text}</span>
                </li>
              )
            }
            // 같은 사람이 잇달아 말하면 이름을 지운다. 읽는 눈이
            // 같은 이름을 세 번 지나가지 않아도 된다
            const prev = rows[i - 1]?.l
            const run = prev !== undefined && !prev.system && prev.playerId === l.playerId
            const inPhase = phaseOpenedAtMs !== null && l.atMs >= phaseOpenedAtMs
            const failed = out?.state === 'failed'
            return (
              <li
                key={key}
                className={[
                  'sc-rd__line',
                  run ? 'is-run' : '',
                  l.playerId === me.playerId ? 'is-me' : '',
                  out ? 'is-out' : '',
                  out?.state === 'sending' ? 'is-sending' : '',
                  failed ? 'is-failed' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                role={failed ? 'button' : undefined}
                aria-label={failed ? `못 보냈다. 눌러서 다시 보내기: ${l.text}` : undefined}
                /* 누르는 순간 다시 보낸다. 칸의 초점은 그대로 둔다 */
                onPointerDown={
                  failed && out
                    ? (e) => {
                        e.preventDefault()
                        stuckRef.current = true
                        outbox.retry(out.id)
                      }
                    : undefined
                }
              >
                <span className="sc-rd__at">
                  {/* 먼저 세운 줄에는 아직 서버 시각이 없다. 가는 중이면 점, 못 갔으면 느낌표 */}
                  {out
                    ? failed
                      ? '!'
                      : '···'
                    : stampOf(l.atMs, inPhase ? phaseOpenedAtMs : null, secondsIntoSeoulDay(l.atMs))}
                </span>
                {/* 잇달아 말한 줄도 이름 칸의 너비는 남긴다 — 글이 윗줄과 같은 자리에서 시작한다 */}
                <span
                  className="sc-rd__who"
                  title={l.name}
                  aria-hidden={run ? 'true' : undefined}
                  style={{ color: (TEAM_COLOR as Record<string, string>)[l.team] ?? 'var(--rd-on)' }}
                >
                  {l.name}
                  {/* 칠 때 지워져 있었다. 오늘 판정에서 빠진 사람이라,
                      셋이 넷인 줄 알고 방을 나누면 그날 작전이 통째로
                      어긋난다 — 무전은 막지 않는 대신 이것을 붙인다 */}
                  {l.hidden && <i>안 보임</i>}
                </span>
                <span className="sc-rd__text">
                  {l.text}
                  {failed && <em className="sc-rd__retry">못 보냈다 · 눌러서 다시</em>}
                </span>
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

      {/* ── 송신 — 키보드 위에 떠 있다(radio.css) ──────────── */}
      <div className="sc-rd__bar">
        {/* 태그 후보. 누르는 순간 끼운다 — 칸의 초점은 그대로 둔다 */}
        {picks.length > 0 && !shut && (
          <div className="sc-rd__tags" role="listbox" aria-label="부를 사람">
            {picks.map((n) => (
              <button
                key={n}
                type="button"
                role="option"
                aria-selected={false}
                onPointerDown={(e) => {
                  e.preventDefault()
                  setDraft(insertMention(draft, n))
                }}
              >
                @{n}
              </button>
            ))}
          </div>
        )}
        {shut ? (
          <p className="sc-rd__shut">{allOpen ? ALL_MUTE : ALL_SHUT}</p>
        ) : (
        <div className="sc-rd__field">
          <input
            {...box}
            id="rd-say"
            placeholder={channel === 'team' ? '무전한다' : '모두에게 말한다'}
            aria-label={channel === 'team' ? '같은 팀에게 무전하기' : '전원에게 무전하기'}
            // 올려 읽던 중이었어도 칠 때는 맨 아래를 본다
            onFocus={() => toBottom()}
          />
          {/* 누르는 순간 보낸다 — 손을 뗄 때까지 기다리면 칸이 초점을 잃는다(useSendBox) */}
          <button
            {...button}
            className={'sc-rd__send' + (draft.trim().length === 0 ? ' is-empty' : '')}
            aria-label="송신"
          >
            {/* 도트 화살표. 11칸 격자를 두 배로 — 정수 배라 끝이 안 흐려진다 */}
            <svg viewBox="0 0 11 11" width="22" height="22" aria-hidden="true" shapeRendering="crispEdges">
              <path fill="currentColor" d="M5 1h1v1h1v1h1v1h1v1h1v1H7v4H4V6H1V5h1V4h1V3h1V2h1z" />
            </svg>
          </button>
        </div>
        )}
      </div>
    </div>
  )
}
