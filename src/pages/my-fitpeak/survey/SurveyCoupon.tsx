import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Copy, Check } from 'lucide-react'
import { apiFetch } from '../lib/api'
import { BackToMyPage, Card, ErrorText, PillButton, Spinner, SurveyShell, copyText, trackStep, useMySurvey } from './ui'

export interface IssuedCoupon {
  couponCode: string
  amount: number
  expiresAt: string
  discountUrl: string
}

// 本人の回答に対するクーポンを発行（何度呼んでも同じコード）
export function useSurveyCoupon(enabled: boolean) {
  const [coupon, setCoupon] = useState<IssuedCoupon | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const r = await apiFetch('/api/my-fitpeak/survey/coupon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const d = await r.json().catch(() => ({}))
      if (r.ok) setCoupon(d)
      else setError(d.error || 'クーポンを表示できませんでした')
    } catch { setError('通信に失敗しました') }
    setLoading(false)
  }, [])
  useEffect(() => { if (enabled) load() }, [enabled, load])
  return { coupon, error, loading, retry: load }
}

function useCountdown(expiresAt?: string) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  if (!expiresAt) return ''
  const diff = new Date(expiresAt).getTime() - now
  if (diff <= 0) return '期限切れ'
  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  const s = Math.floor((diff % 60000) / 1000)
  return `${h}時間${String(m).padStart(2, '0')}分${String(s).padStart(2, '0')}秒`
}

export function CouponCard({ coupon }: { coupon: IssuedCoupon }) {
  const [copied, setCopied] = useState(false)
  const left = useCountdown(coupon.expiresAt)
  return (
    <div className="rounded-[18px] border-2 border-dashed border-[#111] p-5 text-center">
      <p className="text-[12px] font-bold tracking-[0.12em] text-[#6b6b6b]">FITPEAK 公式サイトで使える</p>
      <p className="mt-1 text-[30px] font-bold text-[#111]">¥{coupon.amount.toLocaleString('ja-JP')} OFF</p>
      <button type="button" onClick={async () => { if (await copyText(coupon.couponCode)) { setCopied(true); setTimeout(() => setCopied(false), 1500) } }}
        className="mt-3 inline-flex items-center gap-2 px-4 h-10 rounded-full bg-[#f3f3f3] text-[15px] font-bold tracking-wider text-[#111]">
        {coupon.couponCode}
        {copied ? <Check size={16} /> : <Copy size={16} />}
      </button>
      <p className="mt-3 text-[12px] text-[#6b6b6b]">有効期限まであと <span className="font-bold text-[#111]">{left}</span></p>
      <div className="mt-4">
        <a href={coupon.discountUrl} className="flex items-center justify-center w-full min-h-[52px] rounded-full bg-[#111] text-white text-[15px] font-bold hover:bg-[#333]">
          クーポンを適用して公式サイトへ
        </a>
      </div>
      <p className="mt-2 text-[11px] text-[#9a9a9a]">ボタンから開くと、お会計で自動的に割引されます（1回限り）</p>
    </div>
  )
}

export default function SurveyCoupon() {
  const { survey, loading } = useMySurvey()
  const { coupon, error, loading: issuing, retry } = useSurveyCoupon(!!survey)
  useEffect(() => { trackStep('coupon') }, [])

  if (loading || (!coupon && issuing)) return <SurveyShell><Spinner /></SurveyShell>
  if (!survey) return null

  return (
    <SurveyShell>
      <Card>
        <h1 className="text-[20px] font-bold text-[#111] text-center">ご回答ありがとうございました</h1>
        <p className="mt-2 text-[13px] text-[#6b6b6b] text-center">お礼のクーポンをお届けします</p>
        <div className="mt-5">
          {coupon ? <CouponCard coupon={coupon} /> : (
            <>
              <ErrorText>{error}</ErrorText>
              <div className="mt-3"><PillButton onClick={retry}>もう一度表示する</PillButton></div>
            </>
          )}
        </div>
        {survey.rating <= 3 && (
          <Link to="/my-fitpeak/survey/support-cta" className="block mt-5 text-center text-[13px] text-[#111] underline underline-offset-2">
            商品についてお困りの方はこちら
          </Link>
        )}
        <p className="mt-4 text-[12px] text-[#6b6b6b] text-center">クーポンは My FITPEAK の「クーポン」からいつでも確認できます。</p>
      </Card>
      <BackToMyPage />
    </SurveyShell>
  )
}
