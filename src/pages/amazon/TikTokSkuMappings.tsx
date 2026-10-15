import { useState, useEffect } from 'react'
import { Music2, RefreshCw, CheckCircle2, Wand2 } from 'lucide-react'
import { skuMappingApi, tiktokProductApi } from './api'
import type { SkuMapping } from './types'
import type { AmazonSku, TikTokSku } from './api'

// TikTok Shop のSKUを Amazon(FBA) のSKUに対応付ける。対応付けたSKUは10分ごとに在庫がFBAに合わせられ、
// 注文はAmazon MCFで自動出荷される。
export default function TikTokSkuMappings({ mappings, amazonSkus, onChanged }: {
  mappings: SkuMapping[]
  amazonSkus: AmazonSku[]
  onChanged: () => Promise<void> | void
}) {
  const [skus, setSkus] = useState<TikTokSku[]>([])
  const [connected, setConnected] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await tiktokProductApi.list()
      setConnected(res.connected)
      setSkus(res.skus)
    } catch (err: any) {
      setError(err.message)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const tiktokMappings = mappings.filter(m => m.channel === 'TIKTOK')
  const mappingFor = (s: TikTokSku) => tiktokMappings.find(m => m.channelSku === s.skuId || (s.sellerSku && m.channelSku === s.sellerSku))

  const link = async (s: TikTokSku, amazonSku: string) => {
    setSaving(s.skuId)
    setError('')
    try {
      const existing = mappingFor(s)
      if (existing) await skuMappingApi.delete(existing.id)
      if (amazonSku) await skuMappingApi.create({ channel: 'TIKTOK', channelSku: s.skuId, amazonSku })
      await onChanged()
    } catch (err: any) {
      setError(err.message)
    }
    setSaving(null)
  }

  // TikTokの出品者SKUがAmazonのSKUと同じものをまとめて対応付ける
  const autoLink = async () => {
    const amazonSet = new Set(amazonSkus.map(a => a.sellerSku))
    const targets = skus.filter(s => !mappingFor(s) && s.sellerSku && amazonSet.has(s.sellerSku))
    for (const s of targets) await link(s, s.sellerSku)
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
      <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
          <Music2 size={16} />
          TikTok Shop の対応付け
          <span className="text-xs font-normal text-slate-400">({tiktokMappings.length}/{skus.length})</span>
        </h3>
        <div className="flex items-center gap-2">
          <button onClick={autoLink} disabled={loading || skus.length === 0} className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800 transition disabled:opacity-50 cursor-pointer">
            <Wand2 size={12} />
            同じSKUを自動で対応付け
          </button>
          <button onClick={load} disabled={loading} className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800 transition disabled:opacity-50 cursor-pointer">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            再取得
          </button>
        </div>
      </div>
      {error && <p className="px-4 py-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      {connected === false ? (
        <p className="px-4 py-8 text-center text-sm text-slate-400">TikTok Shop が未連携です。API設定から連携してください。</p>
      ) : (
        <div className="max-h-80 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0">
              <tr className="bg-slate-50 dark:bg-slate-800">
                <th className="text-left px-4 py-2 text-slate-500 font-medium">商品名</th>
                <th className="text-left px-4 py-2 text-slate-500 font-medium">SKU</th>
                <th className="text-right px-4 py-2 text-slate-500 font-medium">在庫</th>
                <th className="text-left px-4 py-2 text-slate-500 font-medium">Amazon SKU</th>
              </tr>
            </thead>
            <tbody>
              {skus.map(s => {
                const mapped = mappingFor(s)
                return (
                  <tr key={s.skuId} className="border-t border-slate-50 dark:border-slate-800">
                    <td className="px-4 py-2 text-slate-700 dark:text-slate-300 truncate max-w-[220px]"><span translate="no">{s.title}</span></td>
                    <td className="px-4 py-2 font-mono text-slate-500">{s.sellerSku || s.skuId}</td>
                    <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-400">{s.quantity}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1.5">
                        {mapped && <CheckCircle2 size={12} className="text-green-600 dark:text-green-400 shrink-0" />}
                        <select
                          value={mapped?.amazonSku || ''}
                          disabled={saving === s.skuId}
                          onChange={e => link(s, e.target.value)}
                          className="w-full max-w-[260px] px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-mono"
                        >
                          <option value="">未紐付け</option>
                          {amazonSkus.map(a => (
                            <option key={a.sellerSku} value={a.sellerSku}>{a.sellerSku} {a.variation || a.productName}</option>
                          ))}
                        </select>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {connected && skus.length === 0 && !loading && (
            <p className="px-4 py-8 text-center text-sm text-slate-400">TikTok Shop に出品中の商品がありません</p>
          )}
        </div>
      )}
    </div>
  )
}
