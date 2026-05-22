import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Package, Truck, MessageCircle, ChevronRight } from 'lucide-react'
import { useFitpeakAuth } from './lib/auth'
import { fitpeakSupabase } from './lib/supabase'

interface RecentOrder {
  name: string
  date: string
  total: string
  status: string
  items: string
}

export default function FitpeakDashboard() {
  const { user } = useFitpeakAuth()
  const [orders, setOrders] = useState<RecentOrder[]>([])
  const [lineLinked, setLineLinked] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      if (!user?.email) return

      try {
        const res = await fetch(`/api/my-fitpeak/orders?email=${encodeURIComponent(user.email)}&limit=3`)
        if (res.ok) {
          const data = await res.json()
          setOrders(data.orders || [])
        }
      } catch { /* ignore */ }

      try {
        const { data } = await fitpeakSupabase
          .from('line_shopify_links')
          .select('id')
          .eq('shopify_email', user.email)
          .maybeSingle()
        setLineLinked(!!data)
      } catch { /* ignore */ }

      setLoading(false)
    }
    load()
  }, [user])

  const statusColor = (s: string) => {
    if (s === 'fulfilled' || s === '出荷済み') return 'text-green-400'
    if (s === 'unfulfilled' || s === '未出荷' || !s) return 'text-yellow-400'
    return 'text-white/60'
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-[#c8a960] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold text-white">マイページ</h1>
        <p className="text-white/40 text-sm mt-1">{user?.email}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Link
          to="/my-fitpeak/orders"
          className="flex items-center gap-4 p-5 rounded-xl bg-[#151515] border border-white/10 hover:border-[#c8a960]/30 transition group"
        >
          <div className="p-3 rounded-lg bg-[#c8a960]/10">
            <Package size={22} className="text-[#c8a960]" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-white">注文履歴</h3>
            <p className="text-xs text-white/40 mt-0.5">{orders.length > 0 ? `${orders.length}件の注文` : '注文を確認'}</p>
          </div>
          <ChevronRight size={16} className="text-white/20 group-hover:text-[#c8a960] transition" />
        </Link>

        <Link
          to="/my-fitpeak/orders"
          className="flex items-center gap-4 p-5 rounded-xl bg-[#151515] border border-white/10 hover:border-[#c8a960]/30 transition group"
        >
          <div className="p-3 rounded-lg bg-blue-500/10">
            <Truck size={22} className="text-blue-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-white">配送状況</h3>
            <p className="text-xs text-white/40 mt-0.5">追跡情報を確認</p>
          </div>
          <ChevronRight size={16} className="text-white/20 group-hover:text-blue-400 transition" />
        </Link>

        <Link
          to="/my-fitpeak/line"
          className="flex items-center gap-4 p-5 rounded-xl bg-[#151515] border border-white/10 hover:border-[#06C755]/30 transition group"
        >
          <div className="p-3 rounded-lg bg-[#06C755]/10">
            <MessageCircle size={22} className="text-[#06C755]" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-white">LINE連携</h3>
            <p className="text-xs text-white/40 mt-0.5">
              {lineLinked ? '連携済み' : '通知を受け取る'}
            </p>
          </div>
          <ChevronRight size={16} className="text-white/20 group-hover:text-[#06C755] transition" />
        </Link>
      </div>

      {orders.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-white">最近のご注文</h2>
            <Link to="/my-fitpeak/orders" className="text-xs text-[#c8a960] hover:underline">すべて見る</Link>
          </div>
          <div className="space-y-3">
            {orders.map((order) => (
              <div
                key={order.name}
                className="p-4 rounded-xl bg-[#151515] border border-white/10"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-white">{order.name}</span>
                  <span className={`text-xs font-medium ${statusColor(order.status)}`}>
                    {order.status || '未出荷'}
                  </span>
                </div>
                <p className="text-xs text-white/40">{order.items}</p>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-white/30">
                    {new Date(order.date).toLocaleDateString('ja-JP')}
                  </span>
                  <span className="text-sm text-white/60">{order.total}円</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
