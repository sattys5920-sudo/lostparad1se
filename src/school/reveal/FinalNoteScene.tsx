// A의 마지막 쪽지 — 종이가 한 줄씩 손글씨로 적히고, 잠깐 멈췄다가
// 찢겨 사라진다. **한 번만 돈다.** 루프가 없다 — 엔딩 송출은 순간이지
// 배경음악이 아니다.
//
// **문장은 서버에서 받는다.** 화면 코드에는 안 둔다 — 번들 누출
// 검사가 그걸 막는다(scripts/check-bundle.ts). 시간표(줄마다 시작
// 시각·타이핑 길이·찢기 시작·전체 길이)만 finalNote.ts 에 있고, 여기는
// 그 시간표를 setTimeout 으로 따라가며 CSS 로 그린다 — width 를 0에서
// 끝까지 옮기는 것이 곧 타이핑 효과다(steps() 로 한 글자씩 끊어 보인다).
import { useEffect, useRef, useState } from 'react'

import { Snow } from './Snow'
import {
  FINAL_NOTE_STARTS,
  FINAL_NOTE_TEAR_START,
  FINAL_NOTE_TOTAL_MS,
  FINAL_NOTE_TYPE_MS,
} from './finalNote'
import type { GameActions } from '../game/useGame'

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return (
    document.documentElement.hasAttribute('data-plain') ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

export interface FinalNoteSceneProps {
  act: GameActions
  /** 한 번 다 돌면(찢겨 사라지면) 불린다. */
  onDone?: () => void
}

export function FinalNoteScene({ act, onDone }: FinalNoteSceneProps) {
  const [lines, setLines] = useState<string[] | null>(null)
  const [error, setError] = useState('')
  const paperRef = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<(HTMLSpanElement | null)[]>([])

  useEffect(() => {
    let live = true
    act
      .finalNoteText()
      .then((d) => {
        if (live) setLines((d as { lines?: string[] }).lines ?? [])
      })
      .catch((e) => live && setError((e as Error).message))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (lines === null) return
    const paper = paperRef.current
    if (!paper) return
    const els = lineRefs.current.filter((el): el is HTMLSpanElement => el !== null)
    const timers: ReturnType<typeof setTimeout>[] = []
    const reduced = prefersReducedMotion()

    if (reduced) {
      // 전부 즉시 보여 주고, 읽을 시간만 준 뒤 조용히 사라진다 —
      // 옮기고 찢는 큰 움직임은 없다
      els.forEach((el) => { el.style.transition = 'none'; el.style.width = el.dataset.full ?? 'auto' })
      timers.push(setTimeout(() => {
        paper.style.transition = 'opacity 400ms ease'
        paper.style.opacity = '0'
      }, 3200))
      timers.push(setTimeout(() => onDone?.(), 3600))
      return () => timers.forEach(clearTimeout)
    }

    els.forEach((el) => { el.dataset.full = `${el.scrollWidth + 2}px` })

    els.forEach((el, i) => {
      const dur = FINAL_NOTE_TYPE_MS[i] ?? 1200
      timers.push(setTimeout(() => {
        const steps = Math.max(5, Math.round(dur / 85))
        el.style.transition = `width ${dur}ms steps(${steps}, end)`
        el.style.width = el.dataset.full ?? 'auto'
      }, FINAL_NOTE_STARTS[i] ?? 0))
    })

    timers.push(setTimeout(() => {
      paper.style.transition = 'transform 300ms ease'
      paper.style.transform = 'translateY(2px) rotate(-2deg)'
    }, FINAL_NOTE_TEAR_START))
    timers.push(setTimeout(() => {
      paper.style.transition = 'transform 600ms ease, clip-path 600ms ease'
      paper.style.clipPath = 'polygon(0 0,100% 0,100% 38%,58% 44%,42% 40%,0 46%)'
      paper.style.transform = 'translateY(4px) rotate(-4deg)'
    }, FINAL_NOTE_TEAR_START + 300))
    timers.push(setTimeout(() => {
      paper.style.transition = 'transform 800ms ease, opacity 800ms ease, clip-path 800ms ease'
      paper.style.clipPath = 'polygon(0 0,45% 2%,100% 0,100% 100%,55% 96%,0 100%)'
      paper.style.transform = 'translateY(30px) rotate(10deg)'
      paper.style.opacity = '0.9'
    }, FINAL_NOTE_TEAR_START + 900))
    timers.push(setTimeout(() => {
      paper.style.transition = 'transform 800ms ease, opacity 800ms ease'
      paper.style.transform = 'translateY(180px) rotate(28deg)'
      paper.style.opacity = '0'
    }, FINAL_NOTE_TEAR_START + 1700))

    timers.push(setTimeout(() => onDone?.(), FINAL_NOTE_TOTAL_MS))

    return () => timers.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines])

  if (error) return <p className="sc-fn__err">{error}</p>
  if (lines === null) return <div className="sc-fn__stage" />

  return (
    <div className="sc-fn__stage">
      <Snow level={4} />
      <div className="sc-fn__paper" ref={paperRef}>
        <i className="sc-fn__corner is-tl" />
        <i className="sc-fn__corner is-tr" />
        <i className="sc-fn__corner is-bl" />
        <i className="sc-fn__corner is-br" />
        {lines.map((line, i) => (
          <div className="sc-fn__row" key={i}>
            <span className="sc-fn__ln" ref={(el) => { lineRefs.current[i] = el }}>
              {line}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
