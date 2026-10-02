// 운영자 「로그」 탭 — 모든 상태 변화를 시각과 함께, 시간순으로.
//
// 서버(hostEventLog)가 events · 다섯 기록 · 달력 · 페이즈 결과 · 투표 결과 ·
// 공지 · 미션 · 알림을 한 줄 모양으로 합쳐 준다. 화면은 거르고 찾고
// 따라간다 — 「따라가기」를 켜면 3초마다 마지막 줄 뒤만 받아 붙인다.
//
// 위에는 불변식 검사(hostInvariants). 어긋난 것이 있으면 빨간 띠로 수와
// 목록이 뜬다. 페이즈가 닫힐 때도 서버가 같은 검사를 돌려 기록해 둔다.
//
// **채팅 문장 · 역할 · 표의 상대 · 미션 판정 내용은 서버가 애초에 안 준다.**
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { GameActions } from '../game/useGame'
import './eventLog.css'

interface Row {
  id: string
  atMs: number
  day: number
  kind: string
  src: string
  actor?: string
  target?: string
  tileId?: string
  text: string
}
interface LogOut {
  nowMs: number
  rows: Row[]
  kinds: string[]
  total: number
  truncated: boolean
}
interface Violation {
  atMs: number
  kind: string
  detail: string
  lastEvent: Row | null
}
interface InvOut {
  nowMs: number
  violations: Violation[]
  history: Violation[]
  labels: Record<string, string>
}

/** 따라가기 간격 */
const TAIL_MS = 3000
/** 처음 여는 화면에 받는 줄 수 — 그 뒤는 따라가기가 붙인다 */
const FIRST_LIMIT = 600
/** 한 번에 그리는 줄 수. 더 있으면 「앞을 더」 */
const PAGE = 300

const CLOCK = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})
/** 게임 시계를 서울 시각으로 — 판이 보는 시계와 같다 */
const hhmmss = (ms: number) => CLOCK.format(ms)

/** 종류 이름. 없으면 종류 그대로 */
const KIND_LABEL: Record<string, string> = {
  gameStart: '시작',
  dayStart: '아침',
  settlement: '정산',
  gameEnd: '끝',
  arrive: '도착',
  roamTo: '방 옮김',
  standAt: '섬',
  phaseOpen: '페이즈 열림',
  phaseClose: '페이즈 닫힘',
  phaseAct: '페이즈 행동',
  shopBought: '구매',
  cropSold: '매입',
  vendBuy: '구매',
  vendSell: '매입',
  trade: '거래',
  dealAsked: '거래 청함',
  dealAnswered: '거래 답',
  dealCancelled: '거래 접음',
  dealSettled: '거래 성립',
  tradeAccepted: '거래(분단)',
  transferAsked: '이적 청함',
  transferAnswered: '이적 답',
  teamMoved: '이적',
  ballotCast: '표 적음',
  ballotOpen: '투표 열림',
  ballotClose: '투표 닫힘',
  ballotResult: '투표 결과',
  'push:dayStart': '아침 넘김',
  'push:settlement': '정산 넘김',
  'push:lastHours': '점수판 끄기',
  'push:gameEnd': '끝 넘김',
  'mission:override': '판정 뒤집음',
  'mission:send': '판정 보냄',
  vote: '표',
  notice: '공지',
  notify: '알림',
  slipTake: '쪽지 주움',
  slipRead: '쪽지 읽음',
  slipGive: '쪽지 건넴',
  slipTear: '쪽지 찢음',
  slipDrop: '쪽지 둠',
  slipScattered: '쪽지 뿌림',
  slipPulled: '쪽지 회수',
  memoDropped: '메모 놓음',
  trapCommissioned: '덫 맡김',
  trapTaken: '덫 찾음',
  trapSet: '덫 놓음',
  trapSprung: '덫 걸림',
  lockPicked: '자물쇠 땀',
  dayPushed: '달력 넘김',
  missionJudge: '자정 판정',
  devClock: '시계',
  assigned: '배정',
  reset: '되돌림',
  invisibleCleared: '투명 해제',
  errandDone: '심부름 끝',
  errandTake: '심부름 받음',
  errandQuit: '심부름 그만둠',
  errandPickUp: '심부름 물건 집음',
  errandExpired: '심부름 시간 지남',
}
const kindName = (k: string) => KIND_LABEL[k] ?? k

/** 뒤에서 앞으로 합친다 — 같은 줄(id)은 한 번만 */
function merge(had: Row[], more: Row[]): Row[] {
  if (more.length === 0) return had
  const seen = new Set(had.map((r) => r.id))
  const add = more.filter((r) => !seen.has(r.id))
  if (add.length === 0) return had
  return [...had, ...add].sort((a, b) => a.atMs - b.atMs || a.id.localeCompare(b.id))
}

export function EventLog({
  act,
  seats,
  onSaid,
}: {
  act: GameActions
  seats: readonly { playerId: string; name: string }[]
  onSaid: (t: string) => void
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [kinds, setKinds] = useState<string[]>([])
  const [truncated, setTruncated] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [actor, setActor] = useState('')
  const [search, setSearch] = useState('')
  const [follow, setFollow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [inv, setInv] = useState<InvOut | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  /** 서버가 말한 게임 시각. 따라가기의 기준이다 */
  const [serverNow, setServerNow] = useState(0)
  const listRef = useRef<HTMLOListElement | null>(null)
  /*
   * 따라가기의 앞자리. **지금보다 뒤에 놓인 줄은 기준으로 안 삼는다** —
   * 개발용 시계를 건 판에는 로비에서 실제 시각으로 적힌 줄이 게임 시각보다
   * 한참 뒤에 있어서, 그 뒤만 받으면 새 줄이 영영 안 온다
   */
  const lastAt = useMemo(() => {
    let at = 0
    for (const r of rows) if (r.atMs > at && (serverNow === 0 || r.atMs <= serverNow)) at = r.atMs
    return at
  }, [rows, serverNow])

  /** 처음 · 새로 읽기 — 최근 것부터 */
  const load = useCallback(async () => {
    setBusy(true)
    try {
      const out = (await act.hostEventLog({ limit: FIRST_LIMIT })) as unknown as LogOut
      setRows(out.rows)
      setKinds(out.kinds)
      setTruncated(out.truncated)
      setServerNow(out.nowMs)
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [act, onSaid])

  /** 불변식 — 지금 검사 */
  const checkNow = useCallback(async () => {
    try {
      const out = (await act.hostInvariants()) as unknown as InvOut
      setInv(out)
    } catch (e) {
      onSaid((e as Error).message)
    }
  }, [act, onSaid])

  useEffect(() => {
    void load()
    void checkNow()
  }, [load, checkNow])

  /** 따라가기 — 마지막 줄 뒤만 받아 붙인다 */
  useEffect(() => {
    if (!follow) return
    let alive = true
    const tick = async () => {
      try {
        const out = (await act.hostEventLog({ sinceMs: lastAt, limit: 500 })) as unknown as LogOut
        if (!alive) return
        setServerNow(out.nowMs)
        setRows((had) => merge(had, out.rows))
        setKinds((had) => (out.kinds.every((k) => had.includes(k)) ? had : [...new Set([...had, ...out.kinds])].sort()))
      } catch {
        // 한 번 못 받아도 다음 번에 받는다
      }
    }
    const t = window.setInterval(() => void tick(), TAIL_MS)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [follow, act, lastAt])

  const shown = useMemo(() => {
    const q = search.trim()
    return rows.filter((r) => {
      if (picked.size > 0 && !picked.has(r.kind)) return false
      if (actor && r.actor !== actor && r.target !== actor) return false
      if (q && !`${r.text} ${r.actor ?? ''} ${r.target ?? ''} ${r.kind}`.includes(q)) return false
      return true
    })
  }, [rows, picked, actor, search])
  const tail = showAll ? shown : shown.slice(Math.max(0, shown.length - PAGE))

  // 따라가는 동안은 늘 끝을 본다
  useEffect(() => {
    if (!follow || !listRef.current) return
    listRef.current.lastElementChild?.scrollIntoView({ block: 'nearest' })
  }, [follow, tail.length])

  const toggleKind = (k: string) => {
    const next = new Set(picked)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    setPicked(next)
  }

  /** 거른 줄을 JSON 으로 내려받는다 */
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(shown, null, 1)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `qa-log-${lastAt || 0}.json`
    a.click()
    URL.revokeObjectURL(url)
    onSaid(`${shown.length} 줄을 내려받았다.`)
  }

  const bad = inv?.violations ?? []
  const label = (k: string) => inv?.labels?.[k] ?? k

  return (
    <div className="sc-lg">
      {/* ── 불변식 ── */}
      {bad.length > 0 ? (
        <div className="sc-lg__alarm" role="alert">
          <div className="sc-lg__alarmHead">
            <b>어긋남 {bad.length} 건</b>
            <span>{hhmmss(inv?.nowMs ?? 0)} 검사</span>
            <button onClick={() => void checkNow()}>다시 검사</button>
          </div>
          <ul className="sc-lg__bad">
            {bad.map((v, i) => (
              <li key={`${v.kind}-${i}`}>
                <b>{label(v.kind)}</b>
                <span>{v.detail}</span>
                {v.lastEvent && <em>직전 — {hhmmss(v.lastEvent.atMs)} {v.lastEvent.text}</em>}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="sc-lg__ok">
          <span>{inv ? `불변식 이상 없음 · ${hhmmss(inv.nowMs)} 검사` : '불변식 검사 중…'}</span>
          <button onClick={() => void checkNow()}>다시 검사</button>
        </div>
      )}
      {inv && inv.history.length > 0 && (
        <div className="sc-lg__hist">
          <button onClick={() => setShowHistory((v) => !v)}>
            어긋난 기록 {inv.history.length} 건 {showHistory ? '접기' : '보기'}
          </button>
          {showHistory && (
            <ul className="sc-lg__bad is-hist">
              {inv.history.map((v, i) => (
                <li key={`${v.atMs}-${i}`}>
                  <time>{hhmmss(v.atMs)}</time>
                  <b>{label(v.kind)}</b>
                  <span>{v.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── 거르기 ── */}
      <div className="sc-lg__bar">
        <input
          id="lg-search"
          type="search"
          placeholder="찾기 — 이름 · 방 · 말"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="찾기"
        />
        <select value={actor} onChange={(e) => setActor(e.target.value)} aria-label="사람">
          <option value="">모두</option>
          <option value="감독관">감독관</option>
          {seats.map((s) => (
            <option key={s.playerId} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="sc-lg__chips">
        <button className={picked.size === 0 ? 'is-on' : ''} onClick={() => setPicked(new Set())}>
          전부
        </button>
        {kinds.map((k) => (
          <button key={k} className={picked.has(k) ? 'is-on' : ''} onClick={() => toggleKind(k)}>
            {kindName(k)}
          </button>
        ))}
      </div>
      <div className="sc-lg__bar">
        <button className={follow ? 'is-on sc-lg__follow' : 'sc-lg__follow'} onClick={() => setFollow((v) => !v)}>
          {follow ? '● 따라가는 중' : '따라가기'}
        </button>
        <button disabled={busy} onClick={() => void load()}>
          새로 읽기
        </button>
        <button disabled={shown.length === 0} onClick={exportJson}>
          JSON
        </button>
        <span className="sc-lg__count">
          {shown.length}
          {shown.length !== rows.length ? `/${rows.length}` : ''} 줄{truncated ? ' · 앞은 잘림' : ''}
        </span>
      </div>

      {/* ── 줄 ── */}
      {rows.length === 0 ? (
        <p className="sc-ad__hint">{busy ? '읽는 중이다.' : '기록이 없다.'}</p>
      ) : (
        <>
          {!showAll && shown.length > PAGE && (
            <button className="sc-lg__more" onClick={() => setShowAll(true)}>
              앞 {shown.length - PAGE} 줄 더
            </button>
          )}
          <ol className="sc-lg__list" ref={listRef}>
            {tail.map((r) => (
              <li key={r.id} className={`sc-lg__row is-${r.src}${serverNow > 0 && r.atMs > serverNow + 60_000 ? ' is-future' : ''}`}>
                <time>
                  <small>D{r.day}</small>
                  {hhmmss(r.atMs)}
                </time>
                <b>{kindName(r.kind)}</b>
                <span>{r.text}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  )
}
