import { Routes, Route, Navigate, useSearchParams } from 'react-router-dom'
import { FitpeakAuthProvider, useFitpeakAuth } from './my-fitpeak/lib/auth'
import { fitpeakSupabase } from './my-fitpeak/lib/supabase'
import FitpeakLayout from './my-fitpeak/FitpeakLayout'
import FitpeakLogin from './my-fitpeak/FitpeakLogin'
import FitpeakDashboard from './my-fitpeak/FitpeakDashboard'
import FitpeakOrders from './my-fitpeak/FitpeakOrders'
import FitpeakOrderDetail from './my-fitpeak/FitpeakOrderDetail'
import FitpeakLineConnect from './my-fitpeak/FitpeakLineConnect'
import { type ReactNode, useEffect, useState } from 'react'

function AutoLoginHandler({ children }: { children: ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [processing, setProcessing] = useState(false)
  const { user } = useFitpeakAuth()
  const altToken = searchParams.get('alt')

  useEffect(() => {
    if (!altToken || user || processing) return
    setProcessing(true)

    async function autoLogin() {
      try {
        const res = await fetch('/api/my-fitpeak/auth/auto-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: altToken }),
        })
        if (res.ok) {
          const data = await res.json()
          if (data.email && data.verified) {
            await fitpeakSupabase.auth.signInWithOtp({
              email: data.email,
              options: { shouldCreateUser: true },
            })
          }
        }
      } catch { /* ignore */ }
      searchParams.delete('alt')
      setSearchParams(searchParams, { replace: true })
      setProcessing(false)
    }
    autoLogin()
  }, [altToken, user, processing, searchParams, setSearchParams])

  if (processing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a]">
        <div className="w-8 h-8 border-2 border-[#c8a960] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return <>{children}</>
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useFitpeakAuth()
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a]">
      <div className="w-8 h-8 border-2 border-[#c8a960] border-t-transparent rounded-full animate-spin" />
    </div>
  )
  if (!user) return <Navigate to="/my-fitpeak/login" />
  return <>{children}</>
}

export default function MyFitpeak() {
  return (
    <FitpeakAuthProvider>
      <AutoLoginHandler>
        <Routes>
          <Route path="login" element={<FitpeakLogin />} />
          <Route path="line-link" element={<FitpeakLogin />} />
          <Route path="/" element={<ProtectedRoute><FitpeakLayout /></ProtectedRoute>}>
            <Route index element={<FitpeakDashboard />} />
            <Route path="orders" element={<FitpeakOrders />} />
            <Route path="orders/:id" element={<FitpeakOrderDetail />} />
            <Route path="line" element={<FitpeakLineConnect />} />
          </Route>
        </Routes>
      </AutoLoginHandler>
    </FitpeakAuthProvider>
  )
}
