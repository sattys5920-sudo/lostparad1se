// 키보드가 먹은 높이 — 맵 탭 말줄과 무전 탭이 **같은 값 하나**를 본다.
//
// 전에는 Play.tsx 안에 useKeyboard 가 따로 있었고, 무전 탭은 그걸 몰랐다.
// 그래서 무전 입력칸은 키보드 뒤에 숨었다 — 말줄만 키보드를 따라 올라가고
// 무전은 제자리에 있었다. 둘이 따로 재면 한쪽이 반드시 어긋난다.
// 재는 일을 여기 한 군데로 모으고, 부르는 쪽이 몇이든 귀는 하나만 단다.
import { useSyncExternalStore } from 'react'

/** 주소창이 줄었다 늘었다 하는 정도는 키보드가 아니다 */
const NOT_KB_PX = 80

/**
 * 키보드가 먹은 높이(css px). 안 올라와 있으면 0.
 *
 * **dvh 로는 안 잡힌다.** dvh 는 주소창과 툴바까지만 세고 키보드는
 * 안 센다 — 아이폰에서 키보드가 올라와도 100dvh 는 그대로다.
 *
 *   kb = innerHeight - visualViewport.height - visualViewport.offsetTop
 *
 * `offsetTop` 까지 빼는 것이 중요하다. 아이폰은 키보드가 올라오는 동안
 * 보이는 창을 아래로 밀기도 하는데(offsetTop 이 0 이 아니게 된다),
 * 그걸 안 빼면 키보드가 실제보다 높다고 잰다 — 바가 먼저 튀어 오른다.
 */
export function insetOf(innerHeight: number, vvHeight: number, vvOffsetTop: number): number {
  const gap = Math.round(innerHeight - vvHeight - vvOffsetTop)
  return gap > NOT_KB_PX ? gap : 0
}

let kbNow = 0
const ears = new Set<() => void>()

/**
 * **이벤트마다 갱신한다.** 아이폰은 키보드가 올라오는 0.25초 동안
 * visualViewport 이벤트를 여러 번 보낸다. 그때마다 --kb 를 고쳐 주면
 * 바가 키보드를 따라 올라간다. 이벤트 사이의 빈틈은 CSS 의
 * `transition: bottom .2s` 가 메운다(controls.css 의 .sc-sy, radio.css).
 *
 * 값은 문서 뿌리에 적는다 — 입력줄이 `position:fixed` 라 화면 전체를
 * 기준으로 서고, 그 규칙이 이 훅을 부른 컴포넌트 바깥에 있다.
 * 내려갈 때도 같은 길이다. 따로 「닫힘」 처리를 두지 않는다.
 */
function measure() {
  const vv = window.visualViewport
  if (!vv) return
  const root = document.documentElement.style
  /*
   * **보이는 창의 자리와 높이를 그대로 적는다.** 적는 중에는 입력줄이
   * 키보드 높이(--kb)가 아니라 이 둘을 본다(radio.css · controls.css).
   *
   * --kb 는 innerHeight 를 빼서 얻는데, 아이폰 사파리가 판마다 innerHeight
   * 를 다르게 준다 — 키보드가 떠도 그대로인 판이 있고 같이 주는 판이 있다.
   * 그러면 --kb 가 0 이 되고 입력줄이 키보드 뒤로 숨는다(실제로 그랬다).
   * 보이는 창의 위치(offsetTop)와 높이(height)는 어느 판에서나 **지금 눈에
   * 보이는 칸** 그 자체다. 거기 붙이면 키보드가 어떻게 뜨든 바로 위다.
   */
  root.setProperty('--vv-top', `${Math.round(vv.offsetTop)}px`)
  root.setProperty('--vv-h', `${Math.round(vv.height)}px`)
  const px = insetOf(window.innerHeight, vv.height, vv.offsetTop)
  // 그래도 밀렸으면 제자리로. 지도는 여기 고정이다
  if (window.scrollY !== 0) window.scrollTo(0, 0)
  if (px === kbNow) return
  kbNow = px
  document.documentElement.style.setProperty('--kb', `${px}px`)
  for (const f of ears) f()
}

/**
 * 지금 적는 자리. 무전 입력줄이면 'rd', 맵 말줄이면 'sy'. 문서 뿌리에
 * data-typing 으로 단다 — CSS 가 그것을 보고 그 줄만 보이는 창에 붙인다.
 * 다른 칸(가방의 빈 종이 등)에 적을 때는 안 단다. 그 줄들이 괜히 뜨면 안 된다.
 */
function typingOf(el: Element | null): 'rd' | 'sy' | null {
  if (!el || !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return null
  if (el.closest('.sc-rd')) return 'rd'
  if (el.closest('.sc-sy')) return 'sy'
  return null
}

/**
 * 키보드가 올라오고 내려가는 동안 몇 번 더 잰다. **이벤트를 안 믿는다** —
 * 어떤 아이폰은 키보드가 뜰 때 visualViewport 의 resize 를 안 보내거나
 * 늦게 보낸다. 초점이 오간 뒤 1.2초 동안 화면마다 한 번씩 잰다.
 */
let follow = 0
function followFor(ms: number) {
  cancelAnimationFrame(follow)
  const until = performance.now() + ms
  const step = () => {
    measure()
    if (performance.now() < until) follow = requestAnimationFrame(step)
  }
  follow = requestAnimationFrame(step)
}

function onFocusIn(e: FocusEvent) {
  const where = typingOf(e.target as Element | null)
  if (where) document.documentElement.setAttribute('data-typing', where)
  else document.documentElement.removeAttribute('data-typing')
  followFor(1200)
}
function onFocusOut() {
  // 칸에서 칸으로 옮겨 가는 사이에 한 번 비었다 차는 것을 기다린다
  setTimeout(() => {
    if (!typingOf(document.activeElement)) document.documentElement.removeAttribute('data-typing')
    followFor(1200)
  }, 0)
}

function subscribe(onChange: () => void): () => void {
  const vv = window.visualViewport
  ears.add(onChange)
  // 처음 부른 쪽이 귀를 단다. 둘째부터는 이미 달린 귀를 같이 쓴다
  if (ears.size === 1 && vv) {
    document.documentElement.style.setProperty('--kb', `${kbNow}px`)
    vv.addEventListener('resize', measure)
    vv.addEventListener('scroll', measure)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    measure()
  }
  return () => {
    ears.delete(onChange)
    // 마지막이 떠날 때만 뗀다. 한 탭이 떠났다고 다른 탭의 --kb 를 지우면 안 된다
    if (ears.size > 0 || !vv) return
    vv.removeEventListener('resize', measure)
    vv.removeEventListener('scroll', measure)
    document.removeEventListener('focusin', onFocusIn)
    document.removeEventListener('focusout', onFocusOut)
    cancelAnimationFrame(follow)
    document.documentElement.removeAttribute('data-typing')
    document.documentElement.style.removeProperty('--kb')
    kbNow = 0
  }
}

const snap = () => kbNow
const serverSnap = () => 0

/** 키보드 높이(px). 부르기만 하면 --kb 가 문서 뿌리에 적힌다 */
export function useKeyboardInset(): number {
  return useSyncExternalStore(subscribe, snap, serverSnap)
}
