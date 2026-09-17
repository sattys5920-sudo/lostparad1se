// 남들이 지금 어디서 어디를 보고 걷는가.
//
// **이것은 화면만의 이야기다.** 판정은 한 줄도 여기를 보지 않는다 —
// 「바로 옆 칸인가」도, 방 머릿수도, 깃발도 전부 서버가 pawns 로 정한다.
// 여기 있는 것은 그 사이를 메우는 그림뿐이다.
//
// 그래서 값이 싸야 한다. 걷는 동안에만 적고, 멈추면 한 번 더 적고
// 그친다. Firestore 는 한 문서에 초당 한 번쯤을 셈하고 만든 물건이라,
// 가만히 선 열넷이 계속 두드리면 느려지는 쪽은 판 전체다.
//
// 누가 누구를 읽어도 되는지는 **규칙이 정한다**(firestore.rules 의
// live/{playerId}). 내 view 에 든 사람의 문서만 열린다 — 안개가 가린
// 사람, 잠복한 사람, 지워진 사람은 목록에 없으니 문이 안 열린다.
// 화면이 받아서 숨기는 것이 아니라 오지를 않는다.
import { useEffect, useRef, type RefObject } from 'react'
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore'
import { db } from '../../firebase'
import type { LiveDoc } from '../../../shared/model'

/** 이보다 오래된 것은 안 믿는다. 창을 닫고 간 사람이 그 자리에 남는다. */
export const LIVE_STALE_MS = 6000

/**
 * 시작 전에는 가만히 서 있어도 이 간격으로 한 번씩 적는다.
 *
 * **판이 돌 때는 멈추면 안 적는다.** 서버가 아는 칸(pawns)이 있어서,
 * 실시간 자리가 끊겨도 그 자리에 선 것으로 그려진다. 그런데 시작
 * 전에는 그 밑바탕이 없다 — 말이 아직 없다. 안 적으면 가만히 선
 * 사람이 6초 뒤에 사라진다.
 *
 * 그래서 시작 전에만 맥을 뛴다. 열넷이 4초에 한 번이면 초당 서너 번,
 * 로비가 치를 만한 값이다.
 */
export const LIVE_BEAT_MS = 4000

/** 시작 전의 유효 기간. 맥을 두 번 놓칠 때까지는 서 있는 것으로 본다. */
export const LIVE_LOBBY_STALE_MS = 12_000

/**
 * 걷는 동안 이 간격으로 적는다.
 *
 * 한 칸이 160ms 니까 두 칸에 한 번꼴이다. 더 자주 적어도 남의 화면은
 * 어차피 사이를 메워 그리므로 눈에 띄게 부드러워지지 않는다 — 값만 든다.
 */
export const LIVE_EVERY_MS = 320

/** 내가 지금 어디 있는지 적는다. 실패는 삼킨다 — 그림 하나 때문에 화면이 멎으면 안 된다. */
export function pushLive(gameId: string, uid: string, at: LiveDoc): void {
  if (!db) return
  void setDoc(doc(db, 'games', gameId, 'live', uid), at).catch(() => undefined)
}

/**
 * 보이는 사람들의 자리를 계속 받아 둔다.
 *
 * **state 가 아니라 ref 다.** 열셋이 초에 세 번씩 바뀌는 것을 state 로
 * 두면 그 값만큼 화면 전체가 다시 그려진다. 지도는 어차피 매 프레임
 * 제 손으로 그리므로, 최신값을 들고 있기만 하면 된다.
 *
 * 문서마다 따로 듣는다. 컬렉션을 통째로 물으면 규칙이 거절한다 —
 * 질의 결과가 전부 읽어도 되는 것임을 규칙이 미리 증명하지 못한다.
 */
export function useLive(gameId: string, ids: readonly string[]): RefObject<Map<string, LiveDoc>> {
  const box = useRef<Map<string, LiveDoc>>(new Map())
  // 목록이 같으면 다시 붙지 않는다. 배열은 매번 새로 오므로 내용으로 본다
  const key = [...ids].sort().join(',')

  useEffect(() => {
    if (!db || !gameId || key === '') return
    const base = collection(db, 'games', gameId, 'live')
    const mine = key.split(',')
    const stop = mine.map((id) =>
      onSnapshot(
        doc(base, id),
        (snap) => {
          const d = snap.data() as LiveDoc | undefined
          if (d) box.current.set(id, d)
          else box.current.delete(id)
        },
        // 규칙이 거절하면 그 사람은 안 보이는 것이다. 조용히 지운다
        () => box.current.delete(id),
      ),
    )
    // 목록에서 빠진 사람은 화면에서도 지운다
    for (const had of [...box.current.keys()]) if (!mine.includes(had)) box.current.delete(had)
    return () => stop.forEach((f) => f())
  }, [gameId, key])

  return box
}
