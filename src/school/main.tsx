import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './base.css'
import { SchoolApp } from './SchoolApp.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SchoolApp />
  </StrictMode>,
)
