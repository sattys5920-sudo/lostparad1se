import './RoleRevealScreen.css'
import { useSchoolGame } from '../state/SchoolGameContext'

export function RoleRevealScreen() {
  const { myPlayer, myRole, acknowledgeRole, assignedTarget } = useSchoolGame()

  if (!myPlayer || !myRole) {
    return (
      <div className="sc-reveal sc-reveal--wait">
        <p>역할을 배정하는 중이다...</p>
      </div>
    )
  }

  return (
    <div className="sc-reveal">
      <div className="sc-reveal__scroll">
        <span className="sc-reveal__eyebrow">당신의 역할</span>
        <h1 className="sc-reveal__name">{myRole.name}</h1>
        <span className="sc-reveal__axis">지도에서 당신은 · {myRole.axis}</span>

        <section className="sc-reveal__section">
          <span className="sc-reveal__label">공개적인 모습</span>
          <p>{myRole.publicPersona}</p>
        </section>

        <section className="sc-reveal__section">
          <span className="sc-reveal__label">A와의 관계</span>
          <p>{myRole.knownRelationToA}</p>
        </section>

        <section className="sc-reveal__section sc-reveal__section--private">
          <span className="sc-reveal__label">아무에게도 말하지 않은 사실</span>
          <p>{myRole.privateFact}</p>
        </section>

        <section className="sc-reveal__section">
          <span className="sc-reveal__label">개인 미션</span>
          <ul>
            {myRole.mission.checklist.map((item) => (
              <li key={item.text}>{item.text}</li>
            ))}
          </ul>
        </section>

        {assignedTarget && (
          <section className="sc-reveal__section sc-reveal__section--private">
            <span className="sc-reveal__label">미션이 지정한 상대</span>
            <p>
              {assignedTarget.nickname}. 「지정된 한 사람」이라고 적힌 미션은 이 사람을 말한다. 아무에게도 말하지 마라.
            </p>
          </section>
        )}

        <section className="sc-reveal__section sc-reveal__section--private">
          <span className="sc-reveal__label">숨겨진 목표</span>
          <p>{myRole.mission.hiddenGoal}</p>
        </section>

        <p className="sc-reveal__notice">이 화면은 오직 당신만 볼 수 있다. 프로필 탭에서 언제든 다시 볼 수 있다.</p>
      </div>

      <button className="sc-reveal__confirm" onClick={acknowledgeRole}>
        기억했다
      </button>
    </div>
  )
}
