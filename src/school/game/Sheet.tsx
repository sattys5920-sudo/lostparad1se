// 아래에서 올라오는 시트와, 두 번 눌러야 되는 단추(Sure).
//
// 모바일에는 창이 없다. 창처럼 가운데 띄우면 손가락이 닿지 않는
// 위쪽에 닫기 단추가 생긴다 — 그래서 전부 아래에서 올린다.
// 높이는 화면의 70%까지. 넘치면 시트 안에서만 구른다. 위쪽 30%는
// 항상 비어 있어야 한다. 거기 페이즈 타이머가 떠 있다.
import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type MutableRefObject, type ReactNode } from 'react'

import { buzz } from './Controls'

/** 이만큼 아래로 밀면 닫는다. 그보다 짧으면 제자리로 돌아간다. */
const CLOSE_PX = 80

export interface SheetProps {
  title: string
  onClose: () => void
  children: ReactNode
  /**
   * 뒤를 가리지 않는 낮은 시트. 높이는 40% 까지이고 뒤를 누를 수 있다 —
   * 전체 맵에서 방을 누르면 뜨는 정보가 이것이다. 다른 방을 누르면 그
   * 방으로 바뀌어야 하는데, 뒤를 막으면 한 번 닫고 다시 눌러야 한다.
   */
  peek?: boolean
  /** 시트 판의 상자. 뒤에서 가려진 것을 비켜 세울 때 잰다. */
  panelRef?: MutableRefObject<HTMLDivElement | null>
}

export function Sheet({ title, onClose, children, peek = false, panelRef: outer }: SheetProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const fromRef = useRef<number | null>(null)

  const move = useCallback((y: number) => {
    const el = panelRef.current
    if (!el) return
    const from = fromRef.current
    if (from == null) return
    // 위로는 안 끌린다. 시트는 아래로만 사라진다
    el.style.transform = `translateY(${Math.max(0, y - from)}px)`
  }, [])

  const down = (e: React.PointerEvent) => {
    fromRef.current = e.clientY
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const up = (e: React.PointerEvent) => {
    const from = fromRef.current
    fromRef.current = null
    const el = panelRef.current
    if (el) el.style.transform = ''
    if (from != null && e.clientY - from > CLOSE_PX) onClose()
  }

  return (
    <div className={'sc-sheet' + (peek ? ' is-peek' : '')} role="dialog" aria-label={title}>
      {/* 뒤를 눌러도 닫힌다. 시트 밖은 전부 닫기 자리다 */}
      {!peek && <button className="sc-sheet__back" aria-label="닫기" onClick={onClose} />}
      <div
        className="sc-sheet__panel"
        ref={(el) => {
          panelRef.current = el
          if (outer) outer.current = el
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="sc-sheet__grip"
          onPointerDown={down}
          onPointerMove={(e) => move(e.clientY)}
          onPointerUp={up}
          onPointerCancel={up}
        >
          <span />
        </div>
        <header className="sc-sheet__head">
          <h2>{title}</h2>
          <button onClick={onClose}>닫기</button>
        </header>
        <div className="sc-sheet__body">{children}</div>
      </div>
    </div>
  )
}

// ── 두 번 누르기 ────────────────────────────────────────────────
//
// 되돌릴 수 없는 것들 — 로봇 부수기, 쪽지 찢기, 지우개, 심부름 그만두기,
// 로그아웃, 투표지 넣기 — 은 손가락이 스친 것만으로 일어나면 안 된다.
//
// **창을 띄우지 않는다.** 한 번 누르면 단추가 2초 동안 「정말?」로 바뀌고
// 무슨 일이 일어나는지 한 줄을 보인다. 그 사이에 한 번 더 누르면 한다.
// 단계가 적고, 손가락이 제자리에 있으니 실수로 다른 것을 누를 일도 없다.
// 창은 손가락을 화면 가운데로 끌고 가고, 위쪽 「그만두기」는 엄지가
// 안 닿는다.

/** 「정말?」이 떠 있는 시간. */
export const SURE_MS = 2000

export interface SureProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  /** 두 번째에 할 일. */
  onGo: () => void
  /** 무엇이 일어나는지 한 줄. 「정말?」 아래에 뜬다. */
  warn: string
  children: ReactNode
}

export function Sure({ onGo, warn, children, className, ...rest }: SureProps) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), SURE_MS)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <button
      {...rest}
      className={(className ? className + ' ' : '') + 'sc-sure' + (armed ? ' is-armed' : '')}
      aria-live="polite"
      onClick={() => {
        if (!armed) {
          setArmed(true)
          buzz('act')
          return
        }
        setArmed(false)
        onGo()
      }}
    >
      {armed ? (
        <span className="sc-sure__ask">
          <b>정말?</b>
          <small>{warn}</small>
        </span>
      ) : (
        children
      )}
    </button>
  )
}
