import { useState } from 'react'
import './LobbyScreen.css'
import { useSchoolGame } from '../state/SchoolGameContext'
import { MAX_PLAYERS, MIN_PLAYERS } from '../data/roles'
import { withParticle } from '../lib/particle'

export function LobbyScreen() {
  const { isHost, players, hostAssignRoles, hostRemovePlayer, hostResetSession } = useSchoolGame()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)

  const roster = Object.values(players)
    .filter((p) => !p.isHost)
    .sort((a, b) => a.joinedAtMs - b.joinedAtMs)
  const count = roster.length
  const canStart = count >= MIN_PLAYERS && count <= MAX_PLAYERS

  async function start() {
    setError('')
    setBusy(true)
    try {
      await hostAssignRoles()
    } catch (e) {
      setError(e instanceof Error ? e.message : '알 수 없는 오류가 발생했다.')
    } finally {
      setBusy(false)
    }
  }

  async function reset() {
    if (!confirmReset) {
      setConfirmReset(true)
      return
    }
    setError('')
    setBusy(true)
    try {
      await hostResetSession()
    } catch (e) {
      setError(e instanceof Error ? `명단을 비우지 못했다. ${e.message}` : '명단을 비우지 못했다.')
    } finally {
      setBusy(false)
      setConfirmReset(false)
    }
  }

  async function kick(playerId: string, nickname: string) {
    setError('')
    try {
      await hostRemovePlayer(playerId)
    } catch (e) {
      const who = withParticle(nickname, 'object')
      setError(e instanceof Error ? `${who} 내보내지 못했다. ${e.message}` : `${who} 내보내지 못했다.`)
    }
  }

  return (
    <div className="sc-lobby">
      <div className="sc-lobby__head">
        <span className="sc-lobby__eyebrow">아직 시작하지 않았다</span>
        <h1>{count}명이 모였다</h1>
        <span className="sc-lobby__range">
          {MAX_PLAYERS}명 기준 · {MIN_PLAYERS}명부터 시작할 수 있다
        </span>
      </div>

      <ul className="sc-lobby__list">
        {roster.map((p, i) => (
          <li key={p.id} className="sc-lobby__row">
            <span className="sc-lobby__index">{String(i + 1).padStart(2, '0')}</span>
            <span className="sc-lobby__name">{p.nickname}</span>
            {isHost && (
              <button className="sc-lobby__kick" onClick={() => kick(p.id, p.nickname)} aria-label={`${p.nickname} 내보내기`}>
                내보내기
              </button>
            )}
          </li>
        ))}
        {roster.length === 0 && <li className="sc-lobby__empty">아직 아무도 들어오지 않았다.</li>}
      </ul>

      {isHost ? (
        <div className="sc-lobby__host">
          {!canStart && (
            <p className="sc-lobby__hint">
              {count < MIN_PLAYERS ? `최소 ${MIN_PLAYERS}명이 필요하다.` : `최대 ${MAX_PLAYERS}명까지 가능하다.`}
            </p>
          )}
          {error && <p className="sc-lobby__error">{error}</p>}
          <button className="sc-lobby__start" disabled={!canStart || busy} onClick={start}>
            역할을 배정하고 시작한다
          </button>
          <button className="sc-lobby__reset" disabled={busy} onClick={reset}>
            {confirmReset ? '정말 명단을 비운다 (다시 누르면 실행)' : '명단 비우기'}
          </button>
        </div>
      ) : (
        <p className="sc-lobby__wait">진행자가 시작할 때까지 기다린다.</p>
      )}
    </div>
  )
}
