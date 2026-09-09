import { useState } from 'react'
import './RosterScreen.css'
import { useSchoolGame } from '../state/SchoolGameContext'
import { roleById } from '../data/roles'
import { missionCompleteCount, missionTotalCount } from '../engine/missionProgress'
import { ChatScreen } from './ChatScreen'

export function RosterScreen() {
  const { isHost, viewerId, players, otherPlayerIds, dmWith } = useSchoolGame()
  const [openChatId, setOpenChatId] = useState<string | null>(null)

  const classmates = otherPlayerIds
    .map((id) => players[id])
    .filter(Boolean)
    .sort((a, b) => a.nickname.localeCompare(b.nickname, 'ko'))

  if (isHost) {
    return (
      <div className="sc-roster">
        <h1 className="sc-roster__title">아이들</h1>
        <ul className="sc-roster__list">
          {classmates.map((p) => {
            const role = p.roleId ? roleById[p.roleId] : null
            return (
              <li key={p.id} className="sc-roster__row">
                <span className="sc-roster__name">{p.nickname}</span>
                <span className="sc-roster__meta">
                  {role ? role.name : '역할 미배정'}
                  {role && ` · 미션 ${missionCompleteCount(p)}/${missionTotalCount(role)}`}
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

  return (
    <div className="sc-roster">
      <h1 className="sc-roster__title">아이들</h1>
      <p className="sc-roster__hint">이름을 누르면 둘만의 대화가 열린다.</p>
      <ul className="sc-roster__list">
        {classmates.map((p) => {
          const messages = viewerId ? dmWith(p.id) : []
          const last = messages[messages.length - 1]
          const revealedToMe = messages.some((m) => m.kind === 'reveal' && m.authorId === p.id)
          return (
            <li key={p.id}>
              <button className="sc-roster__row sc-roster__row--tap" onClick={() => setOpenChatId(p.id)}>
                <span className="sc-roster__left">
                  <span className="sc-roster__name">{p.nickname}</span>
                  {last && <span className="sc-roster__preview">{last.text}</span>}
                </span>
                {revealedToMe && <span className="sc-roster__revealed">공개함</span>}
              </button>
            </li>
          )
        })}
        {classmates.length === 0 && <li className="sc-roster__empty">아직 아무도 없다.</li>}
      </ul>
    </div>
  )
}
