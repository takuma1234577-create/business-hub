import { useState, useEffect } from 'react'
import {
  ShoppingBag,
  Loader2,
  Link,
  RefreshCw,
  Package,
  Search,
  ArrowRight,
  CheckCircle2,
  X,
} from 'lucide-react'
import { skuMappingApi, amazonSkuApi, shopifyProductApi } from './api'
import type { SkuMapping } from './types'
import type { AmazonProduct, AmazonSku, ShopifyProduct } from './api'

export default function SkuMappings() {
  const [mappings, setMappings] = useState<SkuMapping[]>([])
  const [amazonProducts, setAmazonProducts] = useState<AmazonProduct[]>([])
  const [amazonSkus, setAmazonSkus] = useState<AmazonSku[]>([])
  const [shopifyProducts, setShopifyProducts] = useState<ShopifyProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingAmazon, setLoadingAmazon] = useState(false)
  const [loadingShopify, setLoadingShopify] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [linking, setLinking] = useState<string | null>(null) // amazonSku being linked
  const [shopifySearch, setShopifySearch] = useState('')
  const [amazonSearch, setAmazonSearch] = useState('')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const fetchMappings = async () => {
    try {
      const data = await skuMappingApi.list()
      setMappings(data)
    } catch (err) {
      console.error('Failed to fetch SKU mappings', err)
    }
  }

  const fetchAmazon = async () => {
    setLoadingAmazon(true)
    try {
      const res = await amazonSkuApi.list()
      setAmazonProducts(res.products)
      setAmazonSkus(res.skus)
    } catch (err: any) {
      setMessage({ type: 'error', text: 'Amazon SKU取得失敗: ' + err.message })
    }
    setLoadingAmazon(false)
  }

  const fetchShopify = async () => {
    setLoadingShopify(true)
    try {
      const products = await shopifyProductApi.list()
      setShopifyProducts(products)
    } catch (err: any) {
      setMessage({ type: 'error', text: 'Shopify商品取得失敗: ' + err.message })
    }
    setLoadingShopify(false)
  }

  useEffect(() => {
    Promise.all([fetchMappings(), fetchAmazon(), fetchShopify()]).finally(() => setLoading(false))
  }, [])

  const handleLink = async (amzSku: string, shopifySku: string) => {
    setLinking(amzSku)
    try {
      await skuMappingApi.create({ channel: 'SHOPIFY', channelSku: shopifySku, amazonSku: amzSku })
      setMessage({ type: 'success', text: `${shopifySku} → ${amzSku} を紐付けました` })
      setLinking(null)
      setShopifySearch('')
      await fetchMappings()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || '紐付けに失敗しました' })
      setLinking(null)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('この紐付けを解除しますか？')) return
    setDeleting(id)
    try {
      await skuMappingApi.delete(id)
      await fetchMappings()
    } catch (err) {
      console.error('Delete failed', err)
    }
    setDeleting(null)
  }

  const getMappingForAmazonSku = (sku: string) => mappings.find(m => m.amazonSku === sku)
  const getShopifyBySku = (sku: string) => shopifyProducts.find(p => p.sku === sku)

  const filteredAmazonProducts = amazonSearch
    ? amazonProducts.filter(p =>
        p.productName.toLowerCase().includes(amazonSearch.toLowerCase()) ||
        p.parentAsin.toLowerCase().includes(amazonSearch.toLowerCase()) ||
        p.children.some(c => c.asin.toLowerCase().includes(amazonSearch.toLowerCase()) || c.skus.some(s => s.sellerSku.toLowerCase().includes(amazonSearch.toLowerCase())))
      )
    : amazonProducts

  const filteredShopify = shopifySearch
    ? shopifyProducts.filter(p =>
        p.title.toLowerCase().includes(shopifySearch.toLowerCase()) ||
        p.sku.toLowerCase().includes(shopifySearch.toLowerCase()) ||
        (p.variantTitle || '').toLowerCase().includes(shopifySearch.toLowerCase())
      )
    : shopifyProducts

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <Loader2 size={24} className="animate-spin mr-2" />
        読み込み中...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Message */}
      {message && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-50 text-green-800 dark:bg-green-950/50 dark:text-green-300 border border-green-200 dark:border-green-800' : 'bg-red-50 text-red-800 dark:bg-red-950/50 dark:text-red-300 border border-red-200 dark:border-red-800'}`}>
          {message.text}
          <button onClick={() => setMessage(null)} className="ml-auto text-xs opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
          <div className="flex items-center gap-2 text-[#FF9900] mb-1">
            <Package size={16} />
            <span className="text-xs font-medium text-slate-500">Amazon商品</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">{amazonSkus.length}</p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
          <div className="flex items-center gap-2 text-[#96BF48] mb-1">
            <ShoppingBag size={16} />
            <span className="text-xs font-medium text-slate-500">Shopify商品</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">{shopifyProducts.length}</p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
          <div className="flex items-center gap-2 text-blue-600 mb-1">
            <Link size={16} />
            <span className="text-xs font-medium text-slate-500">紐付け済み</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">{mappings.length}</p>
        </div>
      </div>

      {/* Amazon Products with Mapping */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
            <Package size={16} className="text-[#FF9900]" />
            Amazon FBA商品 → Shopify紐付け
          </h3>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={amazonSearch}
                onChange={e => setAmazonSearch(e.target.value)}
                placeholder="Amazon商品を検索..."
                className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-300 w-48 focus:outline-none focus:ring-2 focus:ring-[#FF9900]/30"
              />
            </div>
            <button onClick={fetchAmazon} disabled={loadingAmazon} className="p-1.5 rounded-lg text-slate-400 hover:text-[#FF9900] hover:bg-[#FF9900]/10 transition disabled:opacity-50 cursor-pointer" title="Amazon再取得">
              <RefreshCw size={14} className={loadingAmazon ? 'animate-spin' : ''} />
            </button>
            <button onClick={fetchShopify} disabled={loadingShopify} className="p-1.5 rounded-lg text-slate-400 hover:text-[#96BF48] hover:bg-[#96BF48]/10 transition disabled:opacity-50 cursor-pointer" title="Shopify再取得">
              <ShoppingBag size={14} className={loadingShopify ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {filteredAmazonProducts.map(product => (
            <div key={product.parentAsin} className="px-5 py-4">
              {/* Parent Product Header */}
              <div className="flex items-center gap-3 mb-3">
                {product.imageUrl && <img src={product.imageUrl} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono bg-[#FF9900]/10 text-[#FF9900] px-1.5 py-0.5 rounded">親ASIN: {product.parentAsin}</span>
                    <span className="text-xs text-slate-400">{product.children.length}バリエーション</span>
                  </div>
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate mt-0.5">{product.productName}</p>
                </div>
              </div>

              {/* Child ASINs */}
              <div className="space-y-2 ml-3 border-l-2 border-slate-100 dark:border-slate-800 pl-4">
                {product.children.map(child => (
                  <div key={child.asin} className="space-y-1">
                    {/* Child ASIN Header */}
                    <div className="flex items-center gap-2">
                      {child.imageUrl && <img src={child.imageUrl} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" />}
                      <span className="text-[10px] font-mono bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-1.5 py-0.5 rounded">{child.asin}</span>
                      {child.variation ? (
                        <span className="text-xs font-medium bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded">{child.variation}</span>
                      ) : (
                        <span className="text-[10px] text-slate-400">バリエーション情報なし</span>
                      )}
                    </div>

                    {/* SKUs under this child ASIN */}
                    {child.skus.map(variant => {
                      const mapping = getMappingForAmazonSku(variant.sellerSku)
                      const linkedShopify = mapping ? getShopifyBySku(mapping.channelSku) : null
                      const isLinking = linking === variant.sellerSku

                      return (
                        <div key={variant.sellerSku} className="flex items-center gap-3 py-1.5 px-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 ml-2">
                          {/* Amazon SKU info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-medium text-slate-700 dark:text-slate-300">{variant.sellerSku}</span>
                              <span className={`text-[10px] ${variant.fulfillableQuantity === 0 ? 'text-red-500' : variant.fulfillableQuantity <= 5 ? 'text-yellow-600' : 'text-green-600'}`}>
                                出荷可能:{variant.fulfillableQuantity}
                              </span>
                              {variant.inboundQuantity > 0 && <span className="text-[10px] text-blue-500">入庫:{variant.inboundQuantity}</span>}
                              {variant.reservedQuantity > 0 && <span className="text-[10px] text-orange-500">予約:{variant.reservedQuantity}</span>}
                            </div>
                          </div>

                      {/* Arrow */}
                      <ArrowRight size={14} className="text-slate-300 flex-shrink-0" />

                      {/* Shopify mapping */}
                      <div className="flex-1 min-w-0">
                        {mapping && linkedShopify ? (
                          <div className="flex items-center gap-2">
                            <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
                            <div className="min-w-0">
                              <span className="text-xs text-slate-700 dark:text-slate-300 truncate block">{linkedShopify.title}</span>
                              {linkedShopify.variantTitle && <span className="text-[10px] text-slate-400">{linkedShopify.variantTitle}</span>}
                            </div>
                            <span className="font-mono text-[10px] text-slate-400">{mapping.channelSku}</span>
                            <button onClick={() => handleDelete(mapping.id)} disabled={deleting === mapping.id} className="p-1 rounded text-slate-300 hover:text-red-500 transition flex-shrink-0 cursor-pointer">
                              {deleting === mapping.id ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                            </button>
                          </div>
                        ) : mapping ? (
                          <div className="flex items-center gap-2">
                            <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
                            <span className="font-mono text-xs text-slate-500">{mapping.channelSku}</span>
                            <button onClick={() => handleDelete(mapping.id)} disabled={deleting === mapping.id} className="p-1 rounded text-slate-300 hover:text-red-500 transition flex-shrink-0 cursor-pointer">
                              {deleting === mapping.id ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                            </button>
                          </div>
                        ) : isLinking ? (
                          <div className="relative">
                            <div className="flex items-center gap-1">
                              <div className="relative flex-1">
                                <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                  type="text"
                                  value={shopifySearch}
                                  onChange={e => setShopifySearch(e.target.value)}
                                  placeholder="Shopify商品を検索..."
                                  className="w-full pl-7 pr-2 py-1 rounded border border-[#96BF48] bg-white dark:bg-slate-900 text-xs focus:outline-none"
                                  autoFocus
                                />
                              </div>
                              <button onClick={() => { setLinking(null); setShopifySearch(''); }} className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer">
                                <X size={14} />
                              </button>
                            </div>
                            {shopifySearch && (
                              <div className="absolute z-20 mt-1 w-80 max-h-48 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl">
                                {filteredShopify.length === 0 ? (
                                  <div className="px-3 py-2 text-xs text-slate-400">該当なし</div>
                                ) : (
                                  filteredShopify.slice(0, 15).map(sp => (
                                    <button
                                      key={sp.variantId}
                                      type="button"
                                      onClick={() => handleLink(variant.sellerSku, sp.sku)}
                                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[#96BF48]/10 transition cursor-pointer"
                                    >
                                      {sp.imageUrl && <img src={sp.imageUrl} alt="" className="w-6 h-6 rounded object-cover flex-shrink-0" />}
                                      <div className="flex-1 min-w-0">
                                        <span className="text-slate-700 dark:text-slate-300 truncate block">{sp.title}</span>
                                        {sp.variantTitle && <span className="text-[10px] text-slate-400">{sp.variantTitle}</span>}
                                      </div>
                                      <span className="font-mono text-[10px] text-slate-400 flex-shrink-0">{sp.sku}</span>
                                      <span className="text-[10px] text-slate-400">¥{Number(sp.price).toLocaleString()}</span>
                                    </button>
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <button
                            onClick={() => setLinking(variant.sellerSku)}
                            className="flex items-center gap-1.5 px-3 py-1 rounded-md border border-dashed border-[#96BF48] text-[#96BF48] text-xs font-medium hover:bg-[#96BF48]/10 transition cursor-pointer"
                          >
                            <ShoppingBag size={12} />
                            Shopify商品を紐付ける
                          </button>
                        )}
                      </div>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {filteredAmazonProducts.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <Package size={32} className="mb-2" />
              <p className="text-sm">{amazonSearch ? '検索結果がありません' : 'Amazon FBA商品がありません'}</p>
            </div>
          )}
        </div>
      </div>

      {/* Shopify Products Reference */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
            <ShoppingBag size={16} className="text-[#96BF48]" />
            Shopify商品一覧
            <span className="text-xs font-normal text-slate-400">({shopifyProducts.length}件)</span>
          </h3>
          <button onClick={fetchShopify} disabled={loadingShopify} className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800 transition disabled:opacity-50 cursor-pointer">
            <RefreshCw size={12} className={loadingShopify ? 'animate-spin' : ''} />
            再取得
          </button>
        </div>
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0">
              <tr className="bg-slate-50 dark:bg-slate-800">
                <th className="text-left px-4 py-2 text-slate-500 font-medium w-8"></th>
                <th className="text-left px-4 py-2 text-slate-500 font-medium">商品名</th>
                <th className="text-left px-4 py-2 text-slate-500 font-medium">バリエーション</th>
                <th className="text-left px-4 py-2 text-slate-500 font-medium">SKU</th>
                <th className="text-right px-4 py-2 text-slate-500 font-medium">価格</th>
                <th className="text-right px-4 py-2 text-slate-500 font-medium">在庫</th>
                <th className="text-center px-4 py-2 text-slate-500 font-medium">紐付け</th>
              </tr>
            </thead>
            <tbody>
              {shopifyProducts.map(sp => {
                const mapped = mappings.find(m => m.channelSku === sp.sku)
                return (
                  <tr key={sp.variantId} className="border-t border-slate-50 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-4 py-2">
                      {sp.imageUrl ? <img src={sp.imageUrl} alt="" className="w-6 h-6 rounded object-cover" /> : <div className="w-6 h-6 rounded bg-slate-100 dark:bg-slate-800" />}
                    </td>
                    <td className="px-4 py-2 text-slate-700 dark:text-slate-300 truncate max-w-[180px]">{sp.title}</td>
                    <td className="px-4 py-2 text-slate-500">{sp.variantTitle || '-'}</td>
                    <td className="px-4 py-2 font-mono text-slate-500">{sp.sku || '-'}</td>
                    <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-400">¥{Number(sp.price).toLocaleString()}</td>
                    <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-400">{sp.inventoryQuantity}</td>
                    <td className="px-4 py-2 text-center">
                      {mapped ? (
                        <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
                          <CheckCircle2 size={12} />
                          <span className="font-mono text-[10px]">{mapped.amazonSku}</span>
                        </span>
                      ) : (
                        <span className="text-slate-300 text-[10px]">未紐付け</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {shopifyProducts.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <ShoppingBag size={28} className="mb-2" />
              <p className="text-sm">Shopify商品がありません</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
