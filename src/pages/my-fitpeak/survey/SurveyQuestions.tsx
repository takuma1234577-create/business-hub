import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { SURVEY_QUESTIONS, SKIP_IF_HIGH_RATING, PRODUCT_POSITIVE_POINTS, type SurveyAnswers } from './config'
import { Card, CheckboxGroup, ErrorText, PillButton, ProgressBar, SingleSelect, Spinner, StarRating, SurveyShell, SurveyTextArea, trackStep } from './ui'

// 書きかけの回答だけは端末に残す（送信したら消す）。誰の回答かはサーバーがログインから決める
const DRAFT_KEY = 'myfp_survey_draft'
const EMPTY: SurveyAnswers = { product: '', rating: 0, positive_points: [], recommendation_text: '' }

export default function SurveyQuestions() {
  const navigate = useNavigate()
  const [checking, setChecking] = useState(true)
  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [answers, setAnswers] = useState<SurveyAnswers>(() => {
    try { const s = localStorage.getItem(DRAFT_KEY); if (s) return { ...EMPTY, ...JSON.parse(s) } } catch { /* ignore */ }
    return EMPTY
  })

  // 回答済みなら回答済み画面へ
  useEffect(() => {
    let cancelled = false
    apiFetch('/api/my-fitpeak/survey/status')
      .then((r) => r.json())
      .then((d) => { if (!cancelled && d.completed) navigate('/my-fitpeak/survey/completed', { replace: true }) })
      .catch(() => { /* 送信時にサーバーが再確認する */ })
      .finally(() => { if (!cancelled) setChecking(false) })
    trackStep('questions')
    return () => { cancelled = true }
  }, [navigate])

  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(answers)) } catch { /* ignore */ }
  }, [answers])

  const questions = useMemo(() => {
    let qs = [...SURVEY_QUESTIONS]
    if (answers.rating >= 4) qs = qs.filter((q) => !SKIP_IF_HIGH_RATING.includes(q.id))
    const opts = answers.product ? PRODUCT_POSITIVE_POINTS[answers.product] : null
    if (opts) qs = qs.map((q) => (q.id === 'positive_points' ? { ...q, options: opts } : q))
    return qs
  }, [answers.rating, answers.product])

  useEffect(() => { if (step >= questions.length) setStep(questions.length - 1) }, [questions, step])

  const q = questions[step]
  const isLast = step === questions.length - 1

  const canProceed = () => {
    if (!q) return false
    if (!q.required) return true
    if (q.id === 'rating') return answers.rating > 0
    const v = answers[q.id]
    if (q.type === 'single_select') return typeof v === 'string' && !!v
    if (q.type === 'textarea') {
      const s = typeof v === 'string' ? v.trim() : ''
      return s.length > 0 && (!q.minLength || s.length >= q.minLength)
    }
    return true
  }

  const update = (id: string, value: unknown) => {
    setAnswers((prev) => {
      const next = { ...prev, [id]: value }
      if (id === 'product') next.positive_points = []
      return next
    })
  }

  const submit = async () => {
    setSubmitting(true)
    setError('')
    try {
      const res = await apiFetch('/api/my-fitpeak/survey/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.status === 409) { navigate('/my-fitpeak/survey/completed', { replace: true }); return }
      if (!res.ok) { setError(d.error || 'エラーが発生しました'); setSubmitting(false); return }
      try { localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
      trackStep('submitted')
      navigate(answers.rating === 5 ? '/my-fitpeak/survey/pre-review' : '/my-fitpeak/survey/coupon', { replace: true })
    } catch {
      setError('通信に失敗しました。もう一度お試しください。')
      setSubmitting(false)
    }
  }

  if (checking) return <SurveyShell><Spinner /></SurveyShell>
  if (!q) return null

  return (
    <SurveyShell>
      <div className="mb-4"><ProgressBar current={step + 1} total={questions.length} /></div>
      <Card>
        <h2 className="text-[17px] font-bold text-[#111] mb-5 leading-snug">{q.label}</h2>
        {q.type === 'single_select' && q.options && (
          <SingleSelect options={q.options} value={(answers[q.id] as string) || ''} onChange={(v) => update(q.id, v)} />
        )}
        {q.type === 'star' && <StarRating value={answers.rating} onChange={(v) => update('rating', v)} />}
        {q.type === 'multi_checkbox' && q.options && (
          <CheckboxGroup options={q.options} selected={(answers[q.id] as string[]) || []} onChange={(v) => update(q.id, v)} />
        )}
        {q.type === 'textarea' && (
          <SurveyTextArea value={(answers[q.id] as string) || ''} onChange={(v) => update(q.id, v)}
            placeholder={q.placeholder} maxLength={q.maxLength} minLength={q.minLength} hint={q.hint} />
        )}
        <ErrorText>{error}</ErrorText>
      </Card>

      <div className="mt-5 flex gap-3">
        {step > 0 && (
          <div className="w-28 shrink-0">
            <PillButton variant="secondary" onClick={() => setStep((s) => s - 1)}>戻る</PillButton>
          </div>
        )}
        {isLast ? (
          <PillButton onClick={submit} disabled={!canProceed() || submitting}>{submitting ? '送信中...' : 'アンケートを送信'}</PillButton>
        ) : (
          <PillButton onClick={() => setStep((s) => s + 1)} disabled={!canProceed()}>次へ</PillButton>
        )}
      </div>
    </SurveyShell>
  )
}
