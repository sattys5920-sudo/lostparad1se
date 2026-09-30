// 답안지 — 마지막에 서로의 역할을 맞힌다.
//
// 감독관이 「답안지 제출」을 누르면 어느 화면에 있든 이 종이가 뜬다.
// 열넷 한 사람 한 사람 옆에 역할을 고르고 낸다. 채점 전까지는 고쳐 낸다.
// 감독관이 「채점하기」를 누르면 정답과 점수가 뜬다(AnswerResult).
//
// **메모 탭은 끌어오지 않는다.** 칸은 비어서 뜨고, 전에 낸 답안이 있으면
// 그것만 다시 채운다.
import { useEffect, useMemo, useState } from 'react'

import type { GameDoc } from '../../../shared/model'
import { ROLE_NAMES, canonRoleId, type RoleId } from '../../../shared/missions/roleNames'
import { ANSWER_ROLES } from '../../../shared/rules/answers'
import type { GameActions } from './useGame'
import './answerSheet.css'

const roleLabel = (id: string | null | undefined): string => {
  const r = canonRoleId(id ?? null)
  return r ? ROLE_NAMES[r] : '—'
}

export function AnswerSheet({ game, gameId, uid, act }: { game: GameDoc; gameId: string; uid: string; act: GameActions }) {
  const openAt = game.answerSheet?.openAtMs ?? null
  const [hidden, setHidden] = useState(false)
  const [picks, setPicks] = useState<Record<string, string>>({})
  const [sentAt, setSentAt] = useState<number | null>(null)
  /** 낸 뒤에 고쳤는가 — 고친 것은 다시 내야 채점에 든다 */
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState('')

  // 열릴 때마다 한 번 — 전에 낸 것이 있으면 그것, 없으면 빈칸
  useEffect(() => {
    if (openAt === null) return
    setHidden(false)
    let live = true
    void (async () => {
      try {
        const mine = (await act.myAnswers()) as { answers?: Record<string, string>; atMs?: number | null }
        if (!live) return
        setPicks(mine.answers ?? {})
        setSentAt(mine.atMs ?? null)
        setDirty(false)
      } catch {
        if (live) setPicks({})
      }
    })()
    return () => {
      live = false
    }
  }, [openAt, gameId, uid, act])

  if (openAt === null) return null
  const seats = game.seats
  const filled = seats.filter((s) => picks[s.playerId]).length

  if (hidden) {
    return (
      <button className="sc-ans__reopen" onClick={() => setHidden(false)}>
        {/* 접어 둔다고 내는 것이 아니다 — 「제출」을 눌러야 채점에 든다 */}
        답안지 {sentAt ? (dirty ? '· 고친 것은 아직 안 냈다' : '· 냈다') : `· 아직 안 냈다 ${filled}/${seats.length}`}
      </button>
    )
  }

  async function send() {
    setBusy(true)
    setSaid('')
    try {
      await act.submitAnswers(picks)
      setSentAt(Date.now())
      setDirty(false)
      setSaid('냈다. 감독관이 채점하면 결과가 뜬다. 그 전까지는 고쳐 낼 수 있다.')
    } catch (e) {
      setSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sc-ans" role="dialog" aria-modal="true" aria-label="답안지">
      <div className="sc-ans__sheet">
        <header className="sc-ans__head">
          <p className="sc-ans__eyebrow">2 - 3 교실 · 마지막 시험</p>
          <h2>답 안 지</h2>
          <p className="sc-ans__lead">열넷의 역할을 적는다. 한 문항에 {Math.round(1000 / seats.length) / 10} 점.</p>
        </header>
        <ol className="sc-ans__list">
          {seats.map((s, i) => (
            <li key={s.playerId}>
              <span className="sc-ans__no">{i + 1}.</span>
              <label className="sc-ans__name" htmlFor={`as-${s.playerId}`}>
                {s.name}
                {s.playerId === uid && <em> (나)</em>}
              </label>
              <select
                id={`as-${s.playerId}`}
                value={picks[s.playerId] ?? ''}
                onChange={(e) => {
                  setPicks((p) => ({ ...p, [s.playerId]: e.target.value }))
                  setDirty(true)
                }}
              >
                <option value="">고른다</option>
                {ANSWER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_NAMES[r]}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ol>
        {said && <p className="sc-ans__said">{said}</p>}
        <div className="sc-ans__row">
          <button className="sc-ans__later" onClick={() => setHidden(true)}>
            접어 두기
          </button>
          <button className="sc-ans__send" disabled={busy} onClick={() => void send()}>
            {sentAt ? '고쳐 내기' : '제출'} ({filled}/{seats.length})
          </button>
        </div>
      </div>
    </div>
  )
}

const SEEN = 'sc.answers.seen'

/** 채점 결과. 정답 · 내 점수 · 모두의 점수. 한 번 닫으면 그 채점은 다시 안 뜬다 */
export function AnswerResult({ game, gameId, uid, act }: { game: GameDoc; gameId: string; uid: string; act: GameActions }) {
  const result = game.answerResult ?? null
  const key = `${SEEN}:${gameId}:${uid}`
  const [seenAt, setSeenAt] = useState<number | null>(() => {
    try {
      return Number(localStorage.getItem(key)) || null
    } catch {
      return null
    }
  })
  const [mine, setMine] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!result) return
    void act
      .myAnswers()
      .then((r) => setMine(((r as { answers?: Record<string, string> }).answers ?? {}) as Record<string, string>))
      .catch(() => undefined)
  }, [result, act])
  const me = useMemo(() => result?.scores.find((s) => s.playerId === uid) ?? null, [result, uid])

  if (!result || seenAt === result.atMs) return null
  function close() {
    try {
      localStorage.setItem(key, String(result!.atMs))
    } catch {
      // 못 적으면 다음에 한 번 더 뜬다
    }
    setSeenAt(result!.atMs)
  }
  return (
    <div className="sc-ans" role="dialog" aria-modal="true" aria-label="채점 결과">
      <div className="sc-ans__sheet">
        <header className="sc-ans__head">
          <p className="sc-ans__eyebrow">채 점</p>
          <h2>{me ? `${me.score} 점` : '채점 결과'}</h2>
          {me && <p className="sc-ans__lead">{me.total} 문항 중 {me.correct} 문항을 맞혔다.</p>}
        </header>
        <h3 className="sc-ans__sub">정답</h3>
        <ol className="sc-ans__list is-key">
          {result.key.map((k, i) => {
            const my = mine[k.playerId]
            const ok = canonRoleId(my) === canonRoleId(k.roleId)
            return (
              <li key={k.playerId}>
                <span className="sc-ans__no">{i + 1}.</span>
                <span className="sc-ans__name">{k.name}</span>
                <b className="sc-ans__role">{roleLabel(k.roleId)}</b>
                <span className={'sc-ans__mark' + (ok ? ' is-ok' : ' is-no')} aria-label={ok ? '맞음' : '틀림'}>
                  {ok ? '○' : my ? `✕ ${roleLabel(my)}` : '✕'}
                </span>
              </li>
            )
          })}
        </ol>
        <h3 className="sc-ans__sub">모두의 점수</h3>
        <ol className="sc-ans__scores">
          {result.scores.map((s) => (
            <li key={s.playerId} className={s.playerId === uid ? 'is-me' : ''}>
              <span>{s.name}</span>
              <b>{s.submitted ? `${s.score} 점` : '안 냈다'}</b>
            </li>
          ))}
        </ol>
        <div className="sc-ans__row">
          <button className="sc-ans__send" onClick={close}>
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}

export type { RoleId }
