import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Package, ChevronRight, Truck, Search, ShoppingCart, X } from 'lucide-react'
import { useFitpeakAuth } from './lib/auth'

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

export default function FitpeakOrders() {
  const { user } = useFitpeakAuth()
  const [orders, setOrders] = useState<Order[]>([])
  const [amazonOrders, setAmazonOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [amazonInput, setAmazonInput] = useState('')
  const [amazonSearching, setAmazonSearching] = useState(false)
  const [amazonError, setAmazonError] = useState('')

  useEffect(() => {
    async function load() {
      if (!user?.email) return
      try {
        const res = await fetch(`/api/my-fitpeak/orders?email=${encodeURIComponent(user.email)}&limit=20`)
        if (res.ok) {
          const data = await res.json()
          setOrders((data.orders || []).map((o: Order) => ({ ...o, source: 'shopify' })))
        }
      } catch { /* ignore */ }
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
      const res = await fetch('/api/my-fitpeak/amazon-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: id }),
      })
      const data = await res.json()
      if (!res.ok) {
        setAmazonError(data.error || '検索に失敗しました')
      } else {
        const exists = amazonOrders.some((o) => o.name === data.name)
        if (!exists) {
          setAmazonOrders((prev) => [{ ...data, source: 'amazon' }, ...prev])
        }
        setAmazonInput('')
      }
    } catch {
      setAmazonError('検索に失敗しました')
    }
    setAmazonSearching(false)
  }

  const removeAmazonOrder = (name: string) => {
    setAmazonOrders((prev) => prev.filter((o) => o.name !== name))
  }

  const allOrders = [...amazonOrders, ...orders].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  )

  const statusBadge = (s: string, source?: string) => {
    if (source === 'amazon') {
      if (s === 'Shipped') return { label: '出荷済み', cls: 'bg-green-400/10 text-green-400' }
      if (s === 'Unshipped') return { label: '未出荷', cls: 'bg-yellow-400/10 text-yellow-400' }
      if (s === 'Canceled') return { label: 'キャンセル', cls: 'bg-red-400/10 text-red-400' }
      return { label: s, cls: 'bg-white/5 text-white/40' }
    }
    if (s === 'fulfilled') return { label: '出荷済み', cls: 'bg-green-400/10 text-green-400' }
    if (s === 'partial') return { label: '一部出荷', cls: 'bg-yellow-400/10 text-yellow-400' }
    return { label: '未出荷', cls: 'bg-white/5 text-white/40' }
  }

  const sourceBadge = (source?: string) => {
    if (source === 'amazon') return { label: 'Amazon', cls: 'bg-[#FF9900]/10 text-[#FF9900]' }
    return { label: '公式サイト', cls: 'bg-[#c8a960]/10 text-[#c8a960]' }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-[#c8a960] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-white mb-6">注文履歴</h1>

      <div className="bg-[#151515] border border-white/10 rounded-xl p-5 mb-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 rounded-lg bg-[#FF9900]/10">
            <ShoppingCart size={18} className="text-[#FF9900]" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Amazon注文を追跡</h2>
            <p className="text-xs text-white/40">Amazonの注文番号を入力して追加</p>
          </div>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={amazonInput}
            onChange={(e) => { setAmazonInput(e.target.value); setAmazonError('') }}
            onKeyDown={(e) => e.key === 'Enter' && handleAmazonSearch()}
            placeholder="例: 250-1234567-1234567"
            className="flex-1 px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/20 text-sm focus:outline-none focus:border-[#FF9900]/50 focus:ring-1 focus:ring-[#FF9900]/30 transition"
          />
          <button
            onClick={handleAmazonSearch}
            disabled={amazonSearching || !amazonInput.trim()}
            className="px-4 py-2.5 rounded-lg bg-[#FF9900] hover:bg-[#e88d00] text-black text-sm font-semibold transition disabled:opacity-40 flex items-center gap-2"
          >
            <Search size={16} />
            {amazonSearching ? '...' : '検索'}
          </button>
        </div>
        {amazonError && (
          <p className="text-red-400 text-xs mt-2">{amazonError}</p>
        )}
      </div>

      {allOrders.length === 0 ? (
        <div className="text-center py-20">
          <Package size={40} className="mx-auto text-white/20 mb-4" />
          <p className="text-white/40 text-sm">注文履歴がありません</p>
        </div>
      ) : (
        <div className="space-y-4">
          {allOrders.map((order) => {
            const badge = statusBadge(order.source === 'amazon' ? order.status : order.fulfillmentStatus, order.source)
            const sBadge = sourceBadge(order.source)
            const isAmazon = order.source === 'amazon'

            return (
              <div
                key={`${order.source}-${order.id}`}
                className="block p-5 rounded-xl bg-[#151515] border border-white/10 hover:border-white/20 transition"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-white">{order.name}</span>
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${sBadge.cls}`}>
                        {sBadge.label}
                      </span>
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </div>
                    <span className="text-xs text-white/30 mt-1 block">
                      {new Date(order.date).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white/60">{order.total}円</span>
                    {isAmazon ? (
                      <button
                        onClick={() => removeAmazonOrder(order.name)}
                        className="p-1 rounded text-white/20 hover:text-white/50 transition"
                        title="削除"
                      >
                        <X size={14} />
                      </button>
                    ) : (
                      <Link to={`/my-fitpeak/orders/${order.id}`}>
                        <ChevronRight size={16} className="text-white/20 hover:text-[#c8a960] transition" />
                      </Link>
                    )}
                  </div>
                </div>

                <div className="space-y-1">
                  {order.items.map((item, i) => (
                    <p key={i} className="text-xs text-white/50">
                      {item.title}{item.variant ? ` (${item.variant})` : ''} x{item.quantity}
                    </p>
                  ))}
                </div>

                {order.trackingNumber && (
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/5">
                    <Truck size={14} className="text-blue-400" />
                    <span className="text-xs text-white/40">
                      {order.trackingCompany} {order.trackingNumber}
                    </span>
                  </div>
                )}

                {isAmazon && (
                  <div className="mt-3 pt-3 border-t border-white/5">
                    <a
                      href={`https://www.amazon.co.jp/gp/your-account/order-details?orderID=${order.name}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-[#FF9900] hover:underline"
                    >
                      Amazonで注文詳細を確認
                    </a>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
