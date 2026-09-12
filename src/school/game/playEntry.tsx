import { createRoot } from 'react-dom/client'

// 겨울 학교의 색과 눈발 바탕. 본 앱과 같은 것을 쓴다
import '../theme.css'
import { Play } from './Play'

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <div className="school-root sc-pl-root">
      <Play />
    </div>,
  )
}
