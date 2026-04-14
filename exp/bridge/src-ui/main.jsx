import React from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import { OverlayApp } from './OverlayApp'
import './styles.css'

const params = new URLSearchParams(window.location.search)
const isOverlayMode = params.get('mode') === 'overlay'

document.documentElement.classList.toggle('overlay-mode', isOverlayMode)
document.body.classList.toggle('overlay-mode', isOverlayMode)

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isOverlayMode ? <OverlayApp /> : <App />}
  </React.StrictMode>,
)
