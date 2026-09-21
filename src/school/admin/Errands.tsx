// 심부름 — 게시판을 골라 붙이고, 지금 상황을 본다.
//
// **자동 배치는 없다.** 판에 붙는 심부름이 전부 이 화면을 거친다 —
// 지금 이 판에서 무슨 일이 일어나기를 바라는지가 그대로 게시판에
// 붙는다. 대신 운영자가 딴 데 보고 있으면 게시판이 종일 비어 있다.
//
// **목록은 못 고친다.** 열 가지가 데이터 파일에 박혀 있고(rules/errand)
// 물건마다 도트가 하나씩 그려져 있다 — 이름을 자유롭게 적게 두면
// 「석고상」에 상자 그림이 붙는다. 운영자가 정하는 것은 **무엇을 어느
// 게시판에** 붙이느냐 하나다.
import { useCallback, useEffect, useState } from 'react'

import { BOARDS, ERRANDS_PER_BOARD, minutesLeft, type ErrandSpec } from '../../../shared/rules/errand'
import { goodIcon } from '../game/goodArt'
import { TILE_BY_ID } from '../../../shared/rules/board'
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

export function ErrandDesk({ act, onSaid }: { act: GameActions; onSaid: (t: string) => void }) {
  const [pool, setPool] = useState<ErrandSpec[]>([])
  const [posted, setPosted] = useState<Posted[]>([])
  const [nowMs, setNowMs] = useState(0)
  const [busy, setBusy] = useState(false)
  const [pick, setPick] = useState('')
  const [board, setBoard] = useState(BOARDS[0]?.id ?? '')

  const load = useCallback(async () => {
    try {
      const out = (await act.hostErrands()) as { pool?: ErrandSpec[]; posted?: Posted[]; nowMs?: number }
      setPool(out.pool ?? [])
      setPosted(out.posted ?? [])
      setNowMs(out.nowMs ?? 0)
      /*
       * 기본으로 고르는 것은 **오늘 아직 안 나간 첫 것**이다. 첫 줄을
       * 그냥 고르면 비커가 이미 나간 날에 「비커 (오늘 나갔다)」가
       * 골라진 채로 뜨고, 붙이기가 죽어 있는 까닭을 한참 찾는다.
       */
      if (pick === '') {
        const posted = out.posted ?? []
        const day = posted.find((p) => !p.expired && p.doneBy === null)?.day ?? posted[0]?.day
        const gone = new Set(posted.filter((p) => p.day === day).map((p) => p.specId))
        const first = (out.pool ?? []).find((e) => !gone.has(e.id)) ?? (out.pool ?? [])[0]
        if (first) setPick(first.id)
      }
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
      {/* ── 붙이기 ──────────────────────────────────────── */}
      <label className="sc-dr__row">
        <span>무엇</span>
        <select value={pick} onChange={(e) => setPick(e.target.value)}>
          {pool.map((e) => (
            <option key={e.id} value={e.id} disabled={today.has(e.id)}>
              {e.thing} · {TILE_BY_ID[e.from]?.name} → {TILE_BY_ID[e.to]?.name}
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
        className="is-primary"
        disabled={busy || pick === '' || onBoard(board) >= ERRANDS_PER_BOARD}
        onClick={() => void run('붙였다.', () => act.hostPostErrand(pick, board))}
      >
        붙이기
      </button>

      {/* ── 지금 ────────────────────────────────────────── */}
      <h3>지금 판 위 {live.length > 0 && <em>{live.length}장</em>}</h3>
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

      {/*
        ── 풀 ───────────────────────────────────────────
        **접어 둔다.** 열 가지가 늘 펼쳐져 있으면 붙이는 칸 하나
        보려고 두 화면을 내려야 한다 — 고를 때는 위 목록에 다 있고,
        무엇인지 읽고 싶을 때만 편다.
      */}
      <details className="sc-ed__pool">
        <summary>심부름 {pool.length}가지 — 물건 · 길 · 값 · 시간</summary>
        <ul>
          {pool.map((e) => (
            <li key={e.id}>
              <b>
                <img className="sc-ed__icon" src={goodIcon(e.icon ?? 'box')} alt="" width={18} height={18} />
                {e.thing}
              </b>
              <span>
                {TILE_BY_ID[e.from]?.name} → {TILE_BY_ID[e.to]?.name} · {e.coins}코인 · {e.limitMin}분
              </span>
              <p>{e.text}</p>
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
