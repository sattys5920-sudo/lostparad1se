// 감독관 — 시작 전 잠금과 탭 잠금.
//
// 시작 전: 가입 · 아바타 · 프롤로그를 마친 사람은 아무것도 못 한다.
// 「대화 · 이동 풀기」를 누르면 2-3 교실 안에서 걷고 말한다. 「판 시작」을
// 누르면 전부 열린다.
//
// 판이 도는 동안: 탭을 하나씩 잠그고 연다. 잠긴 탭은 모두의 화면에서 흐려진다.
import { useState } from 'react'

import type { GameDoc } from '../../../shared/model'
import type { GameActions } from '../game/useGame'
import { BGM_TRACKS, bgmDay } from '../game/bgm'

export function LobbyStageDesk({ game, act, onSaid }: { game: GameDoc; act: GameActions; onSaid: (t: string) => void }) {
  const [busy, setBusy] = useState(false)
  const talk = game.lobbyStage === 'talk'
  async function flip() {
    setBusy(true)
    try {
      await act.hostSetLobbyStage(talk ? 'locked' : 'talk')
      onSaid(talk ? '다시 잠갔다. 아무도 못 걷고 못 말한다.' : '풀었다. 2-3 교실 안에서 걷고 말한다.')
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="sc-ad__row">
      <button className={talk ? '' : 'is-primary'} disabled={busy} onClick={() => void flip()}>
        {talk ? '다시 잠그기' : '대화 · 이동 풀기'}
      </button>
      <span className="sc-ad__hint">
        {talk ? '지금: 2-3 교실 안에서 걷고 말한다.' : '지금: 잠겨 있다. 아무것도 못 누른다.'} 판을 시작하면 전부 열린다.
      </span>
    </div>
  )
}

const TABS: readonly [string, string][] = [
  ['map', '맵'],
  ['me', '나'],
  ['radio', '무전'],
  ['vote', '투표'],
  ['note', '메모'],
]

export function TabLockDesk({ game, act, onSaid }: { game: GameDoc; act: GameActions; onSaid: (t: string) => void }) {
  const [busy, setBusy] = useState(false)
  const locked = new Set(game.lockedTabs ?? [])
  async function flip(tab: string, name: string) {
    setBusy(true)
    try {
      const lock = !locked.has(tab)
      await act.hostSetTabLock(tab, lock)
      onSaid(lock ? `${name} 탭을 잠갔다.` : `${name} 탭을 열었다.`)
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="sc-ad__row">
      {TABS.map(([tab, name]) => (
        <button key={tab} disabled={busy} className={locked.has(tab) ? 'is-primary' : ''} onClick={() => void flip(tab, name)}>
          {name} {locked.has(tab) ? '잠김' : '열림'}
        </button>
      ))}
      <span className="sc-ad__hint">누르면 잠그고, 다시 누르면 연다.</span>
    </div>
  )
}


/** 배경음악. **틀면 꺼 둔 사람도 다시 켜진다.** 끄면 모두 꺼진다 */
export function BgmDesk({ game, act, onSaid }: { game: GameDoc; act: GameActions; onSaid: (t: string) => void }) {
  const [busy, setBusy] = useState(false)
  const on = game.bgm?.on ?? true
  async function set(next: boolean) {
    setBusy(true)
    try {
      await act.hostSetBgm(next)
      onSaid(next ? '음악을 틀었다. 꺼 둔 사람도 다시 켜진다.' : '음악을 껐다. 모두 꺼진다.')
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="sc-ad__row">
      <button className="is-primary" disabled={busy} onClick={() => void set(true)}>
        {on ? '다시 틀기' : '틀기'}
      </button>
      <button disabled={busy || !on} onClick={() => void set(false)}>
        끄기
      </button>
      <span className="sc-ad__hint">
        지금: {on ? '틀어 두었다' : '꺼 두었다'} · {BGM_TRACKS[bgmDay(game.phase, game.day)]?.name ?? '없음'}. 틀면 꺼 둔 사람도 다시 켜진다.
      </span>
    </div>
  )
}
