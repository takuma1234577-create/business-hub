import { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { Gift } from 'lucide-react'
import { apiFetch } from './lib/api'

/**
 * My FITPEAKポイントを使う（仕様書 v1 第11項A）
 * fitpeak.co の商品ページ・カートの「ポイントを使う」から来る。
 * 使うポイント数を選ぶ → サーバーが1回限りの割引コードを発行（ポイントは仮押さえ）→ 割引が入った状態で fitpeak.co へ戻る。
 * URL: /my-fitpeak/points/use?redirect=/products/xxx（redirect は fitpeak.co の中のパス。サーバー側でも検査する）
 */
export default function FitpeakRedeem() {
  const [searchParams] = useSearchParams()
  const redirect = searchParams.get('redirect') || '/cart'
  const [balance, setBalance] = useState<number | null>(null)
  const [points, setPoints] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    apiFetch('/api/my-fitpeak/loyalty')
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (cancelled) return
        const b = s ? Number(s.balance) || 0 : 0
        setBalance(b)
        setPoints(b > 0 ? String(b) : '')
      })
      .catch(() => { if (!cancelled) setBalance(0) })
    return () => { cancelled = true }
  }, [])

  const n = Number(points)
  const valid = Number.isInteger(n) && n > 0 && balance !== null && n <= balance

  const redeem = async () => {
    setError('')
    setBusy(true)
    try {
      const res = await apiFetch('/api/my-fitpeak/loyalty/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: n, redirect }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || '割引コードを作れませんでした')
        setBusy(false)
        return
      }
      window.location.href = data.url
    } catch {
      setError('通信に失敗しました。時間をおいてお試しください')
      setBusy(false)
    }
  }

  if (balance === null) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-2 border-[#c8a960] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-[#151515] border border-white/10 p-5">
        <div className="flex items-center gap-2">
          <Gift size={18} className="text-[#c8a960]" />
          <h1 className="text-base font-bold text-white">My FITPEAKポイントを使う</h1>
        </div>
        <div className="flex items-baseline justify-between mt-4">
          <span className="text-xs text-white/50">保有ポイント</span>
          <span className="text-2xl font-bold text-white">{balance.toLocaleString()}pt</span>
        </div>

        {balance <= 0 ? (
          <p className="text-sm text-white/60 mt-4">
            使えるポイントがまだありません。クレアショット定期購入中の方は、毎日ここを開くと1ptずつたまります。
          </p>
        ) : (
          <>
            <label className="block text-xs text-white/50 mt-5 mb-2">使うポイント（1pt＝1円引き）</label>
            <div className="flex gap-2">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={balance}
                value={points}
                onChange={(e) => { setPoints(e.target.value.replace(/[^\d]/g, '')); setError('') }}
                className="flex-1 px-4 py-3 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-[#c8a960]/50 transition"
              />
              <button
                type="button"
                onClick={() => setPoints(String(balance))}
                className="px-4 py-3 rounded-lg bg-white/5 border border-white/10 text-white/70 text-sm hover:bg-white/10 transition"
              >
                全部
              </button>
            </div>
            {points !== '' && !valid && <p className="text-red-400 text-xs mt-2">1〜{balance.toLocaleString()}ptの範囲で入力してください</p>}
            <button
              onClick={redeem}
              disabled={!valid || busy}
              className="w-full mt-4 py-3 rounded-lg bg-[#c8a960] hover:bg-[#b89a50] text-black text-sm font-bold transition disabled:opacity-40"
            >
              {busy ? '準備中' : `${valid ? n.toLocaleString() : 0}円引きでお買い物に戻る`}
            </button>
            {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
            <ul className="text-[11px] text-white/40 mt-4 space-y-1 leading-relaxed">
              <li>割引は1回のご注文に使えます。24時間以内にご注文ください。</li>
              <li>使わなかった場合、ポイントは24時間後に自動で戻ります。</li>
              <li>商品代金がポイントより少ないときは、使った分だけ減り、残りは戻ります。</li>
              <li>定期購入に使った場合は初回のご請求だけが割引になります。2回目以降は、ホームの「次回の請求でポイントを使う」で設定できます。</li>
            </ul>
          </>
        )}
      </section>
      <Link to="/my-fitpeak" className="block text-center text-xs text-white/40 hover:text-white/70">ホームに戻る</Link>
    </div>
  )
}
