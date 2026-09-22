// 아침 등교.
//
//   검은 화면에 날짜 카드
//   → A의 기록 읽기 (종이 위에 타자, 탭하면 다음 줄, 배경에 눈)
//   → 오늘 일어나는 일
//   → 미니맵으로 돌아오며 지목 칸 강조
//
// 며칠을 건너뛰고 들어왔으면 빠진 날을 날짜순으로 이어서 본다. 진행은
// shared/reveal/morning.ts 가 쥐고, 여기서는 그리기만 한다.
import { useEffect, useMemo, useState } from 'react'
import './reveal.css'
import { Snow } from './Snow'
import { PaperSheet } from './PaperSheet'
import { useTypewriter } from './useTypewriter'
import {
  advance,
  currentDay,
  done,
  startMorning,
  type DayScript,
  type MorningState,
} from '../../../shared/reveal/morning'
import type { PaperKind } from '../../../shared/reveal/paper'

/** 서버가 내려보낸 한 날의 조각. **읽을 글이 전부다.** */
export interface DayFragment {
  day: number
  papers: {
    kind: PaperKind
    lines: string[]
    caption: string | null
    topLines: string[] | null
    topCaption: string | null
  }[]
}

export interface MorningProps {
  /** 재생할 날들의 조각. 날짜순이 아니어도 된다. */
  fragments: readonly DayFragment[]
  /** 그날의 투명인간 이름. 없는 날은 비워 둔다. */
  invisibleNameByDay?: Record<number, string | null>
  /** 눈발 단계 0~5. */
  snowLevel?: number
  /** 다 봤을 때. 끝까지 본 날과 건너뛴 날을 알려 준다. */
  onFinish: (result: { read: number[]; skipped: number[] }) => void
}

export function MorningSequence(props: MorningProps) {
  const byDay = useMemo(
    () => new Map(props.fragments.map((f) => [f.day, f])),
    [props.fragments],
  )
  const days = useMemo(
    () => [...props.fragments].map((f) => f.day).sort((a, b) => a - b),
    [props.fragments],
  )
  const [state, setState] = useState<MorningState>(() => startMorning(days))

  const day = currentDay(state)
  const fragment = day !== null ? byDay.get(day) : undefined
  const script: DayScript | null = fragment
    ? { day: fragment.day, papers: fragment.papers.map((p) => ({ hasTop: p.topLines !== null })) }
    : null

  const paper = fragment?.papers[state.paperIndex]
  const body = useTypewriter(state.scene === 'record' && paper ? paper.lines : [])
  const top = useTypewriter(
    state.scene === 'record' && state.topShown && paper?.topLines ? paper.topLines : [],
  )

  // 끝나면 바깥에 알린다
  useEffect(() => {
    if (!done(state)) return
    const read = days.filter((d) => !state.skipped.includes(d))
    props.onFinish({ read, skipped: [...state.skipped] })
  }, [state, days, props])

  if (done(state) || day === null || !fragment) return null

  /** 기록 읽기의 탭. 찍는 중이면 다 보여 주고, 다 찍혔으면 넘어간다. */
  function onTap() {
    if (state.scene !== 'record') return
    // 맨 위가 드러나는 중이면 그쪽 타자를 먼저 끝낸다
    const active = state.topShown && paper?.topLines ? top : body
    if (!active.tap()) return
    setState((s) => advance(s, script))
  }

  return (
    <div className="sc-rv" role="dialog" aria-label="기록">
      <Snow level={props.snowLevel ?? 5} />

      {paper && (
        <button className="sc-rv__record" onClick={onTap} aria-label="넘기기">
          <PaperSheet
            kind={paper.kind}
            lines={body.shown}
            caption={paper.caption}
            topLines={top.shown}
            topCaption={paper.topCaption}
            topShown={state.topShown}
          />
        </button>
      )}

    </div>
  )
}
