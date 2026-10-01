// 남에게 하는 일 — 표.
//
// **수첩 탭에 산다.** 전에는 「나」 탭에 있었는데, 아침에는 열넷이 한
// 교실에 서 있어서 카드 열셋이 그 탭의 절반을 먹었다. 남에 대한
// 것은 남을 적어 두는 자리에 있는 편이 맞다.
//
// 신뢰·호감표는 여기서 뺐다. 그것은 마주 선 사람에게 주는 것이라 맵
// 쪽으로 갔고, 상대는 누를 때 시트로 고른다 — 평소에 열셋을 늘어
// 놓을 이유가 없다.
//
// 표는 익명이다. 던지고 나면 화면에도 아무것도 남지 않는다 — 서버가
// 「던졌다」만 알려 주고, 누구에게 줬는지는 내 몫에도 안 담긴다.
import { useState } from 'react'

import { VOTE_LABEL, type VoteKind } from '../../../shared/rules/v2'
import { TEAM_COLOR } from './MapPlan'
import type { GameActions } from './useGame'
import type { SeatEntry } from '../../../shared/model'
import type { TeamId } from '../types'
import { buzz } from './Controls'

export interface AroundProps {
  me: SeatEntry
  seats: readonly SeatEntry[]
  day: number
  /** 오늘 지워진 사람. 표를 받지 않는다. */
  invisibleId: string | null
  /** 내가 고른 중요한 사람. */
  chosenId: string | null
  /** 지금 나와 같은 자리에 서 있는 사람들. */
  hereIds: readonly string[]
  /**
   * 그중 **바로 옆 칸**인 사람들. 표는 거래와 같은 기준이라 같은
   * 방이라는 것만으로는 모자라다 — 이 목록에 없으면 표를 못 준다.
   */
  nearIds: ReadonlySet<string>
  /** 내가 선 방 이름. 걷는 중이면 null. */
  hereName: string | null
  act: GameActions
  onSaid: (text: string) => void
}

// 표는 호의뿐이다. 배제는 투명인간 투표가 따로 맡는다
const VOTES: VoteKind[] = ['trust', 'liking']

export function Around(props: AroundProps) {
  const { me, seats, act, onSaid } = props
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)

  // **여기 있는 사람만 보인다.** 명단을 통째로 펴 놓으면 학교
  // 반대편 사람에게도 뭔가 할 수 있을 것처럼 보인다. 만나야 한다
  const here = new Set(props.hereIds)
  // 마주 선 사람만. **투명인간은 목록에 아예 안 뜬다** — 서버가 위치를
  // 안 보내 here 에 들지 않지만, 화면도 한 번 더 거른다
  const others = seats.filter(
    (s) => s.playerId !== me.playerId && s.playerId !== props.invisibleId && here.has(s.playerId),
  )

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true)
    try {
      await fn()
      buzz('ok')
      onSaid(`${label} 했다.`)
    } catch (e) {
      buzz('no')
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sc-pe">
      <h2>여기 있는 사람 <span>{others.length} 명</span></h2>
      {others.length === 0 && (
        <p className="sc-pe__none">
          {props.hereName ? `${props.hereName}에 아무도 없다.` : '걷는 중이다.'}
        </p>
      )}
      <ul className="sc-pe__list">
        {others.map((s) => (
          <li key={s.playerId} className={picked === s.playerId ? 'is-picked' : ''}>
            <button className="sc-pe__who" onClick={() => setPicked(picked === s.playerId ? null : s.playerId)}>
              {s.name}
              {/* 팀은 글자가 아니라 완장 색이다. 다른 화면과 같은 규칙 */}
              <span className="sc-pe__band" style={{ background: TEAM_COLOR[s.team as TeamId] }} aria-hidden />
            </button>
            {picked === s.playerId && (
              <div className="sc-pe__acts">
                {!props.nearIds.has(s.playerId) && <p className="sc-pe__far">바로 옆 칸이어야 표를 줄 수 있다.</p>}
                {VOTES.map((k) => (
                  <button
                    key={k}
                    disabled={busy || !props.nearIds.has(s.playerId)}
                    onClick={() => run(VOTE_LABEL[k], () => act.castVote(s.playerId, k))}
                  >
                    {VOTE_LABEL[k]}
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
