// 관리자 화면.
//
// **판을 움직이는 단추는 전부 여기 있다.** 전에는 플레이어 화면
// 「더보기」 시트 안에 운영자만 보이게 섞여 있었다. 그러면 두 가지가
// 나쁘다 — 운영자가 게임을 하면서 판을 조작하게 되고, 무엇이 운영자
// 권한인지 코드에서도 한눈에 안 보인다.
//
// **화면이 막는 것은 하나도 없다.** 여기 있는 모든 단추는 서버가
// 운영자 표시를 다시 확인한다. 이 페이지는 주소만 알면 누구나 열 수
// 있고, 열어도 아무것도 안 된다.
import { useCallback, useEffect, useMemo, useState } from 'react'

import { amHost, claimHost, logIn } from '../accounts'
import { gameActions, useGame } from '../game/useGame'
import { PhaseHost } from '../game/Phase'
import { QuizHost } from '../game/Quiz'
import { useGameNow } from '../game/Shell'
import { TOTAL_SEATS } from '../../../shared/rules/lobby'
import './admin.css'

const GAME_ID = new URLSearchParams(location.search).get('game') ?? 'live'

/** 서울 시각으로 읽는다. 판이 보는 시계와 같은 시계다. */
const clockText = (ms: number) =>
  new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(ms)

/**
 * 들어오는 자리.
 *
 * 아이디·비밀번호로 로그인하고, 그다음에 운영자 코드를 맞힌다.
 * **코드는 여기에도 번들에도 없다** — 서버가 배포 환경변수로 들고
 * 있고 틀린 횟수도 서버가 센다.
 */
function AdminGate({ onIn }: { onIn: () => void }) {
  const [id, setId] = useState('')
  const [pw, setPw] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function go() {
    setBusy(true)
    setError('')
    try {
      // 이미 로그인돼 있으면 건너뛴다 — 코드만 다시 맞히러 온 것이다
      if (id.trim().length > 0) await logIn(id, pw)
      await claimHost(code)
      onIn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sc-ad__gate">
      <h1>관리자</h1>
      <p className="sc-ad__hint">
        판을 만들고 페이즈를 여는 자리다. 이미 로그인돼 있으면 아이디·비밀번호는 비워 둬도 된다.
      </p>
      <input placeholder="아이디" value={id} onChange={(e) => setId(e.target.value)} autoCapitalize="off" />
      <input placeholder="비밀번호" type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
      <input
        placeholder="관리자 코드"
        type="password"
        value={code}
        autoComplete="off"
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) void go()
        }}
      />
      {error && <p className="sc-ad__error">{error}</p>}
      <button className="sc-ad__go" disabled={busy || code.trim().length === 0} onClick={() => void go()}>
        들어가기
      </button>
      <a className="sc-ad__back" href={`${import.meta.env.BASE_URL}play.html`}>
        게임 화면으로
      </a>
    </div>
  )
}

export function Admin() {
  const [host, setHost] = useState<boolean | null>(null)
  const check = useCallback(() => {
    void amHost().then(setHost)
  }, [])
  useEffect(check, [check])

  if (host === null) return <p className="sc-ad__wait">확인하는 중</p>
  if (!host) return <AdminGate onIn={check} />
  return <Desk />
}

function Desk() {
  const state = useGame(GAME_ID)
  const act = useMemo(() => gameActions(GAME_ID), [])
  const [said, setSaid] = useState('')
  const [busy, setBusy] = useState(false)
  const [qaPw, setQaPw] = useState('')
  const nowMs = useGameNow(state.game?.clock)

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true)
    try {
      const out = await fn()
      const n = (out as { added?: number; seated?: number } | undefined) ?? {}
      setSaid(
        n.added !== undefined ? `${label} 했다. ${n.added}칸.`
        : n.seated !== undefined ? `${label} 했다. ${n.seated}명.`
        : `${label} 했다.`,
      )
    } catch (e) {
      setSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const game = state.game
  const seats = game?.seats ?? []
  const phaseNo = game?.phaseNow?.no ?? 0
  const phaseOpen = game?.phaseNow?.open === true
  const phaseEndsAtMs = game?.phaseNow?.endsAtMs ?? null

  return (
    <div className="sc-ad">
      <header className="sc-ad__top">
        <h1>관리자</h1>
        <span className="sc-ad__game">{GAME_ID}</span>
      </header>

      <section className="sc-ad__card">
        <h2>판</h2>
        {state.loading ? (
          <p className="sc-ad__hint">불러오는 중</p>
        ) : !game ? (
          <>
            <p className="sc-ad__hint">아직 판이 없다.</p>
            <button disabled={busy} onClick={() => void run('판 만들기', () => act.createGame())}>
              판 만들기
            </button>
          </>
        ) : (
          <>
            <dl className="sc-ad__facts">
              <div><dt>상태</dt><dd>{game.phase}</dd></div>
              <div><dt>사람</dt><dd>{seats.length} / {TOTAL_SEATS}</dd></div>
              {/* 게임 시계다. 개발용 배속을 걸어 두면 실제 시각과 다르다 */}
              <div><dt>지금</dt><dd>{clockText(nowMs)}</dd></div>
            </dl>
            {game.phase === 'lobby' && (
              <>
                <button disabled={busy} onClick={() => void run('시작', () => act.startGame())}>
                  닷새 시작
                </button>
                {/*
                  QA용. 비밀번호를 여기서 정하게 둔다 — 뻔한 값을 박아
                  두면 qa01 이 그대로 뒷문이 된다.
                  **자리를 다 채운다.** 운영자는 관리자 화면에 있지
                  판 안에 있지 않아서, 한 자리를 비워 두면 열넷이
                  안 차 시작을 못 한다
                */}
                <input
                  type="password"
                  placeholder="QA 비밀번호 (8자 이상)"
                  value={qaPw}
                  autoComplete="off"
                  onChange={(e) => setQaPw(e.target.value)}
                />
                <button
                  disabled={busy || qaPw.length < 8}
                  onClick={() => void run('채우기', () => act.seedPlayers(qaPw, 0))}
                >
                  QA 열넷 채우기
                </button>
              </>
            )}
            <button disabled={busy} onClick={() => void run('따라잡기', () => act.tick())}>
              따라잡기
            </button>
          </>
        )}
      </section>

      {game && game.phase !== 'lobby' && (
        <>
          <section className="sc-ad__card">
            <h2>페이즈</h2>
            <p className="sc-ad__hint">
              페이즈는 저절로 열리지 않는다. 여는 것도 닫는 것도 여기서 한다.
            </p>
            <PhaseHost open={phaseOpen} no={phaseNo} endsAtMs={phaseEndsAtMs} act={act} onSaid={setSaid} />
          </section>

          <section className="sc-ad__card">
            <h2>방</h2>
            {/* 시험용. 본래는 A의 기록이 날마다 두 칸씩 연다 */}
            <button disabled={busy} onClick={() => void run('방 다 열기', () => act.openAllTiles())}>
              핵심 방 다 열기
            </button>
          </section>

          <section className="sc-ad__card">
            <h2>문제</h2>
            <QuizHost act={act} onSaid={setSaid} />
          </section>
        </>
      )}

      {said && (
        <p className="sc-ad__said" onClick={() => setSaid('')}>
          {said}
        </p>
      )}
      <a className="sc-ad__back" href={`${import.meta.env.BASE_URL}play.html`}>
        게임 화면으로
      </a>
    </div>
  )
}
