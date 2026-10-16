import { useEffect, useState } from 'react'
import { Ticket } from 'lucide-react'
import { apiFetch } from './lib/api'

/** 自分のクーポン一覧（旧 my.fitpeak.co/coupons）。サーバーがログインから本人の分だけ返す */
interface Coupon {
  id: string
  coupon_code: string
  discount_amount: number
  status: string
  issued_at: string
  expires_at: string | null
  used_at: string | null
  discountUrl: string | null
}

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')

export default function FitpeakCoupons() {
  const [coupons, setCoupons] = useState<Coupon[] | null>(null)

  useEffect(() => {
    apiFetch('/api/my-fitpeak/coupons').then((r) => r.json()).then((d) => setCoupons(d.coupons || [])).catch(() => setCoupons([]))
  }, [])

  const state = (c: Coupon) => {
    if (c.used_at || c.status === 'used') return { label: '使用済み', usable: false }
    if (c.expires_at && new Date(c.expires_at).getTime() < Date.now()) return { label: '期限切れ', usable: false }
    return { label: '使えます', usable: true }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-[26px] font-bold text-[#111] flex items-center gap-2"><Ticket size={22} /> クーポン</h1>

      {coupons === null ? (
        <div className="flex justify-center py-12"><div className="w-8 h-8 border-2 border-[#111] border-t-transparent rounded-full animate-spin" /></div>
      ) : coupons.length === 0 ? (
        <section className="rounded-[20px] bg-white border border-[#e6e6e6] p-6 text-center text-[14px] text-[#6b6b6b]">
          お持ちのクーポンはありません。
        </section>
      ) : (
        <div className="space-y-3">
          {coupons.map((c) => {
            const s = state(c)
            return (
              <section key={c.id} className={`rounded-[20px] bg-white border border-[#e6e6e6] p-5 ${s.usable ? '' : 'opacity-60'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[22px] font-bold text-[#111]">¥{c.discount_amount.toLocaleString('ja-JP')} OFF</p>
                    <p className="mt-1 text-[14px] font-bold tracking-wider text-[#111]">{c.coupon_code}</p>
                    {c.expires_at && <p className="mt-1 text-[12px] text-[#6b6b6b]">有効期限 {fmt(c.expires_at)}</p>}
                  </div>
                  <span className={`shrink-0 text-[12px] font-bold rounded-full px-2.5 py-1 ${s.usable ? 'bg-[#111] text-white' : 'bg-[#eee] text-[#666]'}`}>{s.label}</span>
                </div>
                {s.usable && c.discountUrl && (
                  <a href={c.discountUrl} className="mt-4 flex items-center justify-center w-full min-h-[48px] rounded-full bg-[#111] text-white text-[14px] font-bold hover:bg-[#333]">
                    クーポンを適用して公式サイトへ
                  </a>
                )}
              </section>
            )
          })}
        </div>
      )}

    </div>
  )
}
