// 종이 이력 — 운영자 화면의 「이력」 탭. 쪽지 탭의 「이력」 단추도 여기 팝업을 쓴다.
//
// 판에 나간 종이(쪽지 · 메모 · 문제)가 수십 장이 되어도 한 장에 한 줄만
// 차지하게 둔다. 줄에는 이름 · 상태 · 발견한 사람 · 지금 있는 곳까지만,
// 누가 언제 무엇을 했는지는 줄을 누르면 아래에서 올라오는 팝업에서 본다.
//
// **서버가 다 모아 준다**(hostPapers). 운영자만 부를 수 있다.
import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  PAPER_KIND_LABEL,
  PAPER_STATE_LABEL,
  TRAIL_LABEL,
  type PaperKind,
  type PaperRow,
  type PaperState,
} from '../../../shared/rules/paperTrail'
import { josa } from '../../../shared/text'
import type { GameActions } from '../game/useGame'

/** 한 번에 보이는 줄 수. 더 있으면 「더 보기」 */
const PAGE = 20

type KindFilter = PaperKind | ''
/** 끝 = 찢김 · 풀림 */
type StateFilter = '' | 'floor' | 'held' | 'done'

const isDone = (s: PaperState) => s === 'torn' || s === 'solved'

/** 게임 시계는 서울 시각이다 */
function clock(ms: number | null): string {
  if (ms == null) return ''
  const d = new Date(ms)
  const f = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? ''
  return `${get('month')}.${get('day')} ${get('hour')}:${get('minute')}`
}

/** 지금 어디 있나 — 한 줄짜리 */
function nowWhere(p: PaperRow): string {
  if (p.state === 'held') return `${p.holder ?? '누군가'} 손에`
  if (p.state === 'floor') return `${p.where ?? '?'} 바닥`
  const who = p.doneBy ?? '누군가'
  return `${who}${josa(who, '이/가')} ${p.state === 'torn' ? '찢음' : '맞힘'}`
}

/** 한 장의 이력 팝업. 아래에서 올라온다 — 바깥을 누르거나 Esc 로 닫는다 */
export function TrailSheet({ paper, onClose }: { paper: PaperRow; onClose: () => void }) {
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const facts: [string, string][] = [
    ['처음 놓인 곳', [paper.placedAt ?? '—', clock(paper.placedAtMs)].filter(Boolean).join(' · ')],
    ['발견(처음 주움)', paper.foundBy ?? '아직 아무도'],
    ['지금', nowWhere(paper)],
  ]
  if (paper.kind !== 'quiz') facts.push(['읽은 사람', paper.readers.length ? paper.readers.join(', ') : '아직 없음'])

  return (
    <div className="sc-pt__veil" role="presentation" onClick={onClose}>
      <div
        className="sc-pt__sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`${paper.title} 이력`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sc-pt__grip" aria-hidden="true" />
        <header className="sc-pt__top">
          <span className={`sc-pt__kind is-${paper.kind}`}>{PAPER_KIND_LABEL[paper.kind]}</span>
          <h3>{paper.title || '(빈 종이)'}</h3>
          <button className="sc-pt__x" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </header>

        {paper.text && (
          <button className="sc-pt__text" aria-expanded={wide} onClick={() => setWide(!wide)}>
            {wide || paper.text.length <= 40 ? paper.text : `${paper.text.slice(0, 40)}…`}
          </button>
        )}

        <dl className="sc-pt__facts">
          {facts.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>

        <h4 className="sc-pt__sub">있었던 일 {paper.trail.length}</h4>
        {paper.trail.length === 0 ? (
          <p className="sc-pt__none">아직 아무도 손대지 않았다.</p>
        ) : (
          <ol className="sc-pt__trail">
            {paper.trail.map((t, i) => (
              <li key={i} className={`is-${t.kind}`}>
                <time>{clock(t.atMs)}</time>
                <span>
                  <b>{t.who}</b> {TRAIL_LABEL[t.kind]}
                  {t.to ? ` → ${t.to}` : ''}
                  {t.where ? <em> · {t.where}</em> : null}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}

export function PaperDesk({ act, onSaid }: { act: GameActions; onSaid: (t: string) => void }) {
  const [papers, setPapers] = useState<PaperRow[] | null>(null)
  const [kind, setKind] = useState<KindFilter>('')
  const [state, setState] = useState<StateFilter>('')
  const [limit, setLimit] = useState(PAGE)
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setPapers(((await act.hostPapers()) as { papers: PaperRow[] }).papers)
    } catch (e) {
      onSaid((e as Error).message)
    }
  }, [act, onSaid])
  useEffect(() => {
    void load()
  }, [load])

  const all = useMemo(() => papers ?? [], [papers])
  const shown = all.filter(
    (p) =>
      (kind === '' || p.kind === kind) &&
      (state === '' || (state === 'done' ? isDone(p.state) : p.state === state)),
  )
  const count = (f: (p: PaperRow) => boolean) => all.filter(f).length
  const open = openId ? (all.find((p) => p.id === openId) ?? null) : null

  if (!papers) return <p className="sc-ad__hint">이력을 읽는 중이다.</p>

  return (
    <div className="sc-pt">
      <div className="sc-sd__sum" role="status">
        <span>
          나간 종이 <b>{all.length}</b>
        </span>
        <span>
          바닥 <b>{count((p) => p.state === 'floor')}</b>
        </span>
        <span>
          손에 <b>{count((p) => p.state === 'held')}</b>
        </span>
        <span>
          끝 <b>{count((p) => isDone(p.state))}</b>
        </span>
        <button className="sc-pt__reload" onClick={() => void load()}>
          새로 읽기
        </button>
      </div>

      <div className="sc-pt__chips" role="group" aria-label="종류">
        {(['', 'note', 'memo', 'quiz'] as const).map((k) => (
          <button
            key={k || 'all'}
            className={kind === k ? 'is-on' : ''}
            aria-pressed={kind === k}
            onClick={() => {
              setKind(k)
              setLimit(PAGE)
            }}
          >
            {k === '' ? '전체' : PAPER_KIND_LABEL[k]} {k === '' ? all.length : count((p) => p.kind === k)}
          </button>
        ))}
      </div>
      <div className="sc-pt__chips" role="group" aria-label="상태">
        {(
          [
            ['', '전체'],
            ['held', '손에'],
            ['floor', '바닥'],
            ['done', '끝'],
          ] as const
        ).map(([s, name]) => (
          <button
            key={s || 'all'}
            className={state === s ? 'is-on' : ''}
            aria-pressed={state === s}
            onClick={() => {
              setState(s)
              setLimit(PAGE)
            }}
          >
            {name}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="sc-ad__hint">해당하는 종이가 없다.</p>
      ) : (
        <ul className="sc-pt__list">
          {shown.slice(0, limit).map((p) => (
            <li key={p.id}>
              <button className={`sc-pt__row is-${p.state}`} onClick={() => setOpenId(p.id)}>
                <span className={`sc-pt__kind is-${p.kind}`}>{PAPER_KIND_LABEL[p.kind]}</span>
                <span className="sc-pt__main">
                  <span className="sc-pt__title">{p.title || '(빈 종이)'}</span>
                  <span className="sc-pt__meta">
                    발견 {p.foundBy ?? '—'} · {nowWhere(p)}
                  </span>
                </span>
                <span className={`sc-pt__state is-${p.state}`}>{PAPER_STATE_LABEL[p.state]}</span>
                <span className="sc-pt__more" aria-hidden="true">
                  ›
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {shown.length > limit && (
        <button className="sc-pt__page" onClick={() => setLimit(limit + PAGE)}>
          더 보기 ({shown.length - limit}장 남음)
        </button>
      )}

      {open && <TrailSheet paper={open} onClose={() => setOpenId(null)} />}
    </div>
  )
}
