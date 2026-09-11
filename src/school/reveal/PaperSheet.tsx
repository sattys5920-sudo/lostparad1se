// 종이 한 장 위의 글.
//
// 종이는 캔버스로 그리고 글은 그 위에 얹는다. 종이 크기는 글이 정한다 —
// 줄이 몇 개인지, 380px에서 몇 줄로 접히는지에 따라 늘어난다.
//
// 이 컴포넌트는 **그리기만 한다.** 무엇을 어디까지 찍을지는 바깥이
// 정한다 — 탭 한 번이 「남은 글자 다 보여 주기」인지 「다음 장면」인지는
// 시퀀스가 아는 일이라, 여기서 쥐고 있으면 두 군데가 다투게 된다.
import { useEffect, useRef, useState } from 'react'
import { drawPaper, geomOf } from './paperSprite'
import { PAPERS, type PaperKind } from '../../../shared/reveal/paper'
import { PAPER_PAN_MS, PAPER_SCALE } from '../../../shared/reveal/staging'

export interface SheetProps {
  kind: PaperKind
  /** 지금까지 찍힌 본문 줄. */
  lines: readonly string[]
  caption?: string | null
  /** 지금까지 찍힌 맨 위 줄. 비어 있으면 아직 안 드러난 것이다. */
  topLines?: readonly string[]
  topCaption?: string | null
  /** 맨 위가 드러났는가. 카메라가 위로 올라간다. */
  topShown?: boolean
}

/** 종이 뒤판. 크기는 글이 차지한 자리에서 받는다. */
function PaperBack({ kind, w, h, seed }: { kind: PaperKind; w: number; h: number; seed: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  // 배율은 고정이다. 화면 폭에 따라 바꾸면 괘선 간격이 줄 높이와 어긋난다
  const scale = PAPER_SCALE
  const cw = Math.max(40, Math.ceil(w / scale))
  const ch = Math.max(50, Math.ceil(h / scale))

  useEffect(() => {
    const c = ref.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    c.width = cw * scale
    c.height = ch * scale
    drawPaper(ctx, { kind, w: cw, h: ch, scale, seed })
  }, [kind, cw, ch, scale, seed])

  return <canvas ref={ref} className="sc-rv__paper" aria-hidden="true" />
}

export function PaperSheet(props: SheetProps) {
  const { kind, lines, caption, topLines = [], topCaption, topShown = false } = props
  const boxRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 280, h: 200 })

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const measure = () => setSize({ w: el.offsetWidth, h: el.offsetHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 여백은 확대 전 픽셀이다. CSS에는 배율을 곱해 넣는다 —
  // 퍼센트로 주면 종이가 넓어질수록 왼쪽 여백이 같이 벌어져서
  // 구멍과 여백선 위로 글씨가 올라간다
  const pad = geomOf(kind, 100, 100).pad
  const px = (n: number) => `${n * PAPER_SCALE}px`
  const seed = kind.length * 31 + (lines[0]?.length ?? 0)

  return (
    <div
      className={`sc-rv__sheet ${topShown ? 'is-panned' : ''}`}
      style={{ '--pan-ms': `${PAPER_PAN_MS}ms` } as React.CSSProperties}
    >
      <div className="sc-rv__sheet-stack">
        <PaperBack kind={kind} w={size.w} h={size.h} seed={seed} />
        <div
          ref={boxRef}
          className="sc-rv__sheet-text"
          style={{ padding: `${px(pad.top)} ${px(pad.right)} ${px(pad.bottom)} ${px(pad.left)}` }}
        >
          {/* 맨 위 줄. 드러나기 전에는 자리도 만들지 않는다 */}
          {topShown && (
            <div className="sc-rv__top">
              {topCaption && <p className="sc-rv__caption">{topCaption}</p>}
              {topLines.map((l, i) => (
                <p key={i} className="sc-rv__hand">
                  {l}
                </p>
              ))}
            </div>
          )}
          {caption && <p className="sc-rv__caption">{caption}</p>}
          {lines.map((l, i) => (
            <p key={i} className="sc-rv__line">
              {l}
            </p>
          ))}
        </div>
      </div>
      <span className="sc-rv__paper-label">{PAPERS[kind].label}</span>
    </div>
  )
}
