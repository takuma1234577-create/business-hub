import { useEffect, useState } from 'react'
import { Star, LayoutGrid, Trash2, ExternalLink, Loader2 } from 'lucide-react'
import { fitpeakSupabase } from './lib/supabase'

// FITPEAK NAVI (navi.fitpeak.co) で保存した「部屋の配置」と「商品」。保存したご本人のアカウントだけが読み書きできる(RLS)。
const NAVI = 'https://navi.fitpeak.co'

interface SavedLayout {
  id: string; name: string; total_price: number; item_count: number; room_w: number | null; room_d: number | null; created_at: string
  summary: { id: string; title: string; price: number; image: string | null; category: string }[]
}
interface SavedProduct { id: string; product_id: string; title: string; image: string | null; price: number; navi_score: number | null; category: string | null; created_at: string }

const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`
const date = (s: string) => new Date(s).toLocaleDateString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric' })
const safeImg = (u: string | null) => (u && /^https:\/\//.test(u) ? u : null)

export default function FitpeakSaved() {
  const [layouts, setLayouts] = useState<SavedLayout[]>([])
  const [products, setProducts] = useState<SavedProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [l, p] = await Promise.all([
        fitpeakSupabase.from('shop_saved_layouts').select('id,name,total_price,item_count,room_w,room_d,created_at,summary').order('created_at', { ascending: false }),
        fitpeakSupabase.from('shop_saved_products').select('id,product_id,title,image,price,navi_score,category,created_at').order('created_at', { ascending: false }),
      ])
      if (!alive) return
      if (l.error || p.error) setError('保存した内容を読み込めませんでした。時間をおいて再読み込みしてください。')
      setLayouts((l.data as SavedLayout[]) ?? [])
      setProducts((p.data as SavedProduct[]) ?? [])
      setLoading(false)
    })()
    return () => { alive = false }
  }, [])

  const removeLayout = async (id: string) => {
    if (!confirm('この配置を削除しますか？')) return
    const { error } = await fitpeakSupabase.from('shop_saved_layouts').delete().eq('id', id)
    if (error) setError('削除できませんでした。'); else setLayouts(a => a.filter(x => x.id !== id))
  }
  const removeProduct = async (id: string) => {
    const { error } = await fitpeakSupabase.from('shop_saved_products').delete().eq('id', id)
    if (error) setError('削除できませんでした。'); else setProducts(a => a.filter(x => x.id !== id))
  }

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="animate-spin text-[#c8a960]" /></div>

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-xl font-bold text-white">保存</h1>
        <p className="text-xs text-white/40 mt-1">FITPEAK NAVI で保存した、部屋の配置とお気に入りの商品です。</p>
      </div>
      {error && <p className="text-sm text-red-400" role="alert">{error}</p>}

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-white"><LayoutGrid size={18} className="text-[#c8a960]" /> 保存した配置 <span className="text-xs font-normal text-white/40">{layouts.length}件</span></h2>
          <a href={`${NAVI}/room-sim`} className="text-xs text-[#c8a960] hover:underline">新しく配置する</a>
        </div>
        {layouts.length === 0 ? (
          <p className="text-sm text-white/40 p-6 rounded-xl bg-[#151515] border border-white/10">まだ保存した配置がありません。3Dシミュレーターで「この配置を保存する」を押すと、ここに表示されます。</p>
        ) : (
          <div className="space-y-3">
            {layouts.map(l => (
              <div key={l.id} className="p-4 rounded-xl bg-[#151515] border border-white/10">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-white truncate">{l.name || '保存した配置'}</h3>
                    <p className="text-xs text-white/40 mt-0.5">{date(l.created_at)} · {l.item_count}点{l.room_w && l.room_d ? ` · ${l.room_w}×${l.room_d}cm` : ''}</p>
                  </div>
                  <p className="text-base font-bold text-[#c8a960] whitespace-nowrap">{yen(l.total_price)}</p>
                </div>
                <div className="flex gap-2 mt-3 overflow-x-auto">
                  {l.summary.slice(0, 8).map((s, i) => (
                    <a key={s.id + i} href={`${NAVI}/p/${encodeURIComponent(s.id)}`} target="_blank" rel="noopener noreferrer" title={s.title} className="shrink-0 w-14">
                      {safeImg(s.image) ? <img src={safeImg(s.image)!} alt="" className="w-14 h-14 object-contain rounded-lg bg-white" /> : <div className="w-14 h-14 rounded-lg bg-white/5" />}
                    </a>
                  ))}
                </div>
                <ul className="mt-3 space-y-1">
                  {l.summary.map((s, i) => <li key={s.id + i} className="flex justify-between gap-3 text-xs text-white/60"><span className="truncate">{s.title}</span><span className="whitespace-nowrap">{yen(s.price)}</span></li>)}
                </ul>
                <div className="flex gap-2 mt-4">
                  <a href={`${NAVI}/room-sim?saved=${l.id}&items=${encodeURIComponent(l.summary.map(s => s.id).join(','))}`} className="flex-1 text-center text-sm font-semibold py-2.5 rounded-lg bg-[#c8a960] text-black hover:opacity-90">3Dで開く</a>
                  <button onClick={() => removeLayout(l.id)} aria-label="この配置を削除" className="px-3 rounded-lg border border-white/10 text-white/50 hover:text-red-400"><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="flex items-center gap-2 text-base font-semibold text-white mb-4"><Star size={18} className="text-[#c8a960]" /> 保存した商品 <span className="text-xs font-normal text-white/40">{products.length}件</span></h2>
        {products.length === 0 ? (
          <p className="text-sm text-white/40 p-6 rounded-xl bg-[#151515] border border-white/10">まだ保存した商品がありません。3Dシミュレーターで商品を選び、星マークを押すと、ここに表示されます。</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {products.map(p => (
              <div key={p.id} className="flex gap-3 p-3 rounded-xl bg-[#151515] border border-white/10">
                {safeImg(p.image) ? <img src={safeImg(p.image)!} alt="" className="w-20 h-20 object-contain rounded-lg bg-white shrink-0" /> : <div className="w-20 h-20 rounded-lg bg-white/5 shrink-0" />}
                <div className="min-w-0 flex-1 flex flex-col">
                  <p className="text-xs text-white line-clamp-2">{p.title}</p>
                  <p className="text-sm font-bold text-[#c8a960] mt-1">{yen(p.price)}</p>
                  {p.navi_score != null && <p className="text-[11px] text-white/40">FITPEAK NAVIスコア {p.navi_score} / 100</p>}
                  <div className="flex items-center gap-3 mt-auto pt-2">
                    <a href={`${NAVI}/p/${encodeURIComponent(p.product_id)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-[#c8a960] hover:underline">購入先を見る <ExternalLink size={12} /></a>
                    <button onClick={() => removeProduct(p.id)} className="ml-auto text-xs text-white/40 hover:text-red-400">保存を外す</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
