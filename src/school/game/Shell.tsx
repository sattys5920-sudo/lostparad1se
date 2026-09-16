// 모바일 틀 — 가로 안내, 연결 끊김, 돌아왔을 때 다시 맞추기.
//
// 세 가지 다 「모바일이라 생기는 일」이다. 데스크톱에서는 창을 돌리지도
// 않고, 앱을 전환하지도 않고, 지하철에 들어가지도 않는다.
import { useEffect, useState } from 'react'

import { logOut } from '../accounts'
import { josa } from '../text'
import { gameNow } from '../../../shared/rules/clock'
import type { GameDoc } from '../../../shared/model'

type DevClock = GameDoc['clock']

/** 가로로 돌렸을 때. 세로 전용이라 안내만 띄운다. */
export function TurnNotice() {
  return (
    <div className="sc-turn">
      <p>세로로 돌려 주세요.</p>
      <small>가로 화면은 지원하지 않습니다.</small>
    </div>
  )
}

/**
 * 지금 서버에 닿는가.
 *
 * navigator.onLine 은 「랜선이 꽂혀 있는가」에 가깝고 실제로 닿는지는
 * 모른다. 그래도 끊긴 것은 확실히 알려 주므로, 여기서는 그것만 쓴다 —
 * 서버에 맞는지 아닌지는 요청이 실패할 때 알게 된다.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}

export function OfflineBar() {
  return <div className="sc-offline">연결이 끊겼습니다. 다시 이어지면 계속할 수 있습니다.</div>
}

/**
 * 앱이 돌아왔을 때 서버 상태를 다시 받아온다.
 *
 * **모바일은 앱 전환이 잦다.** 화면을 껐다 켜는 사이에 페이즈가 열렸을
 * 수도, 닫혔을 수도 있다. 돌아와서 옛 화면을 그대로 보여 주면 있지도
 * 않은 페이즈에 대고 단추를 누르게 된다.
 */
export function useWakeUp(onWake: () => void): void {
  useEffect(() => {
    const wake = () => {
      if (document.visibilityState === 'visible') onWake()
    }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('focus', wake)
    window.addEventListener('online', wake)
    return () => {
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('focus', wake)
      window.removeEventListener('online', wake)
    }
  }, [onWake])
}

/**
 * 이 탭이 지금 보이는가. **애니메이션이 이걸 본다.**
 *
 * 백그라운드에서 눈을 계속 그리면 배터리만 먹는다. 브라우저가
 * requestAnimationFrame 을 알아서 멈추는 경우도 있지만, 멈추지 않는
 * 기기가 있고 그쪽이 대개 배터리가 약한 기기다.
 */
export function useVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible')
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return visible
}

// ── 홈 화면에 추가 ──────────────────────────────────────────────
//
// 주소창이 있는 채로 하면 화면 높이가 60px 쯤 깎인다. 네 층으로 나눈
// 화면에서 60px 은 방 화면 한 칸이다. 그래서 한 번은 권한다 —
// **한 번만.** 닫으면 다시 뜨지 않는다.

const ADDED_KEY = 'sc.home.asked'

/** 이미 홈 화면에서 띄운 앱인가. */
function standalone(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  // iOS 사파리는 display-mode 를 안 쓴다
  return (navigator as { standalone?: boolean }).standalone === true
}

export function AddToHome() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (standalone()) return
    try {
      if (localStorage.getItem(ADDED_KEY)) return
    } catch {
      // 사파리 사생활 보호 모드에서는 읽기부터 막힌다. 그러면 그냥 안 띄운다
      return
    }
    setShow(true)
  }, [])

  if (!show) return null

  const close = () => {
    try {
      localStorage.setItem(ADDED_KEY, '1')
    } catch {
      // 저장이 안 되면 다음에 또 뜬다. 안 뜨는 것보다는 낫다
    }
    setShow(false)
  }

  return (
    <div className="sc-home" role="dialog" aria-label="홈 화면에 추가">
      <div className="sc-home__panel">
        <h2>홈 화면에 추가</h2>
        <p>
          주소창 없이 전체 화면으로 열립니다. 닷새 동안 자주 켜게 되니
          한 번 해 두는 편이 낫습니다.
        </p>
        <ShareHint />
        <button onClick={close}>알겠습니다</button>
      </div>
    </div>
  )
}

/**
 * iOS 공유 버튼 경로. **그림으로 안내한다** — 「공유」라고만 쓰면
 * 아이폰에서 그 단추가 어디 있는지 못 찾는 사람이 실제로 많다.
 */
function ShareHint() {
  return (
    <figure className="sc-home__hint">
      <svg viewBox="0 0 200 56" role="img" aria-label="아래 공유 단추를 누르고 홈 화면에 추가를 고릅니다">
        {/* 공유 단추 */}
        <rect x="6" y="10" width="36" height="36" rx="7" fill="none" stroke="currentColor" />
        <path d="M24 34V16" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M18 22l6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M16 28v10h16V28" fill="none" stroke="currentColor" strokeWidth="2" />
        {/* 화살표 */}
        <path d="M50 28h22" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M68 24l6 4-6 4" fill="none" stroke="currentColor" strokeWidth="2" />
        {/* 홈 화면에 추가 */}
        <rect x="82" y="10" width="112" height="36" rx="7" fill="none" stroke="currentColor" />
        <text x="94" y="33" fontSize="12" fill="currentColor">홈 화면에 추가</text>
      </svg>
      <figcaption>아이폰은 아래 공유 단추 → 「홈 화면에 추가」.</figcaption>
    </figure>
  )
}

// ── 서비스 워커 ─────────────────────────────────────────────────

/**
 * 정적 파일만 미리 쥔다. **게임 상태는 절대 캐시하지 않는다.**
 *
 * 붙이는 자리를 화면 쪽에 두는 것은, 에뮬레이터로 띄운 판에까지
 * 워커가 끼어들면 고친 것을 고친 대로 못 보기 때문이다.
 */
export function useStaticCache(): void {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return
    void navigator.serviceWorker.register('/lostparad1se/sw.js', { scope: '/lostparad1se/' }).catch(() => {
      // 못 붙어도 게임은 그대로 돌아간다. 캐시는 덤이다
    })
  }, [])
}

// ── 게임 속 시각 ────────────────────────────────────────────────

/**
 * 지금 게임 속으로 몇 시인가.
 *
 * **Date.now() 를 쓰면 안 된다.** 판마다 시계가 따로 돈다 — 개발용
 * 시계를 걸면 3월 1일 밤 열한 시에 서 있고, 배속이 걸리면 흐르는
 * 속도까지 다르다. 그 시각과 실제 시각을 맞대면 값이 몇 달씩 어긋난다.
 *
 * 실제로 어긋났다. 페이즈 타이머가 열자마자 0:00 이었고, 「이동 중」이
 * 늘 「0분 남았다」였다. 서버는 gameNow 로 재고 화면은 Date.now() 로
 * 재고 있었다 — **같은 함수로 재야 같은 값이 나온다.**
 */
export function useGameNow(clock: DevClock | undefined, everyMs = 1000): number {
  const [realNow, setRealNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setRealNow(Date.now()), everyMs)
    return () => clearInterval(t)
  }, [everyMs])
  return gameNow(clock, realNow)
}

// ── 기다리는 화면 ───────────────────────────────────────────────

/**
 * 「불러오는 중」. **영영 그대로 두지 않는다.**
 *
 * 여태 이 자리는 글자 한 줄이었다. 서버가 대답을 안 하거나 규칙이
 * 막으면 그 줄에서 멈춘 채 아무 말도 없었다 — 무엇을 기다리는지도,
 * 무엇이 잘못됐는지도, 어떻게 빠져나가는지도 없었다. 앱이 죽은 것과
 * 구별이 안 된다.
 *
 * 몇 초가 지나면 기다리는 것을 밝히고, 다시 해 볼 길과 나갈 길을 준다.
 */
export function Waiting({
  what,
  error,
  onRetry,
  afterMs = 6000,
}: {
  /** 무엇을 기다리는가. 늦어질 때만 보인다. */
  what: string
  /** 서버가 거절했으면 그 말. **삼키지 않는다.** */
  error?: string | null
  onRetry?: () => void
  afterMs?: number
}) {
  const [late, setLate] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setLate(true), afterMs)
    return () => clearTimeout(t)
  }, [afterMs])

  if (!late && !error) return <p className="sc-pl__wait">불러오는 중</p>

  return (
    <div className="sc-wait">
      <p className="sc-wait__what">
        {error ? '서버가 거절했다.' : `${what}${josa(what, '을/를')} 기다리고 있다.`}
      </p>
      {error && <p className="sc-wait__why">{error}</p>}
      {!error && <p className="sc-wait__why">연결이 느리거나, 서버가 대답하지 않는다.</p>}
      <div className="sc-wait__row">
        <button onClick={() => (onRetry ? onRetry() : location.reload())}>다시 해 본다</button>
        <button
          onClick={() => {
            void logOut().finally(() => location.reload())
          }}
        >
          로그아웃
        </button>
      </div>
      <p className="sc-wait__why">그래도 안 되면 앱을 완전히 닫았다 열어라.</p>
    </div>
  )
}

// ── 나가기 ──────────────────────────────────────────────────────

/**
 * 로그아웃.
 *
 * 여태 이 단추는 **오류 창에만** 있었다. 잘 돌아가는 동안에는 나갈
 * 길이 없어서, 남의 계정으로 들어온 사람은 앱 데이터를 지우거나
 * 시크릿 창을 여는 수밖에 없었다 — QA 로 열넷을 번갈아 켜 보는
 * 동안에는 그 일이 하루에도 여러 번이다.
 *
 * 닷새 중에는 한 번 묻는다. 비밀번호를 모르면 못 돌아오는 자리라,
 * 손가락이 스친 것만으로 일어나면 안 된다. 아직 시작 전이면 그냥
 * 나간다 — 잃을 것이 없다.
 *
 * 나간 뒤에는 화면을 새로 연다. 로그인 상태만 바꾸고 그대로 두면
 * 앞사람의 판 문서를 구독하던 것들이 살아남아 거절을 뱉는다.
 */
export function SignOut({ ask, note }: { ask?: (text: string) => Promise<boolean>; note?: string }) {
  const [busy, setBusy] = useState(false)
  async function go(): Promise<void> {
    if (ask && !(await ask('로그아웃한다. 다시 들어오려면 아이디와 비밀번호가 있어야 한다.'))) return
    setBusy(true)
    await logOut().catch(() => undefined)
    location.reload()
  }
  return (
    <section className="sc-out">
      <button className="sc-out__go" disabled={busy} onClick={() => void go()}>
        로그아웃
      </button>
      {note && <p className="sc-out__note">{note}</p>}
    </section>
  )
}
