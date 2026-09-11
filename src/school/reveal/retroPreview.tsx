// 회고 검수용.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Retrospective } from './Retrospective'
import { normalizeLook } from '../char/look'
import { newPost, type RetroPost } from '../../../shared/reveal/retro'

const NAMES: Record<string, string> = { me: '한겨울', p2: '서리', p3: '눈보라' }

function App() {
  const [retired, setRetired] = useState(false)
  const [posts, setPosts] = useState<RetroPost[]>([
    { id: 'r1', authorId: 'p2', anonymous: false, text: '사실 DAY 4에 진짜로 미안했어요.', atMs: 100 },
    { id: 'r2', anonymous: true, text: '끝까지 못 말해서 계속 신경 쓰였어요.', atMs: 200 },
  ])

  return (
    <Retrospective
      viewerId="me"
      look={normalizeLook({ hair: 3, hairColor: 2, expression: 1 })}
      team="A"
      retired={retired}
      posts={posts}
      nameOf={(id) => NAMES[id] ?? id}
      notice={{ when: '토요일 저녁 8시 · 30분', link: 'https://meet.example.com/retro' }}
      onRetire={() => setRetired(true)}
      onPost={(text, anonymous) =>
        setPosts((p) => [
          ...p,
          newPost({ id: `r${p.length + 1}`, authorId: 'me', anonymous, text, atMs: Date.now() }),
        ])
      }
    />
  )
}

const root = document.getElementById('root')
if (root) createRoot(root).render(<App />)
