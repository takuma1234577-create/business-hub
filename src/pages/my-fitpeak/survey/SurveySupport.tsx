import { useEffect } from 'react'
import { apiFetch } from '../lib/api'
import { BackToMyPage, Card, SurveyShell, trackStep } from './ui'

const LINE_ADD_URL = 'https://line.me/R/ti/p/@956iyppc'

/** ★1〜3の人へ：返品・交換の案内と公式LINEでの相談（旧 /survey/support-cta） */
export default function SurveySupport() {
  useEffect(() => { trackStep('support_cta') }, [])
  const onLine = () => {
    apiFetch('/api/my-fitpeak/survey/track-click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'line_consultation' }),
      keepalive: true,
    }).catch(() => { /* ignore */ })
  }
  return (
    <SurveyShell>
      <Card>
        <h1 className="text-[20px] font-bold text-[#111] text-center leading-snug">ご期待に沿えず<br />申し訳ございませんでした</h1>
        <p className="mt-3 text-[14px] text-[#6b6b6b] leading-relaxed">
          よろしければ、商品の返品・交換をご検討ください。Amazonのご注文履歴から手続きいただけます。
        </p>
        <a href="https://www.amazon.co.jp/gp/your-account/order-history"
          className="mt-5 flex items-center justify-center w-full min-h-[52px] rounded-full bg-[#111] text-white text-[15px] font-bold hover:bg-[#333]">
          Amazonで返品・交換の手続きをする
        </a>
        <div className="my-5 flex items-center gap-3">
          <div className="flex-1 h-px bg-[#e6e6e6]" />
          <span className="text-[12px] text-[#9a9a9a]">または</span>
          <div className="flex-1 h-px bg-[#e6e6e6]" />
        </div>
        <p className="text-[14px] text-[#6b6b6b] text-center mb-3">公式LINEのトークで、直接ご意見をお聞かせください</p>
        <a href={LINE_ADD_URL} onClick={onLine}
          className="flex items-center justify-center w-full min-h-[52px] rounded-full bg-[#06C755] text-white text-[15px] font-bold hover:bg-[#05b34c]">
          公式LINEで相談する
        </a>
      </Card>
      <BackToMyPage />
    </SurveyShell>
  )
}
