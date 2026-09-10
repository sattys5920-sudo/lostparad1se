import { useState } from 'react'
import './LobbyScreen.css'
import { useSchoolGame } from '../state/SchoolGameContext'
import { MAX_PLAYERS, MIN_PLAYERS } from '../data/roles'
import { withParticle } from '../lib/particle'

export function LobbyScreen() {
  const {
    isHost,
    players,
    hostAssignRoles,
    hostRemovePlayer,
    hostResetSession,
    hostSeedTestPlayers,
    hostRemoveTestPlayers,
    botCount,
    logout,
  } = useSchoolGame()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
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

  async function fillWithTestPlayers() {
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const added = await hostSeedTestPlayers(MAX_PLAYERS)
      setNotice(added > 0 ? `테스트 인원 ${added}명을 채웠다.` : '이미 정원이 찼다.')
    } catch (e) {
      setError(e instanceof Error ? e.message : '테스트 인원을 채우지 못했다.')
    } finally {
      setBusy(false)
    }
  }

  async function clearTestPlayers() {
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const removed = await hostRemoveTestPlayers()
      setNotice(`테스트 인원 ${removed}명을 뺐다.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '테스트 인원을 빼지 못했다.')
    } finally {
      setBusy(false)
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
            <span className="sc-lobby__name">
              {p.nickname}
              {p.isBot && <span className="sc-lobby__bot">테스트</span>}
            </span>
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
          {notice && <p className="sc-lobby__notice">{notice}</p>}
          <button className="sc-lobby__start" disabled={!canStart || busy} onClick={start}>
            역할과 팀을 배정하고 시작한다
          </button>

          <div className="sc-lobby__qa">
            <span className="sc-lobby__qa-label">사람이 모자랄 때 · QA용</span>
            <div className="sc-lobby__qa-row">
              <button disabled={busy || count >= MAX_PLAYERS} onClick={fillWithTestPlayers}>
                {MAX_PLAYERS}명까지 채우기
              </button>
              <button disabled={busy || botCount === 0} onClick={clearTestPlayers}>
                테스트 인원 {botCount > 0 ? `${botCount}명 ` : ''}빼기
              </button>
            </div>
            <p className="sc-lobby__qa-note">
              채운 인원도 역할과 팀을 정상적으로 받는다. 진행 화면에서 이들의 표를 한 번에 던지게 할 수 있다.
            </p>
          </div>

          <button className="sc-lobby__reset" disabled={busy} onClick={reset}>
            {confirmReset ? '정말 명단을 비운다 (다시 누르면 실행)' : '명단 비우기'}
          </button>
        </div>
      ) : (
        <div className="sc-lobby__waiting">
          <p className="sc-lobby__wait">진행자가 시작할 때까지 기다린다.</p>
          {/* 학생으로 한 번 들어오면 진입 화면이 다시 뜨지 않는다. 진행자로 바꿔 잡을 길을 남겨 둔다. */}
          <button className="sc-lobby__leave" onClick={logout}>
            나가서 다시 정하기
          </button>
        </div>
      )}
    </div>
  )
}
