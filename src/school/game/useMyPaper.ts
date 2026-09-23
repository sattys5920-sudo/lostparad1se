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

/*
 * **모양은 서버와 같은 파일에서 온다**(shared/missions/paper.ts).
 *
 * 전에는 여기에 따로 적어 두었다. 콜러블 응답은 any 로 넘어와서 타입
 * 검사가 안 걸린다 — 서버가 인연 미션을 쪽지 미션으로 바꿨을 때 화면은
 * 그대로 paper.bond.text 를 읽고 있었고, 「나」 탭이 열리는 순간 터졌다.
 * 컴파일도 시험도 조용히 지나갔다.
 *
 * **import type 이라 한 줄도 번들에 안 실린다.** 역할 데이터는 이
 * 경로로 새지 않는다(scripts/check-bundle.ts 가 본다).
 */
import type { ClauseView, MissionView, SlipMissionView } from '../../../shared/missions/judge'
import type { MyPaperDoc } from '../../../shared/missions/paper'

export type ClauseShown = ClauseView
export type MissionShown = MissionView
export type SlipShown = SlipMissionView
export type MyPaper = MyPaperDoc

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
