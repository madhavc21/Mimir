import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Console from './Console.tsx'

document.documentElement.classList.add('console-window')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Console />
  </StrictMode>,
)
