// 오간 말을 가져오는 자리.
//
// 채팅은 `secret/` 아래에 있어서 **구독할 수 없다.** 규칙이 막아서가
// 아니라, 원문을 그대로 내려보내면 지워진 사람의 「…」가 의미를 잃기
// 때문이다. 그래서 서버에 물어보는 수밖에 없다.
//
// 물어보는 곳이 둘이 되었다 — 창(Chat)과 화면 아래 말줄(Say). 둘이
// 각자 세어 두면 「어디까지 가져왔나」가 어긋나서 같은 줄이 두 번
// 붙는다. 세는 일을 여기 한 군데로 모은다.
import { useCallback, useEffect, useRef, useState } from 'react'

import { CHAT_POLL_MS } from './timing'
import type { GameActions } from './useGame'

export interface ChatLine {
  playerId: string
  name: string
  team: string
  atMs: number
  text: string
  /** 전해지지 않은 줄. 지워진 채로 친 말이다. */
  muted: boolean
}

/** 방에 남는 말인가, 팀에 매인 말(무전)인가. */
export type Channel = 'room' | 'team'

export interface Talk {
  lines: readonly ChatLine[]
  /** 지금 한 번 더 가져온다. 보내고 난 직후에 부른다. */
  pull: () => Promise<void>
}

export function useChatLines(act: GameActions, channel: Channel): Talk {
  const team = channel === 'team'
  const [lines, setLines] = useState<ChatLine[]>([])
  const sinceRef = useRef(0)
  const pullingRef = useRef(false)

  const pull = useCallback(async () => {
    // 보내고 나서 바로 한 번, 그리고 주기적으로 한 번. 둘이 겹치면
    // 같은 줄을 두 번 붙인다 — 먼저 들어온 쪽이 끝날 때까지 기다린다
    if (pullingRef.current) return
    pullingRef.current = true
    try {
      const res = (await (team ? act.radioLines(sinceRef.current) : act.chatLines(sinceRef.current))) as {
        lines?: ChatLine[]
      }
      const fresh = res.lines ?? []
      if (fresh.length === 0) return
      sinceRef.current = Math.max(sinceRef.current, ...fresh.map((l) => l.atMs))
      setLines((old) => [...old, ...fresh])
    } catch {
      // 잠깐 끊긴 것뿐이다. 다음 번에 다시 가져온다
    } finally {
      pullingRef.current = false
    }
  }, [act, team])

  useEffect(() => {
    void pull()
    const t = setInterval(() => void pull(), CHAT_POLL_MS)
    return () => clearInterval(t)
  }, [pull])

  return { lines, pull }
}
