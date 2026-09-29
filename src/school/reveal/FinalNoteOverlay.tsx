// 엔딩 송출 — 운영자가 누르는 순간 열넷 전원의 화면 위로 그대로 뜬다.
//
// **지금 무엇을 하고 있었든** 덮는다. 밑에 깔린 화면(채팅 입력칸,
// 고르던 표 등)은 그대로 둔다 — 트리를 갈아 끼우지 않고 위에 얹기만
// 한다. 닫으면 그 자리로 돌아온다.
import { useEffect, useState } from 'react'

import { FinalNoteScene } from './FinalNoteScene'
import { armSfx, isArmed, startSnowAmbient, stopSnowAmbient } from '../game/sfx'
import type { GameActions } from '../game/useGame'

export interface FinalNoteOverlayProps {
  act: GameActions
  /** 「닫기」를 눌렀다. 오버레이를 걷어내는 것은 부르는 쪽 몫이다. */
  onClose: () => void
}

export function FinalNoteOverlay({ act, onClose }: FinalNoteOverlayProps) {
  const [closable, setClosable] = useState(false)
  const [muted, setMuted] = useState(!isArmed())

  useEffect(() => {
    if (isArmed()) startSnowAmbient()
    return () => stopSnowAmbient()
  }, [])

  function handleDone(): void {
    // 본 것으로 남긴다 — 닫기를 누르기 전에 탭을 닫아도 봤다는 사실은 남는다
    act.markEndingSeen().catch(() => {})
    // 여운을 끊지 않는다. 찢겨 사라지고 3초는 빈 화면만 있는다
    setTimeout(() => setClosable(true), 3000)
  }

  function unmute(): void {
    armSfx()
    startSnowAmbient()
    setMuted(false)
  }

  return (
    <div className="sc-fnov" role="dialog" aria-label="A의 마지막 쪽지" aria-modal="true">
      <FinalNoteScene act={act} onDone={handleDone} />
      {muted && (
        <button className="sc-fnov__unmute" onClick={unmute}>
          소리 켜기
        </button>
      )}
      {closable && (
        <button className="sc-fnov__close" onClick={onClose}>
          닫기
        </button>
      )}
    </div>
  )
}
