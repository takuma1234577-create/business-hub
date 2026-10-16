import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, Star } from 'lucide-react'
import { apiFetch } from '../lib/api'
import type { SurveySummary } from './config'

/**
 * アンケート・特典まわりの共通部品（My FITPEAK のデザイン：白基調・モノトーン・#111 のピル型ボタン）
 */

export function SurveyShell({ children }: { children: ReactNode }) {
  useEffect(() => {
    const prev = document.title
    document.title = 'アンケート | My FITPEAK'
    return () => { document.title = prev }
  }, [])
  return (
    <div className="fp-root min-h-[100dvh] bg-[#f5f5f7]" style={{ fontFamily: "'Noto Sans JP', sans-serif", fontFeatureSettings: "'palt'" }}>
      <header className="bg-[#0b0b0b]">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center">
          <img src="/fitpeak-wordmark-white.png" alt="FITPEAK" className="h-[18px] w-auto" />
          <span className="ml-2.5 pl-2.5 border-l border-white/25 text-[10px] font-bold tracking-[0.14em] text-white/70">MY PAGE</span>
        </div>
      </header>
      <main className="max-w-lg mx-auto px-4 py-6">{children}</main>
    </div>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-[20px] bg-white border border-[#e6e6e6] p-5 sm:p-6 ${className}`}>{children}</section>
}

export function PillButton({ children, onClick, disabled, type = 'button', variant = 'primary' }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; type?: 'button' | 'submit'; variant?: 'primary' | 'secondary'
}) {
  const cls = variant === 'primary'
    ? 'bg-[#111] text-white hover:bg-[#333]'
    : 'bg-white text-[#111] border border-[#d6d6d6] hover:bg-[#f3f3f3]'
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`w-full min-h-[52px] px-6 rounded-full text-[15px] font-bold transition disabled:opacity-40 disabled:cursor-not-allowed ${cls}`}>
      {children}
    </button>
  )
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-2 border-[#111] border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null
  return <p className="mt-3 text-sm text-[#c8102e] bg-[#c8102e]/5 rounded-[12px] px-3 py-2">{children}</p>
}

export function BackToMyPage() {
  return (
    <Link to="/my-fitpeak" className="block text-center text-[13px] text-[#6b6b6b] underline underline-offset-2 mt-5">
      My FITPEAK トップへ
    </Link>
  )
}

export function ProgressBar({ current, total }: { current: number; total: number }) {
  return (
    <div>
      <div className="flex justify-between text-[12px] text-[#6b6b6b] mb-1.5">
        <span>質問 {current} / {total}</span>
        <span>{Math.round((current / total) * 100)}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-[#e6e6e6] overflow-hidden">
        <div className="h-full bg-[#111] transition-all" style={{ width: `${(current / total) * 100}%` }} />
      </div>
    </div>
  )
}

export function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex justify-center gap-2" role="radiogroup" aria-label="満足度">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" onClick={() => onChange(n)} aria-label={`${n}点`} aria-checked={value === n} role="radio"
          className="p-1">
          <Star size={40} strokeWidth={1.5} className={n <= value ? 'fill-[#111] text-[#111]' : 'text-[#c9c9c9]'} />
        </button>
      ))}
    </div>
  )
}

export function SingleSelect({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-2">
      {options.map((o) => (
        <button key={o} type="button" onClick={() => onChange(o)}
          className={`w-full text-left px-4 min-h-[48px] rounded-[14px] border text-[15px] transition ${
            value === o ? 'border-[#111] bg-[#111] text-white font-bold' : 'border-[#e0e0e0] bg-white text-[#111] hover:bg-[#f6f6f6]'}`}>
          {o}
        </button>
      ))}
    </div>
  )
}

export function CheckboxGroup({ options, selected, onChange }: { options: string[]; selected: string[]; onChange: (v: string[]) => void }) {
  const toggle = (o: string) => onChange(selected.includes(o) ? selected.filter((x) => x !== o) : [...selected, o])
  return (
    <div className="space-y-2">
      {options.map((o) => {
        const on = selected.includes(o)
        return (
          <button key={o} type="button" onClick={() => toggle(o)}
            className={`w-full flex items-center gap-3 text-left px-4 min-h-[48px] rounded-[14px] border text-[15px] transition ${
              on ? 'border-[#111] bg-[#f3f3f3] font-bold' : 'border-[#e0e0e0] bg-white hover:bg-[#f6f6f6]'}`}>
            <span className={`w-5 h-5 rounded-[6px] border flex items-center justify-center shrink-0 ${on ? 'bg-[#111] border-[#111]' : 'border-[#bdbdbd]'}`}>
              {on && <Check size={14} className="text-white" />}
            </span>
            {o}
          </button>
        )
      })}
    </div>
  )
}

export function SurveyTextArea({ value, onChange, placeholder, maxLength, minLength, hint }: {
  value: string; onChange: (v: string) => void; placeholder?: string; maxLength?: number; minLength?: number; hint?: string
}) {
  const len = value.trim().length
  return (
    <div>
      <textarea value={value} onChange={(e) => onChange(maxLength ? e.target.value.slice(0, maxLength) : e.target.value)}
        placeholder={placeholder} rows={6}
        className="w-full rounded-[14px] border border-[#e0e0e0] px-4 py-3 text-[15px] text-[#111] placeholder-[#9a9a9a] focus:outline-none focus:border-[#111]" />
      <div className="flex justify-between text-[12px] text-[#6b6b6b] mt-1">
        <span>{hint || ''}</span>
        <span className={`shrink-0 whitespace-nowrap pl-2 ${minLength && len < minLength ? "text-[#c8102e]" : ""}`}>
          {len}{maxLength ? ` / ${maxLength}` : ''}文字
        </span>
      </div>
    </div>
  )
}

// 画面到達の記録（失敗しても画面には影響させない）
export function trackStep(step: string) {
  apiFetch('/api/my-fitpeak/survey/track-step', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ step }),
    keepalive: true,
  }).catch(() => { /* ignore */ })
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const t = document.createElement('textarea')
      t.value = text
      t.style.position = 'fixed'
      t.style.opacity = '0'
      document.body.appendChild(t)
      t.select()
      document.execCommand('copy')
      document.body.removeChild(t)
      return true
    } catch { return false }
  }
}

// 本人の回答（サーバーから取る。端末に保存した回答や他人のIDは使わない）
export function useMySurvey(redirectIfNone = true) {
  const navigate = useNavigate()
  const [survey, setSurvey] = useState<SurveySummary | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    apiFetch('/api/my-fitpeak/survey/status')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
        if (!d.survey && redirectIfNone) navigate('/my-fitpeak/survey', { replace: true })
        setSurvey(d.survey || null)
      })
      .catch(() => { /* 表示側でエラー */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [navigate, redirectIfNone])
  return { survey, loading }
}
