import { getLocale } from '../../i18n/store'
import { useEffect, useState } from 'react'
import { Crown, CheckCircle, AlertTriangle } from 'lucide-react'
import { apiFetch } from './lib/api'

/**
 * FITPEAK PRO（有料会員）の画面（2026-09-27）
 * 状態の確認と解約。LPの「定期契約の条件」で「My FITPEAKからいつでも解約できる」と案内しているため、
 * 解約はこの画面だけで完結させる（引き止めの手順は入れない）。
 * API: /api/public/subscription/portal/pro/status, /cancel（server/fitpeak-pro.cjs）
 */

interface ProStatus {
  is_pro: boolean
  plan_expires_date: string | null
  subscription: {
    id: string
    status: string
    plan_name: string
    price: number
    interval_days: number | null
    next_billing_date: string | null
    in_trial: boolean
    cancelled: boolean
    cancelled_date: string | null
    can_cancel: boolean
  } | null
}

const LP_URL = 'https://fitpeak.co/products/fitpeak-pro'

function jpDate(d: string | null) {
  if (!d) return ''
  const [y, m, day] = d.split('-').map(Number)
  return new Intl.DateTimeFormat(getLocale(), { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(y, m - 1, day))
}

export default function FitpeakPro() {
  const [data, setData] = useState<ProStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [note, setNote] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [done, setDone] = useState(false)

  const load = () => {
    setLoading(true)
    apiFetch('/api/public/subscription/portal/pro/status')
      .then(async (r) => {
        const j = await r.json()
        if (!r.ok) throw new Error(j.error || '読み込みに失敗しました')
        setData(j)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const cancel = async () => {
    setCancelling(true)
    setError('')
    try {
      const r = await apiFetch('/api/public/subscription/portal/pro/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || '解約に失敗しました')
      setData(j)
      setDone(true)
      setConfirming(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : '解約に失敗しました')
    } finally {
      setCancelling(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-2 border-[#c8a960] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const sub = data?.subscription || null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-base font-bold text-white">
          <Crown size={18} className="text-[#c8a960]" /> FITPEAK PRO
        </h1>
        <p className="text-xs text-white/40 mt-1 leading-relaxed">有料会員プランの状態の確認と、解約ができます。</p>
      </div>

      {error && <p className="flex items-center gap-1.5 text-sm text-red-400"><AlertTriangle size={16} />{error}</p>}

      {!sub && (
        <section className="rounded-2xl bg-[#151515] border border-white/10 p-5 sm:p-6 space-y-3">
          <p className="text-sm text-white">FITPEAK PRO には、まだ登録していません。</p>
          <ul className="text-xs text-white/50 space-y-1 leading-relaxed">
            <li>・ギアはいつでも10%OFF・送料無料</li>
            <li>・ポイント2倍＋毎月100ポイント</li>
            <li>・毎月の会員限定クーポン</li>
          </ul>
          <a href={LP_URL} className="block text-center w-full py-3.5 rounded-lg bg-[#c8a960] hover:bg-[#b89950] text-black text-sm font-bold transition">
            くわしく見る（14日間無料）
          </a>
        </section>
      )}

      {sub && (
        <section className="rounded-2xl bg-[#151515] border border-white/10 p-5 sm:p-6">
          <dl className="grid grid-cols-[7rem_1fr] gap-y-3 text-sm">
            <dt className="text-white/40">プラン</dt>
            <dd className="text-white">{sub.plan_name}</dd>
            <dt className="text-white/40">状態</dt>
            <dd className="text-white">
              {sub.cancelled ? '解約済み' : sub.in_trial ? '無料期間中' : sub.status === 'past_due' ? 'お支払い確認中' : 'ご利用中'}
            </dd>
            {!sub.cancelled && sub.next_billing_date && (
              <>
                <dt className="text-white/40">{sub.in_trial ? '無料期間の終了' : '次回の決済日'}</dt>
                <dd className="text-white">
                  {jpDate(sub.next_billing_date)}
                  <span className="block text-xs text-white/40 mt-0.5">この日に ¥{sub.price.toLocaleString(getLocale())} を決済します</span>
                </dd>
              </>
            )}
            {sub.cancelled && data?.plan_expires_date && (
              <>
                <dt className="text-white/40">特典を使える期限</dt>
                <dd className="text-white">{jpDate(data.plan_expires_date)}まで</dd>
              </>
            )}
          </dl>

          {done && (
            <p className="mt-5 flex items-center gap-1.5 text-sm text-[#06C755]">
              <CheckCircle size={16} /> 解約しました。今後の決済はありません。
            </p>
          )}

          {sub.can_cancel && !confirming && (
            <button
              onClick={() => setConfirming(true)}
              className="mt-6 w-full py-3 rounded-lg border border-white/15 text-white/70 hover:text-white text-sm transition"
            >
              解約する
            </button>
          )}

          {sub.can_cancel && confirming && (
            <div className="mt-6 space-y-3 rounded-xl border border-white/10 p-4">
              <p className="text-sm text-white">FITPEAK PRO を解約しますか？</p>
              <p className="text-xs text-white/50 leading-relaxed">
                {sub.in_trial
                  ? '無料期間中の解約なので、料金はかかりません。無料期間の終了日までは特典を使えます。'
                  : 'お支払い済みの期間が終わるまでは特典を使えます。日割りの返金はありません。'}
              </p>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="よければ、解約の理由を教えてください（任意）"
                className="w-full rounded-lg bg-black/40 border border-white/10 focus:border-[#c8a960] px-3 py-2 text-sm text-white placeholder-white/25 outline-none"
              />
              <div className="flex gap-2">
                <button onClick={() => setConfirming(false)} className="flex-1 py-3 rounded-lg border border-white/15 text-white/70 text-sm">
                  やめる
                </button>
                <button
                  onClick={cancel}
                  disabled={cancelling}
                  className="flex-1 py-3 rounded-lg bg-white text-black text-sm font-bold disabled:opacity-50"
                >
                  {cancelling ? '手続き中…' : '解約する'}
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
