import { createRoot } from 'react-dom/client'
import { Play } from './Play'

const root = document.getElementById('root')
if (root) createRoot(root).render(<Play />)
