import { useState } from 'react'
import './EndingScreen.css'
import { useSchoolGame } from '../state/SchoolGameContext'
import { endingByKey } from '../data/endings'
import { finalScores } from '../engine/territory'
import { deriveEnding } from '../engine/playerScore'
import { TEAMS, teamById } from '../data/teams'

export function EndingScreen() {
  const { isHost, myPlayer, players, otherPlayerIds, session, myScore, chooseEnding } = useSchoolGame()
  const [saved, setSaved] = useState(false)

  const classmates = otherPlayerIds.map((id) => players[id]).filter((p) => p && !p.isHost)
  const scores = finalScores(session.territory)
  const ranked = [...TEAMS].sort((a, b) => scores[b.id].total - scores[a.id].total)
  const winner = ranked[0]

  const facedHiddenGoal = Boolean(myPlayer?.hiddenGoalResolution?.trim())
  const derived = myScore ? deriveEnding(myScore, facedHiddenGoal) : null
  const myEnding = derived ? endingByKey[derived] : null
  const myTeam = myPlayer?.teamId ? teamById[myPlayer.teamId] : null

  async function keepResult() {
    if (!derived) return
    await chooseEnding(derived, myPlayer?.hiddenGoalResolution ?? null)
    setSaved(true)
  }

  return (
    <div className="sc-ending">
      <div className="sc-ending__head">
        <span className="sc-ending__eyebrow">DAY 5 · 닷새가 지났다</span>
        <h1>A가 사라지고 난 뒤,{'\n'}우리는 서로에게 어떤 사람이 되었나.</h1>
      </div>

      <section className="sc-ending__roll">
        <span className="sc-ending__label">
          최종 영역 정산 · <span style={{ color: winner.color }}>{winner.name}</span> 우세
        </span>
        <ul>
          {ranked.map((t, i) => (
            <li key={t.id}>
              <span className="sc-ending__roll-name" style={{ color: t.color }}>
                {i + 1}위 · {t.name}
              </span>
              <span className="sc-ending__roll-title">
                {scores[t.id].total}점 (영역 {scores[t.id].territory} · 연결 {scores[t.id].connection} · 핵심{' '}
                {scores[t.id].core} · 자원 {scores[t.id].resource} · 개발 {scores[t.id].development})
              </span>
            </li>
          ))}
        </ul>
      </section>

      {!isHost && myEnding && myScore && (
        <section className="sc-ending__mine">
          <span className="sc-ending__mine-title">「{myEnding.title}」</span>
          <p>{myEnding.description}</p>
          <span className="sc-ending__derived">
            고른 것이 아니라 닷새 동안 실제로 한 일에서 나온 결과다. 개인 점수 {myScore.total}
            {myTeam && ` · ${myTeam.name}`}
          </span>
          <button className="sc-ending__keep" onClick={keepResult} disabled={saved}>
            {saved ? '남겨 두었다' : '내 결과를 남긴다'}
          </button>
        </section>
      )}

      <section className="sc-ending__roll">
        <span className="sc-ending__label">모두의 마지막</span>
        <ul>
          {classmates.map((p) => {
            const team = p.teamId ? teamById[p.teamId] : null
            return (
              <li key={p.id}>
                <span className="sc-ending__roll-name">
                  {p.nickname}
                  {team && <span style={{ color: team.color }}> · {team.name}</span>}
                </span>
                <span className="sc-ending__roll-title">
                  {p.endingKey ? `「${endingByKey[p.endingKey].title}」` : '아직 결과를 남기지 않았다'}
                </span>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
