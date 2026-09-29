// 쪽지 56장 배포 — 운영자 화면의 「쪽지」 탭.
//
// **서버가 판을 준다**(hostSlipBoard). 문안 전문도 거기서 온다 — 운영자
// 몫이라 {이름}은 실제 이름으로 바뀌어 있다. 번들에는 문안이 없다.
//
//   한눈에   뿌림 n / 56 · 주움 · 찢김
//   경고     이름형과 역할형이 하나라도 같이 나갔으면 「완성 가능」 노란 점 ·
//            같은 날 한 역할이 두 장 이상이면 「몰림」 · 3~4번을 DAY 3 전에
//            뿌리면 한 번 더
//   목록     역할 열넷을 접어 둔다. 펼치면 넉 장 — 번호 · 종류 · 문안 · 상태 · 위치 · 단추
//
// 화면이 막는 것은 편의뿐이다. 뿌리기 · 회수 · 무작위는 서버가 다시 본다.
import { useCallback, useEffect, useMemo, useState } from 'react'

import { FLOOR_NAME, TILE_BY_ID } from '../../../shared/rules/board'
import { ROLE_IDS, ROLE_NAMES, type RoleId } from '../../../shared/missions/roleNames'
import {
  SCATTER_ROOMS,
  SLIP_STATE_LABEL,
  needsEarlyConfirm,
  roleWarn,
  type BoardNote,
  type SlipState,
} from '../../../shared/rules/slipBoard'
import { Sure } from '../game/Sheet'
import type { PaperRow } from '../../../shared/rules/paperTrail'
import { TrailSheet } from './PaperDesk'
import type { GameActions } from '../game/useGame'

interface Board {
  day: number
  running: boolean
  assigned: boolean
  lateFromDay: number
  notes: BoardNote[]
}

type Sort = 'role' | 'state'
const STATE_ORDER: SlipState[] = ['waiting', 'placed', 'held', 'torn']
const KIND_LABEL = { role: '역할', name: '이름' } as const
const PREVIEW = 20

/** 방 목록. 층 이름을 앞에 — 같은 이름이 층마다 있을 때가 있다 */
const ROOM_OPTIONS = SCATTER_ROOMS.map((id) => ({ id, label: `${FLOOR_NAME[TILE_BY_ID[id].floor]} · ${TILE_BY_ID[id].name}` }))

function stateText(n: BoardNote): string {
  if (n.state === 'placed') return `뿌림(${n.room ? TILE_BY_ID[n.room].name : '?'})`
  if (n.state === 'held') return `주움(${n.holder ?? '?'})`
  return SLIP_STATE_LABEL[n.state]
}

export function SlipDesk({ act, onSaid }: { act: GameActions; onSaid: (t: string) => void }) {
  const [board, setBoard] = useState<Board | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<Set<RoleId>>(new Set())
  const [full, setFull] = useState<Set<string>>(new Set())
  const [where, setWhere] = useState<Record<string, string>>({})
  const [fRole, setFRole] = useState<RoleId | ''>('')
  const [fSlot, setFSlot] = useState<'' | '1' | '2' | '3' | '4'>('')
  const [fState, setFState] = useState<SlipState | ''>('')
  const [sort, setSort] = useState<Sort>('role')
  const [howMany, setHowMany] = useState(4)
  const [trail, setTrail] = useState<PaperRow | null>(null)

  /** 한 장의 이력 — 누를 때만 서버에 묻는다. 뿌린 뒤라야 이력이 있다 */
  const showTrail = async (slipId: string) => {
    try {
      const { papers } = (await act.hostPapers()) as { papers: PaperRow[] }
      const p = papers.find((x) => x.id === slipId)
      if (p) setTrail(p)
      else onSaid('이력을 못 찾았다.')
    } catch (e) {
      onSaid((e as Error).message)
    }
  }

  const load = useCallback(async () => {
    try {
      setBoard((await act.hostSlipBoard()) as Board)
    } catch (e) {
      onSaid((e as Error).message)
    }
  }, [act, onSaid])
  useEffect(() => {
    void load()
  }, [load])

  async function run(fn: () => Promise<unknown>, said: (r: unknown) => string) {
    setBusy(true)
    try {
      const r = await fn()
      onSaid(said(r))
      await load()
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const notes = useMemo(() => board?.notes ?? [], [board])
  const counts = useMemo(
    () => ({
      out: notes.filter((n) => n.state !== 'waiting').length,
      held: notes.filter((n) => n.state === 'held').length,
      torn: notes.filter((n) => n.state === 'torn').length,
    }),
    [notes],
  )

  const shown = (n: BoardNote) =>
    (fSlot === '' || String(n.slot) === fSlot) && (fState === '' || n.state === fState)
  const roles = ROLE_IDS.filter((r) => fRole === '' || r === fRole)
    .map((r) => ({ id: r, all: notes.filter((n) => n.roleKey === r) }))
    .filter((g) => g.all.some(shown))
  if (sort === 'state') {
    roles.sort(
      (a, b) =>
        b.all.filter((n) => n.state !== 'waiting').length - a.all.filter((n) => n.state !== 'waiting').length ||
        a.all[0].no - b.all[0].no,
    )
  }

  if (!board) return <p className="sc-ad__hint">배포판을 읽는 중이다.</p>

  const toggle = <T,>(set: Set<T>, v: T, put: (s: Set<T>) => void) => {
    const next = new Set(set)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    put(next)
  }

  const scatter = (n: BoardNote) => {
    const room = where[n.id] ?? ''
    void run(
      () => act.hostScatterSlip(n.id, room, needsEarlyConfirm(n.slot, board.day)),
      (r) => `${(r as { where?: string }).where ?? ''}에 뿌렸다.`,
    )
  }

  return (
    <div className="sc-sd">
      {/* ── 한눈에 ── */}
      <div className="sc-sd__sum" role="status">
        <span>
          뿌림 <b>{counts.out}</b> / {notes.length}
        </span>
        <span>
          주움 <b>{counts.held}</b>
        </span>
        <span>
          찢김 <b>{counts.torn}</b>
        </span>
        <span className="sc-sd__day">DAY {board.day}</span>
      </div>
      {!board.assigned && <p className="sc-ad__hint">역할을 아직 안 나눴다. 나눈 뒤에 뿌린다 — 쪽지의 주인은 그 역할을 받은 사람이다.</p>}

      {/* ── 무작위 ── */}
      <div className="sc-sd__rand">
        <label htmlFor="sd-n">무작위로</label>
        <input
          id="sd-n"
          type="number"
          inputMode="numeric"
          min={1}
          max={14}
          value={howMany}
          onChange={(e) => setHowMany(Math.max(1, Math.min(14, Number(e.target.value) || 1)))}
        />
        <button
          disabled={busy || !board.running || !board.assigned}
          onClick={() =>
            void run(
              () => act.hostScatterRandom(howMany),
              (r) => {
                const o = r as { scattered?: number; asked?: number }
                return `${o.scattered ?? 0}장을 뿌렸다${(o.scattered ?? 0) < (o.asked ?? 0) ? ` — 조건에 맞는 것이 ${o.scattered ?? 0}장뿐이다` : ''}.`
              },
            )
          }
        >
          장 뿌리기
        </button>
      </div>
      <p className="sc-ad__hint">
        대기 중에서 고른다. 3~4번(그날)은 DAY {board.lateFromDay}부터 후보에 들고, 한 역할이 같은 날 두 장이 되지 않게 빈 방부터 흩는다.
      </p>

      {/* ── 거르기 · 줄 세우기 ── */}
      <div className="sc-sd__filters">
        <select aria-label="역할" value={fRole} onChange={(e) => setFRole(e.target.value as RoleId | '')}>
          <option value="">역할 전부</option>
          {ROLE_IDS.map((r, i) => (
            <option key={r} value={r}>
              {String(i + 1).padStart(2, '0')} {ROLE_NAMES[r]}
            </option>
          ))}
        </select>
        <select aria-label="번호" value={fSlot} onChange={(e) => setFSlot(e.target.value as '' | '1' | '2' | '3' | '4')}>
          <option value="">번호 전부</option>
          <option value="1">1번</option>
          <option value="2">2번</option>
          <option value="3">3번</option>
          <option value="4">4번</option>
        </select>
        <select aria-label="상태" value={fState} onChange={(e) => setFState(e.target.value as SlipState | '')}>
          <option value="">상태 전부</option>
          {STATE_ORDER.map((s) => (
            <option key={s} value={s}>
              {SLIP_STATE_LABEL[s]}
            </option>
          ))}
        </select>
        <select aria-label="정렬" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="role">역할 순</option>
          <option value="state">상태 순</option>
        </select>
      </div>

      {/* ── 역할 열넷 ── */}
      <ul className="sc-sd__roles">
        {roles.map(({ id, all }) => {
          const warn = roleWarn(all)
          const isOpen = open.has(id)
          const rows = all.filter(shown)
          if (sort === 'state') rows.sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state))
          const no = String(all[0]?.no ?? 0).padStart(2, '0')
          return (
            <li key={id} className={`sc-sd__role${isOpen ? ' is-open' : ''}`}>
              <button
                className="sc-sd__head"
                aria-expanded={isOpen}
                onClick={() => toggle(open, id, setOpen)}
              >
                <span className="sc-sd__no">{no}</span>
                <span className="sc-sd__name">{ROLE_NAMES[id]}</span>
                {warn.solvable && (
                  <span className="sc-sd__dot" title="이름형과 역할형이 하나라도 같이 나갔다 — 누구인지 맞출 수 있다">
                    완성 가능
                  </span>
                )}
                {warn.crowdedDays.length > 0 && (
                  <span className="sc-sd__crowd" title="같은 날 이 역할의 쪽지가 두 장 이상 나갔다">
                    몰림 DAY {warn.crowdedDays.join('·')}
                  </span>
                )}
                <span className="sc-sd__count">
                  뿌림 {all.filter((n) => n.state !== 'waiting').length} / {all.length}
                </span>
              </button>
              {isOpen && (
                <div className="sc-sd__tablewrap">
                  <table className="sc-sd__table">
                    <thead>
                      <tr>
                        <th>번호</th>
                        <th>종류</th>
                        <th>문안</th>
                        <th>상태</th>
                        <th>위치</th>
                        <th aria-label="할 일" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((n) => {
                        const wide = full.has(n.id)
                        const early = n.state === 'waiting' && needsEarlyConfirm(n.slot, board.day)
                        const room = where[n.id] ?? ''
                        return (
                          <tr key={n.id} className={`is-${n.state}`}>
                            <td className="sc-sd__num">{n.slot}</td>
                            <td>{KIND_LABEL[n.kind]}</td>
                            <td>
                              <button
                                className="sc-sd__text"
                                aria-expanded={wide}
                                onClick={() => toggle(full, n.id, setFull)}
                              >
                                {wide || n.text.length <= PREVIEW ? n.text : `${n.text.slice(0, PREVIEW)}…`}
                              </button>
                            </td>
                            <td className="sc-sd__state">
                              {stateText(n)}
                              {n.slipId && (
                                <button className="sc-sd__trail" onClick={() => void showTrail(n.slipId ?? '')}>
                                  이력
                                </button>
                              )}
                            </td>
                            <td>
                              {n.state === 'waiting' ? (
                                <select
                                  aria-label="뿌릴 방"
                                  value={room}
                                  onChange={(e) => setWhere({ ...where, [n.id]: e.target.value })}
                                >
                                  <option value="">— 방 —</option>
                                  {ROOM_OPTIONS.map((o) => (
                                    <option key={o.id} value={o.id}>
                                      {o.label}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <span className="sc-sd__muted">—</span>
                              )}
                            </td>
                            <td>
                              {n.state === 'waiting' ? (
                                early ? (
                                  <Sure
                                    disabled={busy || room === '' || !board.running}
                                    warn={`3~4번(그날)은 DAY ${board.lateFromDay}부터다. 그래도 뿌린다`}
                                    onGo={() => scatter(n)}
                                  >
                                    뿌리기
                                  </Sure>
                                ) : (
                                  <button disabled={busy || room === '' || !board.running} onClick={() => scatter(n)}>
                                    뿌리기
                                  </button>
                                )
                              ) : n.state === 'placed' ? (
                                <button
                                  disabled={busy || n.everHeld || !n.slipId}
                                  title={n.everHeld ? '누가 한 번 주웠던 것은 회수 못 한다' : undefined}
                                  onClick={() =>
                                    void run(() => act.hostPullSlip(n.slipId ?? ''), () => '회수했다. 다시 대기다.')
                                  }
                                >
                                  회수
                                </button>
                              ) : (
                                <span className="sc-sd__muted">—</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {trail && <TrailSheet paper={trail} onClose={() => setTrail(null)} />}
    </div>
  )
}
