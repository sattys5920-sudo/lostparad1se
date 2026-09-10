import { useState } from 'react'
import './RosterScreen.css'
import { useSchoolGame } from '../state/SchoolGameContext'
import { roleById } from '../data/roles'
import { teamById } from '../data/teams'
import { ChatScreen } from './ChatScreen'
import { VOTE_LABEL, type VoteCategory } from '../types'

const VOTE_ORDER: VoteCategory[] = ['trust', 'liking', 'suspicion']

export function RosterScreen() {
  const { isHost, viewerId, players, otherPlayerIds, dmWith, myVotesToday, castVote, myTeamId } = useSchoolGame()
  const [openChatId, setOpenChatId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const classmates = otherPlayerIds
    .map((id) => players[id])
    .filter(Boolean)
    .filter((p) => !p.isHost)
    .sort((a, b) => a.nickname.localeCompare(b.nickname, 'ko'))

  if (isHost) {
    return (
      <div className="sc-roster">
        <h1 className="sc-roster__title">아이들</h1>
        <ul className="sc-roster__list">
          {classmates.map((p) => {
            const role = p.roleId ? roleById[p.roleId] : null
            const team = p.teamId ? teamById[p.teamId] : null
            return (
              <li key={p.id} className="sc-roster__row sc-roster__row--host">
                <span className="sc-roster__name">{p.nickname}</span>
                <span className="sc-roster__meta">
                  {team && (
                    <span style={{ color: team.color }}>
                      {team.name}
                      {' · '}
                    </span>
                  )}
                  {role ? role.name : '역할 미배정'}
                </span>
              </li>
            )
          })}
          {classmates.length === 0 && <li className="sc-roster__empty">아직 아무도 없다.</li>}
        </ul>
      </div>
    )
  }

  if (openChatId) {
    return <ChatScreen otherId={openChatId} onBack={() => setOpenChatId(null)} />
  }

  async function vote(targetId: string, category: VoteCategory) {
    setError('')
    try {
      await castVote(targetId, category)
    } catch (e) {
      setError(e instanceof Error ? e.message : '표를 줄 수 없다.')
    }
  }

  return (
    <div className="sc-roster">
      <h1 className="sc-roster__title">아이들</h1>
      <p className="sc-roster__hint">
        이름을 누르면 둘만의 대화가 열린다. 신뢰·호감·의심은 하루에 각각 한 명에게만, 그리고 다른 팀에게만 줄 수 있다.
      </p>
      {error && <p className="sc-roster__error">{error}</p>}
      <ul className="sc-roster__list">
        {classmates.map((p) => {
          const messages = viewerId ? dmWith(p.id) : []
          const last = messages[messages.length - 1]
          const revealedToMe = messages.some((m) => m.kind === 'reveal' && m.authorId === p.id)
          const team = p.teamId ? teamById[p.teamId] : null
          const sameTeam = Boolean(myTeamId && p.teamId === myTeamId)
          return (
            <li key={p.id} className="sc-roster__item">
              <button className="sc-roster__row sc-roster__row--tap" onClick={() => setOpenChatId(p.id)}>
                <span className="sc-roster__left">
                  <span className="sc-roster__name">
                    {p.nickname}
                    {team && (
                      <span className="sc-roster__team" style={{ color: team.color }}>
                        {' '}
                        {team.name}
                      </span>
                    )}
                  </span>
                  {last && <span className="sc-roster__preview">{last.text}</span>}
                </span>
                {revealedToMe && <span className="sc-roster__revealed">공개함</span>}
              </button>
              {sameTeam ? (
                <span className="sc-roster__sameteam">같은 팀 — 표를 줄 수 없다</span>
              ) : (
                <div className="sc-roster__votes">
                  {VOTE_ORDER.map((category) => {
                    const givenHere = myVotesToday[category] === p.id
                    return (
                      <button
                        key={category}
                        type="button"
                        className={`sc-roster__vote sc-roster__vote--${category} ${givenHere ? 'is-selected' : ''}`}
                        disabled={myVotesToday[category] !== null}
                        onClick={(e) => {
                          e.stopPropagation()
                          vote(p.id, category)
                        }}
                      >
                        {VOTE_LABEL[category]}
                        {givenHere ? ' ✓' : ''}
                      </button>
                    )
                  })}
                </div>
              )}
            </li>
          )
        })}
        {classmates.length === 0 && <li className="sc-roster__empty">아직 아무도 없다.</li>}
      </ul>
    </div>
  )
}
