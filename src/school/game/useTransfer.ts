// 지금 내게 걸린 이적 제안 하나.
//
// **views 를 거치지 않는다.** 거래와 같다 — 마주 선 채로 묻고 답하는
// 것이라 반 박자가 늦으면 안 된다. 규칙이 이 문서를 그 둘에게만
// 열어 두었고, 나머지 열둘에게는 애초에 없는 문서다.
//
// 부른 쪽도 읽는다. 거절당한 것이 안 보이면 말을 꺼낸 사람은 상대가
// 답을 안 한 것인지 안 받은 것인지 알 수가 없다.
import { useCallback, useEffect, useRef, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'

import { db } from '../../firebase'
import type { TransferState } from '../../../shared/rules/transfer'

export interface LiveTransfer extends TransferState {
  id: string
}

export interface TransferSeat {
  ask: LiveTransfer | null
  /** 끝난 제안을 치운다. 아직 묻고 있는 것에는 아무 일도 하지 않는다. */
  dismiss: () => void
}

export function useTransfer(gameId: string | null, uid: string | null): TransferSeat {
  const [ask, setAsk] = useState<LiveTransfer | null>(null)
  /** 내가 끼어 있던 제안. 끝난 뒤에도 이것만 한 번 보여 준다. */
  const seat = useRef<string | null>(null)
  const [dropped, setDropped] = useState<string | null>(null)

  useEffect(() => {
    if (!db || !gameId || !uid) {
      setAsk(null)
      return
    }
    const rows = collection(db, 'games', gameId, 'transfers')
    // 규칙이 「이 문서의 두 사람만」이라 한쪽씩 물어야 한다. 한 번에
    // 다 긁으면 남의 제안까지 딸려 와서 질의 전체가 거절당한다
    const seen = new Map<string, LiveTransfer[]>()
    const settle = () => {
      const all = [...seen.values()].flat()
      const live = all.find((t) => t.status === 'asking') ?? null
      if (live) {
        seat.current = live.id
        setAsk(live)
        return
      }
      setAsk(seat.current ? (all.find((t) => t.id === seat.current) ?? null) : null)
    }
    const stop = (['byId', 'toId'] as const).map((field) =>
      onSnapshot(
        query(rows, where(field, '==', uid)),
        (snap) => {
          seen.set(
            field,
            snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LiveTransfer, 'id'>) })),
          )
          settle()
        },
        (e) => {
          // 조용히 죽으면 「제안이 안 뜬다」만 남는다. 이유를 남긴다
          console.error('이적 제안을 못 읽었다', e)
          setAsk(null)
        },
      ),
    )
    return () => stop.forEach((f) => f())
  }, [gameId, uid])

  const dismiss = useCallback(() => {
    setDropped(seat.current)
    seat.current = null
  }, [])

  return { ask: ask && ask.id === dropped ? null : ask, dismiss }
}
