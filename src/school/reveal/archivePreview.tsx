// 보관함 검수용. 본문은 전부 가짜다 — 진짜는 서버에만 있다.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Archive } from './Archive'
import { buildArchive } from '../../../shared/reveal/archive'
import { emptyNote, type DeductionNote } from '../../../shared/reveal/notes'

const NAMES = ['한겨울', '서리', '눈보라', '고드름', '진눈깨비', '싸락', '함박', '가랑', '이슬', '서릿발', '새벽', '북풍', '동지']
const MATES = NAMES.map((name, i) => ({ id: `p${i + 1}`, name }))
const nameOf = (id: string) => MATES.find((m) => m.id === id)?.name ?? id

const ITEMS = buildArchive({
  viewerId: 'me',
  viewerTeam: 'A',
  records: [1, 2, 3].map((day) => ({ day, atMs: day * 1000 })),
  unreadDays: [3],
  confessions: [
    { id: 'c1', speakerId: 'p2', scope: 'class', listenerIds: [], text: '전체', atMs: 4000 },
    { id: 'c2', speakerId: 'p5', scope: 'private', listenerIds: ['me'], text: '둘만', atMs: 5000 },
  ],
  memories: [{ tileId: 'library', team: 'A', atMs: 6000 }],
  sights: [{ ownerId: 'me', atMs: 7000 }],
  tileName: (id) => (id === 'library' ? '도서관' : id),
  nameOf,
})

function App() {
  const [note, setNote] = useState<DeductionNote>(emptyNote('me'))
  return (
    <Archive
      items={ITEMS}
      note={note}
      classmates={MATES}
      onNoteChange={setNote}
      bodyOf={(item) => [`${item.title}의 본문 자리입니다. 검수용이라 내용은 아무 뜻이 없습니다.`]}
    />
  )
}

const root = document.getElementById('root')
if (root) createRoot(root).render(<App />)
