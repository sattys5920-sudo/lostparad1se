// 타자 효과.
//
// 한 글자씩 찍다가, 탭하면 남은 글자가 한 번에 나온다. 다 나온 뒤의
// 탭은 다음 장면으로 넘어간다 — 그 둘을 가르는 게 이 훅의 일이다.
//
// 움직임을 줄여 달라고 한 사람에게는 처음부터 다 보여 준다. 타자 효과는
// 분위기지 내용이 아니다.
import { useEffect, useRef, useState } from 'react'
import { TAP_GUARD_MS, TYPE_LINE_GAP_MS, TYPE_MS_PER_CHAR } from '../../../shared/reveal/staging'

export interface Typed {
  /** 지금까지 찍힌 줄들. 마지막 줄은 찍히는 중일 수 있다. */
  shown: string[]
  /** 다 찍혔는가. */
  complete: boolean
  /**
   * 탭. 아직 찍는 중이면 전부 드러내고 false를 돌려준다.
   * 이미 다 찍혔으면 아무것도 하지 않고 true — 부르는 쪽이 다음 장면으로 간다.
   */
  tap: () => boolean
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function useTypewriter(lines: readonly string[], msPerChar = TYPE_MS_PER_CHAR): Typed {
  const [count, setCount] = useState(0)
  const lastTap = useRef(0)
  const key = lines.join('')
  const total = lines.reduce((a, l) => a + l.length, 0)
  const instant = msPerChar <= 0 || prefersReducedMotion()

  // 줄이 바뀌면 처음부터 다시 찍는다
  useEffect(() => {
    setCount(instant ? total : 0)
  }, [key, instant, total])

  useEffect(() => {
    if (instant || count >= total) return
    // 줄이 끝나는 자리에서는 조금 쉰다
    let at = 0
    let atLineEnd = false
    for (const l of lines) {
      at += l.length
      if (count === at) {
        atLineEnd = true
        break
      }
    }
    const delay = atLineEnd ? TYPE_LINE_GAP_MS : msPerChar
    const t = setTimeout(() => setCount((c) => c + 1), delay)
    return () => clearTimeout(t)
    // lines는 key로 갈음한다 — 배열 정체성이 매 렌더 바뀌어도 다시 안 돈다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, total, instant, msPerChar, key])

  const shown: string[] = []
  let left = count
  for (const l of lines) {
    if (left <= 0) break
    shown.push(l.slice(0, left))
    left -= l.length
  }

  const complete = count >= total

  function tap(): boolean {
    const now = Date.now()
    if (now - lastTap.current < TAP_GUARD_MS) return false
    lastTap.current = now
    if (complete) return true
    setCount(total)
    return false
  }

  return { shown, complete, tap }
}
