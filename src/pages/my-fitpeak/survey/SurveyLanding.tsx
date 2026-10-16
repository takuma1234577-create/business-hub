import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Gift, Clock } from 'lucide-react'
import { apiFetch } from '../lib/api'
import { Card, PillButton, SurveyShell } from './ui'

/**
 * アンケートの入口（公開・ログイン不要）
 * 公式LINEは購入7日後に my.fitpeak.co/survey?lu=<LINEのuserId>&src=line を送っている。
 * lu は「開いた」記録にだけ使い、何も表示しない・保存しない（回答・クーポンはログインした本人に紐づける）。
 */
export default function SurveyLanding() {
  const navigate = useNavigate()
  const [params] = useSearchParams()

  useEffect(() => {
    const lu = params.get('lu')
    if (!lu) return
    apiFetch('/api/my-fitpeak/public/survey/track-open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lu }),
      keepalive: true,
    }).catch(() => { /* ignore */ })
  }, [params])

  return (
    <SurveyShell>
      <Card>
        <p className="text-[13px] text-[#6b6b6b] text-center">商品をお使いいただきありがとうございます</p>
        <h1 className="mt-2 text-[22px] font-bold text-[#111] text-center leading-snug">商品改善のための<br />アンケートにご協力ください</h1>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <div className="rounded-[16px] bg-[#f5f5f7] p-4 text-center">
            <Clock size={20} className="mx-auto text-[#111]" />
            <p className="mt-1.5 text-[12px] text-[#6b6b6b]">所要時間</p>
            <p className="text-[15px] font-bold text-[#111]">約2分</p>
          </div>
          <div className="rounded-[16px] bg-[#f5f5f7] p-4 text-center">
            <Gift size={20} className="mx-auto text-[#111]" />
            <p className="mt-1.5 text-[12px] text-[#6b6b6b]">回答した方全員に</p>
            <p className="text-[15px] font-bold text-[#111]">2,000円OFF</p>
          </div>
        </div>

        <div className="mt-6">
          <PillButton onClick={() => navigate('/my-fitpeak/survey/questions')}>アンケートを始める</PillButton>
        </div>
        <p className="mt-3 text-[12px] text-[#6b6b6b] text-center leading-relaxed">
          LINEでログインしてから回答します。クーポンはご本人のMy FITPEAKに届きます。
        </p>
        <p className="mt-4 text-[11px] text-[#9a9a9a] text-center leading-relaxed">
          ※レビュー投稿は任意です。クーポン獲得には影響しません。
        </p>
      </Card>
    </SurveyShell>
  )
}
