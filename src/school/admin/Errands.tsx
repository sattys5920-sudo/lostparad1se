// 심부름 — 풀에 넣고, 게시판을 골라 붙이고, 지금 상황을 본다.
//
// **자동 배치는 없다.** 판에 붙는 심부름이 전부 이 화면을 거친다 —
// 지금 이 판에서 무슨 일이 일어나기를 바라는지가 그대로 게시판에
// 붙는다. 대신 운영자가 딴 데 보고 있으면 게시판이 종일 비어 있다.
import { useCallback, useEffect, useState } from 'react'

import { BOARDS, ERRANDS_PER_BOARD, minutesLeft, type ErrandSpec } from '../../../shared/rules/errand'
import { TILES, TILE_BY_ID, FLOOR_NAME } from '../../../shared/rules/board'
import type { GameActions } from '../game/useGame'

interface Posted {
  id: string
  specId: string
  boardId: string
  board: string
  thing: string
  postedMs: number
  limitMin: number
  day: number
  takers: number
  doneBy: string | null
  expired: boolean
}

const EMPTY: ErrandSpec = { id: '', thing: '', from: 'labRoom', to: 'annex', coins: 1, limitMin: 30, text: '' }

export function ErrandDesk({ act, onSaid }: { act: GameActions; onSaid: (t: string) => void }) {
  const [pool, setPool] = useState<ErrandSpec[]>([])
  const [posted, setPosted] = useState<Posted[]>([])
  const [nowMs, setNowMs] = useState(0)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<ErrandSpec | null>(null)
  const [pick, setPick] = useState('')
  const [board, setBoard] = useState(BOARDS[0]?.id ?? '')

  const load = useCallback(async () => {
    try {
      const out = (await act.hostErrands()) as { pool?: ErrandSpec[]; posted?: Posted[]; nowMs?: number }
      setPool(out.pool ?? [])
      setPosted(out.posted ?? [])
      setNowMs(out.nowMs ?? 0)
      if (pick === '' && (out.pool ?? []).length > 0) setPick((out.pool ?? [])[0].id)
    } catch (e) {
      onSaid((e as Error).message)
    }
  }, [act, onSaid, pick])

  useEffect(() => {
    void load()
  }, [load])

  async function run(what: string, fn: () => Promise<unknown>) {
    setBusy(true)
    try {
      await fn()
      onSaid(what)
      await load()
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const live = posted.filter((p) => !p.expired && p.doneBy === null)
  /** 오늘 이미 나간 것. 다시 못 붙인다 — 자동 배치가 없어도 규칙은 같다 */
  const today = new Set(posted.filter((p) => p.day === (live[0]?.day ?? p.day)).map((p) => p.specId))
  const onBoard = (id: string) => live.filter((p) => p.boardId === id).length

  return (
    <div className="sc-ed">
      {/* ── 풀 ─────────────────────────────────────────── */}
      <h3>심부름 풀</h3>
      {pool.length === 0 ?
        <p className="sc-ad__hint">등록된 것이 없다. 풀이 비면 붙일 것도 없다.</p>
      : <ul className="sc-ed__pool">
          {pool.map((e) => (
            <li key={e.id}>
              <b>{e.thing}</b>
              <span>
                {TILE_BY_ID[e.from]?.name} → {TILE_BY_ID[e.to]?.name} · {e.coins}코인 · {e.limitMin}분
              </span>
              <p>{e.text}</p>
              <div className="sc-ed__row">
                <button disabled={busy} onClick={() => setForm({ ...e })}>
                  수정
                </button>
                <button disabled={busy} onClick={() => void run('지웠다.', () => act.hostDeleteErrand(e.id))}>
                  삭제
                </button>
              </div>
            </li>
          ))}
        </ul>
      }
      {!form && (
        <button className="sc-ed__add" disabled={busy} onClick={() => setForm({ ...EMPTY })}>
          + 새로 등록
        </button>
      )}

      {form && (
        <div className="sc-ed__form">
          <label className="sc-dr__row">
            <span>아이디</span>
            <input value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} />
          </label>
          <label className="sc-dr__row">
            <span>물건</span>
            <input value={form.thing} onChange={(e) => setForm({ ...form, thing: e.target.value })} />
          </label>
          <label className="sc-dr__row">
            <span>가져올</span>
            <select value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value as ErrandSpec['from'] })}>
              {TILES.map((t) => (
                <option key={t.id} value={t.id}>
                  {FLOOR_NAME[t.floor]} · {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="sc-dr__row">
            <span>놓을</span>
            <select value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value as ErrandSpec['to'] })}>
              {TILES.map((t) => (
                <option key={t.id} value={t.id}>
                  {FLOOR_NAME[t.floor]} · {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="sc-dr__row">
            <span>보상</span>
            <input
              type="number"
              value={form.coins}
              onChange={(e) => setForm({ ...form, coins: Number(e.target.value) })}
            />
          </label>
          <label className="sc-dr__row">
            <span>제한(분)</span>
            <input
              type="number"
              value={form.limitMin}
              onChange={(e) => setForm({ ...form, limitMin: Number(e.target.value) })}
            />
          </label>
          <label className="sc-dr__row sc-dr__row--tall">
            <span>설명</span>
            <textarea rows={2} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} />
          </label>
          <div className="sc-ed__row">
            <button
              disabled={busy || form.id.trim() === '' || form.thing.trim() === ''}
              onClick={() =>
                void run('등록했다.', async () => {
                  await act.hostSaveErrand(form)
                  setForm(null)
                })
              }
            >
              저장
            </button>
            <button disabled={busy} onClick={() => setForm(null)}>
              그만
            </button>
          </div>
        </div>
      )}

      {/* ── 붙이기 ──────────────────────────────────────── */}
      <h3>붙이기</h3>
      <label className="sc-dr__row">
        <span>무엇</span>
        <select value={pick} onChange={(e) => setPick(e.target.value)}>
          {pool.map((e) => (
            <option key={e.id} value={e.id} disabled={today.has(e.id)}>
              {e.thing}
              {today.has(e.id) ? ' (오늘 나갔다)' : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="sc-dr__row">
        <span>어디</span>
        <select value={board} onChange={(e) => setBoard(e.target.value)}>
          {BOARDS.map((b) => (
            <option key={b.id} value={b.id} disabled={onBoard(b.id) >= ERRANDS_PER_BOARD}>
              {b.name} · {onBoard(b.id)}/{ERRANDS_PER_BOARD}
            </option>
          ))}
        </select>
      </label>
      <button
        className="sc-dr__go"
        disabled={busy || pick === '' || onBoard(board) >= ERRANDS_PER_BOARD}
        onClick={() => void run('붙였다.', () => act.hostPostErrand(pick, board))}
      >
        붙이기
      </button>
      <p className="sc-dr__hint">
        붙고 난 뒤의 규칙은 누가 붙였든 같다. 받는 사람에게는 운영자가 붙였다는 티가 안 난다.
      </p>

      {/* ── 지금 ────────────────────────────────────────── */}
      <h3>지금 판 위</h3>
      {live.length === 0 ?
        <p className="sc-ad__hint">붙어 있는 것이 없다.</p>
      : <ul className="sc-ed__live">
          {live.map((p) => (
            <li key={p.id}>
              <b>{p.thing}</b>
              <span>{p.board}</span>
              {/* **누가 받았는지는 안 온다.** 경주하는 중이라 운영자
                  화면에도 이름을 안 싣는다 — 세는 것까지다 */}
              <em>받은 사람 {p.takers}</em>
              <i>{minutesLeft(p.postedMs, p.limitMin, nowMs)}분</i>
            </li>
          ))}
        </ul>
      }
    </div>
  )
}
