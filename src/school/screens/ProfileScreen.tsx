import { useState } from 'react'
import './ProfileScreen.css'
import { useSchoolGame } from '../state/SchoolGameContext'
import { CharacterCreator } from '../components/CharacterCreator'
import type { AvatarLook } from '../types'
import { teamById } from '../data/teams'
import type { MissionItemProgress } from '../engine/missionProgress'
import type { MissionMetric } from '../types'

/** 초 단위로 재는 미션은 초로 보여주면 안 읽힌다. 300이 아니라 5분으로. */
const TIME_METRICS = new Set(['aloneSeconds', 'roomSeconds', 'pairAloneWithTargetSeconds', 'withTargetSeconds'])

function asTime(seconds: number): string {
  if (seconds < 60) return `${seconds}초`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s === 0 ? `${m}분` : `${m}분 ${s}초`
}

/**
 * 남이 나에게 한 일에 걸린 항목인가.
 *
 * 이런 항목의 숫자를 실시간으로 띄우면 익명이 무너진다. 방금 누군가와
 * 이야기를 마쳤는데 「받은 신뢰 2/3」이 3으로 바뀌면, 누가 줬는지 바로
 * 안다. 표는 익명이어야 하므로 이 숫자는 끝나야 열린다.
 */
function dependsOnOthers(m: MissionMetric): boolean {
  if (m.kind === 'vote') return true
  if (m.kind === 'action' && m.direction === 'to') return true
  return false
}

function formatProgress(p: MissionItemProgress): string {
  const isTime = TIME_METRICS.has(p.item.metric.kind)
  const cap = p.item.comparison === 'atMost' ? p.current : Math.min(p.current, p.item.threshold)
  if (isTime) return `${asTime(cap)}/${asTime(p.item.threshold)}`
  return `${cap}/${p.item.threshold}`
}

export function ProfileScreen() {
  const {
    nickname,
    myPlayer,
    myRole,
    myTeamId,
    players,
    session,
    myMissionProgress,
    myScore,
    myLeverage,
    spendLeverageOn,
    amBlockedToday,
    actionsLeftToday,
    submitHiddenGoalResolution,
    myLook,
    updateAvatar,
    logout,
  } = useSchoolGame()
  const [goalDraft, setGoalDraft] = useState(myPlayer?.hiddenGoalResolution ?? '')
  const [savedNotice, setSavedNotice] = useState(false)
  const [error, setError] = useState('')

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

  async function useLeverage(leverageId: string, aboutId: string, mode: 'block' | 'extort') {
    setError('')
    try {
      await spendLeverageOn(leverageId, aboutId, mode)
    } catch (e) {
      setError(e instanceof Error ? e.message : '쓸 수 없다.')
    }
  }

  const myTeam = myTeamId ? teamById[myTeamId] : null
  const ended = session.phase === 'ended'
  const sealed = ended ? [] : myMissionProgress.filter((p) => dependsOnOthers(p.item.metric))
  const open = myMissionProgress.filter((p) => ended || !dependsOnOthers(p.item.metric))

  return (
    <div className="sc-profile">
      <div className="sc-profile__head">
        <span className="sc-profile__eyebrow">
          {myRole.name}
          {myTeam && <span style={{ color: myTeam.color }}> · {myTeam.name}</span>}
        </span>
        <h1>{nickname}</h1>
        <span className="sc-profile__today">
          {amBlockedToday ? '약점을 잡혀 오늘은 움직일 수 없다' : `오늘 남은 행동 ${actionsLeftToday}회`}
        </span>
      </div>

      <section className="sc-profile__section">
        <span className="sc-profile__label">아바타</span>
        <CharacterCreator look={myLook} team={myTeamId} onChange={(next: AvatarLook) => void updateAvatar(next)} />
      </section>

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
          개인 미션 · {open.filter((p) => p.done).length}/{open.length}
          {sealed.length > 0 && <span className="sc-profile__muted"> · {sealed.length}개는 끝나야 안다</span>}
        </span>
        <ul className="sc-profile__checklist">
          {myMissionProgress.map((p) => {
            const hide = !ended && dependsOnOthers(p.item.metric)
            return (
              <li key={p.item.text}>
                <div className={`sc-profile__check ${!hide && p.done ? 'is-done' : ''}`}>
                  <span className="sc-profile__check-box">{!hide && p.done ? '✓' : ''}</span>
                  <span className="sc-profile__check-text">{p.item.text}</span>
                  <span className="sc-profile__check-count">
                    {hide ? '끝날 때 판정' : formatProgress(p)}
                  </span>
                </div>
              </li>
            )
          })}
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

      <section className="sc-profile__section">
        <span className="sc-profile__label">내가 쥔 약점 · {myLeverage.length}</span>
        {myLeverage.length === 0 && (
          <p className="sc-profile__muted">아직 없다. 누군가 자기 이야기를 털어놓으면 그게 약점이 된다.</p>
        )}
        {error && <p className="sc-profile__error">{error}</p>}
        {myLeverage.map((l) => (
          <div key={l.id} className="sc-profile__leverage">
            <span className="sc-profile__leverage-name">{players[l.aboutId]?.nickname ?? '???'}</span>
            <div className="sc-profile__leverage-actions">
              <button onClick={() => useLeverage(l.id, l.aboutId, 'block')}>오늘 발을 묶는다</button>
              <button onClick={() => useLeverage(l.id, l.aboutId, 'extort')}>영향력 3을 뜯는다</button>
            </div>
          </div>
        ))}
      </section>

      {/*
        점수도 끝나야 열린다. 받은 신뢰·호감·의심이 실시간으로 보이면
        표가 익명이 아니게 된다 — 숫자가 오른 시각과 방금 만난 사람을
        맞춰 보면 그만이다.
      */}
      {ended && myScore && (
        <section className="sc-profile__section">
          <span className="sc-profile__label">내 점수 · {myScore.total}</span>
          <ul className="sc-profile__score">
            <li>
              <span>미션</span>
              <span>{myScore.missions}</span>
            </li>
            <li>
              <span>신뢰</span>
              <span>{myScore.trust}</span>
            </li>
            <li>
              <span>호감</span>
              <span>{myScore.liking}</span>
            </li>
            <li>
              <span>의심</span>
              <span>{myScore.suspicion}</span>
            </li>
            <li>
              <span>비밀</span>
              <span>{myScore.secrets}</span>
            </li>
            <li>
              <span>팀 기여</span>
              <span>{myScore.contribution}</span>
            </li>
          </ul>
        </section>
      )}

      <button className="sc-profile__logout" onClick={logout}>
        다시 시작하기
      </button>
    </div>
  )
}
