import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle } from 'lucide-react'
import { Card, SurveyShell, trackStep } from './ui'

/** 既に回答済みの人（旧 /survey/completed） */
export default function SurveyCompleted() {
  useEffect(() => { trackStep('completed') }, [])
  return (
    <SurveyShell>
      <Card className="text-center">
        <CheckCircle size={44} className="mx-auto text-[#111]" />
        <h1 className="mt-3 text-[20px] font-bold text-[#111]">既にご回答いただいています</h1>
        <p className="mt-2 text-[14px] text-[#6b6b6b] leading-relaxed">
          アンケートはお一人様1回です。<br />お礼のクーポンは My FITPEAK でご確認いただけます。
        </p>
        <div className="mt-6 space-y-3">
          <Link to="/my-fitpeak/survey/coupon" className="flex items-center justify-center w-full min-h-[52px] rounded-full bg-[#111] text-white text-[15px] font-bold hover:bg-[#333]">
            クーポンを表示する
          </Link>
          <Link to="/my-fitpeak" className="flex items-center justify-center w-full min-h-[52px] rounded-full border border-[#d6d6d6] text-[#111] text-[15px] font-bold hover:bg-[#f3f3f3]">
            My FITPEAK トップへ
          </Link>
        </div>
      </Card>
    </SurveyShell>
  )
}
