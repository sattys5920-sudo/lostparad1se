// 아래에서 올라오는 시트와, 한 번 묻는 확인 창.
//
// 모바일에는 창이 없다. 창처럼 가운데 띄우면 손가락이 닿지 않는
// 위쪽에 닫기 단추가 생긴다 — 그래서 전부 아래에서 올린다.
// 높이는 화면의 70%까지. 넘치면 시트 안에서만 구른다. 위쪽 30%는
// 항상 비어 있어야 한다. 거기 페이즈 타이머가 떠 있다.
import { useCallback, useRef, useState, type ReactNode } from 'react'

/** 이만큼 아래로 밀면 닫는다. 그보다 짧으면 제자리로 돌아간다. */
const CLOSE_PX = 80

export interface SheetProps {
  title: string
  onClose: () => void
  children: ReactNode
}

export function Sheet({ title, onClose, children }: SheetProps) {
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
    <div className="sc-sheet" role="dialog" aria-label={title}>
      {/* 뒤를 눌러도 닫힌다. 시트 밖은 전부 닫기 자리다 */}
      <button className="sc-sheet__back" aria-label="닫기" onClick={onClose} />
      <div className="sc-sheet__panel" ref={panelRef}>
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

// ── 한 번 묻기 ──────────────────────────────────────────────────
//
// 되돌릴 수 없는 것들 — 짝 무너뜨리기, 쪽지 찢기, 무리 옮기기,
// 투명인간 고르기 — 은 손가락이 스친 것만으로 일어나면 안 된다.
//
// 브라우저의 confirm 은 쓰지 않는다. 앱 안 브라우저에서는 막히기도 하고,
// 막히면 **막힌 줄도 모르고 그냥 true 가 아닌 값이 돌아온다**.

export function useAsk(): [ReactNode, (text: string) => Promise<boolean>] {
  const [asking, setAsking] = useState<string | null>(null)
  // 물어본 사람에게 돌려줄 대답. 창이 떠 있는 동안만 들어 있다
  const replyRef = useRef<((ok: boolean) => void) | null>(null)

  const ask = useCallback((text: string) => {
    // 이미 묻고 있으면 앞의 것은 아니오로 끝낸다. 대답을 영영 기다리게
    // 두면 누른 쪽이 굳는다
    replyRef.current?.(false)
    setAsking(text)
    return new Promise<boolean>((resolve) => {
      replyRef.current = resolve
    })
  }, [])

  const answer = (ok: boolean) => {
    setAsking(null)
    const reply = replyRef.current
    replyRef.current = null
    reply?.(ok)
  }

  const node = asking == null ? null : (
    <div className="sc-ask" role="alertdialog" aria-label="확인">
      <div className="sc-ask__panel">
        <p>{asking}</p>
        <div className="sc-ask__row">
          <button onClick={() => answer(false)}>그만두기</button>
          <button className="is-go" onClick={() => answer(true)}>한다</button>
        </div>
      </div>
    </div>
  )

  return [node, ask]
}
