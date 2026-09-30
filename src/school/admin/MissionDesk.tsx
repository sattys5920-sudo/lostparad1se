// 운영자 — 개인 미션 판정. 날마다 열넷의 결과를 보고, 뒤집고, 보낸다.
//
//   날 탭   판정한 날마다 하나. 마지막 날은 「최종」
//   줄      열넷이 한 줄씩 — 이름 · 역할 · 팀 · 결과 점 · 뒤집음 · 보냄
//           누르면 펴진다: 조항마다 채운 값 / 기준 · 상태 · 전날 대비
//   뒤집기  달성 · 실패 · 되돌리기, 까닭은 꼭. 서버가 기록에 남긴다
//   보내기  한 사람 · 고른 사람 · 전부. **보내기 전에 받을 모습을 먼저 본다**
//   기록    그날 보낸 것 · 뒤집은 것
//
// **보내는 모습은 서버가 만든 mail 그대로다.** 여기서 truth 로 다시 만들지
// 않는다 — 운영자가 보는 것과 그 사람이 받는 것이 어긋나면 안 된다.
// 운영자만 부른다(hostMissionDay · hostMissionOverride · hostMissionSend).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { deltaOf, type DayClause, type DayClauseView, type DayStatus, type DayVerdict, type DayVerdictView } from '../../../shared/missions/daily'
import type { MissionMail } from '../../../shared/missions/mail'
import { STATUS_LABEL } from '../../../shared/missions/roleNames'
import type { TeamId } from '../../../shared/rules/v2'
import type { GameActions } from '../game/useGame'
import { Sure } from '../game/Sheet'

/** 판정이 있는 날 하나 */
interface DayMeta {
  day: number
  asOfMs: number
  final: boolean
  count: number
}

/** 한 사람의 그날 판정. 서버(functions/src/missionDays.ts)의 MissionSnapDoc 에 이름 · 받을 모습을 붙인 것 */
interface Row {
  day: number
  playerId: string
  roleId: string
  team: TeamId
  final: boolean
  truth: DayVerdict
  view: DayVerdictView
  override: { status: DayStatus; reason: string; atMs: number } | null
  sentAtMs: number | null
  name: string
  roleName: string
  mail: MissionMail
}

interface LogLine {
  kind: 'override' | 'send' | 'board'
  playerIds: string[]
  names: string[]
  from?: DayStatus | null
  to?: DayStatus | null
  reason?: string
  atMs: number
}

interface Out {
  days: DayMeta[]
  day: number | null
  rows: Row[]
  prev: { playerId: string; truth: DayVerdict }[]
  log: LogLine[]
}

type Filter = 'all' | 'met' | 'failed' | 'unsent' | 'flipped'

/** 탭이 열려 있는 동안만 다시 읽는다 */
const AUTO_MS = 10_000
const REASON_MAX = 200
const TEAMS: readonly TeamId[] = ['A', 'B', 'C', 'D']

/** 받는 사람이 읽는 결과 한 줄 */
const RESULT_LINE: Record<DayStatus, string> = {
  met: '해냈다',
  running: '아직이다',
  failed: '끝났다',
  endOnly: '아직 모른다',
}

function hhmm(ms: number): string {
  const f = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(ms))
  return `${f.find((p) => p.type === 'hour')?.value ?? ''}:${f.find((p) => p.type === 'minute')?.value ?? ''}`
}

/** 운영자가 보는 결과 — 뒤집었으면 뒤집은 값 */
const effOf = (r: Row): DayStatus => r.override?.status ?? r.truth.status

/** 보낸 뒤에 뒤집었다 — 다시 보내야 그 사람에게 간다 */
const staleOf = (r: Row, log: readonly LogLine[]): boolean =>
  r.sentAtMs !== null && log.some((l) => l.kind === 'override' && l.playerIds.includes(r.playerId) && l.atMs > (r.sentAtMs ?? 0))

/** 채운 값. 「했다」류는 숫자 대신 말로 */
function amount(c: Pick<DayClauseView, 'have' | 'bar' | 'unit' | 'mode'>): string {
  if (c.have === null) return '—'
  if (c.unit === 'flag') return c.have > 0 ? '했다' : '안 했다'
  const u = c.unit === 'minutes' ? ' 분' : ''
  return c.mode === 'atMost' ? `${c.have}${u} · 최대 ${c.bar}${u}` : `${c.have}/${c.bar}${u}`
}

function deltaText(d: number | null, unit: DayClause['unit']): string {
  if (d === null || unit === 'flag') return ''
  const u = unit === 'minutes' ? ' 분' : ''
  return d === 0 ? '±0' : d > 0 ? `+${d}${u}` : `−${-d}${u}`
}

const statusName = (s: DayStatus | null | undefined): string => (s ? STATUS_LABEL[s] : '판정대로')

/** 짝사랑의 오늘 대상 — 위치·팀은 후보 칸에만 보인다(운영자 몫이다). 안 고르면 그날은 대상이 없다. */
interface CrushOut {
  day: number
  crushPlayerId: string | null
  crushName: string | null
  candidates: { id: string; name: string; team: TeamId }[]
  targetId: string | null
}

function CrushTarget({ act, onSaid }: { act: GameActions; onSaid: (t: string) => void }) {
  const [data, setData] = useState<CrushOut | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setData((await act.hostCrushTarget()) as CrushOut)
    } catch {
      // 이 판에 짝사랑이 없거나 아직 안 배정됐다 — 조용히 넘어간다
    }
  }, [act])

  useEffect(() => {
    void load()
  }, [load])

  if (!data || !data.crushPlayerId) return null

  async function pick(id: string) {
    setBusy(true)
    try {
      await act.hostSetCrushTarget(id === '' ? null : id)
      onSaid(id ? '오늘의 대상을 정했다.' : '오늘의 대상을 거뒀다.')
      await load()
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sc-md__crush">
      <span>
        DAY {data.day} · 짝사랑({data.crushName}) 오늘의 대상
      </span>
      <select value={data.targetId ?? ''} disabled={busy} onChange={(e) => void pick(e.target.value)}>
        <option value="">— 안 정함 —</option>
        {data.candidates.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  )
}

export function MissionDesk({ act, onSaid }: { act: GameActions; onSaid: (t: string) => void }) {
  const [data, setData] = useState<Out | null>(null)
  /** 보고 있는 날. 처음 읽을 때 가장 최근 날로 정한다 */
  const [day, setDay] = useState<number | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  /** 뒤집기 칸을 연 사람 */
  const [flipId, setFlipId] = useState<string | null>(null)
  /** 보내기 확인 — null 이면 전부 */
  const [ask, setAsk] = useState<{ ids: string[] | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [readAt, setReadAt] = useState<number | null>(null)
  /** 늦게 온 옛 응답이 새 날 화면을 덮지 않게 */
  const seq = useRef(0)

  const load = useCallback(async () => {
    const n = ++seq.current
    try {
      const out = (await act.hostMissionDay(day ?? undefined)) as Out
      if (n !== seq.current) return
      setData(out)
      setErr('')
      setReadAt(Date.now())
      if (day === null && out.day !== null) setDay(out.day)
    } catch (e) {
      if (n === seq.current) setErr((e as Error).message)
    }
  }, [act, day])

  // 탭이 열려 있는 동안만 돈다 — 탭을 옮기면 이 화면이 내려가면서 멈춘다
  useEffect(() => {
    void load()
    const t = window.setInterval(() => {
      if (!document.hidden) void load()
    }, AUTO_MS)
    return () => window.clearInterval(t)
  }, [load])

  const log = useMemo(() => data?.log ?? [], [data])
  const rows = useMemo(() => {
    const r = [...(data?.rows ?? [])]
    return r.sort((a, b) => TEAMS.indexOf(a.team) - TEAMS.indexOf(b.team) || a.name.localeCompare(b.name, 'ko'))
  }, [data])
  const prevOf = useMemo(() => new Map((data?.prev ?? []).map((p) => [p.playerId, p.truth])), [data])

  const count = (f: Filter) => rows.filter((r) => pass(r, f)).length
  function pass(r: Row, f: Filter): boolean {
    if (f === 'met') return effOf(r) === 'met'
    if (f === 'failed') return effOf(r) === 'failed'
    if (f === 'unsent') return r.sentAtMs === null || staleOf(r, log)
    if (f === 'flipped') return r.override !== null
    return true
  }
  const shown = rows.filter((r) => pass(r, filter))
  const meta = data?.days.find((d) => d.day === data.day) ?? null
  const sentN = rows.filter((r) => r.sentAtMs !== null && !staleOf(r, log)).length

  const toggle = (set: ReadonlySet<string>, id: string): Set<string> => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }

  function pickDay(d: number) {
    if (d === day) return
    seq.current += 1
    setDay(d)
    setData(null)
    setOpen(new Set())
    setPicked(new Set())
    setFlipId(null)
  }

  async function send(ids: string[] | null) {
    if (data?.day == null) return
    setBusy(true)
    try {
      const out = (await act.hostMissionSend(data.day, ids ?? undefined)) as { sent?: number }
      onSaid(`DAY ${data.day} 판정을 ${out.sent ?? 0} 명에게 보냈다.`)
      setAsk(null)
      setPicked(new Set())
      await load()
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function announce() {
    if (data?.day == null) return
    setBusy(true)
    try {
      const out = (await act.hostMissionBoard(data.day)) as { met?: number; failed?: number }
      onSaid(`DAY ${data.day} 결과를 모두에게 알렸다. 성공 ${out.met ?? 0} · 실패 ${out.failed ?? 0}.`)
      await load()
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function flip(r: Row, status: 'met' | 'failed' | null, reason: string) {
    setBusy(true)
    try {
      const out = (await act.hostMissionOverride(r.day, r.playerId, status, reason)) as { sent?: boolean }
      const what = status === null ? '판정대로 되돌렸다' : status === 'met' ? '달성으로 바꿨다' : '실패로 바꿨다'
      onSaid(out.sent ? `${r.name} — ${what}. 이미 보낸 뒤라 다시 보내야 간다.` : `${r.name} — ${what}.`)
      setFlipId(null)
      await load()
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!data) return <p className="sc-ad__hint">{err || '판정을 읽는 중이다.'}</p>
  if (data.day === null) {
    return (
      <div className="sc-md">
        <CrushTarget act={act} onSaid={onSaid} />
        <p className="sc-ad__hint">아직 판정한 날이 없다. 날을 넘기면 그날 밤 판정이 여기 쌓인다.</p>
        <button className="sc-md__reload" onClick={() => void load()}>
          새로 읽기
        </button>
      </div>
    )
  }

  const allShownPicked = shown.length > 0 && shown.every((r) => picked.has(r.playerId))
  const askRows = ask ? (ask.ids ? rows.filter((r) => ask.ids?.includes(r.playerId)) : rows) : []

  return (
    <div className="sc-md">
      <CrushTarget act={act} onSaid={onSaid} />

      {/* ── 날 탭 ── */}
      <nav className="sc-md__days" aria-label="판정한 날">
        {data.days.map((d) => (
          <button key={d.day} className={d.day === data.day ? 'is-on' : ''} aria-pressed={d.day === data.day} onClick={() => pickDay(d.day)}>
            DAY {d.day}
            {d.final && <em>최종</em>}
          </button>
        ))}
      </nav>

      {/* ── 한 줄 요약 · 새로 읽기 ── */}
      <div className="sc-md__sum" role="status">
        <span>
          달성 <b>{count('met')}</b>
        </span>
        <span>
          실패 <b>{count('failed')}</b>
        </span>
        <span>
          보냄 <b>{sentN}</b>/{rows.length}
        </span>
        <button className="sc-md__reload" disabled={busy} onClick={() => void load()}>
          새로 읽기
        </button>
      </div>
      <p className="sc-md__asof">
        {meta ? `${hhmm(meta.asOfMs)} 까지 센 판정` : ''}
        {readAt ? ` · ${hhmm(readAt)} 에 읽음 · 10 초마다` : ''}
        {err ? <b> · 못 읽었다: {err}</b> : null}
      </p>

      {/* ── 거르기 ── */}
      <div className="sc-md__chips" role="group" aria-label="거르기">
        {(
          [
            ['all', '전체'],
            ['met', '달성'],
            ['failed', '실패'],
            ['unsent', '안 보냄'],
            ['flipped', '뒤집음'],
          ] as const
        ).map(([f, name]) => (
          <button key={f} className={filter === f ? 'is-on' : ''} aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {name} {count(f)}
          </button>
        ))}
      </div>

      {/* ── 보내기 ── */}
      <div className="sc-md__send">
        <label className="sc-md__all">
          <input
            type="checkbox"
            checked={allShownPicked}
            onChange={() => {
              const next = new Set(picked)
              for (const r of shown) {
                if (allShownPicked) next.delete(r.playerId)
                else next.add(r.playerId)
              }
              setPicked(next)
            }}
          />
          보이는 {shown.length} 명 고르기
        </label>
        <div className="sc-ad__row">
          <button disabled={busy || picked.size === 0} onClick={() => setAsk({ ids: [...picked] })}>
            고른 {picked.size} 명 보내기
          </button>
          <button className="is-primary sc-md__go" disabled={busy} onClick={() => setAsk({ ids: null })}>
            전부 보내기
          </button>
        </div>
        {/*
          **모두에게 알린다** — 열넷의 이름과 성공/실패만. 역할 · 조건 · 숫자는
          안 나간다. 개인에게 보내기와 따로라, 보내기 전에 눌러도 된다
        */}
        <div className="sc-ad__row">
          <Sure
            disabled={busy}
            warn={`DAY ${data.day} 열넷의 이름과 성공/실패가 모두에게 뜬다. 역할은 안 나간다.`}
            onGo={() => void announce()}
          >
            {log.some((l) => l.kind === 'board') ? '모두에게 다시 공개' : '모두에게 공개'}
          </Sure>
        </div>
      </div>

      {/* ── 열넷 ── */}
      {shown.length === 0 ? (
        <p className="sc-ad__hint">해당하는 사람이 없다.</p>
      ) : (
        <ul className="sc-md__list">
          {shown.map((r) => (
            <PlayerRow
              key={r.playerId}
              row={r}
              prev={prevOf.get(r.playerId) ?? null}
              stale={staleOf(r, log)}
              open={open.has(r.playerId)}
              picked={picked.has(r.playerId)}
              flipping={flipId === r.playerId}
              busy={busy}
              onToggle={() => setOpen(toggle(open, r.playerId))}
              onPick={() => setPicked(toggle(picked, r.playerId))}
              onFlipOpen={() => setFlipId(flipId === r.playerId ? null : r.playerId)}
              onFlip={(s, why) => void flip(r, s, why)}
              onSend={() => setAsk({ ids: [r.playerId] })}
            />
          ))}
        </ul>
      )}

      {/* ── 그날 기록 ── */}
      <h3 className="sc-md__sub">DAY {data.day} 기록 {log.length}</h3>
      {log.length === 0 ? (
        <p className="sc-ad__hint">아직 보내거나 뒤집은 것이 없다.</p>
      ) : (
        <ol className="sc-md__log">
          {log.map((l, i) => (
            <li key={`${l.atMs}-${i}`}>
              <time>{hhmm(l.atMs)}</time>
              <span className={`sc-md__kind is-${l.kind}`}>{l.kind === 'send' ? '보냄' : l.kind === 'board' ? '전체 공개' : '뒤집음'}</span>
              <span className="sc-md__who">
                {l.kind === 'board'
                  ? `${l.names.length} 명의 성공/실패`
                  : l.kind === 'send' && l.names.length === rows.length && rows.length > 1
                    ? `전부 ${l.names.length} 명`
                    : l.names.join(', ')}
                {l.kind === 'override' && (
                  <>
                    <em>
                      {' '}
                      {statusName(l.from)} → {statusName(l.to)}
                    </em>
                    {l.reason ? <q>{l.reason}</q> : null}
                  </>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}

      {ask && (
        <SendSheet
          day={data.day}
          rows={askRows}
          all={ask.ids === null}
          busy={busy}
          stale={(r) => staleOf(r, log)}
          onClose={() => setAsk(null)}
          onSend={() => void send(ask.ids)}
        />
      )}
    </div>
  )
}

function Dot({ s }: { s: DayStatus }) {
  return <span className={`sc-md__dot is-${s}`} aria-label={STATUS_LABEL[s]} role="img" />
}

function PlayerRow({
  row: r,
  prev,
  stale,
  open,
  picked,
  flipping,
  busy,
  onToggle,
  onPick,
  onFlipOpen,
  onFlip,
  onSend,
}: {
  row: Row
  prev: DayVerdict | null
  stale: boolean
  open: boolean
  picked: boolean
  flipping: boolean
  busy: boolean
  onToggle: () => void
  onPick: () => void
  onFlipOpen: () => void
  onFlip: (s: 'met' | 'failed' | null, why: string) => void
  onSend: () => void
}) {
  const eff = effOf(r)
  const dMain = deltaOf(r.truth.clauses, prev?.clauses ?? null)
  const sentText = r.sentAtMs === null ? '안 보냄' : stale ? '다시 보내야' : `보냄 ${hhmm(r.sentAtMs)}`

  return (
    <li className={`sc-md__row${open ? ' is-open' : ''}${picked ? ' is-picked' : ''}`}>
      <div className="sc-md__head">
        <label className="sc-md__pick" aria-label={`${r.name} 고르기`}>
          <input type="checkbox" checked={picked} onChange={onPick} />
        </label>
        <button className="sc-md__toggle" aria-expanded={open} onClick={onToggle}>
          <Dot s={eff} />
          <span className="sc-md__main">
            <span className="sc-md__name">
              <b>{r.name || '이름 없음'}</b>
              <i className={`sc-md__team is-${r.team}`}>{r.team}</i>
            </span>
            <span className="sc-md__meta">
              {r.roleName} · {STATUS_LABEL[eff]}
            </span>
          </span>
          <span className="sc-md__marks">
            {r.override && <span className="sc-md__flip">뒤집음</span>}
            <span className={`sc-md__sent${r.sentAtMs === null ? ' is-no' : stale ? ' is-stale' : ''}`}>{sentText}</span>
          </span>
          <span className="sc-md__chev" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
        </button>
      </div>

      {open && (
        <div className="sc-md__body">
          <Clauses title="미션" list={r.truth.clauses} view={r.view.clauses} delta={dMain} hasPrev={prev !== null} />
          {r.final && (
            <p className="sc-md__line">
              <Dot s={r.truth.choice} /> 마지막 선택 <b>{STATUS_LABEL[r.truth.choice]}</b>
            </p>
          )}
          <p className="sc-md__line">
            판정 <b>{STATUS_LABEL[r.truth.status]}</b>
            {r.view.status !== r.truth.status && <> · 본인 몫 {STATUS_LABEL[r.view.status]}</>}
            {r.override && (
              <>
                {' '}
                → 뒤집어서 <b>{STATUS_LABEL[r.override.status]}</b>
              </>
            )}
          </p>
          {r.override && (
            <p className="sc-md__why">
              {hhmm(r.override.atMs)} · {r.override.reason}
            </p>
          )}
          {stale && <p className="sc-md__warn">보낸 뒤에 뒤집었다. 다시 보내야 그 사람에게 간다.</p>}

          <div className="sc-ad__row">
            <button disabled={busy} className={flipping ? 'is-on' : ''} aria-expanded={flipping} onClick={onFlipOpen}>
              뒤집기
            </button>
            <button disabled={busy} onClick={onSend}>
              {r.sentAtMs === null ? '보내기' : '다시 보내기'}
            </button>
          </div>
          {flipping && <FlipForm row={r} busy={busy} onCancel={onFlipOpen} onFlip={onFlip} />}
        </div>
      )}
    </li>
  )
}

function Clauses({
  title,
  list,
  view,
  delta,
  hasPrev,
}: {
  title: string
  list: readonly DayClause[]
  view: readonly DayClauseView[]
  delta: (number | null)[]
  hasPrev: boolean
}) {
  return (
    <div className="sc-md__clauses">
      <h4>
        {title}
        {hasPrev && <em>어제 대비</em>}
      </h4>
      <ul>
        {list.map((c, i) => {
          const hidden = view[i]?.have === null
          const d = deltaText(delta[i] ?? null, c.unit)
          return (
            <li key={`${c.kind}-${i}`} className={`is-${c.status}`}>
              <Dot s={c.status} />
              <span className="sc-md__text">
                {c.text}
                {hidden && <i> · 본인에게 안 보임</i>}
              </span>
              <span className="sc-md__have">{amount(c)}</span>
              <span className={`sc-md__delta${d.startsWith('+') ? ' is-up' : d.startsWith('−') ? ' is-down' : ''}`}>{d}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function FlipForm({
  row: r,
  busy,
  onCancel,
  onFlip,
}: {
  row: Row
  busy: boolean
  onCancel: () => void
  onFlip: (s: 'met' | 'failed' | null, why: string) => void
}) {
  const [to, setTo] = useState<'met' | 'failed' | null | undefined>(undefined)
  const [why, setWhy] = useState('')
  const ready = to !== undefined && why.trim().length > 0
  const options: ['met' | 'failed' | null, string][] = [
    ['met', '달성'],
    ['failed', '실패'],
  ]
  if (r.override) options.push([null, '되돌리기'])

  return (
    <div className="sc-md__form">
      <p>
        지금 <b>{STATUS_LABEL[effOf(r)]}</b>. 무엇으로 바꾸나.
      </p>
      <div className="sc-md__to" role="group" aria-label="바꿀 결과">
        {options.map(([s, name]) => (
          <button key={name} className={to === s ? 'is-on' : ''} aria-pressed={to === s} onClick={() => setTo(s)}>
            {name}
          </button>
        ))}
      </div>
      <textarea
        rows={2}
        maxLength={REASON_MAX}
        placeholder="까닭 — 꼭 적는다. 기록에 남는다"
        value={why}
        onChange={(e) => setWhy(e.target.value)}
      />
      {r.sentAtMs !== null && <p className="sc-md__warn">이미 보냈다. 바꾸면 다시 보내야 간다.</p>}
      <div className="sc-ad__row">
        <button onClick={onCancel}>그만</button>
        <button className="sc-md__do" disabled={busy || !ready} onClick={() => onFlip(to ?? null, why.trim())}>
          {to === null ? '되돌린다' : '뒤집는다'}
        </button>
      </div>
    </div>
  )
}

/** 받는 사람이 볼 한 장. 서버가 만든 mail 그대로 그린다 */
function MailCard({ mail }: { mail: MissionMail }) {
  const lines = (list: DayClauseView[]) =>
    list.map((c, i) => (
      <li key={i} className={`is-${c.status}`}>
        <Dot s={c.status} />
        <span className="sc-md__text">{c.text}</span>
        <span className="sc-md__have">{amount(c)}</span>
      </li>
    ))
  return (
    <div className="sc-md__mail">
      <p className="sc-md__mailTop">
        DAY {mail.day} · {mail.roleName}
        {mail.final && ' · 최종'}
      </p>
      <p className={`sc-md__result is-${mail.status}`}>{RESULT_LINE[mail.status]}</p>
      <ul>{lines(mail.clauses)}</ul>
      {mail.final && (
        <p className="sc-md__mailSub">
          마지막 선택 — {RESULT_LINE[mail.choice]}
        </p>
      )}
      {mail.line && <p className="sc-md__mission">{mail.line}</p>}
    </div>
  )
}

function SendSheet({
  day,
  rows,
  all,
  busy,
  stale,
  onClose,
  onSend,
}: {
  day: number
  rows: Row[]
  all: boolean
  busy: boolean
  stale: (r: Row) => boolean
  onClose: () => void
  onSend: () => void
}) {
  const [peek, setPeek] = useState<string | null>(rows.length === 1 ? rows[0].playerId : null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const again = rows.filter((r) => r.sentAtMs !== null && !stale(r)).length
  const one = rows.length === 1 ? rows[0] : null
  const title = one ? `${one.name}에게 보낸다` : all ? `전부 ${rows.length} 명에게 보낸다` : `고른 ${rows.length} 명에게 보낸다`

  return (
    <div className="sc-md__veil" role="presentation" onClick={onClose}>
      <div className="sc-md__sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="sc-md__top">
          <h3>
            DAY {day} · {title}
          </h3>
          <button className="sc-md__x" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </header>
        <p className="sc-ad__hint">받는 사람에게는 아래 모습 그대로 간다. 까닭과 숨긴 값은 안 간다.</p>

        {one ? (
          <MailCard mail={one.mail} />
        ) : (
          <ul className="sc-md__peek">
            {rows.map((r) => (
              <li key={r.playerId}>
                <button aria-expanded={peek === r.playerId} onClick={() => setPeek(peek === r.playerId ? null : r.playerId)}>
                  <Dot s={r.mail.status} />
                  <b>{r.name}</b>
                  <span>{RESULT_LINE[r.mail.status]}</span>
                  {r.sentAtMs !== null && <em>{stale(r) ? '다시' : '보냄'}</em>}
                  <i aria-hidden="true">{peek === r.playerId ? '▾' : '▸'}</i>
                </button>
                {peek === r.playerId && <MailCard mail={r.mail} />}
              </li>
            ))}
          </ul>
        )}

        {again > 0 && (
          <p className="sc-md__warn">
            {one ? '이미 보냈다.' : `${again} 명은 이미 보냈다.`} 다시 보내면 덮어쓰고, 팝업이 다시 뜬다.
          </p>
        )}
        <div className="sc-ad__row">
          <button onClick={onClose}>그만</button>
          <button className="sc-md__do" disabled={busy || rows.length === 0} onClick={onSend}>
            {one ? '보낸다' : `${rows.length} 명에게 보낸다`}
          </button>
        </div>
      </div>
    </div>
  )
}
