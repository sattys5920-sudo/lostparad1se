// 오락기 게임들이 같이 쓰는 시계와 기록 내기.
//
// **서버 시계에 맞춘다.** 먼저 쏴의 신호, 탑 쌓기의 차례, 눈치 게임의
// 「시작」은 서버가 정한 벽시계 시각에 뜬다. 폰 시계는 서로 몇백 ms 씩
// 어긋나 있다 — 그대로 두면 한 폰에서만 신호가 먼저 뜬다. 오락기를 열
// 때 서버에 한 번 물어 어긋난 만큼을 재 둔다.
import { useEffect, useState } from 'react'

import type { ArcadeOutcome } from '../../../shared/rules/arcade'
import type { GameActions } from './useGame'
import type { LiveRoom } from './useArcade'

let offset = 0
let synced = false

/** 서버 벽시계로 지금. 재기 전에는 폰 시계 그대로다. */
export const serverNow = (): number => Date.now() + offset

/**
 * 어긋남을 잰다. 물어본 동안 걸린 시간의 절반을 길 위에 있던 것으로
 * 친다(NTP 와 같은 셈). 세 번 묻고 왕복이 제일 짧았던 것을 쓴다.
 */
export async function syncClock(act: GameActions): Promise<void> {
  if (synced) return
  let best = Infinity
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now()
    try {
      const r = (await act.arcadeClock()) as { nowMs?: number }
      const t1 = Date.now()
      if (typeof r.nowMs === 'number' && t1 - t0 < best) {
        best = t1 - t0
        offset = r.nowMs - (t0 + t1) / 2
      }
    } catch {
      return
    }
  }
  synced = best < Infinity
}

/** 매 프레임 서버 시각. active 가 거짓이면 멈춘다. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(serverNow)
  useEffect(() => {
    if (!active) return
    let raf = 0
    const loop = () => {
      setNow(serverNow())
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [active])
  return now
}

/** 서버가 「아직」이라 하면 이만큼 기다렸다 다시 낸다. 시계가 조금 어긋난 것이다 */
const RETRY_MS = 1500
const RETRIES = 4

/** 기록을 낸다. 「아직 판이 안 끝났다」면 조금 기다렸다 다시. */
export async function submitLog(act: GameActions, roomId: string, log: unknown): Promise<string | null> {
  for (let i = 0; i <= RETRIES; i++) {
    try {
      await act.arcadeSubmit(roomId, log)
      return null
    } catch (e) {
      const msg = (e as Error).message
      if (!msg.includes('아직') || i === RETRIES) return msg
      await new Promise((r) => setTimeout(r, RETRY_MS))
    }
  }
  return null
}

/** 판이 열리기 전 셈. 0 보다 크면 몇 초 남았는지. */
export const countdown = (room: LiveRoom, now: number): number =>
  room.startAtMs === null ? 0 : Math.max(0, Math.ceil((room.startAtMs - now) / 1000))

/** 끝났을 때 크게 띄우는 글자. */
export const BIG: Record<ArcadeOutcome, string> = { win: 'YOU WIN', lose: 'YOU LOSE', draw: 'DRAW' }
