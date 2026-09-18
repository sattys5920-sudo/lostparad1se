// 들어오는 문 — 구겨진 투표용지 한 장.
//
// 문은 **하나뿐이다.** 플레이어는 이름을 적어 내고, 운영자는 코드로
// 들어온다. 전에는 운영자가 admin.html 이라는 딴 주소로 들어갔다.
// 주소를 아는 사람만 찾아가는 문은 문이 아니라 뒷길이다.
//
// 화면은 종이 한 장이다. 탭도 상자도 없다 — 그런 것이 붙으면 문서가
// 아니라 앱처럼 보인다. 가입은 종이 아래 작은 줄을 눌러서 가고,
// 운영자 자리는 **제목을 다섯 번 두드려야** 나온다. 판을 여는 사람만
// 아는 자리라 눈에 보이는 입구를 두지 않는다.
//
// 종이와 글자는 같은 상자 안에 있다. 배경 그림으로 깔고 글자를 그
// 위에 절대 위치로 얹으면, 화면 크기가 바뀔 때 둘이 따로 논다.
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react'

import { hostEnter, logIn, signUp } from '../accounts'
import { Snow } from '../reveal/Snow'
import { paperSlice } from './paperArt'
import './gate.css'

type Mode = 'in' | 'up' | 'host'

/** 제목을 몇 번 두드려야 운영자 자리가 열리는지, 그 사이 간격. */
const HOST_TAPS = 5
const HOST_TAP_GAP_MS = 1200
/** 접혀 들어가는 데 걸리는 시간. 이만큼 기다렸다 들여보낸다. */
const FOLD_MS = 360

const reducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** 종이가 이보다 작아지면 내용이 안 들어간다. */
const MIN_PAPER = 400

/**
 * 종이 높이를 잰다. **줄어든 값은 버린다.**
 *
 * 키보드가 올라오면 안드로이드는 화면 높이 자체를 깎는다. 그대로
 * 74dvh 를 쓰면 종이가 그때마다 쪼그라든다 — 글자 크기는 그대로인데
 * 종이만 줄어드니 내용이 넘친다. 그래서 **그 폭에서 본 가장 큰
 * 높이**를 기억한다. 가로가 바뀌면(회전) 다시 잰다.
 *
 * 올라온 키보드는 높이가 아니라 **자리**로 피한다 — 가운데 여백이
 * 저절로 줄어들면서 종이가 위로 올라간다(gate.css 의 margin-top).
 */
function usePaperHeight(): number {
  const [h, setH] = useState(0)
  useEffect(() => {
    let atWidth = 0
    let tallest = 0
    const fit = () => {
      if (innerWidth !== atWidth) {
        atWidth = innerWidth
        tallest = 0
      }
      tallest = Math.max(tallest, innerHeight)
      setH(Math.max(MIN_PAPER, Math.round(tallest * 0.74)))
    }
    fit()
    addEventListener('resize', fit)
    addEventListener('orientationchange', fit)
    return () => {
      removeEventListener('resize', fit)
      removeEventListener('orientationchange', fit)
    }
  }, [])
  return h
}

export function Gate({ onIn }: { onIn: () => void }) {
  const [mode, setMode] = useState<Mode>('in')
  const [id, setId] = useState('')
  const [pw, setPw] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [gone, setGone] = useState(false)
  const holdRef = useRef<HTMLDivElement>(null)
  const taps = useRef<{ n: number; at: number }>({ n: 0, at: 0 })
  const height = usePaperHeight()
  const host = mode === 'host'

  /**
   * 틀린 이유가 뜰 때마다 종이가 흔들려야 한다.
   *
   * 클래스를 붙이는 것만으로는 **두 번째부터 안 흔들린다** — 이미
   * 붙어 있는 애니메이션은 다시 시작하지 않는다. 떼고, 레이아웃을 한
   * 번 읽어 브라우저에게 「없던 일」로 만들고, 다시 붙인다.
   */
  function shake() {
    const el = holdRef.current
    if (!el || reducedMotion()) return
    el.classList.remove('is-bad')
    void el.offsetWidth
    el.classList.add('is-bad')
  }

  async function go() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      if (host) await hostEnter(code)
      else await (mode === 'up' ? signUp(id, pw) : logIn(id, pw))
      if (reducedMotion()) {
        onIn()
        return
      }
      setGone(true)
      setTimeout(onIn, FOLD_MS)
    } catch (e) {
      setError((e as Error).message)
      shake()
      setBusy(false)
    }
  }

  /** 제목을 잇달아 다섯 번. 사이가 뜨면 처음부터다. */
  function tapTitle() {
    const now = Date.now()
    const t = taps.current
    t.n = now - t.at > HOST_TAP_GAP_MS ? 1 : t.n + 1
    t.at = now
    if (t.n < HOST_TAPS) return
    t.n = 0
    setMode('host')
    setError('')
    const el = holdRef.current
    if (el && !reducedMotion()) {
      el.classList.remove('is-crumple')
      void el.offsetWidth
      el.classList.add('is-crumple')
    }
  }

  function toMode(next: Mode) {
    setMode(next)
    setError('')
    taps.current = { n: 0, at: 0 }
  }

  /** 누르는 동안 입력칸이 초점을 잃지 않게 한다. */
  const hold = (e: MouseEvent) => e.preventDefault()

  const ready = host ? code.trim().length > 0 : Boolean(id.trim() && pw)
  const enter = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing && ready) void go()
  }

  return (
    <div className="sc-gt" style={height ? ({ '--gt-h': `${height}px` } as CSSProperties) : undefined}>
      <Snow level={1} />
      <div ref={holdRef} className={`sc-gt__hold${gone ? ' is-gone' : ''}`}>
        <div className="sc-gt__paper">
          {/* 종이 그림. 글자와 같은 상자 안에 있고, 이 상자를 가득 채운다 */}
          <div className="sc-gt__sheet" aria-hidden="true">
            <span className="sc-gt__flat" />
            <span className="sc-gt__e sc-gt__e--t" style={{ backgroundImage: `url(${paperSlice('ET')})` }} />
            <span className="sc-gt__e sc-gt__e--b" style={{ backgroundImage: `url(${paperSlice('EB')})` }} />
            <span className="sc-gt__e sc-gt__e--l" style={{ backgroundImage: `url(${paperSlice('EL')})` }} />
            <span className="sc-gt__e sc-gt__e--r" style={{ backgroundImage: `url(${paperSlice('ER')})` }} />
            <span className="sc-gt__c sc-gt__c--tl" style={{ backgroundImage: `url(${paperSlice('TL')})` }} />
            <span className="sc-gt__c sc-gt__c--tr" style={{ backgroundImage: `url(${paperSlice('TR')})` }} />
            <span className="sc-gt__c sc-gt__c--bl" style={{ backgroundImage: `url(${paperSlice('BL')})` }} />
            <span className="sc-gt__c sc-gt__c--br" style={{ backgroundImage: `url(${paperSlice('BR')})` }} />
          </div>

          <div className="sc-gt__in">
            <div className="sc-gt__no">2 - 3</div>

            <div className="sc-gt__body">
              <h1 className="sc-gt__title" onClick={tapTitle}>
                남겨진 아이들
              </h1>
              <div className="sc-gt__rule" />

              {host ? (
                <label className="sc-gt__field">
                  <span className="sc-gt__lab">코 드</span>
                  <input
                    id="gt-code"
                    type="password"
                    value={code}
                    autoComplete="off"
                    enterKeyHint="go"
                    onChange={(e) => setCode(e.target.value)}
                    onKeyDown={enter}
                  />
                </label>
              ) : (
                <>
                  <label className="sc-gt__field">
                    <span className="sc-gt__lab">이 름</span>
                    <input
                      id="gt-id"
                      value={id}
                      autoCapitalize="off"
                      autoCorrect="off"
                      autoComplete="username"
                      enterKeyHint="next"
                      onChange={(e) => setId(e.target.value)}
                      onKeyDown={enter}
                    />
                  </label>
                  <label className="sc-gt__field">
                    <span className="sc-gt__lab">암 호</span>
                    <input
                      id="gt-pw"
                      type="password"
                      value={pw}
                      autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
                      enterKeyHint="go"
                      onChange={(e) => setPw(e.target.value)}
                      onKeyDown={enter}
                    />
                  </label>
                </>
              )}

              {error && <p className="sc-gt__error">{error}</p>}

              {/* 누르는 순간 입력칸에서 손을 떼면 키보드가 내려가고, 그
                  사이에 종이가 움직여 **누른 것이 눌리지 않는다.** 그래서
                  누를 때 자리를 안 옮긴다 */}
              <button className="sc-gt__submit" disabled={busy || !ready} onMouseDown={hold} onClick={() => void go()}>
                제 출
              </button>

              <button className="sc-gt__link" onMouseDown={hold} onClick={() => toMode(host || mode === 'up' ? 'in' : 'up')}>
                {host ? '돌아가기' : mode === 'up' ? '이미 이름이 있다면' : '아직 이름이 없다면'}
              </button>
            </div>

            <p className="sc-gt__foot">왜인지는 적지 않아도 됩니다</p>
          </div>
        </div>
      </div>
    </div>
  )
}
