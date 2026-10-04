// 감독관 — 기념사진. 켜면 2-3 교실의 기물이 다 빠지고 위 벽에 현수막이 걸린다.
// 바닥에 열넷의 이름 자리가 붙고, 각자 제 이름 자리에 서면 자세를 고른다.
import { useState } from 'react'

import type { GameDoc } from '../../../shared/model'
import { PHOTO_BANNER, PHOTO_BANNER_MAX, PHOTO_POSE_NAME } from '../../../shared/rules/photo'
import type { GameActions } from '../game/useGame'

export function PhotoDesk({ game, act, onSaid }: { game: GameDoc; act: GameActions; onSaid: (t: string) => void }) {
  const on = game.photo?.on === true
  const [banner, setBanner] = useState(game.photo?.banner ?? PHOTO_BANNER)
  const [busy, setBusy] = useState(false)
  const posed = Object.entries(game.photo?.poses ?? {})

  async function run(next: boolean) {
    setBusy(true)
    try {
      await act.hostPhoto(next, banner)
      onSaid(next ? '기념사진 자리를 폈다.' : '기념사진 자리를 걷었다.')
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sc-ph-desk">
      <p className="sc-ad__hint">
        켜면 2-3 교실 기물이 빠지고 현수막이 걸린다. 각자 제 이름 자리에 서면 자세를 고를 수 있다. 끄면 교실이 원래대로 돌아온다.
      </p>
      <div className="sc-ad__row">
        <label htmlFor="ph-banner">현수막</label>
        <input
          id="ph-banner"
          value={banner}
          maxLength={PHOTO_BANNER_MAX}
          onChange={(e) => setBanner(e.target.value)}
        />
      </div>
      <div className="sc-ad__row">
        <button disabled={busy || banner.trim() === ''} onClick={() => void run(true)}>
          {on ? '현수막 다시 걸기' : '기념사진 켜기'}
        </button>
        <button disabled={busy || !on} onClick={() => void run(false)}>
          끄기
        </button>
        <span className="sc-ad__pill">{on ? `켜짐 · 자세 고른 사람 ${posed.length} 명` : '꺼짐'}</span>
      </div>
      {on && posed.length > 0 && (
        <p className="sc-ad__hint">
          {posed
            .map(([id, pose]) => `${game.seats.find((s) => s.playerId === id)?.name ?? '?'} ${PHOTO_POSE_NAME[pose]}`)
            .join(' · ')}
        </p>
      )}
    </div>
  )
}
