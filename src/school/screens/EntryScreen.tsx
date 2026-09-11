import { useEffect, useState } from 'react'
import './EntryScreen.css'
import { useSchoolGame } from '../state/SchoolGameContext'
import { CharacterCreator } from '../components/CharacterCreator'
import { defaultLook } from '../char/look'
import { loadAccount, logIn, saveAccountCharacter, signUp, type Account } from '../accounts'
import type { AvatarLook } from '../types'
import type { EntryDoor } from './IntroScreen'

/** 로그인한 계정을 기억해 둔다 — 새로고침했다고 다시 적게 하지 않는다. */
const LS_ACCOUNT = 'school_accountId'

type Step = 'signup' | 'login' | 'character' | 'host'

const EYEBROW: Record<Step, string> = {
  signup: 'DAY 0 · 명부에 이름을 올린다',
  login: 'DAY 0 · 교문 앞',
  character: 'DAY 0 · 거울 앞에서',
  host: 'DAY 0 · 진행자',
}

const TITLE: Record<Step, string> = {
  signup: '계정을 만듭니다',
  login: '누구십니까',
  character: '어떤 모습이었습니까',
  host: '진행자로 들어갑니다',
}

export function EntryScreen({ door }: { door: EntryDoor }) {
  const { joinAsPlayer, loginAsHost } = useSchoolGame()
  const [step, setStep] = useState<Step>(door)
  const [account, setAccount] = useState<Account | null>(null)
  const [accountId, setAccountId] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [nickname, setNickname] = useState('')
  const [hostCode, setHostCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // 팀(완장)은 아직 없다. 진행자가 시작할 때 정해진다.
  const [look, setLook] = useState<AvatarLook>(() => defaultLook(crypto.randomUUID()))

  /** 로그인이 끝났다 — 계정에 붙어 있던 닉네임과 모습을 꺼내 온다. */
  function applyAccount(found: Account) {
    setAccount(found)
    setAccountId(found.id)
    setNickname(found.nickname || '')
    if (found.avatar) setLook(found.avatar)
    localStorage.setItem(LS_ACCOUNT, found.id)
    setStep('character')
  }

  // 지난번에 로그인해 둔 계정이 있으면 교문을 건너뛰고 바로 거울 앞으로 간다
  useEffect(() => {
    const saved = localStorage.getItem(LS_ACCOUNT)
    if (!saved) return
    let alive = true
    void loadAccount(saved)
      .then((found) => {
        if (alive && found) applyAccount(found)
      })
      .catch(() => localStorage.removeItem(LS_ACCOUNT))
    return () => {
      alive = false
    }
    // 첫 화면에서 한 번만 본다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function go(next: Step) {
    setError('')
    setPassword('')
    setPassword2('')
    setStep(next)
  }

  async function run(job: () => Promise<void>) {
    setError('')
    setBusy(true)
    try {
      await job()
    } catch (e) {
      setError(e instanceof Error ? e.message : '알 수 없는 오류가 발생했다.')
    } finally {
      setBusy(false)
    }
  }

  const submitSignUp = () =>
    run(async () => {
      if (password !== password2) throw new Error('비밀번호가 서로 다르다.')
      await signUp(accountId, password)
      // 가입한 아이디는 그대로 두고 로그인 화면으로 넘긴다
      setPassword('')
      setPassword2('')
      setStep('login')
    })

  const submitLogIn = () =>
    run(async () => {
      applyAccount(await logIn(accountId, password))
    })

  const submitCharacter = () =>
    run(async () => {
      const trimmed = nickname.trim()
      if (!trimmed) throw new Error('닉네임을 입력해라.')
      await joinAsPlayer(trimmed, look)
      // 다음에 들어올 때 그대로 꺼내 쓰도록 계정에 붙여 둔다
      if (account) await saveAccountCharacter(account.id, trimmed, look)
    })

  function submitHost() {
    setError('')
    try {
      loginAsHost(hostCode)
    } catch (e) {
      setError(e instanceof Error ? e.message : '알 수 없는 오류가 발생했다.')
    }
  }

  function signOut() {
    localStorage.removeItem(LS_ACCOUNT)
    setAccount(null)
    setAccountId('')
    setNickname('')
    go('login')
  }

  return (
    <div className="sc-entry">
      <div className="sc-entry__intro">
        <span className="sc-entry__eyebrow">{EYEBROW[step]}</span>
        <h1>{TITLE[step]}</h1>
      </div>

      {step === 'signup' && (
        <>
          <label className="sc-entry__field">
            <span>아이디</span>
            <input
              value={accountId}
              maxLength={16}
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="영문 소문자·숫자 3~16자"
              onChange={(e) => setAccountId(e.target.value)}
            />
          </label>
          <label className="sc-entry__field">
            <span>비밀번호</span>
            <input
              value={password}
              type="password"
              placeholder="6자 이상"
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label className="sc-entry__field">
            <span>비밀번호 확인</span>
            <input
              value={password2}
              type="password"
              placeholder="한 번 더"
              onChange={(e) => setPassword2(e.target.value)}
            />
          </label>
          {error && <p className="sc-entry__error">{error}</p>}
          <button
            className="sc-entry__submit"
            disabled={busy || !accountId.trim() || !password || !password2}
            onClick={submitSignUp}
          >
            {busy ? '만드는 중…' : '계정 만들기'}
          </button>
          <button className="sc-entry__switch" onClick={() => go('login')}>
            이미 계정이 있다
          </button>
        </>
      )}

      {step === 'login' && (
        <>
          <label className="sc-entry__field">
            <span>아이디</span>
            <input
              value={accountId}
              maxLength={16}
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="아이디"
              onChange={(e) => setAccountId(e.target.value)}
            />
          </label>
          <label className="sc-entry__field">
            <span>비밀번호</span>
            <input
              value={password}
              type="password"
              placeholder="비밀번호"
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && accountId.trim() && password) void submitLogIn()
              }}
            />
          </label>
          {error && <p className="sc-entry__error">{error}</p>}
          <button className="sc-entry__submit" disabled={busy || !accountId.trim() || !password} onClick={submitLogIn}>
            {busy ? '들어가는 중…' : '로그인'}
          </button>
          <button className="sc-entry__switch" onClick={() => go('signup')}>
            계정이 없다
          </button>
          <button className="sc-entry__switch sc-entry__switch--strong" onClick={() => go('host')}>
            진행자로 들어가기
          </button>
        </>
      )}

      {step === 'character' && (
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
          <CharacterCreator
            look={look}
            team={null}
            onChange={setLook}
            onDone={() => void submitCharacter()}
            doneLabel={busy ? '들어가는 중…' : '완성'}
          />
          {error && <p className="sc-entry__error">{error}</p>}
          <button className="sc-entry__switch" onClick={signOut}>
            {account ? `${account.id} — 다른 계정으로` : '처음으로'}
          </button>
        </>
      )}

      {step === 'host' && (
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
          <button className="sc-entry__switch" onClick={() => go('login')}>
            학생으로 돌아가기
          </button>
        </>
      )}
    </div>
  )
}
