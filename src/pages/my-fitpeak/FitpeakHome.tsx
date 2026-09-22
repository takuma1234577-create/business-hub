import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Package, ChevronRight, Truck, Search, Plus, X, MessageCircle, CheckCircle } from 'lucide-react'
import { useFitpeakAuth } from './lib/auth'
import { fitpeakSupabase } from './lib/supabase'
import { apiFetch, displayName } from './lib/api'

interface Order {
  id: number | string
  name: string
  date: string
  total: string
  status: string
  fulfillmentStatus: string
  items: { title: string; quantity: number; price: string; variant?: string }[]
  trackingNumber?: string
  trackingUrl?: string
  trackingCompany?: string
  source?: 'shopify' | 'amazon'
}

export default function FitpeakHome() {
  const { user } = useFitpeakAuth()
  const [orders, setOrders] = useState<Order[]>([])
  const [amazonOrders, setAmazonOrders] = useState<Order[]>([])
  const [lineLinked, setLineLinked] = useState(false)
  const [loading, setLoading] = useState(true)

  const [amazonOpen, setAmazonOpen] = useState(false)
  const [amazonInput, setAmazonInput] = useState('')
  const [amazonSearching, setAmazonSearching] = useState(false)
  const [amazonError, setAmazonError] = useState('')

  useEffect(() => {
    async function load() {
      if (!user?.email) { setLoading(false); return }

      try {
        const res = await apiFetch(`/api/my-fitpeak/orders?email=${encodeURIComponent(user.email)}&limit=20`)
        if (res.ok) {
          const data = await res.json()
          setOrders((data.orders || []).map((o: Order) => ({ ...o, source: 'shopify' as const })))
        }
      } catch { /* 取得できなくても画面は出す */ }

      try {
        const { data } = await fitpeakSupabase
          .from('line_shopify_links')
          .select('id')
          .eq('shopify_email', user.email)
          .maybeSingle()
        setLineLinked(!!data)
      } catch { /* 同上 */ }

      setLoading(false)
    }
    load()
  }, [user])

  const handleAmazonSearch = async () => {
    const id = amazonInput.trim()
    if (!id) return
    setAmazonError('')
    setAmazonSearching(true)
    try {
      const res = await apiFetch('/api/my-fitpeak/amazon-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: id }),
      })
      const data = await res.json()
      if (!res.ok) {
        setAmazonError(data.error || '注文が見つかりませんでした')
      } else {
        if (!amazonOrders.some((o) => o.name === data.name)) {
          setAmazonOrders((prev) => [{ ...data, source: 'amazon' as const }, ...prev])
        }
        setAmazonInput('')
      }
    } catch {
      setAmazonError('検索に失敗しました。時間をおいて試してください')
    }
    setAmazonSearching(false)
  }

  const allOrders = [...amazonOrders, ...orders].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  )

  const statusBadge = (order: Order) => {
    const s = order.source === 'amazon' ? order.status : order.fulfillmentStatus
    if (s === 'fulfilled' || s === 'Shipped') return { label: '出荷済み', cls: 'bg-green-400/10 text-green-400' }
    if (s === 'partial') return { label: '一部出荷', cls: 'bg-amber-400/10 text-amber-400' }
    if (s === 'Canceled') return { label: 'キャンセル', cls: 'bg-red-400/10 text-red-400' }
    return { label: '準備中', cls: 'bg-white/5 text-white/50' }
  }

  const yen = (v: string) => `¥${Number(v || 0).toLocaleString('ja-JP')}`

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-2 border-[#c8a960] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 会員の状態（LINE連携） */}
      <section className="rounded-2xl bg-[#151515] border border-white/10 p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-lg font-bold text-white truncate">{displayName(user)}</p>
            <div className="flex items-center gap-1.5 mt-1">
              {lineLinked ? (
                <>
                  <CheckCircle size={14} className="text-[#06C755]" />
                  <span className="text-xs text-[#06C755]">LINE連携済み・通知が届きます</span>
                </>
              ) : (
                <>
                  <MessageCircle size={14} className="text-white/40" />
                  <span className="text-xs text-white/40">LINE未連携</span>
                </>
              )}
            </div>
          </div>
          {!lineLinked && (
            <Link
              to="/my-fitpeak/account"
              className="shrink-0 px-4 py-2.5 rounded-lg bg-[#06C755] hover:bg-[#05b34c] text-white text-sm font-semibold transition"
            >
              LINEと連携
            </Link>
          )}
        </div>
      </section>

      {/* 注文 */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-base font-bold text-white">ご注文</h1>
          <button
            type="button"
            onClick={() => setAmazonOpen((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs text-white/50 hover:text-white hover:bg-white/5 transition"
          >
            <Plus size={14} />
            Amazonの注文を追加
          </button>
        </div>

        {amazonOpen && (
          <div className="rounded-xl bg-[#151515] border border-white/10 p-4 mb-4">
            <p className="text-xs text-white/40 mb-2">Amazonの注文番号を入力すると、ここに並べて追跡できます</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={amazonInput}
                onChange={(e) => { setAmazonInput(e.target.value); setAmazonError('') }}
                onKeyDown={(e) => e.key === 'Enter' && handleAmazonSearch()}
                placeholder="例: 250-1234567-1234567"
                className="flex-1 min-w-0 px-4 py-3 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/20 text-sm focus:outline-none focus:border-[#FF9900]/50 transition"
              />
              <button
                onClick={handleAmazonSearch}
                disabled={amazonSearching || !amazonInput.trim()}
                className="px-4 py-3 rounded-lg bg-[#FF9900] hover:bg-[#e88d00] text-black text-sm font-semibold transition disabled:opacity-40 flex items-center gap-1.5"
              >
                <Search size={16} />
                {amazonSearching ? '検索中' : '追加'}
              </button>
            </div>
            {amazonError && <p className="text-red-400 text-xs mt-2">{amazonError}</p>}
          </div>
        )}

        {allOrders.length === 0 ? (
          <div className="rounded-2xl bg-[#151515] border border-white/10 text-center py-14 px-6">
            <Package size={36} className="mx-auto text-white/15 mb-4" />
            <p className="text-white/60 text-sm">ご注文はまだありません</p>
            <p className="text-white/30 text-xs mt-1.5">
              公式サイトでのご注文がここに表示されます。Amazonでのご注文は上のボタンから追加できます。
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {allOrders.map((order) => {
              const badge = statusBadge(order)
              const isAmazon = order.source === 'amazon'
              const body = (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${badge.cls}`}>
                          {badge.label}
                        </span>
                        <span className="text-[10px] text-white/30">
                          {isAmazon ? 'Amazon' : '公式サイト'}
                        </span>
                        <span className="text-[10px] text-white/30">
                          {new Date(order.date).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })}
                        </span>
                      </div>
                      <div className="mt-2 space-y-0.5">
                        {order.items.map((item, i) => (
                          <p key={i} className="text-sm text-white/80 truncate">
                            {item.title}{item.variant ? `（${item.variant}）` : ''}
                            {item.quantity > 1 && <span className="text-white/40"> × {item.quantity}</span>}
                          </p>
                        ))}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold text-white">{yen(order.total)}</p>
                      <p className="text-[10px] text-white/30 mt-0.5">{order.name}</p>
                    </div>
                  </div>

                  {order.trackingNumber && (
                    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/5">
                      <Truck size={14} className="text-white/40" />
                      <span className="text-xs text-white/50">
                        {order.trackingCompany} {order.trackingNumber}
                      </span>
                    </div>
                  )}
                </>
              )

              if (isAmazon) {
                return (
                  <div key={`amazon-${order.id}`} className="relative p-4 sm:p-5 rounded-xl bg-[#151515] border border-white/10">
                    <button
                      type="button"
                      onClick={() => setAmazonOrders((prev) => prev.filter((o) => o.name !== order.name))}
                      className="absolute top-3 right-3 p-2 rounded-lg text-white/20 hover:text-white/60 hover:bg-white/5 transition"
                      aria-label="このAmazon注文を一覧から外す"
                    >
                      <X size={14} />
                    </button>
                    {body}
                    <a
                      href={`https://www.amazon.co.jp/gp/your-account/order-details?orderID=${order.name}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block text-xs text-[#FF9900] hover:underline mt-3"
                    >
                      Amazonで注文詳細を見る
                    </a>
                  </div>
                )
              }

              return (
                <Link
                  key={`shopify-${order.id}`}
                  to={`/my-fitpeak/orders/${order.id}`}
                  className="block p-4 sm:p-5 rounded-xl bg-[#151515] border border-white/10 hover:border-white/25 transition"
                >
                  {body}
                  <div className="flex items-center justify-end gap-1 mt-3 text-xs text-white/40">
                    詳細を見る <ChevronRight size={14} />
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
