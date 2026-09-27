// 오락실 — 내가 든 방을 듣는다.
//
// 규칙이 「그 방에 든 사람만」이라 memberIds 로 묻는다. 부름을 받은
// 방도 여기 걸린다 — 부른 순간 memberIds 에 내가 들어가기 때문이다.
//
// **먼저 낸 수와 먼저 끝낸 점수는 여기 없다.** 방 문서에는 「냈다·
// 끝냈다」 표시만 있고, 무엇을 냈는지와 몇 점인지는 서버의 봉인에 있다.
// 다 끝나야 results 로 온다.
import { useCallback, useEffect, useRef, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'

import { db } from '../../firebase'
import { LIVE_ROOM, type RoomDoc } from '../../../shared/rules/arcade'

export interface LiveRoom extends RoomDoc {
  id: string
}

export function useArcade(gameId: string | null, uid: string | null) {
  const [rooms, setRooms] = useState<LiveRoom[]>([])
  /** 끝난 판을 접었는가. 접은 방은 다시 안 띄운다. */
  const shut = useRef<Set<string>>(new Set())
  const [, bump] = useState(0)

  useEffect(() => {
    if (!db || !gameId || !uid) {
      setRooms([])
      return
    }
    const q = query(collection(db, 'games', gameId, 'arcadeRooms'), where('memberIds', 'array-contains', uid))
    return onSnapshot(
      q,
      (snap) => setRooms(snap.docs.map((d) => ({ id: d.id, ...(d.data() as RoomDoc) }))),
      (e) => {
        console.error('오락실 방을 못 읽었다', e)
        setRooms([])
      },
    )
  }, [gameId, uid])

  const mine = (r: LiveRoom) => r.members.find((m) => m.id === uid)
  /*
   * 기계 화면에 띄울 방. **들어가 있는 살아 있는 방이 먼저**, 없으면
   * 제일 최근에 끝난(깨진) 방 — 결과를 보여 주려고 붙든다. 접으면 놓는다.
   */
  const byNew = [...rooms].sort((a, b) => b.atMs - a.atMs)
  const live = byNew.find((r) => LIVE_ROOM.has(r.status) && mine(r)?.state === 'in') ?? null
  const ended =
    byNew.find((r) => !LIVE_ROOM.has(r.status) && !shut.current.has(r.id) && (mine(r)?.state === 'in' || mine(r)?.state === 'left')) ?? null
  const room = live ?? ended
  /** 나를 부른 방. 고르는 중인 것만. */
  const invites = byNew.filter((r) => r.status === 'lobby' && mine(r)?.state === 'invited')

  /** 끝난 판을 접는다. 다음 판이 오면 다시 붙는다. */
  const dismiss = useCallback((id: string) => {
    shut.current.add(id)
    bump((n) => n + 1)
  }, [])

  return { room, invites, dismiss }
}
