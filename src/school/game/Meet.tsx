// 맵에서 사람을 짚으면 그 사람 옆에 뜨는 작은 차림표.
//
// 바텀시트가 아니다. 알피지처럼 짚은 자리에 붙는다 — 다만 **짚은
// 자리를 덮지는 않는다.** 말 한 칸은 32px 인데 손끝이 닿는 자리는
// 45px 쯤이라, 누르는 순간 그 둘레 한 칸 반이 이미 손 밑이다.
// 거기에 창을 띄우면 뜬 것을 못 본다.
//
// 그래서 머리 위로 한 뼘 비껴서 띄우고, 위가 모자라면 발밑으로
// 뒤집는다. 좌우로 잘릴 자리면 화면 안으로 민다.
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

import type { TeamId } from '../../../shared/rules/v2'
import type { PersonAt } from './Walk'

/** 차림표 한 줄의 높이. iOS 가 말하는 최소 손가락 자리(44)보다 한 뼘 위다. */
const ROW_H = 48
/**
 * 말과 차림표 사이. **손끝이 닿는 자리(약 45px)의 절반보다 넓다** —
 * 이보다 좁으면 누른 손가락이 첫 줄을 덮는다.
 */
const GAP_PX = 26
/** 화면 가장자리에서 이만큼은 띄운다. 반쯤 잘린 차림표는 차림표가 아니다. */
const EDGE_PX = 10
/** 꼬리(▼)가 모서리로 넘어가지 않게 잡아 두는 여백. */
const TAIL_PAD = 16

export interface MeetRow {
  key: string
  label: string
  /**
   * 못 누르는 까닭. **살아 있는 줄에는 없다** — 네 줄 모두에 설명을
   * 달면 창이 바텀시트만큼 커진다. 막힌 줄만 왜 막혔는지 말한다.
   */
  why?: string | null
  tone?: 'vote' | 'move'
  onPick: () => void
}

export interface MeetProps {
  name: string
  team: TeamId | null
  /** 짚은 사람이 화면 어디에 서 있나. Walk 가 재서 준다. */
  at: PersonAt
  rows: readonly MeetRow[]
  onClose: () => void
}

export interface Box {
  left: number
  top: number
  /** 발밑으로 뒤집혔나. 꼬리가 위로 붙는다. */
  below: boolean
  /** 꼬리가 차림표 안에서 몇 px 자리인가. 말 바로 위를 가리킨다. */
  tail: number
}

/**
 * 차림표를 어디에 놓을지 센다. **재 놓은 크기를 받아서 셈만 한다** —
 * DOM 을 만지지 않으므로 시험이 붙는다.
 *
 * 기본은 머리 위다. 거기가 모자라면 발밑으로 뒤집고, 뒤집어도
 * 모자라면 화면 안으로 민다.
 */
export function placeMenu(
  at: PersonAt,
  size: { w: number; h: number },
  screen: { w: number; h: number },
): Box {
  let top = at.head - GAP_PX - size.h
  let below = false
  if (top < EDGE_PX) {
    top = at.foot + GAP_PX
    below = true
  }
  top = Math.min(Math.max(top, EDGE_PX), Math.max(EDGE_PX, screen.h - size.h - EDGE_PX))

  const left = Math.min(Math.max(at.x - size.w / 2, EDGE_PX), Math.max(EDGE_PX, screen.w - size.w - EDGE_PX))
  const tail = Math.min(Math.max(at.x - left, TAIL_PAD), Math.max(TAIL_PAD, size.w - TAIL_PAD))
  return { left, top, below, tail }
}

export function Meet({ name, team, at, rows, onClose }: MeetProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState<Box | null>(null)

  /*
   * 자리는 **그려 놓고 재서** 정한다.
   *
   * 줄 수가 사람마다 다르다 — 우리 팀에게는 이적 줄이 아예 없다.
   * 높이를 미리 셈해 두면 그 한 줄만큼 어긋난다. 한 번 그리고,
   * 칠해지기 전에(useLayoutEffect) 재서 옮긴다.
   */
  useLayoutEffect(() => {
    const el = panelRef.current
    if (!el) return
    setBox(
      placeMenu(
        at,
        { w: el.offsetWidth, h: el.offsetHeight },
        { w: window.innerWidth, h: window.innerHeight },
      ),
    )
  }, [at])

  /*
   * **줄 높이는 재기 전에 들어가 있어야 한다.**
   *
   * 처음에는 이걸 자리와 한 뭉치로 넣었다 — 자리가 정해진 뒤에야
   * --mt-row 가 붙으니, 첫 그림은 줄이 44px(버튼 기본값)이고 재는
   * 것도 44px 짜리였다. 그 값으로 자리를 잡은 다음 줄이 48px 로
   * 자라서, 차림표가 열여섯 화소 어긋난 채 떴다. 실제로 그랬다.
   */
  const vars: Record<string, string> = { '--mt-row': `${ROW_H}px` }
  if (box !== null) vars['--mt-tail'] = `${box.tail}px`
  const style: CSSProperties =
    box === null
      ? { ...vars, visibility: 'hidden' }
      : { ...vars, left: `${box.left}px`, top: `${box.top}px` }

  return (
    <div className="sc-mt" role="dialog" aria-label={`${name}에게`}>
      {/* 차림표 밖은 전부 닫기 자리다. **이게 없으면 바깥 탭이 걸음이 된다** —
          닫으려고 누른 것이 「저기로 걸어가기」로 읽히면 한 수를 잃는다 */}
      <button className="sc-mt__back" aria-label="닫기" onClick={onClose} />
      <div
        ref={panelRef}
        className={`sc-mt__panel${box?.below ? ' is-below' : ''}`}
        style={style}
      >
        <header className="sc-mt__head">
          <b>{name}</b>
          <i>{team === null ? '?' : team}팀</i>
        </header>
        {rows.map((r) => (
          <button
            key={r.key}
            className={`sc-mt__row${r.tone ? ` is-${r.tone}` : ''}`}
            disabled={r.why != null}
            onClick={r.onPick}
          >
            {r.label}
            {r.why != null && <span>{r.why}</span>}
          </button>
        ))}
        <i className="sc-mt__tail" aria-hidden />
      </div>
    </div>
  )
}
