import { Routes, Route, Navigate, useSearchParams, useLocation } from 'react-router-dom'
import { FitpeakAuthProvider, useFitpeakAuth } from './my-fitpeak/lib/auth'
import { fitpeakSupabase } from './my-fitpeak/lib/supabase'
import { apiUrl } from './my-fitpeak/lib/embed'
import MoveToAppLocation from './my-fitpeak/MoveToAppLocation'
import FitpeakLayout from './my-fitpeak/FitpeakLayout'
import FitpeakLogin from './my-fitpeak/FitpeakLogin'
import FitpeakHome from './my-fitpeak/FitpeakHome'
import FitpeakOrderDetail from './my-fitpeak/FitpeakOrderDetail'
import FitpeakAccount from './my-fitpeak/FitpeakAccount'
import FitpeakNotifications from './my-fitpeak/FitpeakNotifications'
import FitpeakPro from './my-fitpeak/FitpeakPro'
import FitpeakSaved from './my-fitpeak/FitpeakSaved'
import FitpeakWarrantyRegister from './my-fitpeak/FitpeakWarrantyRegister'
import FitpeakRedeem from './my-fitpeak/FitpeakRedeem'
import FitpeakGotore from './my-fitpeak/FitpeakGotore'
import FitpeakCoupons from './my-fitpeak/FitpeakCoupons'
import FitpeakReferral from './my-fitpeak/FitpeakReferral'
import FitpeakSubscriptions from './my-fitpeak/FitpeakSubscriptions'
import FitpeakCreashot from './my-fitpeak/FitpeakCreashot'
import SurveyLanding from './my-fitpeak/survey/SurveyLanding'
import SurveyQuestions from './my-fitpeak/survey/SurveyQuestions'
import SurveyCoupon from './my-fitpeak/survey/SurveyCoupon'
import SurveyReview from './my-fitpeak/survey/SurveyReview'
import SurveySupport from './my-fitpeak/survey/SurveySupport'
import SurveyCompleted from './my-fitpeak/survey/SurveyCompleted'
import SurveyReviewGift from './my-fitpeak/survey/SurveyReviewGift'
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
        const res = await fetch(apiUrl('/api/my-fitpeak/auth/auto-login'), {
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
      <div className="min-h-screen flex items-center justify-center bg-[#f5f5f7]">
        <div className="w-8 h-8 border-2 border-[#111] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return <>{children}</>
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useFitpeakAuth()
  const location = useLocation()
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#f5f5f7]">
      <div className="w-8 h-8 border-2 border-[#111] border-t-transparent rounded-full animate-spin" />
    </div>
  )
  // ログイン後に元のページへ戻す（ポイント利用ページなど、外から直接来る入口のため）
  if (!user) return <Navigate to={`/my-fitpeak/login?next=${encodeURIComponent(location.pathname + location.search)}`} />
  return <>{children}</>
}

export default function MyFitpeak() {
  return (
    <FitpeakAuthProvider>
      {/* 画面を fitpeak.co/a へ移したあと、my.fitpeak.co に来た人を移す（切替前・埋め込み時は何もしない） */}
      <MoveToAppLocation />
      <AutoLoginHandler>
        <Routes>
          <Route path="login" element={<FitpeakLogin />} />
          <Route path="line-link" element={<FitpeakLogin />} />
          {/* アンケート（旧 my.fitpeak.co/survey）。入口だけ公開、回答以降は本人のログインが必須 */}
          <Route path="survey" element={<SurveyLanding />} />
          <Route path="survey/questions" element={<ProtectedRoute><SurveyQuestions /></ProtectedRoute>} />
          <Route path="survey/auth" element={<Navigate to="/my-fitpeak/survey/questions" replace />} />
          <Route path="survey/coupon" element={<ProtectedRoute><SurveyCoupon /></ProtectedRoute>} />
          <Route path="survey/pre-review" element={<ProtectedRoute><SurveyReview step="pre_review" /></ProtectedRoute>} />
          <Route path="survey/review-cta" element={<ProtectedRoute><SurveyReview step="review_cta" /></ProtectedRoute>} />
          <Route path="survey/support-cta" element={<ProtectedRoute><SurveySupport /></ProtectedRoute>} />
          <Route path="survey/completed" element={<ProtectedRoute><SurveyCompleted /></ProtectedRoute>} />
          <Route path="survey/review-gift" element={<ProtectedRoute><SurveyReviewGift /></ProtectedRoute>} />
          <Route path="survey/sns-campaign" element={<Navigate to="/my-fitpeak/coupons" replace />} />
          <Route path="/" element={<ProtectedRoute><FitpeakLayout /></ProtectedRoute>}>
            <Route index element={<FitpeakHome />} />
            <Route path="orders" element={<Navigate to="/my-fitpeak" replace />} />
            <Route path="orders/:id" element={<FitpeakOrderDetail />} />
            <Route path="account" element={<FitpeakAccount />} />
            <Route path="notifications" element={<FitpeakNotifications />} />
            <Route path="pro" element={<FitpeakPro />} />
            <Route path="saved" element={<FitpeakSaved />} />
            <Route path="warranty-register" element={<FitpeakWarrantyRegister />} />
            <Route path="points/use" element={<FitpeakRedeem />} />
            <Route path="gotore/*" element={<FitpeakGotore />} />
            <Route path="coupons" element={<FitpeakCoupons />} />
            <Route path="referral" element={<FitpeakReferral />} />
            <Route path="subscriptions" element={<FitpeakSubscriptions />} />
            <Route path="creashot" element={<FitpeakCreashot />} />
            <Route path="sns-campaign" element={<Navigate to="/my-fitpeak/coupons" replace />} />
            <Route path="points" element={<Navigate to="/my-fitpeak/referral" replace />} />
            {/* 旧URL（メールやLINEのリンクから来る人のため） */}
            <Route path="line" element={<Navigate to="/my-fitpeak/account" replace />} />
          </Route>
        </Routes>
      </AutoLoginHandler>
    </FitpeakAuthProvider>
  )
}
