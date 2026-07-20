import { useState, useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import InvoiceTool from './pages/InvoiceTool'
import AmazonAutoShip from './pages/AmazonAutoShip'
import LineCrm from './pages/LineCrm'
import ApiSettings from './pages/ApiSettings'
import ReturnRequest from './pages/ReturnRequest'
import ReturnSettings from './pages/ReturnSettings'
import ReturnLogs from './pages/ReturnLogs'
import MyFitpeak from './pages/MyFitpeak'
import AmazonConsulting from './pages/AmazonConsulting'
import Outreach from './pages/Outreach'
import SalesEmail from './pages/SalesEmail'
import StreamerClip from './pages/StreamerClip'
import AmazonAnalytics from './pages/AmazonAnalytics'
import HpOutreach from './pages/HpOutreach'
import ShopifyReviews from './pages/ShopifyReviews'
import FitpeakSns from './pages/FitpeakSns'
import SalesAgent from './pages/SalesAgent'
import Login from './pages/Login'

// 全fetchリクエストに認証トークンを自動付与
const originalFetch = window.fetch
window.fetch = function (input, init) {
  const url = typeof input === 'string' ? input : input instanceof Request ? input.url : ''
  if (url.startsWith('/api/') && !url.startsWith('/api/auth/')) {
    const token = localStorage.getItem('auth_token')
    if (token) {
      init = init || {}
      const headers = new Headers(init.headers || {})
      headers.set('Authorization', `Bearer ${token}`)
      init.headers = headers
    }
  }
  return originalFetch.call(this, input, init)
}

function App() {
  const [auth, setAuth] = useState<'loading' | 'ok' | 'login'>('loading')

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) { setAuth('login'); return }

    fetch('/api/auth/verify', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => setAuth(data.valid ? 'ok' : 'login'))
      .catch(() => setAuth('login'))
  }, [])

  if (auth === 'loading') {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-slate-300 border-t-slate-900 rounded-full animate-spin" />
      </div>
    )
  }

  if (auth === 'login') {
    return <Login onLogin={() => setAuth('ok')} />
  }

  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/settings" element={<ApiSettings />} />
      <Route path="/invoice/*" element={<InvoiceTool />} />
      <Route path="/amazon/*" element={<AmazonAutoShip />} />
      <Route path="/line-crm/*" element={<LineCrm />} />
      <Route path="/my-fitpeak/*" element={<MyFitpeak />} />
      <Route path="/consulting" element={<AmazonConsulting />} />
      <Route path="/outreach" element={<Outreach />} />
      <Route path="/return-request" element={<ReturnRequest />} />
      <Route path="/return-settings" element={<ReturnSettings />} />
      <Route path="/return-logs" element={<ReturnLogs />} />
      <Route path="/sales-email" element={<SalesEmail />} />
      <Route path="/streamer-clip/*" element={<StreamerClip />} />
      <Route path="/amazon-analytics/*" element={<AmazonAnalytics />} />
      <Route path="/shopify-reviews" element={<ShopifyReviews />} />
      <Route path="/hp-outreach" element={<HpOutreach />} />
      <Route path="/fitpeak-sns/*" element={<FitpeakSns />} />
      <Route path="/sales-agent" element={<SalesAgent />} />
    </Routes>
  )
}

export default App
