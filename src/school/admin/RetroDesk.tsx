// 회고 — 운영자 화면 「회고」 탭. 참가자가 끝난 판의 「회고」 탭에 남긴 글을
// 그대로 본다. 새 글이 오면 바로 뜬다.
//
// **익명 글은 운영자도 누가 썼는지 모른다.** 글에 쓴 사람이 애초에 안
// 담긴다(firestore.rules) — 여기서도 「익명」으로만 보인다.
import { collection, onSnapshot } from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'

import type { GameDoc } from '../../../shared/model'
import { seatName } from '../../../shared/rules/lobby'
import { boardFor, type RetroPost } from '../../../shared/reveal/retro'
import { db } from '../../firebase'

/** 게임 시계는 서울 시각이다 */
function clock(ms: number): string {
  const f = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ms))
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? ''
  return `${get('month')}.${get('day')} ${get('hour')}:${get('minute')}`
}

export function RetroDesk({ gameId, game }: { gameId: string; game: GameDoc }) {
  const [posts, setPosts] = useState<RetroPost[] | null>(null)
  const [retired, setRetired] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')

  useEffect(() => {
    if (!db) return
    const stopPosts = onSnapshot(
      collection(db, 'games', gameId, 'retro'),
      (snap) => setPosts(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<RetroPost, 'id'>) }))),
      () => setError('불러오기에 실패했다.'),
    )
    const stopRetired = onSnapshot(collection(db, 'games', gameId, 'retired'), (snap) =>
      setRetired(new Set(snap.docs.map((d) => d.id))),
    )
    return () => {
      stopPosts()
      stopRetired()
    }
  }, [gameId])

  const names = useMemo(() => new Map(game.seats.map((s, i) => [s.playerId, seatName(s, i)])), [game.seats])
  const board = useMemo(() => boardFor(posts ?? [], '', (id) => names.get(id) ?? '누군가'), [posts, names])
  const down = game.seats.filter((s) => retired.has(s.playerId)).length

  return (
    <>
      <p className="sc-ad__hint">
        역할 내려놓음 {down} / {game.seats.length} 명 · 글 {board.length} 개
        {game.phase !== 'finished' && ' · 참가자는 종례가 끝나야 회고 탭이 열린다'}
      </p>
      {error && <p className="sc-ad__hint">{error}</p>}
      {posts === null ?
        <p className="sc-ad__hint">불러오는 중…</p>
      : board.length === 0 ?
        <p className="sc-ad__hint">아직 아무도 쓰지 않았다.</p>
      : <ul className="sc-rv">
          {board.map((p) => (
            <li key={p.id}>
              <div className="sc-rv__top">
                <span className={`sc-rv__who${p.name === '익명' ? ' is-anon' : ''}`}>{p.name}</span>
                <span className="sc-rv__at">{clock(p.atMs)}</span>
              </div>
              <p>{p.text}</p>
            </li>
          ))}
        </ul>
      }
    </>
  )
}
