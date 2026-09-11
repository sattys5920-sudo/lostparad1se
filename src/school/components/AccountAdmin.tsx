import { useCallback, useEffect, useState } from 'react'
import './AccountAdmin.css'
import { deleteAccount, listAccounts, type AccountSummary } from '../accounts'

/**
 * 가입 계정을 펴 보고 지우는 진행자용 칸.
 *
 * 대기실과 진행 화면 양쪽에 붙는다. 정리는 보통 판이 시작되기 전에 하고
 * 싶어지므로 대기실에도 있어야 하고, 판이 도는 중에 문제가 생겨도 손댈 수
 * 있어야 하므로 진행 화면에도 있어야 한다.
 *
 * 계정 데이터는 세션 상태와 따로 사는 것이라 Context를 거치지 않고 여기서
 * 직접 읽는다.
 */
export function AccountAdmin() {
  const [accounts, setAccounts] = useState<AccountSummary[] | null>(null)
  const [notice, setNotice] = useState('')
  /** 한 번 눌러 되묻고, 같은 줄을 다시 눌러야 지운다 */
  const [armedId, setArmedId] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setNotice('')
    try {
      setAccounts(await listAccounts())
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '가입 명단을 읽지 못했다.')
      setAccounts([])
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function remove(id: string) {
    if (armedId !== id) {
      setArmedId(id)
      setNotice('')
      return
    }
    setArmedId('')
    setBusy(true)
    try {
      await deleteAccount(id)
      setNotice(`${id} 계정을 지웠다.`)
      await refresh()
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '지우지 못했다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sc-acct">
      <span className="sc-acct__label">가입 계정{accounts ? ` ${accounts.length}개` : ''}</span>
      <p className="sc-acct__note">
        지우면 그 아이디로 다시 가입할 수 있게 된다. 이미 판에 들어와 있는 사람은 그대로 남는다 —
        참가자를 내보내려면 명단에서 따로 빼야 한다.
      </p>
      {notice && <p className="sc-acct__notice">{notice}</p>}
      {accounts === null && <p className="sc-acct__note">읽는 중…</p>}
      {accounts?.length === 0 && <p className="sc-acct__note">아직 가입한 사람이 없다.</p>}
      {accounts && accounts.length > 0 && (
        <ul className="sc-acct__list">
          {accounts.map((a) => (
            <li key={a.id}>
              <span className="sc-acct__id">{a.id}</span>
              <span className="sc-acct__nick">{a.nickname || '이름 없음'}</span>
              <span className="sc-acct__day">
                {a.createdAtMs ? new Date(a.createdAtMs).toLocaleDateString('ko-KR') : '—'}
              </span>
              <button
                className={`sc-acct__del ${armedId === a.id ? 'is-armed' : ''}`}
                disabled={busy}
                onClick={() => void remove(a.id)}
              >
                {armedId === a.id ? '정말 지운다' : '지우기'}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button className="sc-acct__refresh" disabled={busy} onClick={() => void refresh()}>
        다시 읽기
      </button>
    </div>
  )
}
