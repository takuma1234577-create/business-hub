import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Package, Truck, MapPin, CheckCircle } from 'lucide-react'
import { useFitpeakAuth } from './lib/auth'

interface OrderDetail {
  id: number
  name: string
  date: string
  total: string
  status: string
  fulfillmentStatus: string
  items: { title: string; quantity: number; price: string; variant?: string; sku?: string }[]
  shippingAddress: { name: string; address1: string; city: string; province: string; zip: string } | null
  fulfillments: {
    status: string
    shipmentStatus: string
    trackingCompany: string
    trackingNumber: string
    trackingUrl: string
    createdAt: string
  }[]
}

const SHIPMENT_LABELS: Record<string, string> = {
  confirmed: '配送業者に引き渡し済み',
  in_transit: '配送中',
  out_for_delivery: '配達中',
  delivered: '配達完了',
  failure: '配達失敗',
  attempted_delivery: '配達試行(不在)',
}

export default function FitpeakOrderDetail() {
  const { id } = useParams()
  const { user } = useFitpeakAuth()
  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      if (!user?.email || !id) return
      try {
        const res = await fetch(`/api/my-fitpeak/orders/${id}?email=${encodeURIComponent(user.email)}`)
        if (res.ok) {
          setOrder(await res.json())
        }
      } catch { /* ignore */ }
      setLoading(false)
    }
    load()
  }, [user, id])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-[#c8a960] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!order) {
    return (
      <div className="text-center py-20">
        <p className="text-white/40">注文が見つかりません</p>
        <Link to="/my-fitpeak/orders" className="text-[#c8a960] text-sm hover:underline mt-2 inline-block">注文履歴に戻る</Link>
      </div>
    )
  }

  return (
    <div>
      <Link to="/my-fitpeak/orders" className="inline-flex items-center gap-2 text-white/40 hover:text-white text-sm mb-6 transition">
        <ArrowLeft size={16} /> 注文履歴に戻る
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">{order.name}</h1>
          <p className="text-xs text-white/30 mt-1">
            {new Date(order.date).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <span className="text-lg font-semibold text-white">{order.total}円</span>
      </div>

      <section className="bg-[#151515] border border-white/10 rounded-xl p-5 mb-4">
        <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <Package size={16} className="text-[#c8a960]" /> 注文商品
        </h2>
        <div className="space-y-3">
          {order.items.map((item, i) => (
            <div key={i} className="flex items-center justify-between">
              <div>
                <p className="text-sm text-white">{item.title}</p>
                {item.variant && <p className="text-xs text-white/40">{item.variant}</p>}
              </div>
              <div className="text-right">
                <p className="text-sm text-white/60">{item.price}円</p>
                <p className="text-xs text-white/30">x{item.quantity}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {order.shippingAddress && (
        <section className="bg-[#151515] border border-white/10 rounded-xl p-5 mb-4">
          <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <MapPin size={16} className="text-blue-400" /> 配送先
          </h2>
          <p className="text-sm text-white/60">
            {order.shippingAddress.name}<br />
            {order.shippingAddress.zip} {order.shippingAddress.province}{order.shippingAddress.city}{order.shippingAddress.address1}
          </p>
        </section>
      )}

      {order.fulfillments.length > 0 && (
        <section className="bg-[#151515] border border-white/10 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Truck size={16} className="text-green-400" /> 配送状況
          </h2>
          {order.fulfillments.map((f, i) => (
            <div key={i} className="space-y-3">
              <div className="flex items-center gap-3">
                <CheckCircle size={16} className={f.shipmentStatus === 'delivered' ? 'text-green-400' : 'text-white/20'} />
                <div>
                  <p className="text-sm text-white font-medium">
                    {SHIPMENT_LABELS[f.shipmentStatus] || f.shipmentStatus || '確認中'}
                  </p>
                  <p className="text-xs text-white/40">
                    {f.trackingCompany} / {f.trackingNumber}
                  </p>
                </div>
              </div>
              {f.trackingUrl && (
                <a
                  href={f.trackingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-xs text-[#c8a960] hover:underline"
                >
                  追跡情報を確認する
                </a>
              )}
              <p className="text-xs text-white/30">
                出荷日: {new Date(f.createdAt).toLocaleDateString('ja-JP')}
              </p>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
