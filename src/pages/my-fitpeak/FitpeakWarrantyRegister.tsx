import { getLocale } from '../../i18n/store'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ShieldCheck, CheckCircle2, AlertCircle } from 'lucide-react'
import { apiFetch } from './lib/api'

// 施策⑪ 同梱カードQR→保証登録（claude/hoshou-qr-ugc-kuchikomi-sekkei.md 準拠）
// 初期リリースは「注文番号方式」のみ（第3項）。QRの ?sku=<handle> があれば商品を自動選択する。

const PRODUCTS: { value: string; label: string }[] = [
  { value: 'fitpeak-リストラップ', label: 'リストラップ' },
  { value: 'fitpeak-本革トレーニングベルト', label: 'トレーニングベルト（本革）' },
  { value: 'fitpeak-パワーグリップ', label: 'パワーグリップ' },
]

export default function FitpeakWarrantyRegister() {
  const [searchParams] = useSearchParams()
  const skuParam = searchParams.get('sku') || ''

  const [sku, setSku] = useState(PRODUCTS.some((p) => p.value === skuParam) ? skuParam : '')
  const [orderNumber, setOrderNumber] = useState('')
  const [purchaseDate, setPurchaseDate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ warrantyMonths: number; warrantyExpiresAt: string; upsell: boolean } | null>(null)

  useEffect(() => {
    if (skuParam && PRODUCTS.some((p) => p.value === skuParam)) setSku(skuParam)
  }, [skuParam])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!sku) return setError('商品を選択してください')
    if (!orderNumber.trim()) return setError('Amazonの注文番号を入力してください')
    if (!purchaseDate) return setError('購入日を選択してください')

    setSubmitting(true)
    try {
      const res = await apiFetch('/api/my-fitpeak/warranty-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku, orderNumber: orderNumber.trim(), purchaseDate }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '登録に失敗しました')
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : '登録に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  if (result) {
    return (
      <div className="space-y-6">
        <h1 className="text-base font-bold text-white">保証登録</h1>
        <section className="rounded-2xl bg-[#151515] border border-white/10 p-6 text-center">
          <CheckCircle2 size={40} className="text-[#c8a960] mx-auto mb-3" />
          <p className="text-white font-semibold">保証登録が完了しました</p>
          <p className="text-sm text-white/60 mt-2">
            保証期間：<span className="text-[#c8a960] font-semibold">{result.warrantyMonths}ヶ月</span>
            （{new Date(result.warrantyExpiresAt).toLocaleDateString(getLocale())} まで）
          </p>
          {result.upsell && (
            <a
              href="/my-fitpeak/pro"
              className="block mt-5 py-3 rounded-lg bg-[#c8a960] text-black text-sm font-semibold text-center"
            >
              FITPEAK PROなら保証を2年に延長できます
            </a>
          )}
        </section>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-base font-bold text-white">保証登録</h1>

      <section className="rounded-2xl bg-[#151515] border border-white/10 p-5 sm:p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-11 h-11 rounded-full bg-[#c8a960]/10 flex items-center justify-center shrink-0">
            <ShieldCheck size={20} className="text-[#c8a960]" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">登録するだけで保証を延長</p>
            <p className="text-xs text-white/40 mt-0.5">通常1.5年／FITPEAK PROなら2年（無料）</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-white/50 mb-1.5">購入した商品</label>
            <select
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              className="w-full rounded-lg bg-black/30 border border-white/10 text-white text-sm px-3 py-2.5 focus:outline-none focus:border-[#c8a960]"
            >
              <option value="">選択してください</option>
              {PRODUCTS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-white/50 mb-1.5">Amazon注文番号</label>
            <input
              type="text"
              inputMode="numeric"
              placeholder="250-1234567-1234567"
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              className="w-full rounded-lg bg-black/30 border border-white/10 text-white text-sm px-3 py-2.5 focus:outline-none focus:border-[#c8a960]"
            />
            <p className="text-[11px] text-white/30 mt-1">Amazonの「注文履歴」でご確認いただけます</p>
          </div>

          <div>
            <label className="block text-xs text-white/50 mb-1.5">購入日</label>
            <input
              type="date"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
              className="w-full rounded-lg bg-black/30 border border-white/10 text-white text-sm px-3 py-2.5 focus:outline-none focus:border-[#c8a960]"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 text-xs text-red-400">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3.5 rounded-lg bg-[#c8a960] hover:bg-[#b89650] disabled:opacity-50 text-black text-sm font-semibold transition"
          >
            {submitting ? '登録中…' : '保証登録する'}
          </button>
        </form>
      </section>
    </div>
  )
}
