import { useState } from 'react'
import './EntryScreen.css'
import { useSchoolGame } from '../state/SchoolGameContext'
import { AvatarPicker } from '../components/AvatarPicker'
import { defaultLook } from '../map/avatar'
import type { AvatarLook } from '../types'

export function EntryScreen() {
  const { joinAsPlayer, loginAsHost } = useSchoolGame()
  const [mode, setMode] = useState<'player' | 'host'>('player')
  const [nickname, setNickname] = useState('')
  const [hostCode, setHostCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // 팀은 아직 없다. 옷은 역할이 나눠질 때 저절로 갈아입는다.
  const [look, setLook] = useState<AvatarLook>(() => defaultLook(crypto.randomUUID()))

  async function submitPlayer() {
    setError('')
    setBusy(true)
    try {
      await joinAsPlayer(nickname, look)
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
        <span className="sc-entry__eyebrow">{mode === 'player' ? 'DAY 0 · 반이 다시 모인다' : 'DAY 0 · 진행자'}</span>
        <h1>{mode === 'player' ? '당신은 누구입니까' : '진행자로 들어갑니다'}</h1>
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
          <AvatarPicker look={look} team={null} onChange={setLook} />
          {error && <p className="sc-entry__error">{error}</p>}
          <button className="sc-entry__submit" disabled={busy || !nickname.trim()} onClick={submitPlayer}>
            들어가기
          </button>
          <button className="sc-entry__switch sc-entry__switch--strong" onClick={() => setMode('host')}>
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
