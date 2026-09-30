// 감독관 — 답안지. 열고, 누가 냈는지 보고, 채점해서 모두에게 보낸다.
import { useCallback, useEffect, useState } from 'react'

import type { GameDoc } from '../../../shared/model'
import { ROLE_NAMES, canonRoleId } from '../../../shared/missions/roleNames'
import type { GameActions } from '../game/useGame'

interface Row {
  playerId: string
  name: string
  submitted: boolean
  atMs: number | null
  answers: Record<string, string>
  preview: { correct: number; total: number; score: number } | null
}

const roleLabel = (id: string | undefined) => {
  const r = canonRoleId(id)
  return r ? ROLE_NAMES[r] : '—'
}

export function AnswerDesk({ game, act, onSaid }: { game: GameDoc; act: GameActions; onSaid: (t: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const isOpen = Boolean(game.answerSheet)

  const load = useCallback(async () => {
    try {
      const r = (await act.hostAnswers()) as { rows?: Row[] }
      setRows(r.rows ?? [])
    } catch (e) {
      onSaid((e as Error).message)
    }
  }, [act, onSaid])
  useEffect(() => {
    void load()
  }, [load, game.answerSheet, game.answerResult])

  async function run(fn: () => Promise<unknown>, said: string) {
    setBusy(true)
    try {
      await fn()
      onSaid(said)
      await load()
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const done = rows.filter((r) => r.submitted).length
  const nameOf = (id: string) => rows.find((r) => r.playerId === id)?.name ?? '?'
  return (
    <div className="sc-an-desk">
      <div className="sc-ad__row">
        {isOpen ? (
          <button disabled={busy} onClick={() => void run(() => act.hostOpenAnswers(false), '답안지를 닫았다.')}>
            답안지 닫기
          </button>
        ) : (
          <button className="is-primary" disabled={busy} onClick={() => void run(() => act.hostOpenAnswers(true), '답안지를 모두에게 띄웠다.')}>
            답안지 제출
          </button>
        )}
        <button className="is-primary" disabled={busy || done === 0} onClick={() => void run(() => act.hostGradeAnswers(), '채점해서 모두에게 보냈다.')}>
          채점하기
        </button>
        <button disabled={busy} onClick={() => void load()}>
          새로 읽기
        </button>
      </div>
      <p className="sc-ad__hint">
        {isOpen ? '열려 있다 — 모두의 화면에 답안지가 떠 있다.' : game.answerResult ? '채점해서 보냈다.' : '닫혀 있다.'} 낸 사람 {done} / {rows.length}
      </p>
      <ul className="sc-an-desk__list">
        {rows.map((r) => (
          <li key={r.playerId}>
            <button className="sc-an-desk__who" onClick={() => setOpen(open === r.playerId ? null : r.playerId)} disabled={!r.submitted}>
              <b>{r.name}</b>
              <span>{r.submitted ? `냈다 · 미리 본 점수 ${r.preview?.score ?? 0} 점 (${r.preview?.correct ?? 0}/${r.preview?.total ?? 0})` : '아직 안 냈다'}</span>
            </button>
            {open === r.playerId && (
              <ol className="sc-an-desk__ans">
                {Object.entries(r.answers).map(([pid, role]) => (
                  <li key={pid}>
                    {nameOf(pid)} → {roleLabel(role)}
                  </li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
