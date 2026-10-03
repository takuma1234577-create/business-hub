import { useEffect, useState } from 'react'
import { Ticket, Copy, Check } from 'lucide-react'
import { apiFetch } from './lib/api'

interface Coupon { code: string; label: string; expiresAt: string | null; source: string | null; note: string }

const GEAR_URL = 'https://fitpeak.co/collections/fitpeak筋トレギア一覧'

// 自分のクーポン。公式LINEに登録すると自動でここに入る
export default function FitpeakCoupons() {
  const [coupons, setCoupons] = useState<Coupon[]>([])
  const [copied, setCopied] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await apiFetch('/api/my-fitpeak/coupons')
        if (res.ok && !cancelled) setCoupons((await res.json()).coupons || [])
      } catch { /* クーポンが取れなくても画面は出す */ }
    })()
    return () => { cancelled = true }
  }, [])

  if (coupons.length === 0) return null

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(code)
      setTimeout(() => setCopied(''), 2000)
    } catch { /* コピーできない環境では何もしない */ }
  }

  return (
    <section className="rounded-2xl bg-[#151515] border border-white/10 p-5">
      <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
        <Ticket size={16} className="text-[#c8a960]" /> 使えるクーポン
      </h2>
      <div className="space-y-3">
        {coupons.map((c) => (
          <div key={`${c.code}-${c.source}`} className="rounded-xl border border-dashed border-[#c8a960]/40 bg-[#c8a960]/5 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-base font-bold text-white">{c.label}</p>
                <p className="text-xs text-white/50 mt-0.5 font-mono tracking-wider">{c.code}</p>
              </div>
              <button
                type="button"
                onClick={() => copy(c.code)}
                className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-white/80 transition"
              >
                {copied === c.code ? <><Check size={14} className="text-green-400" /> コピー済み</> : <><Copy size={14} /> コードをコピー</>}
              </button>
            </div>
            {c.note && <p className="text-[11px] text-white/40 mt-2">{c.note}</p>}
            {c.expiresAt && <p className="text-[11px] text-white/40 mt-1">{new Date(c.expiresAt).toLocaleDateString('ja-JP')} まで</p>}
          </div>
        ))}
      </div>
      <a
        href={GEAR_URL}
        className="block text-center mt-4 py-3 rounded-lg bg-[#c8a960] hover:bg-[#b89a50] text-black text-sm font-semibold transition"
      >
        公式サイトでギアを見る
      </a>
    </section>
  )
}
