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

import { realTimeOf, type DevClock } from '../../../shared/rules/clock'

import { CHAT_POLL_MS, SAY_BUBBLE_CHARS, SAY_BUBBLE_MS } from './timing'
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
  /**
   * 가져오기가 **계속** 실패하고 있을 때 그 이유. 한두 번은 null 이다.
   *
   * 여기서 몇 시간을 잃었다. 실제 Firestore 에 색인이 없어서 chatLines
   * 가 매번 거절됐는데, catch 가 「잠깐 끊긴 것뿐」이라며 영영 삼켰다 —
   * 보내기는 되고(입력칸이 비고) 로그와 풍선만 조용히 비어 있었다.
   * 잠깐 끊긴 것과 늘 거절당하는 것은 다르다. 세 번 연달아 실패하면
   * 화면에 낸다.
   */
  stuck: string | null
}

/** 이만큼 연달아 실패하면 「잠깐」이 아니다. 2.5초 간격이니 7.5초다. */
const STUCK_AFTER = 3

/**
 * 방 안의 말은 **쌓아 두지 않는다.**
 *
 * RPG 에서 지나간 대사가 남지 않는 것과 같다. 기록이 남으면 방 안
 * 대화의 휘발성이 사라진다 — 「그 자리에 있던 사람만 안다」가 이
 * 게임의 규칙인데, 다시 펴 볼 수 있으면 그 자리에 있었던 것과
 * 나중에 읽는 것이 같아진다.
 *
 * 무전은 다르다. 그쪽은 적어 두고 읽는 것이라 그대로 쌓인다.
 */
const ROOM_KEEP = 24

export interface TalkOpts {
  /**
   * 지금 선 방. **바뀌면 줄을 버린다** — 새 방에 들어가면 그 방의
   * 말만 보여야 한다. 서버도 옆 방 줄은 안 보내지만, 화면에 남아
   * 있던 옛 방 줄까지 서버가 지워 줄 수는 없다.
   */
  room?: string | null
}

export function useChatLines(act: GameActions, channel: Channel, opts: TalkOpts = {}): Talk {
  const team = channel === 'team'
  const room = opts.room ?? null
  const [lines, setLines] = useState<ChatLine[]>([])
  const [stuck, setStuck] = useState<string | null>(null)
  const sinceRef = useRef(0)
  const pullingRef = useRef(false)
  const failsRef = useRef(0)

  const pull = useCallback(async () => {
    // 보내고 나서 바로 한 번, 그리고 주기적으로 한 번. 둘이 겹치면
    // 같은 줄을 두 번 붙인다 — 먼저 들어온 쪽이 끝날 때까지 기다린다
    if (pullingRef.current) return
    pullingRef.current = true
    try {
      const res = (await (team ? act.radioLines(sinceRef.current) : act.chatLines(sinceRef.current))) as {
        lines?: ChatLine[]
      }
      // 대답이 왔다 — 끊긴 게 아니다
      failsRef.current = 0
      setStuck(null)
      const fresh = res.lines ?? []
      if (fresh.length === 0) return
      sinceRef.current = Math.max(sinceRef.current, ...fresh.map((l) => l.atMs))
      setLines((old) => {
        const next = [...old, ...fresh]
        return team ? next : next.slice(-ROOM_KEEP)
      })
    } catch (e) {
      // 한두 번은 잠깐 끊긴 것이다. 다음 번에 다시 가져온다.
      // 계속 그러면 그건 끊긴 게 아니라 거절이다 — 화면에 낸다
      failsRef.current += 1
      if (failsRef.current >= STUCK_AFTER) setStuck((e as Error).message || '서버가 대답하지 않는다.')
    } finally {
      pullingRef.current = false
    }
  }, [act, team])

  /**
   * 방을 옮기면 비운다.
   *
   * 「어디까지 가져왔나」도 같이 되돌린다. 안 그러면 새 방에서
   * 먼저 오간 말이 이미 지나간 시각이라 영영 안 온다 — 서버는
   * 어차피 내가 들어오기 전 줄은 안 보내므로 0 으로 되돌려도
   * 남의 옛말이 딸려 오지 않는다.
   *
   * **모르는 동안(null)에는 안 버린다.** 여기서 크게 당했다 — 선 방은
   * `view.visiblePawns` 에서 나를 찾아 꺼내는 값이라, view 가 잠깐
   * 비거나(다시 붙는 중, 앱이 깨어나는 중) 그 목록에 내가 없는 순간이
   * 있으면 null 이 된다. 열넷이 돌아다니는 판에서는 view 가 쉴 새 없이
   * 다시 오므로 그 순간이 자주 온다. null 마다 버리면 **로그가 쌓이질
   * 않는다** — 쌓이자마자 지워지니 화면에는 아무것도 없고, 머리 위
   * 풍선도 같은 줄을 보므로 같이 사라진다. 실제로 폰에서 그렇게 됐다.
   *
   * 버리는 것은 **아는 방에서 아는 다른 방으로 옮겨 섰을 때**뿐이다.
   */
  const lastRoomRef = useRef<string | null>(null)
  useEffect(() => {
    if (team) return
    if (!movedRoom(lastRoomRef.current, room)) return
    lastRoomRef.current = room
    setLines([])
    sinceRef.current = 0
  }, [team, room])

  useEffect(() => {
    void pull()
    const t = setInterval(() => void pull(), CHAT_POLL_MS)
    return () => clearInterval(t)
  }, [pull])

  return { lines, pull, stuck }
}

/**
 * 머리 위 풍선에 넣을 글.
 *
 * 한 줄 열두 자에 두 줄이니 스물넷. 넘치면 뒤를 「…」로 자른다.
 * **자르는 일을 CSS 에 맡기지 않는다** — line-clamp 는 잘렸다는
 * 표시를 안 남겨서, 짧게 끊은 말과 잘린 말을 구별할 수가 없다.
 */
export function bubbleText(text: string): string {
  return text.length > SAY_BUBBLE_CHARS ? `${text.slice(0, SAY_BUBBLE_CHARS)}…` : text
}

/**
 * 이 줄의 풍선이 아직 떠 있어야 하는가.
 *
 * **실제 시계로 잰다.** 여기서 한 번 크게 틀렸다 — 줄에 찍힌 시각이
 * 게임 시각이라기에 게임 시계로 뺐는데, 판은 닷새를 하룻저녁에
 * 돌리느라 시계가 빨리 간다. 배속 60이면 4초가 실제로는 67ms 라,
 * 폰에서는 **풍선이 아예 안 뜬 것처럼** 보였다.
 *
 * 풍선이 얼마나 떠 있어야 하는가는 게임의 규칙이 아니라 **사람이 한
 * 줄 읽는 데 걸리는 시간**이다. 그건 시계를 어떻게 돌리든 4초다.
 * 그래서 찍힌 게임 시각을 실제 시각으로 되돌려서 real 시계와 뺀다.
 */
/**
 * 방을 옮긴 것인가 — 로그를 버려야 하는가.
 *
 * **모르는 동안(null)은 옮긴 것이 아니다.** 선 방은 `view.visiblePawns`
 * 에서 나를 찾아 꺼내는 값이라, view 가 잠깐 비거나(다시 붙는 중, 앱이
 * 깨어나는 중) 그 목록에 내가 없는 순간이 있으면 null 이 된다. 열넷이
 * 돌아다니는 판에서는 view 가 쉴 새 없이 다시 오므로 그 순간이 자주
 * 온다. null 마다 버리면 **로그가 쌓이질 않는다** — 쌓이자마자 지워지니
 * 화면에는 아무것도 없고, 머리 위 풍선도 같은 줄을 보므로 같이
 * 사라진다. 실제로 폰에서 그렇게 됐다.
 *
 * 버리는 것은 **아는 방에서 아는 다른 방으로 옮겨 섰을 때**뿐이다.
 */
export function movedRoom(was: string | null, now: string | null): boolean {
  if (now === null) return false
  return was !== now
}

export function bubbleUp(atMs: number, clock: DevClock | undefined, realNowMs: number = Date.now()): boolean {
  return realNowMs - realTimeOf(atMs, clock) <= SAY_BUBBLE_MS
}
