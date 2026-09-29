import { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Package, Truck, MapPin, CheckCircle, RotateCcw, ImagePlus, X } from 'lucide-react'
import { useFitpeakAuth } from './lib/auth'
import { apiFetch } from './lib/api'

interface OrderDetail {
  id: number
  name: string
  date: string
  total: string
  status: string
  fulfillmentStatus: string
  items: { title: string; quantity: number; price: string; variant?: string; sku?: string }[]
  shippingAddress: { name: string; address1: string; city: string; province: string; zip: string } | null
  financialStatus?: string
  returnInfo: ReturnInfo | null
  fulfillments: {
    status: string
    shipmentStatus: string
    trackingCompany: string
    trackingNumber: string
    trackingUrl: string
    createdAt: string
  }[]
}

interface ReturnInfo {
  latest: { requestType: 'return' | 'exchange'; result: 'approved' | 'denied'; shopifyResult: string; message: string; at: string } | null
  approved: boolean
  deadline: { maxDays: number; remaining: number }
  allowedReasons: string[]
  canRequest: boolean
  blockedReason: string | null
}

const REASONS: Record<string, string> = {
  defective: '商品の初期不良（破損・傷など）',
  wrong_item: '届いた商品が注文と異なる（誤送品）',
  size_color_mismatch: 'サイズ・カラーが違う',
  changed_mind: '気が変わった',
  other: 'その他',
}

// スマホ写真は大きいので、送る前に縮小する（サーバーの受け取り上限に収めるため）
function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const max = 1280
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.7))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像を読み込めませんでした')) }
    img.src = url
  })
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

  // 返品・交換の申請
  const [formOpen, setFormOpen] = useState(false)
  const [reqType, setReqType] = useState<'return' | 'exchange'>('return')
  const [reason, setReason] = useState('defective')
  const [detailText, setDetailText] = useState('')
  const [address, setAddress] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [resultMsg, setResultMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    if (!user?.email || !id) return
    try {
      const res = await apiFetch(`/api/my-fitpeak/orders/${id}?email=${encodeURIComponent(user.email)}`)
      if (res.ok) setOrder(await res.json())
    } catch { /* ignore */ }
    setLoading(false)
  }

  useEffect(() => { load() }, [user?.email, id]) // eslint-disable-line react-hooks/exhaustive-deps

  const addImages = async (files: FileList | null) => {
    if (!files) return
    setFormError('')
    const room = 5 - images.length
    try {
      const list = await Promise.all(Array.from(files).slice(0, room).map(compressImage))
      setImages((prev) => [...prev, ...list])
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '画像を追加できませんでした')
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  const submitReturn = async () => {
    setFormError('')
    if (images.length === 0) return setFormError('証拠写真を1枚以上追加してください')
    if (reason === 'other' && !detailText.trim()) return setFormError('「その他」の場合は補足説明を入力してください')
    if (reqType === 'exchange' && !address.trim()) return setFormError('交換の場合は届け先の住所を入力してください')
    setSubmitting(true)
    try {
      const res = await apiFetch(`/api/my-fitpeak/orders/${id}/return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestType: reqType, reason, reasonDetail: detailText.trim() || undefined, shippingAddress: reqType === 'exchange' ? address.trim() : undefined, images }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFormError(data.error || '申請できませんでした')
      } else {
        setResultMsg({ ok: data.result === 'approved', text: data.message || '' })
        setFormOpen(false)
        setImages([])
        await load()
      }
    } catch {
      setFormError('通信に失敗しました。時間をおいて試してください')
    }
    setSubmitting(false)
  }

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
        <Link to="/my-fitpeak" className="text-[#c8a960] text-sm hover:underline mt-2 inline-block">ご注文一覧に戻る</Link>
      </div>
    )
  }

  return (
    <div>
      <Link to="/my-fitpeak" className="inline-flex items-center gap-2 text-white/40 hover:text-white text-sm mb-6 transition">
        <ArrowLeft size={16} /> ご注文一覧に戻る
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">{order.name}</h1>
          <p className="text-xs text-white/30 mt-1">
            {new Date(order.date).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <span className="text-lg font-semibold text-white">¥{Number(order.total || 0).toLocaleString('ja-JP')}</span>
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

      {/* 返品・交換 */}
      <section className="bg-[#151515] border border-white/10 rounded-xl p-5 mt-4">
        <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <RotateCcw size={16} className="text-[#c8a960]" /> 返品・交換
        </h2>

        {resultMsg && (
          <div className={`rounded-lg p-3 mb-4 text-sm ${resultMsg.ok ? 'bg-green-400/10 text-green-300' : 'bg-red-400/10 text-red-300'}`}>
            {resultMsg.ok ? '申請が承認されました。' : '申請は承認されませんでした。'}
            {resultMsg.text && <span className="block text-xs mt-1 opacity-80">{resultMsg.text}</span>}
          </div>
        )}

        {order.returnInfo?.latest && !resultMsg && (
          <div className="mb-4 text-sm">
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${order.returnInfo.latest.result === 'approved' ? 'bg-green-400/10 text-green-400' : 'bg-red-400/10 text-red-400'}`}>
              {order.returnInfo.latest.requestType === 'return' ? '返品' : '交換'}・{order.returnInfo.latest.result === 'approved' ? '承認' : '不承認'}
            </span>
            <span className="text-xs text-white/40 ml-2">{new Date(order.returnInfo.latest.at).toLocaleDateString('ja-JP')}</span>
            {order.returnInfo.latest.message && <p className="text-xs text-white/50 mt-2">{order.returnInfo.latest.message}</p>}
          </div>
        )}

        {!order.returnInfo ? (
          <p className="text-xs text-white/40">返品の状況を取得できませんでした。時間をおいて開き直してください。</p>
        ) : order.returnInfo.canRequest ? (
          <>
            {!formOpen && (
              <>
                <p className="text-xs text-white/40 mb-3">
                  ご購入から{order.returnInfo.deadline.maxDays}日以内（あと{order.returnInfo.deadline.remaining}日）に申請できます。証拠写真をもとにAIが審査し、承認されると返金または交換の手続きに進みます。
                </p>
                <button type="button" onClick={() => setFormOpen(true)} className="w-full py-3 rounded-lg bg-[#c8a960] hover:bg-[#b89a50] text-black text-sm font-semibold transition">
                  返品・交換を申請する
                </button>
              </>
            )}
            {formOpen && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  {(['return', 'exchange'] as const).map((t) => (
                    <button key={t} type="button" onClick={() => setReqType(t)}
                      className={`py-2.5 rounded-lg text-sm border transition ${reqType === t ? 'border-[#c8a960] text-white bg-[#c8a960]/10' : 'border-white/10 text-white/50'}`}>
                      {t === 'return' ? '返品（返金）' : '交換'}
                    </button>
                  ))}
                </div>
                <div>
                  <label className="text-xs text-white/40 block mb-1.5">理由</label>
                  <select value={reason} onChange={(e) => setReason(e.target.value)}
                    className="w-full px-3 py-3 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none">
                    {Object.entries(REASONS).map(([k, v]) => <option key={k} value={k} className="bg-[#151515]">{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-white/40 block mb-1.5">補足（任意。「その他」は必須）</label>
                  <textarea value={detailText} onChange={(e) => setDetailText(e.target.value)} rows={3}
                    className="w-full px-3 py-3 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none" />
                </div>
                {reqType === 'exchange' && (
                  <div>
                    <label className="text-xs text-white/40 block mb-1.5">交換品のお届け先住所</label>
                    <input type="text" value={address} onChange={(e) => setAddress(e.target.value)}
                      className="w-full px-3 py-3 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none" />
                  </div>
                )}
                <div>
                  <label className="text-xs text-white/40 block mb-1.5">証拠写真（最大5枚）</label>
                  <div className="flex flex-wrap gap-2">
                    {images.map((src, i) => (
                      <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-white/10">
                        <img src={src} alt="" className="w-full h-full object-cover" />
                        <button type="button" onClick={() => setImages((p) => p.filter((_, j) => j !== i))}
                          className="absolute top-0.5 right-0.5 p-0.5 rounded bg-black/70 text-white" aria-label="写真を外す"><X size={12} /></button>
                      </div>
                    ))}
                    {images.length < 5 && (
                      <button type="button" onClick={() => fileRef.current?.click()}
                        className="w-16 h-16 rounded-lg border border-dashed border-white/20 text-white/40 flex items-center justify-center">
                        <ImagePlus size={20} />
                      </button>
                    )}
                  </div>
                  <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addImages(e.target.files)} />
                </div>
                {formError && <p className="text-red-400 text-xs">{formError}</p>}
                <div className="flex gap-2">
                  <button type="button" onClick={() => setFormOpen(false)} disabled={submitting}
                    className="px-4 py-3 rounded-lg text-sm text-white/50 border border-white/10">やめる</button>
                  <button type="button" onClick={submitReturn} disabled={submitting}
                    className="flex-1 py-3 rounded-lg bg-[#c8a960] hover:bg-[#b89a50] text-black text-sm font-semibold transition disabled:opacity-50">
                    {submitting ? '審査中…（数十秒かかります）' : '申請して審査を受ける'}
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-white/40">{order.returnInfo.blockedReason}</p>
        )}
      </section>
    </div>
  )
}
