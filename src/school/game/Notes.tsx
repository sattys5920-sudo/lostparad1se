// 메모 탭의 사람 판.
//
// 저장은 서버 함수를 안 거친다. 판정에 쓰이지 않는 개인 메모라 서버가
// 검사할 것이 없고, 한 글자마다 왕복하면 끄적이는 자리가 느려진다.
// 대신 규칙이 본인 말고는 읽지도 쓰지도 못하게 막는다.
//
// 그림은 보관함 것과 **같은 것을 쓴다**(PersonBoard). 같은 판을 두
// 벌로 짜 두면 한쪽만 고치게 된다.
import { useCallback, useEffect, useState } from 'react'

import { PersonBoard } from '../reveal/Archive'
import { loadNote, saveNote } from '../reveal/notesSync'
import type { DeductionNote } from '../../../shared/reveal/notes'

export function Notes({
  gameId,
  meId,
  classmates,
}: {
  gameId: string
  meId: string
  classmates: readonly { id: string; name: string }[]
}) {
  const [note, setNote] = useState<DeductionNote | null>(null)

  useEffect(() => {
    let live = true
    loadNote(gameId, meId)
      .then((n) => {
        if (live) setNote(n)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [gameId, meId])

  const change = useCallback(
    (next: DeductionNote) => {
      setNote(next)
      void saveNote(gameId, next).catch(() => {})
    },
    [gameId],
  )

  // 아직 안 왔다. 빈 판을 먼저 보였다가 불러온 것으로 덮으면, 그 사이에
  // 적은 한 줄이 사라진다
  if (!note) return null
  return <PersonBoard note={note} classmates={classmates} onNoteChange={change} />
}
