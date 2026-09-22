// 내 학생증과 생활기록부를 가져온다.
//
// **views 에 안 싣는다.** 미션 진행도는 판 전체의 기록을 훑어야 나오고
// (judge), views 는 누가 한 걸음 옮길 때마다 열넷을 통째로 다시 쓴다 —
// 거기에 얹으면 걸음마다 열네 번씩 닷새치를 훑게 된다.
//
// 대신 **「나」 탭을 열 때와 날짜가 바뀔 때만** 부른다. 그 두 순간
// 말고는 이 숫자가 바뀌지 않는다 — 받은 표도 어제까지만 세고, 미션
// 진행도도 정산 단위다.
import { useCallback, useEffect, useState } from 'react'

import type { GameActions } from './useGame'

/** 조항 한 줄. 서버가 **빼고 만들어** 보낸다(judge.ts 의 ClauseView). */
export interface ClauseShown {
  text: string
  shown: boolean
  unit: 'count' | 'hours' | 'days' | 'flag'
  mode: 'atLeast' | 'atMost'
  /** null 이면 그 숫자는 문서에 아예 없다. 가려 둔 것이 아니다. */
  have: number | null
  bar: number
  met: boolean | null
  note: string | null
}

export interface MissionShown {
  text: string
  clauses: ClauseShown[]
  met: boolean | null
  broken: boolean
}

export interface MyPaper {
  roleId: string
  roleName: string
  /** 내 것 한 줄. 남의 숨긴 사실은 이 응답 어디에도 없다. */
  secret: string
  /**
   * 진행도를 세고 있는가. 로비에서는 false 다 — 팀 금고도 칸도
   * 아직 안 놓여서 셀 것이 없다. 미션 **문장**은 그때도 온다.
   */
  counting: boolean
  main: MissionShown
  bond: MissionShown
  /** 합계뿐이다. 신뢰인지 호감인지는 오지 않는다. */
  votesReceived: number
  votesThroughDay: number
}

export interface Paper {
  paper: MyPaper | null
  /** 못 받아왔으면 그 이유. 조용히 비어 있는 것이 제일 나쁘다. */
  err: string | null
  reload: () => void
}

/**
 * @param on   「나」 탭을 보고 있는가. 안 보고 있으면 안 부른다
 * @param day  날짜. 바뀌면 다시 부른다 — 받은 표가 그때 갱신된다
 */
export function useMyPaper(act: GameActions, on: boolean, day: number): Paper {
  const [paper, setPaper] = useState<MyPaper | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [turn, setTurn] = useState(0)
  const reload = useCallback(() => setTurn((n) => n + 1), [])

  useEffect(() => {
    if (!on) return
    let live = true
    act
      .myPaper()
      .then((r) => {
        if (!live) return
        setPaper(r as unknown as MyPaper)
        setErr(null)
      })
      .catch((e) => {
        if (!live) return
        setErr((e as Error).message)
      })
    return () => {
      live = false
    }
  }, [act, on, day, turn])

  return { paper, err, reload }
}
