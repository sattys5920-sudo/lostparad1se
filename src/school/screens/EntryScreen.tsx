import { useState } from 'react'
import './EntryScreen.css'
import { useSchoolGame } from '../state/SchoolGameContext'

export function EntryScreen() {
  const { joinAsPlayer, loginAsHost } = useSchoolGame()
  const [mode, setMode] = useState<'player' | 'host'>('player')
  const [nickname, setNickname] = useState('')
  const [hostCode, setHostCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submitPlayer() {
    setError('')
    setBusy(true)
    try {
      await joinAsPlayer(nickname)
    } catch (e) {
      setError(e instanceof Error ? e.message : '알 수 없는 오류가 발생했다.')
    } finally {
      setBusy(false)
    }
  }

  function submitHost() {
    setError('')
    try {
      loginAsHost(hostCode)
    } catch (e) {
      setError(e instanceof Error ? e.message : '알 수 없는 오류가 발생했다.')
    }
  }

  return (
    <div className="sc-entry">
      <div className="sc-entry__intro">
        <span className="sc-entry__eyebrow">셋째 날 · 안개가 걷히기 전</span>
        <h1>당신은 누구입니까</h1>
      </div>

      {mode === 'player' ? (
        <>
          <label className="sc-entry__field">
            <span>닉네임</span>
            <input
              value={nickname}
              maxLength={12}
              placeholder="반에서 불리던 이름"
              onChange={(e) => setNickname(e.target.value)}
            />
          </label>
          {error && <p className="sc-entry__error">{error}</p>}
          <button className="sc-entry__submit" disabled={busy || !nickname.trim()} onClick={submitPlayer}>
            들어가기
          </button>
          <button className="sc-entry__switch" onClick={() => setMode('host')}>
            진행자로 들어가기
          </button>
        </>
      ) : (
        <>
          <label className="sc-entry__field">
            <span>진행자 코드</span>
            <input
              value={hostCode}
              type="password"
              placeholder="코드 입력"
              onChange={(e) => setHostCode(e.target.value)}
            />
          </label>
          {error && <p className="sc-entry__error">{error}</p>}
          <button className="sc-entry__submit" disabled={!hostCode.trim()} onClick={submitHost}>
            진행자로 입장
          </button>
          <button className="sc-entry__switch" onClick={() => setMode('player')}>
            학생으로 돌아가기
          </button>
        </>
      )}
    </div>
  )
}
