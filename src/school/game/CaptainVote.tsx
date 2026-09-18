// 오늘의 팀장을 뽑는 자리.
//
// 무전 탭 맨 위에 선다. **상의가 먼저고 투표가 뒤인** 것이 여기서
// 보여야 한다 — 창이 열리기 전에는 남은 시간만 보이고, 열리면 팀원
// 이름이 단추가 된다.
//
// **동점이면 다시 뽑는다.** 그동안 팀장 자리는 빈 채로 있다 — 못 정한
// 것을 규칙이 대신 메워 주지 않는다는 것이 이 화면의 전부다.
import {
  CAPTAIN_NO,
  phaseOf,
  whyNotVote,
  type CaptainVote as Vote,
} from '../../../shared/rules/captain'
import { josa } from '../../../shared/text'
import type { SeatEntry } from '../../../shared/model'
import type { GameActions } from './useGame'
import type { TeamId } from '../../../shared/rules/v2'

/** 남은 시간을 분·초로. 마지막 한 표를 던질지 말지가 여기 달렸다. */
function left(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export interface CaptainVoteProps {
  me: { playerId: string; team: TeamId }
  seats: readonly SeatEntry[]
  captainId: string | null
  /** 오늘 네 팀의 팀장. **비밀이 아니다** — 뽑히면 공지가 나간다. */
  all?: Partial<Record<TeamId, string | null>> | null
  vote: Vote | null
  nowMs: number
  act: GameActions
  onSaid: (text: string) => void
}

export function CaptainVote({ me, seats, captainId, all, vote, nowMs, act, onSaid }: CaptainVoteProps) {
  const mates = seats.filter((s) => s.team === me.team)
  const nameOf = (id: string) => mates.find((s) => s.playerId === id)?.name ?? '?'
  // 다른 팀 팀장은 같은 팀이 아니므로 명단 전체에서 찾는다
  const anyName = (id: string) => seats.find((s) => s.playerId === id)?.name ?? '?'

  // 아직 못 정한 팀은 빼고 적는다. 「없다」를 줄줄이 적어 봐야 소용없다
  const others = (Object.entries(all ?? {}) as [TeamId, string | null][])
    .filter(([t, id]) => t !== me.team && typeof id === 'string' && id !== '')
    .sort(([a], [b]) => a.localeCompare(b))

  if (captainId) {
    return (
      <div className="sc-cv sc-cv--done">
        <p>
          오늘 <b>{me.team}팀 팀장</b>은 <b>{nameOf(captainId)}</b>
          {josa(nameOf(captainId), '이다/다')}.
        </p>
        {/* 팀장은 비밀이 아니다. 뽑힌 만큼 여기에 쌓인다 */}
        {others.length > 0 && (
          <p className="sc-cv__others">
            {others.map(([t, id]) => `${t} ${anyName(id as string)}`).join(' · ')}
          </p>
        )}
      </div>
    )
  }
  if (!vote) return null

  const at = phaseOf(vote, nowMs)
  const again = vote.round > 1

  if (at === 'talking') {
    return (
      <div className="sc-cv">
        <p className="sc-cv__head">
          {again ? <b>다시 뽑는다 — {vote.round}번째</b> : <b>오늘의 팀장을 뽑는다</b>}
          <em>{left(vote.opensAtMs - nowMs)} 뒤에 창이 열린다</em>
        </p>
        <p className="sc-cv__why">
          {again
            ? '지난번에 표가 갈렸다. 무전으로 다시 맞춰 본다.'
            : '먼저 무전으로 상의한다. 누가 맡을지 정하고 나서 적는다.'}
        </p>
      </div>
    )
  }

  if (at === 'closed') {
    return (
      <p className="sc-cv">
        <b>표를 세는 중이다.</b> 갈렸으면 다시 뽑는다.
      </p>
    )
  }

  return (
    <div className="sc-cv sc-cv--open">
      <p className="sc-cv__head">
        <b>{again ? `다시 뽑는다 — ${vote.round}번째` : '오늘의 팀장을 뽑는다'}</b>
        <em>{left(vote.closesAtMs - nowMs)} 남았다</em>
      </p>
      <div className="sc-cv__who">
        {mates.map((s) => {
          const no = whyNotVote({
            vote,
            settled: false,
            nowMs,
            sameTeam: true,
          })
          return (
            <button
              key={s.playerId}
              disabled={no !== null}
              onClick={() => {
                act
                  .voteCaptain(s.playerId)
                  .then(() => onSaid(`${s.name}을(를) 적었다.`))
                  .catch((e) => onSaid((e as Error).message))
              }}
            >
              {s.name}
              {s.playerId === me.playerId && <em>나</em>}
            </button>
          )
        })}
      </div>
      <p className="sc-cv__why">
        {/* 바꿔 적을 수 있다는 것을 안 적으면 아무도 안 바꾼다 */}
        한 장이다. 창이 닫히기 전까지는 바꿔 적을 수 있고, 누가 누구를
        적었는지는 아무에게도 안 간다. 갈리면 다시 뽑는다.
      </p>
    </div>
  )
}

/** 화면이 못 던지는 까닭을 말할 때 쓰는 말. 서버와 같은 문장이다. */
export const VOTE_NO = CAPTAIN_NO
