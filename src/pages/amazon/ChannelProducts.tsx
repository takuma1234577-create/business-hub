import { useState, useEffect } from 'react'
import {
  ShoppingBag,
  Loader2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Search,
  Link,
  X,
} from 'lucide-react'
import { shopifyProductApi, amazonSkuApi, skuMappingApi } from './api'
import { smartMatch } from './searchUtils'
import type { ShopifyProduct, AmazonSku } from './api'
import type { SkuMapping } from './types'

export default function ChannelProducts() {
  const [shopifyProducts, setShopifyProducts] = useState<ShopifyProduct[]>([])
  const [amazonSkus, setAmazonSkus] = useState<AmazonSku[]>([])
  const [mappings, setMappings] = useState<SkuMapping[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'linked' | 'unlinked'>('all')
  const [linking, setLinking] = useState<string | null>(null)
  const [amazonSearch, setAmazonSearch] = useState('')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const fetchAll = async () => {
    try {
      const [products, skuRes, maps] = await Promise.all([
        shopifyProductApi.list(),
        amazonSkuApi.list(),
        skuMappingApi.list(),
      ])
      setShopifyProducts(products)
      setAmazonSkus(skuRes.skus)
      setMappings(maps)
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message })
    }
    setLoading(false)
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    await fetchAll()
    setRefreshing(false)
  }

  useEffect(() => { fetchAll() }, [])

  const getMapping = (sp: ShopifyProduct) =>
    mappings.find(m => m.channelSku === sp.sku || m.channelSku === sp.variantId)

  const getAmazonInfo = (amazonSku: string) =>
    amazonSkus.find(s => s.sellerSku === amazonSku)

  const handleLink = async (shopifyKey: string, amazonSku: string) => {
    try {
      await skuMappingApi.create({ channel: 'SHOPIFY', channelSku: shopifyKey, amazonSku })
      setMessage({ type: 'success', text: '紐付けしました' })
      setLinking(null)
      setAmazonSearch('')
      const maps = await skuMappingApi.list()
      setMappings(maps)
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message })
    }
  }

  const handleUnlink = async (mappingId: string) => {
    try {
      await skuMappingApi.delete(mappingId)
      const maps = await skuMappingApi.list()
      setMappings(maps)
      setMessage({ type: 'success', text: '紐付けを解除しました' })
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message })
    }
  }

  const filteredProducts = shopifyProducts.filter(sp => {
    const mapping = getMapping(sp)
    if (filter === 'linked' && !mapping) return false
    if (filter === 'unlinked' && mapping) return false
    if (search) {
      const text = `${sp.title} ${sp.variantTitle || ''} ${sp.sku}`
      return smartMatch(text, search)
    }
    return true
  })

  const filteredAmazon = amazonSearch
    ? amazonSkus.filter(s => {
        const text = `${s.sellerSku} ${s.productName} ${s.asin} ${s.variation || ''}`
        return smartMatch(text, amazonSearch)
      })
    : amazonSkus

  const linkedCount = shopifyProducts.filter(sp => getMapping(sp)).length
  const unlinkedCount = shopifyProducts.length - linkedCount

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <Loader2 size={24} className="animate-spin mr-2" />
        読み込み中...
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {message && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-50 text-green-800 dark:bg-green-950/50 dark:text-green-300 border border-green-200 dark:border-green-800' : 'bg-red-50 text-red-800 dark:bg-red-950/50 dark:text-red-300 border border-red-200 dark:border-red-800'}`}>
          {message.text}
          <button onClick={() => setMessage(null)} className="ml-auto text-xs opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <button onClick={() => setFilter('all')} className={`rounded-xl border p-4 text-left transition cursor-pointer ${filter === 'all' ? 'border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/50' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'}`}>
          <div className="flex items-center gap-2 mb-1">
            <ShoppingBag size={16} className="text-[#96BF48]" />
            <span className="text-xs font-medium text-slate-500">全商品</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">{shopifyProducts.length}</p>
        </button>
        <button onClick={() => setFilter('linked')} className={`rounded-xl border p-4 text-left transition cursor-pointer ${filter === 'linked' ? 'border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-950/50' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'}`}>
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 size={16} className="text-green-600" />
            <span className="text-xs font-medium text-slate-500">紐付け済み</span>
          </div>
          <p className="text-2xl font-bold text-green-600">{linkedCount}</p>
        </button>
        <button onClick={() => setFilter('unlinked')} className={`rounded-xl border p-4 text-left transition cursor-pointer ${filter === 'unlinked' ? 'border-orange-300 bg-orange-50 dark:border-orange-700 dark:bg-orange-950/50' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'}`}>
          <div className="flex items-center gap-2 mb-1">
            <AlertCircle size={16} className="text-orange-500" />
            <span className="text-xs font-medium text-slate-500">未紐付け</span>
          </div>
          <p className="text-2xl font-bold text-orange-500">{unlinkedCount}</p>
        </button>
      </div>

      {/* Search & Refresh */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="商品名 / バリエーション / SKUで検索..."
            className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#96BF48]/30"
          />
        </div>
        <button onClick={handleRefresh} disabled={refreshing} className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition disabled:opacity-50 cursor-pointer">
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          更新
        </button>
      </div>

      {/* Product List */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
              <th className="text-left px-4 py-3 text-slate-500 font-medium w-12"></th>
              <th className="text-left px-4 py-3 text-slate-500 font-medium">商品名</th>
              <th className="text-left px-4 py-3 text-slate-500 font-medium">バリエーション</th>
              <th className="text-left px-4 py-3 text-slate-500 font-medium">SKU</th>
              <th className="text-right px-4 py-3 text-slate-500 font-medium">価格</th>
              <th className="text-right px-4 py-3 text-slate-500 font-medium">在庫</th>
              <th className="text-left px-4 py-3 text-slate-500 font-medium min-w-[220px]">Amazon紐付け</th>
            </tr>
          </thead>
          <tbody>
            {filteredProducts.map(sp => {
              const mapping = getMapping(sp)
              const amazonInfo = mapping ? getAmazonInfo(mapping.amazonSku) : null
              const isLinking = linking === (sp.sku || sp.variantId)

              return (
                <tr key={sp.variantId} className="border-t border-slate-50 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
                  <td className="px-4 py-3">
                    {sp.imageUrl ? <img src={sp.imageUrl} alt="" className="w-10 h-10 rounded-lg object-cover" /> : <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center"><ShoppingBag size={16} className="text-slate-300" /></div>}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800 dark:text-slate-200 truncate max-w-[200px]">{sp.title}</p>
                  </td>
                  <td className="px-4 py-3">
                    {sp.variantTitle ? (
                      <span className="text-xs bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded">{sp.variantTitle}</span>
                    ) : <span className="text-xs text-slate-300">-</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{sp.sku || <span className="text-slate-300">未設定</span>}</td>
                  <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400">¥{Number(sp.price).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400">{sp.inventoryQuantity}</td>
                  <td className="px-4 py-3">
                    {mapping ? (
                      <div className="flex items-center gap-2">
                        <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
                        <div className="min-w-0">
                          <span className="font-mono text-xs text-[#FF9900]">{mapping.amazonSku}</span>
                          {amazonInfo && (
                            <span className="ml-1.5 text-[10px] text-slate-400">
                              (在庫:{amazonInfo.fulfillableQuantity})
                            </span>
                          )}
                        </div>
                        <button onClick={() => handleUnlink(mapping.id)} className="p-1 rounded text-slate-300 hover:text-red-500 transition cursor-pointer flex-shrink-0" title="紐付け解除">
                          <X size={12} />
                        </button>
                      </div>
                    ) : isLinking ? (
                      <div className="relative">
                        <div className="flex items-center gap-1">
                          <div className="relative flex-1">
                            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                              type="text"
                              value={amazonSearch}
                              onChange={e => setAmazonSearch(e.target.value)}
                              placeholder="Amazon SKU/商品名で検索..."
                              className="w-full pl-7 pr-2 py-1.5 rounded border border-[#FF9900] bg-white dark:bg-slate-900 text-xs focus:outline-none"
                              autoFocus
                            />
                          </div>
                          <button onClick={() => { setLinking(null); setAmazonSearch('') }} className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer">
                            <X size={14} />
                          </button>
                        </div>
                        {amazonSearch && (
                          <div className="absolute z-20 mt-1 w-80 max-h-48 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl" onMouseDown={e => e.preventDefault()}>
                            {filteredAmazon.length === 0 ? (
                              <div className="px-3 py-2 text-xs text-slate-400">該当なし</div>
                            ) : (
                              filteredAmazon.slice(0, 15).map(amz => (
                                <button
                                  key={amz.sellerSku}
                                  type="button"
                                  onClick={() => handleLink(sp.sku || sp.variantId, amz.sellerSku)}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[#FF9900]/10 transition cursor-pointer"
                                >
                                  <span className="font-mono font-medium text-[#FF9900]">{amz.sellerSku}</span>
                                  <span className="truncate flex-1 text-slate-500">{amz.productName}</span>
                                  {amz.variation && <span className="text-[10px] text-blue-500">{amz.variation}</span>}
                                  <span className="text-[10px] text-slate-400">(在庫:{amz.fulfillableQuantity})</span>
                                </button>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <button
                        onClick={() => setLinking(sp.sku || sp.variantId)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-dashed border-[#FF9900] text-[#FF9900] text-xs font-medium hover:bg-[#FF9900]/10 transition cursor-pointer"
                      >
                        <Link size={12} />
                        Amazon SKUを紐付け
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {filteredProducts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <ShoppingBag size={32} className="mb-2" />
            <p className="text-sm">{search ? '検索結果がありません' : '商品がありません'}</p>
          </div>
        )}
      </div>
    </div>
  )
}
