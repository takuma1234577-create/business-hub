import { useState, useEffect } from 'react'
import {
  Plus,
  Trash2,
  ShoppingBag,
  Music,
  Loader2,
  Link,
  RefreshCw,
  Package,
  Search,
} from 'lucide-react'
import { skuMappingApi, amazonSkuApi } from './api'
import type { SkuMapping, Channel } from './types'
import type { AmazonSku } from './api'

export default function SkuMappings() {
  const [mappings, setMappings] = useState<SkuMapping[]>([])
  const [amazonSkus, setAmazonSkus] = useState<AmazonSku[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingSkus, setLoadingSkus] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Form state
  const [channel, setChannel] = useState<Channel>('SHOPIFY')
  const [channelSku, setChannelSku] = useState('')
  const [amazonSku, setAmazonSku] = useState('')
  const [skuSearch, setSkuSearch] = useState('')

  const fetchMappings = async () => {
    setLoading(true)
    try {
      const data = await skuMappingApi.list()
      setMappings(data)
    } catch (err) {
      console.error('Failed to fetch SKU mappings', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchAmazonSkus = async () => {
    setLoadingSkus(true)
    setMessage(null)
    try {
      const skus = await amazonSkuApi.list()
      setAmazonSkus(skus)
      setMessage({ type: 'success', text: `Amazon FBAから${skus.length}件のSKUを取得しました` })
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Amazon SKU取得に失敗しました' })
    } finally {
      setLoadingSkus(false)
    }
  }

  useEffect(() => {
    fetchMappings()
    fetchAmazonSkus()
  }, [])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    setMessage(null)

    if (!channelSku.trim() || !amazonSku.trim()) {
      setMessage({ type: 'error', text: '全てのフィールドを入力してください' })
      return
    }

    setSubmitting(true)
    try {
      await skuMappingApi.create({
        channel,
        channelSku: channelSku.trim(),
        amazonSku: amazonSku.trim(),
      })
      setChannelSku('')
      setAmazonSku('')
      setSkuSearch('')
      await fetchMappings()
      setMessage({ type: 'success', text: 'SKUマッピングを追加しました' })
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '追加に失敗しました' })
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このマッピングを削除しますか？')) return

    setDeleting(id)
    try {
      await skuMappingApi.delete(id)
      await fetchMappings()
    } catch (err) {
      console.error('Failed to delete mapping', err)
    } finally {
      setDeleting(null)
    }
  }

  const filteredAmazonSkus = skuSearch
    ? amazonSkus.filter(s =>
        s.sellerSku.toLowerCase().includes(skuSearch.toLowerCase()) ||
        s.productName.toLowerCase().includes(skuSearch.toLowerCase()) ||
        s.asin.toLowerCase().includes(skuSearch.toLowerCase())
      )
    : amazonSkus

  const selectedAmazonSku = amazonSkus.find(s => s.sellerSku === amazonSku)

  return (
    <div className="space-y-6">
      {/* Message */}
      {message && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-50 text-green-800 dark:bg-green-950/50 dark:text-green-300 border border-green-200 dark:border-green-800' : 'bg-red-50 text-red-800 dark:bg-red-950/50 dark:text-red-300 border border-red-200 dark:border-red-800'}`}>
          {message.text}
          <button onClick={() => setMessage(null)} className="ml-auto text-xs opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Amazon SKU List */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
            <Package size={16} className="text-[#FF9900]" />
            Amazon FBA SKU一覧
            {amazonSkus.length > 0 && <span className="text-xs font-normal text-slate-400">({amazonSkus.length}件)</span>}
          </h3>
          <button
            onClick={fetchAmazonSkus}
            disabled={loadingSkus}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw size={14} className={loadingSkus ? 'animate-spin' : ''} />
            {loadingSkus ? '取得中...' : '再取得'}
          </button>
        </div>

        {amazonSkus.length > 0 && (
          <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-100 dark:border-slate-800">
            <table className="w-full text-xs">
              <thead className="sticky top-0">
                <tr className="bg-slate-50 dark:bg-slate-800">
                  <th className="text-left px-3 py-2 text-slate-500 font-medium">SKU</th>
                  <th className="text-left px-3 py-2 text-slate-500 font-medium">ASIN</th>
                  <th className="text-left px-3 py-2 text-slate-500 font-medium">商品名</th>
                  <th className="text-right px-3 py-2 text-slate-500 font-medium">出荷可能</th>
                  <th className="text-right px-3 py-2 text-slate-500 font-medium">合計</th>
                </tr>
              </thead>
              <tbody>
                {amazonSkus.map(sku => (
                  <tr key={sku.sellerSku} className="border-t border-slate-50 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-3 py-2 font-mono text-slate-700 dark:text-slate-300">{sku.sellerSku}</td>
                    <td className="px-3 py-2 font-mono text-slate-500">{sku.asin}</td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-400 truncate max-w-[250px]">{sku.productName || '-'}</td>
                    <td className={`px-3 py-2 text-right font-medium ${sku.fulfillableQuantity === 0 ? 'text-red-500' : sku.fulfillableQuantity <= 5 ? 'text-yellow-600' : 'text-green-600'}`}>
                      {sku.fulfillableQuantity}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-500">{sku.totalQuantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {loadingSkus && amazonSkus.length === 0 && (
          <div className="flex items-center justify-center py-8 text-slate-400">
            <Loader2 size={20} className="animate-spin mr-2" />
            Amazon FBAからSKUを取得中...
          </div>
        )}
      </div>

      {/* Add Form */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4 flex items-center gap-2">
          <Plus size={16} />
          新規マッピング追加
        </h3>

        <form onSubmit={handleAdd} className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500 dark:text-slate-400">チャネル</label>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value as Channel)}
                className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="SHOPIFY">Shopify</option>
                <option value="TIKTOK">TikTok</option>
              </select>
            </div>

            <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
              <label className="text-xs text-slate-500 dark:text-slate-400">チャネルSKU</label>
              <input
                type="text"
                value={channelSku}
                onChange={(e) => setChannelSku(e.target.value)}
                placeholder="例: SHOP-SKU-001"
                className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-300 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex flex-col gap-1 flex-1 min-w-[200px] relative">
              <label className="text-xs text-slate-500 dark:text-slate-400">Amazon SKU</label>
              {amazonSkus.length > 0 ? (
                <div className="relative">
                  <div className="flex items-center gap-1">
                    <div className="relative flex-1">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        value={skuSearch || amazonSku}
                        onChange={(e) => { setSkuSearch(e.target.value); setAmazonSku(''); }}
                        onFocus={() => { if (amazonSku) { setSkuSearch(amazonSku); setAmazonSku(''); } }}
                        placeholder="SKU/ASIN/商品名で検索..."
                        className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-300 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#FF9900]"
                      />
                    </div>
                  </div>
                  {skuSearch && !amazonSku && (
                    <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg">
                      {filteredAmazonSkus.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-slate-400">該当なし</div>
                      ) : (
                        filteredAmazonSkus.slice(0, 20).map(sku => (
                          <button
                            key={sku.sellerSku}
                            type="button"
                            onClick={() => { setAmazonSku(sku.sellerSku); setSkuSearch(''); }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                          >
                            <span className="font-mono font-medium text-[#FF9900]">{sku.sellerSku}</span>
                            <span className="text-slate-400 truncate flex-1">{sku.productName}</span>
                            <span className="text-slate-400">({sku.fulfillableQuantity})</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                  {amazonSku && selectedAmazonSku && (
                    <p className="mt-1 text-xs text-slate-400 truncate">{selectedAmazonSku.productName} (在庫: {selectedAmazonSku.fulfillableQuantity})</p>
                  )}
                </div>
              ) : (
                <input
                  type="text"
                  value={amazonSku}
                  onChange={(e) => setAmazonSku(e.target.value)}
                  placeholder="例: AMZ-SKU-001"
                  className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-300 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-2"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              追加
            </button>
          </div>
        </form>
      </div>

      {/* Mappings Table */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
            <Link size={16} />
            登録済みマッピング
            {mappings.length > 0 && <span className="text-xs font-normal text-slate-400">({mappings.length}件)</span>}
          </h3>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400 dark:text-slate-500">
            <Loader2 size={24} className="animate-spin mr-2" />
            読み込み中...
          </div>
        ) : mappings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500">
            <Link size={40} className="mb-2" />
            <p>SKUマッピングがありません</p>
            <p className="text-xs mt-1">上のフォームからShopify/TikTokのSKUとAmazon SKUを紐付けてください</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">チャネル</th>
                <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">チャネルSKU</th>
                <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">Amazon SKU</th>
                <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">商品名</th>
                <th className="w-16 px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {mappings.map((mapping) => {
                const amazonInfo = amazonSkus.find(s => s.sellerSku === mapping.amazonSku)
                return (
                  <tr key={mapping.id} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                        {mapping.channel === 'SHOPIFY' ? (
                          <><ShoppingBag size={14} className="text-green-600 dark:text-green-400" /> Shopify</>
                        ) : (
                          <><Music size={14} className="text-pink-600 dark:text-pink-400" /> TikTok</>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-400">{mapping.channelSku}</td>
                    <td className="px-4 py-3 font-mono text-xs text-[#FF9900]">{mapping.amazonSku}</td>
                    <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400 truncate max-w-[200px]">
                      {amazonInfo?.productName || '-'}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleDelete(mapping.id)}
                        disabled={deleting === mapping.id}
                        className="p-1.5 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500 dark:text-red-400 transition-colors cursor-pointer disabled:opacity-50"
                        title="削除"
                      >
                        {deleting === mapping.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
