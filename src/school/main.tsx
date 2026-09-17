import { createRoot } from 'react-dom/client'

// 겨울 학교의 색과 눈발 바탕
import './theme.css'
// **mobile.css 가 마지막이다.** play.css 는 이 페이지가 평범하게
// 구르는 줄 알고 쓰여 있어서, 틀에 관한 것은 나중에 온 쪽이 이겨야 한다
import './game/mobile.css'
import { Root } from './Root'

const root = document.getElementById('root')
if (root) createRoot(root).render(<Root />)
