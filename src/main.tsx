import './setup-axios'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App'
import LanguageSwitcher from './i18n/LanguageSwitcher'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <LanguageSwitcher />
      <App />
    </BrowserRouter>
  </StrictMode>,
)
