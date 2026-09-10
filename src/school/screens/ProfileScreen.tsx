import { useState } from 'react'
import './ProfileScreen.css'
import { useSchoolGame } from '../state/SchoolGameContext'
import { ENDINGS } from '../data/endings'
import type { EndingKey } from '../types'

export function ProfileScreen() {
  const { nickname, myPlayer, myRole, session, myMissionProgress, submitHiddenGoalResolution, chooseEnding, logout } =
    useSchoolGame()
  const [goalDraft, setGoalDraft] = useState(myPlayer?.hiddenGoalResolution ?? '')
  const [savedNotice, setSavedNotice] = useState(false)

  if (!myPlayer || !myRole) {
    return (
      <div className="sc-profile sc-profile--wait">
        <p>역할을 기다리는 중이다.</p>
      </div>
    )
  }

  async function saveGoal() {
    await submitHiddenGoalResolution(goalDraft)
    setSavedNotice(true)
    setTimeout(() => setSavedNotice(false), 1600)
  }

  async function pickEnding(key: EndingKey) {
    await chooseEnding(key, goalDraft || null)
  }

  return (
    <div className="sc-profile">
      <div className="sc-profile__head">
        <span className="sc-profile__eyebrow">{myRole.name}</span>
        <h1>{nickname}</h1>
      </div>

      <section className="sc-profile__section">
        <span className="sc-profile__label">공개적인 모습</span>
        <p>{myRole.publicPersona}</p>
      </section>

      <section className="sc-profile__section sc-profile__section--private">
        <span className="sc-profile__label">아무에게도 말하지 않은 사실</span>
        <p>{myRole.privateFact}</p>
      </section>

      <section className="sc-profile__section">
        <span className="sc-profile__label">
          개인 미션 · {myMissionProgress.filter((p) => p.done).length}/{myRole.mission.checklist.length}
        </span>
        <ul className="sc-profile__checklist">
          {myMissionProgress.map((p) => (
            <li key={p.item.text}>
              <div className={`sc-profile__check ${p.done ? 'is-done' : ''}`}>
                <span className="sc-profile__check-box">{p.done ? '✓' : ''}</span>
                <span className="sc-profile__check-text">{p.item.text}</span>
                <span className="sc-profile__check-count">
                  {Math.min(p.current, p.item.threshold)}/{p.item.threshold}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="sc-profile__section sc-profile__section--private">
        <span className="sc-profile__label">숨겨진 목표</span>
        <p>{myRole.mission.hiddenGoal}</p>
        <textarea
          value={goalDraft}
          placeholder="이 목표를 어떻게 마주했는지, 무엇을 선택했는지 스스로 남겨 둔다"
          onChange={(e) => setGoalDraft(e.target.value)}
          rows={3}
        />
        <button className="sc-profile__save" onClick={saveGoal}>
          {savedNotice ? '남겨 두었다' : '기록으로 남기기'}
        </button>
      </section>

      {session.phase === 'ended' && (
        <section className="sc-profile__section">
          <span className="sc-profile__label">마지막 선택 · 나의 엔딩</span>
          <div className="sc-profile__endings">
            {ENDINGS.map((e) => (
              <button
                key={e.key}
                className={`sc-profile__ending ${myPlayer.endingKey === e.key ? 'is-selected' : ''}`}
                onClick={() => pickEnding(e.key)}
              >
                <span className="sc-profile__ending-title">「{e.title}」</span>
                <span className="sc-profile__ending-desc">{e.description}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <button className="sc-profile__logout" onClick={logout}>
        다시 시작하기
      </button>
    </div>
  )
}
