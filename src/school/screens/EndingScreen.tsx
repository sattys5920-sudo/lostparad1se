import './EndingScreen.css'
import { useSchoolGame } from '../state/SchoolGameContext'
import { endingByKey } from '../data/endings'

export function EndingScreen() {
  const { isHost, myPlayer, players, otherPlayerIds } = useSchoolGame()
  const myEnding = myPlayer?.endingKey ? endingByKey[myPlayer.endingKey] : null

  const classmates = otherPlayerIds.map((id) => players[id]).filter(Boolean)

  return (
    <div className="sc-ending">
      <div className="sc-ending__head">
        <span className="sc-ending__eyebrow">DAY 5 · 닷새가 지났다</span>
        <h1>A가 사라지고 난 뒤,{'\n'}우리는 서로에게 어떤 사람이 되었나.</h1>
      </div>

      {!isHost && (
        <section className="sc-ending__mine">
          {myEnding ? (
            <>
              <span className="sc-ending__mine-title">「{myEnding.title}」</span>
              <p>{myEnding.description}</p>
            </>
          ) : (
            <p className="sc-ending__pending">프로필 탭에서 나의 엔딩을 고른다.</p>
          )}
        </section>
      )}

      <section className="sc-ending__roll">
        <span className="sc-ending__label">모두의 마지막</span>
        <ul>
          {classmates.map((p) => (
            <li key={p.id}>
              <span className="sc-ending__roll-name">{p.nickname}</span>
              <span className="sc-ending__roll-title">
                {p.endingKey ? `「${endingByKey[p.endingKey].title}」` : '고르는 중…'}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
