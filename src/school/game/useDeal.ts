// 지금 내가 앉아 있는 거래판 하나.
//
// **views 를 거치지 않는다.** 투영은 서버가 한 번 깎아 다시 쓰는 것이라
// 반 박자가 늦는데, 흥정은 상대가 물건을 올리는 것이 그 자리에서 보여야
// 흥정이다. 규칙이 이 문서를 마주 앉은 둘에게만 열어 두었다.
//
// **끝난 판도 한 번은 보여 준다.** 「성립했다」나 「자리를 떴다」를 못
// 보고 창이 사라지면 무엇이 오갔는지 알 수가 없다. 다만 내가 앉아
// 있던 판만 그렇다 — 어제 끝난 판이 다시 떠오르면 안 된다.
import { useCallback, useEffect, useRef, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'

import { db } from '../../firebase'
import type { DealState } from '../../../shared/rules/deal'

export interface LiveDeal extends DealState {
  id: string
  /** 서버가 접으면서 남긴 말. 화면이 그대로 보여 준다. */
  why?: string
}

/** 아직 살아 있는 판. 지나간 것은 끝난 판이다. */
const LIVE = new Set(['asking', 'open', 'settling'])

export interface DealSeat {
  deal: LiveDeal | null
  /** 끝난 판을 치운다. 살아 있는 판에는 아무 일도 하지 않는다. */
  dismiss: () => void
}

export function useDeal(gameId: string | null, uid: string | null): DealSeat {
  const [deal, setDeal] = useState<LiveDeal | null>(null)
  /** 내가 앉았던 판. 끝난 뒤에도 이것만 보여 준다. */
  const seat = useRef<string | null>(null)
  const [dropped, setDropped] = useState<string | null>(null)

  useEffect(() => {
    if (!db || !gameId || !uid) {
      setDeal(null)
      return
    }
    const rows = collection(db, 'games', gameId, 'deals')
    // 규칙이 「이 문서의 두 사람만」이라 한쪽씩 물어야 한다. 한 번에
    // 다 긁으면 남의 판까지 딸려 와서 질의 전체가 거절당한다
    const seen = new Map<string, LiveDeal[]>()
    const settle = () => {
      const all = [...seen.values()].flat()
      const live = all.find((d) => LIVE.has(d.status)) ?? null
      if (live) {
        seat.current = live.id
        setDeal(live)
        return
      }
      const ended = seat.current ? (all.find((d) => d.id === seat.current) ?? null) : null
      setDeal(ended)
    }
    const stop = (['aId', 'bId'] as const).map((field) =>
      onSnapshot(
        query(rows, where(field, '==', uid)),
        (snap) => {
          seen.set(
            field,
            snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LiveDeal, 'id'>) })),
          )
          settle()
        },
        (e) => {
          // 조용히 죽으면 「거래가 안 뜬다」만 남는다. 이유를 남긴다
          console.error('거래판을 못 읽었다', e)
          setDeal(null)
        },
      ),
    )
    return () => stop.forEach((f) => f())
  }, [gameId, uid])

  const dismiss = useCallback(() => {
    setDropped(seat.current)
    seat.current = null
  }, [])

  // 치운 판은 다시 앉을 때까지 안 보인다
  return { deal: deal && deal.id === dropped ? null : deal, dismiss }
}
