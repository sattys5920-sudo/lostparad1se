// 오락기 대결 — 내가 낀 대결 문서를 듣는다.
//
// 거래(useDeal)와 같은 모양이다. 규칙이 「그 대결의 두 사람만」이라
// aId 쪽과 bId 쪽을 따로 묻는다 — 한 번에 긁으면 남의 대결까지 딸려
// 와서 질의 전체가 거절당한다.
//
// **먼저 낸 수는 여기 없다.** 대결 문서에는 「냈다」 표시(aIn·bIn)만
// 있고 무엇을 냈는지는 서버의 봉인에 있다. 둘 다 내야 rounds 에 편다.
import { useCallback, useEffect, useRef, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'

import { db } from '../../firebase'
import type { ArcadeGameId, RpsRound } from '../../../shared/rules/arcade'

export type MatchStatus = 'asked' | 'playing' | 'done' | 'declined' | 'gone'

export interface LiveMatch {
  id: string
  game: ArcadeGameId
  aId: string
  bId: string
  status: MatchStatus
  aIn: boolean
  bIn: boolean
  rounds: RpsRound[]
  outcome: 'a' | 'b' | 'draw' | null
  atMs: number
}

const LIVE: ReadonlySet<MatchStatus> = new Set(['asked', 'playing'])

export function useArcade(gameId: string | null, uid: string | null) {
  const [match, setMatch] = useState<LiveMatch | null>(null)
  /** 내가 앉았던 대결. 끝난 뒤에도 결과를 보여 주려고 붙들어 둔다. */
  const seat = useRef<string | null>(null)

  useEffect(() => {
    if (!db || !gameId || !uid) {
      setMatch(null)
      return
    }
    const rows = collection(db, 'games', gameId, 'arcadeMatches')
    const seen = new Map<string, LiveMatch[]>()
    const settle = () => {
      const all = [...seen.values()].flat()
      const live = all.find((m) => LIVE.has(m.status)) ?? null
      if (live) {
        seat.current = live.id
        setMatch(live)
        return
      }
      setMatch(seat.current ? (all.find((m) => m.id === seat.current) ?? null) : null)
    }
    const stop = (['aId', 'bId'] as const).map((field) =>
      onSnapshot(
        query(rows, where(field, '==', uid)),
        (snap) => {
          seen.set(field, snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LiveMatch, 'id'>) })))
          settle()
        },
        (e) => {
          console.error('대결판을 못 읽었다', e)
          setMatch(null)
        },
      ),
    )
    return () => stop.forEach((f) => f())
  }, [gameId, uid])

  /** 끝난 대결을 접는다. 다음 대결이 오면 다시 붙는다. */
  const dismiss = useCallback(() => {
    seat.current = null
    setMatch(null)
  }, [])

  return { match, dismiss }
}
