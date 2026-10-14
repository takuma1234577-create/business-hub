import { useEffect, useState } from 'react'
import { apiFetch } from './lib/api'

/**
 * 次回の定期請求でポイントを使う設定（仕様書 v1 第11項B）
 * 請求の直前にサーバーが設定を読み、残高と請求額を上限にポイントを差し引く。
 */

interface Pref {
  subscription_id: string
  status: string
  amount: number | null
  next_billing_at: string | null
  mode: 'none' | 'all' | 'fixed'
  points: number | null
}

const MODES: { value: Pref['mode']; label: string }[] = [
  { value: 'none', label: '使わない' },
  { value: 'all', label: '全部使う' },
  { value: 'fixed', label: '指定する' },
]

export default function BillingPointsPref() {
  const [prefs, setPrefs] = useState<Pref[] | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [fixedInput, setFixedInput] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    apiFetch('/api/my-fitpeak/loyalty/billing-prefs')
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Pref[]) => {
        if (cancelled) return
        setPrefs(list)
        setFixedInput(Object.fromEntries(list.map((p) => [p.subscription_id, p.points ? String(p.points) : ''])))
      })
      .catch(() => { if (!cancelled) setPrefs([]) })
    return () => { cancelled = true }
  }, [])

  const save = async (p: Pref, mode: Pref['mode']) => {
    setError('')
    setSaved(null)
    const points = mode === 'fixed' ? Number(fixedInput[p.subscription_id]) : null
    if (mode === 'fixed' && (!Number.isInteger(points) || (points ?? 0) <= 0)) {
      setPrefs((list) => (list || []).map((x) => (x.subscription_id === p.subscription_id ? { ...x, mode } : x)))
      return
    }
    setSaving(p.subscription_id)
    try {
      const res = await apiFetch(`/api/my-fitpeak/loyalty/billing-prefs/${p.subscription_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, points }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || '保存できませんでした')
      } else {
        setPrefs((list) => (list || []).map((x) => (x.subscription_id === p.subscription_id ? { ...x, mode, points } : x)))
        setSaved(p.subscription_id)
      }
    } catch {
      setError('通信に失敗しました。時間をおいてお試しください')
    }
    setSaving(null)
  }

  if (!prefs || prefs.length === 0) return null

  return (
    <div className="mt-4 pt-4 border-t border-white/10 space-y-4">
      <p className="text-xs text-white/50">次回の定期請求でポイントを使う</p>
      {prefs.map((p) => (
        <div key={p.subscription_id}>
          {prefs.length > 1 && p.amount != null && (
            <p className="text-[11px] text-white/40 mb-1">定期購入（{Number(p.amount).toLocaleString()}円）</p>
          )}
          <div className="grid grid-cols-3 gap-2">
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                disabled={saving === p.subscription_id}
                onClick={() => save(p, m.value)}
                className={`py-2 rounded-lg text-xs font-semibold border transition ${
                  p.mode === m.value ? 'bg-[#c8a960] text-black border-[#c8a960]' : 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          {p.mode === 'fixed' && (
            <div className="flex gap-2 mt-2">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                value={fixedInput[p.subscription_id] || ''}
                onChange={(e) => setFixedInput((v) => ({ ...v, [p.subscription_id]: e.target.value.replace(/[^\d]/g, '') }))}
                placeholder="使うポイント"
                className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-[#c8a960]/50 transition"
              />
              <button
                type="button"
                disabled={saving === p.subscription_id || !fixedInput[p.subscription_id]}
                onClick={() => save(p, 'fixed')}
                className="px-4 py-2 rounded-lg bg-[#c8a960] text-black text-xs font-semibold disabled:opacity-40"
              >
                保存
              </button>
            </div>
          )}
          {saved === p.subscription_id && <p className="text-[11px] text-[#c8a960] mt-1">保存しました</p>}
        </div>
      ))}
      <p className="text-[11px] text-white/30 leading-relaxed">
        請求の直前に、保有ポイントと請求額の範囲で差し引きます。お支払いが最終的にできなかった場合は、ポイントは戻ります。
      </p>
      {error && <p className="text-red-400 text-xs">{error}</p>}
    </div>
  )
}
