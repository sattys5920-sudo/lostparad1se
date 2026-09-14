// 오늘의 투명인간 — 이름 하나를 적는 자리.
//
// **신뢰·호감 표와는 다른 화면이다.** 그쪽은 마주 서야 주는 호의고,
// 이쪽은 만나지 않고 하는 배제다. 한 화면에 담으면 「좋아한다」와
// 「지워라」가 같은 목록에 나란히 선다.
//
// 기권 단추는 없다. 마감 전까지 몇 번이든 바꿀 수 있고, 마지막에 적은
// 이름만 남는다. **누가 누구를 적었는지는 나에게도 내 것만 보인다.**
import { useState } from 'react'

import { VOTE_GUIDE, VOTE_TITLE, murmursUpTo } from '../../../shared/story/vote'
import type { GameActions } from './useGame'
import type { PlayerViewDoc, SeatEntry } from '../../../shared/model'

export interface BallotProps {
  me: SeatEntry
  seats: readonly SeatEntry[]
  /** 오늘 팀장들. 팀장은 적을 수 없다. */
  captainIds: readonly string[]
  /** 어제 지워진 사람. 이틀 연속은 없다. */
  invisibleId: string | null
  day: number
  view: PlayerViewDoc | null
  act: GameActions
  onSaid: (text: string) => void
}

export function Ballot({ me, seats, captainIds, invisibleId, day, view, act, onSaid }: BallotProps) {
  const [busy, setBusy] = useState(false)
  const mine = view?.myBallot ?? null

  // 적을 수 있는 사람만 목록에 둔다. 나, 팀장, 어제 지워진 사람은 빠진다
  const named = seats.filter(
    (s) => s.playerId !== me.playerId && !captainIds.includes(s.playerId) && s.playerId !== invisibleId,
  )

  async function write(targetId: string) {
    setBusy(true)
    try {
      await act.castBallot(targetId)
      onSaid('적었다. 마감 전까지 바꿀 수 있다.')
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sc-bl">
      <h2>{VOTE_TITLE}</h2>
      <p className="sc-bl__guide">{VOTE_GUIDE}</p>

      <ul className="sc-bl__names">
        {named.map((s) => (
          <li key={s.playerId}>
            <button
              className={mine === s.playerId ? 'is-on' : ''}
              disabled={busy}
              onClick={() => void write(s.playerId)}
            >
              {s.name}
            </button>
          </li>
        ))}
      </ul>

      {mine === null && <p className="sc-bl__none">아직 아무 이름도 적지 않았다.</p>}

      {/* 날마다 한 줄씩 늘어난다. 늘어나는 것 자체가 이 게임이 하려는 말이다 */}
      <div className="sc-bl__murmur">
        {murmursUpTo(day).map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </div>
  )
}
