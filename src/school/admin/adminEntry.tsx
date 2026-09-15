import { createRoot } from 'react-dom/client'

import '../theme.css'
// 운영자 도구(PhaseHost·QuizHost)가 게임 화면의 클래스를 쓴다.
// 같은 것을 두 벌로 만들면 한쪽만 고쳐지므로 그대로 빌려 온다
import '../game/play.css'
import { Admin } from './Admin'

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <div className="school-root">
      <Admin />
    </div>,
  )
}
