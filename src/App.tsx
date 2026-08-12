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
import AmazonAnalytics from './pages/AmazonAnalytics'
import ShopifyReviews from './pages/ShopifyReviews'
import Gifting from './pages/Gifting'
import EbayManager from './pages/EbayManager'
import ReviewForm from './pages/ReviewForm'
import GiftAddressForm from './pages/GiftAddressForm'
import ImageDownloader from './pages/ImageDownloader'
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
  const isPublicForm = window.location.pathname === '/review-form'
  const isGiftForm = window.location.pathname === '/gift-address'

  useEffect(() => {
    if (isPublicForm || isGiftForm) return
    const token = localStorage.getItem('auth_token')
    if (!token) { setAuth('login'); return }

    fetch('/api/auth/verify', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => setAuth(data.valid ? 'ok' : 'login'))
      .catch(() => setAuth('login'))
  }, [])

  // 顧客向けの公開ページ（レビュー提出フォーム）は管理ログインを通さず表示する
  if (isPublicForm) {
    return <ReviewForm />
  }

  // インフルエンサー向け住所入力フォーム（認証不要）
  if (isGiftForm) {
    return <GiftAddressForm />
  }

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
      <Route path="/return-request" element={<ReturnRequest />} />
      <Route path="/return-settings" element={<ReturnSettings />} />
      <Route path="/return-logs" element={<ReturnLogs />} />
      <Route path="/amazon-analytics/*" element={<AmazonAnalytics />} />
      <Route path="/shopify-reviews" element={<ShopifyReviews />} />
      <Route path="/gifting" element={<Gifting />} />
      <Route path="/ebay" element={<EbayManager />} />
      <Route path="/image-downloader" element={<ImageDownloader />} />
    </Routes>
  )
}

export default App
