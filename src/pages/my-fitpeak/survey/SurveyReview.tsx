import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { BackToMyPage, Card, Spinner, SurveyShell, copyText, trackStep, useMySurvey } from './ui'

/**
 * ★5の人へ：Amazonレビューのお願い（旧 /survey/pre-review と /survey/review-cta）
 * 推薦文は本人がアンケートで書いたもの（サーバーから本人の分だけ取る）
 */
export default function SurveyReview({ step }: { step: 'pre_review' | 'review_cta' }) {
  const { survey, loading } = useMySurvey()
  const [copied, setCopied] = useState(false)
  const navigate = useNavigate()
  useEffect(() => { trackStep(step) }, [step])

  // ★5以外はクーポン画面へ（旧アプリと同じ振り分け）
  useEffect(() => {
    if (survey && survey.rating !== 5) navigate('/my-fitpeak/survey/coupon', { replace: true })
  }, [survey, navigate])

  // アンケートの特典クーポンは先に用意しておく（何度呼んでも同じコード）
  useEffect(() => {
    if (survey) apiFetch('/api/my-fitpeak/survey/coupon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => { /* ignore */ })
  }, [survey])

  if (loading) return <SurveyShell><Spinner /></SurveyShell>
  if (!survey) return null

  const amazonUrl = `https://www.amazon.co.jp/review/create-review?asin=${encodeURIComponent(survey.productAsin)}`
  const onReview = () => {
    copyText(survey.recommendationText).then((ok) => setCopied(ok))
    apiFetch('/api/my-fitpeak/survey/track-click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'amazon_review' }),
      keepalive: true,
    }).catch(() => { /* ignore */ })
  }

  return (
    <SurveyShell>
      <Card>
        <h1 className="text-[20px] font-bold text-[#111] text-center leading-snug">よろしければAmazonレビューで<br />応援をお願いします</h1>
        <p className="mt-2 text-[13px] text-[#6b6b6b] text-center">2,000円OFFクーポンはお届け済みです。</p>

        <img src="/my-fitpeak/fitpeak-team.jpg" alt="FITPEAK チーム" className="mt-5 w-full rounded-[16px] object-cover"
          onError={(e) => { e.currentTarget.style.display = 'none' }} />
        <p className="mt-3 text-[14px] text-[#111] leading-relaxed">
          国産フィットネスメーカーとして奮闘しています。Amazonレビューで応援いただけると、私たちの大きな励みになります。
        </p>

        {survey.recommendationText && (
          <div className="mt-4 rounded-[16px] bg-[#f5f5f7] p-4">
            <p className="text-[12px] font-bold text-[#6b6b6b] mb-1.5">そのまま使えるレビュー文（ボタンでコピーしてAmazonへ）</p>
            <p className="text-[14px] text-[#111] whitespace-pre-wrap leading-relaxed">{survey.recommendationText}</p>
          </div>
        )}

        <a href={amazonUrl} onClick={onReview}
          className="mt-5 flex items-center justify-center gap-2 w-full min-h-[52px] rounded-full bg-[#111] text-white text-[15px] font-bold hover:bg-[#333]">
          <img src="/my-fitpeak/amazon-logo.png" alt="" className="w-5 h-5 object-contain bg-white rounded-full p-0.5" />
          {copied ? 'コピーしました。Amazonで投稿' : 'Amazonでレビューする'}
        </a>
        <p className="mt-2 text-[11px] text-[#9a9a9a] text-center">タップでレビュー文をコピーしてAmazonを開きます</p>

        <Link to="/my-fitpeak/survey/coupon" className="block mt-5 text-center text-[13px] text-[#111] underline underline-offset-2">
          2,000円OFFクーポンを表示する
        </Link>
        <p className="mt-3 text-[11px] text-[#9a9a9a] text-center">※レビューの投稿は任意です。クーポンの獲得には影響しません。</p>
      </Card>
      <BackToMyPage />
    </SurveyShell>
  )
}
