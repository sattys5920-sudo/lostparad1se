import { useState } from 'react'
import './EntryScreen.css'
import { useSchoolGame } from '../state/SchoolGameContext'
import { CharacterCreator } from '../components/CharacterCreator'
import { defaultLook } from '../char/look'
import type { AvatarLook } from '../types'

export function EntryScreen() {
  const { joinAsPlayer, loginAsHost } = useSchoolGame()
  const [mode, setMode] = useState<'player' | 'host'>('player')
  // 닉네임을 적고 나면 캐릭터를 만드는 화면으로 넘어간다
  const [step, setStep] = useState<'name' | 'look'>('name')
  const [nickname, setNickname] = useState('')
  const [hostCode, setHostCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // 팀(완장)은 아직 없다. 진행자가 시작할 때 정해진다.
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
        <span className="sc-entry__eyebrow">
          {mode === 'host' ? 'DAY 0 · 진행자' : step === 'name' ? 'DAY 0 · 반이 다시 모인다' : 'DAY 0 · 거울 앞에서'}
        </span>
        <h1>
          {mode === 'host' ? '진행자로 들어갑니다' : step === 'name' ? '당신은 누구입니까' : '어떤 모습이었습니까'}
        </h1>
      </div>

      {mode === 'player' && step === 'name' ? (
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
          <button className="sc-entry__submit" disabled={!nickname.trim()} onClick={() => setStep('look')}>
            다음
          </button>
          <button className="sc-entry__switch sc-entry__switch--strong" onClick={() => setMode('host')}>
            진행자로 들어가기
          </button>
        </>
      ) : mode === 'player' ? (
        <>
          <CharacterCreator
            look={look}
            team={null}
            onChange={setLook}
            onDone={() => void submitPlayer()}
            doneLabel={busy ? '들어가는 중…' : '완성'}
          />
          {error && <p className="sc-entry__error">{error}</p>}
          <button className="sc-entry__switch" onClick={() => setStep('name')}>
            이름 다시 적기
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
