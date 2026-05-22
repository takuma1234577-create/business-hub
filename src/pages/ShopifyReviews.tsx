import { useState, useEffect } from 'react'
import { Star, Check, X, Trash2, Filter, RefreshCw, Plus, ChevronDown, ChevronUp, Download, XCircle } from 'lucide-react'
import axios from 'axios'

const api = axios.create({ baseURL: '/api/shopify-reviews' })
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

const productsApi = axios.create({ baseURL: '/api' })
productsApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

interface Review {
  id: string
  shopify_product_id: string
  product_title: string | null
  source: string
  author_name: string
  author_email: string | null
  rating: number
  title: string | null
  body: string
  verified_purchase: boolean
  status: string
  featured: boolean
  created_at: string
}

interface Stats {
  shopify_product_id: string
  product_title: string | null
  average_rating: number
  total_count: number
  rating_1: number
  rating_2: number
  rating_3: number
  rating_4: number
  rating_5: number
}

interface Product {
  id: string
  shopify_product_id: string
  title: string
  image_url: string | null
  price: string
  status: string
}

const sourceLabel: Record<string, string> = {
  survey: 'アンケート',
  amazon: 'Amazon',
  manual: '手動',
}

const statusLabel: Record<string, { text: string; color: string }> = {
  pending: { text: '保留', color: 'bg-yellow-100 text-yellow-800' },
  approved: { text: '承認済', color: 'bg-green-100 text-green-800' },
  rejected: { text: '却下', color: 'bg-red-100 text-red-800' },
}

function Stars({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} size={size} className={i <= rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'} />
      ))}
    </span>
  )
}

function ClickableStars({ rating, onChange }: { rating: number; onChange: (r: number) => void }) {
  return (
    <span className="inline-flex gap-1">
      {[1, 2, 3, 4, 5].map(i => (
        <button key={i} type="button" onClick={() => onChange(i)}>
          <Star size={24} className={i <= rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'} />
        </button>
      ))}
    </span>
  )
}

// レビュー追加フォーム
function AddReviewForm({ product, onAdded, onCancel }: { product: Product; onAdded: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({ author_name: '', rating: 5, title: '', body: '', source: 'amazon' as string })
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.body.trim() || !form.rating) return
    setSubmitting(true)
    try {
      await api.post('/reviews', {
        shopify_product_id: product.shopify_product_id,
        author_name: form.author_name || '購入者',
        rating: form.rating,
        title: form.title || null,
        body: form.body,
        source: form.source,
        status: 'approved',
        verified_purchase: true,
      })
      onAdded()
    } catch { /* ignore */ }
    setSubmitting(false)
  }

  return (
    <form onSubmit={handleSubmit} className="bg-slate-50 dark:bg-slate-900 rounded-xl p-4 mt-3 space-y-3">
      <div className="flex items-center gap-3">
        <label className="text-xs font-medium text-slate-500 w-16 flex-shrink-0">評価</label>
        <ClickableStars rating={form.rating} onChange={r => setForm(f => ({ ...f, rating: r }))} />
      </div>
      <div className="flex items-center gap-3">
        <label className="text-xs font-medium text-slate-500 w-16 flex-shrink-0">ソース</label>
        <select
          value={form.source}
          onChange={e => setForm(f => ({ ...f, source: e.target.value }))}
          className="text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
        >
          <option value="amazon">Amazon</option>
          <option value="manual">手動</option>
          <option value="survey">アンケート</option>
        </select>
      </div>
      <div className="flex items-center gap-3">
        <label className="text-xs font-medium text-slate-500 w-16 flex-shrink-0">投稿者</label>
        <input
          type="text"
          value={form.author_name}
          onChange={e => setForm(f => ({ ...f, author_name: e.target.value }))}
          placeholder="購入者"
          className="flex-1 text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
        />
      </div>
      <div className="flex items-start gap-3">
        <label className="text-xs font-medium text-slate-500 w-16 flex-shrink-0 mt-2">タイトル</label>
        <input
          type="text"
          value={form.title}
          onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
          placeholder="レビュータイトル（任意）"
          className="flex-1 text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
        />
      </div>
      <div className="flex items-start gap-3">
        <label className="text-xs font-medium text-slate-500 w-16 flex-shrink-0 mt-2">本文</label>
        <textarea
          value={form.body}
          onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
          placeholder="レビュー本文"
          rows={3}
          required
          className="flex-1 text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-slate-900 dark:text-white resize-none"
        />
      </div>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700">
          キャンセル
        </button>
        <button
          type="submit"
          disabled={submitting || !form.body.trim()}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? '追加中...' : 'レビューを追加'}
        </button>
      </div>
    </form>
  )
}

// 商品カード（レビュー一覧付き）
function ProductCard({ product, stats, reviews, onRefresh }: {
  product: Product
  stats: Stats | undefined
  reviews: Review[]
  onRefresh: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const productReviews = reviews.filter(r => r.shopify_product_id === product.shopify_product_id)

  const handleDelete = async (id: string) => {
    if (!confirm('削除しますか？')) return
    await api.delete(`/reviews/${id}`)
    onRefresh()
  }

  const handleToggleStatus = async (id: string, current: string) => {
    const next = current === 'approved' ? 'rejected' : 'approved'
    await api.patch(`/reviews/${id}`, { status: next })
    onRefresh()
  }

  return (
    <div className="bg-white dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
      {/* Product header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-4 p-4 hover:bg-slate-50 dark:hover:bg-slate-900/50 transition text-left"
      >
        {product.image_url ? (
          <img src={product.image_url} alt="" className="w-14 h-14 object-contain rounded-lg flex-shrink-0" />
        ) : (
          <div className="w-14 h-14 bg-slate-100 dark:bg-slate-800 rounded-lg flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-900 dark:text-white line-clamp-1">{product.title}</p>
          <div className="flex items-center gap-3 mt-1">
            {stats ? (
              <>
                <Stars rating={Math.round(stats.average_rating)} />
                <span className="text-xs text-slate-500">{stats.average_rating} ({stats.total_count}件)</span>
              </>
            ) : (
              <span className="text-xs text-slate-400">レビューなし</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-slate-400">{productReviews.length}件</span>
          {expanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-slate-100 dark:border-slate-800 px-4 pb-4">
          {/* Add review button */}
          <div className="flex justify-end py-3">
            <button
              onClick={() => setShowForm(!showForm)}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <Plus size={14} />
              レビューを追加
            </button>
          </div>

          {showForm && (
            <AddReviewForm
              product={product}
              onAdded={() => { setShowForm(false); onRefresh() }}
              onCancel={() => setShowForm(false)}
            />
          )}

          {/* Reviews list */}
          {productReviews.length === 0 ? (
            <p className="text-center py-6 text-sm text-slate-400">この商品にはまだレビューがありません</p>
          ) : (
            <div className="space-y-2 mt-2">
              {productReviews.map(r => (
                <div key={r.id} className="bg-slate-50 dark:bg-slate-900 rounded-lg p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <Stars rating={r.rating} size={12} />
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${statusLabel[r.status]?.color || ''}`}>
                          {statusLabel[r.status]?.text}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400">
                          {sourceLabel[r.source] || r.source}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mb-1">
                        {r.author_name} - {new Date(r.created_at).toLocaleDateString('ja-JP')}
                      </p>
                      {r.title && <p className="text-sm font-medium text-slate-900 dark:text-white mb-0.5">{r.title}</p>}
                      <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{r.body}</p>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleToggleStatus(r.id, r.status)}
                        className={`p-1 rounded ${r.status === 'approved' ? 'text-red-400 hover:bg-red-50' : 'text-green-600 hover:bg-green-50'}`}
                        title={r.status === 'approved' ? '却下' : '承認'}
                      >
                        {r.status === 'approved' ? <X size={14} /> : <Check size={14} />}
                      </button>
                      <button onClick={() => handleDelete(r.id)} className="p-1 rounded text-red-400 hover:bg-red-50" title="削除">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function ShopifyReviews() {
  const [reviews, setReviews] = useState<Review[]>([])
  const [stats, setStats] = useState<Stats[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState({ status: '', source: '', product_id: '' })
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [tab, setTab] = useState<'products' | 'reviews' | 'stats'>('products')
  const [widgetInstalled, setWidgetInstalled] = useState<boolean | null>(null)
  const [widgetLoading, setWidgetLoading] = useState(false)

  const fetchWidgetStatus = async () => {
    try {
      const { data } = await api.get('/widget-status')
      setWidgetInstalled(data.installed)
    } catch { setWidgetInstalled(null) }
  }

  const handleInstallWidget = async () => {
    setWidgetLoading(true)
    try {
      await api.post('/install-widget')
      setWidgetInstalled(true)
    } catch (err: any) {
      alert('インストールエラー: ' + (err.response?.data?.error || err.message))
    }
    setWidgetLoading(false)
  }

  const handleUninstallWidget = async () => {
    if (!confirm('ウィジェットをアンインストールしますか？')) return
    setWidgetLoading(true)
    try {
      await api.delete('/uninstall-widget')
      setWidgetInstalled(false)
    } catch (err: any) {
      alert('アンインストールエラー: ' + (err.response?.data?.error || err.message))
    }
    setWidgetLoading(false)
  }

  const fetchAll = async () => {
    setLoading(true)
    await Promise.all([fetchReviews(), fetchStats(), fetchProducts(), fetchWidgetStatus()])
    setLoading(false)
  }

  const fetchReviews = async () => {
    try {
      const params: Record<string, string> = { page_size: '200' }
      if (filter.status) params.status = filter.status
      if (filter.source) params.source = filter.source
      if (filter.product_id) params.product_id = filter.product_id
      const { data } = await api.get('/reviews', { params })
      setReviews(data.reviews || [])
      setTotal(data.total || 0)
    } catch { /* ignore */ }
  }

  const fetchStats = async () => {
    try {
      const { data } = await api.get('/stats')
      setStats(data.stats || [])
    } catch { /* ignore */ }
  }

  const fetchProducts = async () => {
    try {
      const { data } = await productsApi.get('/shopify-reviews/products')
      setProducts(data.products || [])
    } catch {
      // fallback: use stats to infer products
    }
  }

  useEffect(() => { fetchAll() }, [])
  useEffect(() => { if (tab === 'reviews') fetchReviews() }, [filter.status, filter.source, filter.product_id])

  const handleApprove = async (id: string) => {
    await api.patch(`/reviews/${id}`, { status: 'approved' })
    fetchReviews()
    fetchStats()
  }

  const handleReject = async (id: string) => {
    await api.patch(`/reviews/${id}`, { status: 'rejected' })
    fetchReviews()
    fetchStats()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('削除しますか？')) return
    await api.delete(`/reviews/${id}`)
    fetchReviews()
    fetchStats()
  }

  const handleBulkApprove = async () => {
    if (selectedIds.size === 0) return
    await api.post('/reviews/bulk-approve', { ids: [...selectedIds] })
    setSelectedIds(new Set())
    fetchReviews()
    fetchStats()
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const getStatsForProduct = (productId: string) => stats.find(s => s.shopify_product_id === productId)

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
        <div className="max-w-6xl mx-auto px-6 py-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">Shopifyレビュー管理</h1>
              <p className="text-sm text-slate-500 mt-1">アンケート・Amazon・手動レビューを一元管理</p>
            </div>
            <div className="flex items-center gap-2">
              {widgetInstalled === true && (
                <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 dark:bg-green-900/20 px-3 py-1.5 rounded-full">
                  <Check size={12} /> ウィジェット有効
                </span>
              )}
              {widgetInstalled === true ? (
                <button
                  onClick={handleUninstallWidget}
                  disabled={widgetLoading}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs border border-red-200 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50"
                >
                  <XCircle size={14} />
                  {widgetLoading ? '処理中...' : 'アンインストール'}
                </button>
              ) : widgetInstalled === false ? (
                <button
                  onClick={handleInstallWidget}
                  disabled={widgetLoading}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  <Download size={14} />
                  {widgetLoading ? '処理中...' : 'Shopifyにウィジェットをインストール'}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-6">
        {/* Tabs */}
        <div className="flex gap-1 bg-slate-200 dark:bg-slate-800 rounded-lg p-1 mb-6 w-fit">
          <button
            onClick={() => setTab('products')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition ${tab === 'products' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-600 dark:text-slate-400'}`}
          >
            商品一覧 ({products.length})
          </button>
          <button
            onClick={() => setTab('reviews')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition ${tab === 'reviews' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-600 dark:text-slate-400'}`}
          >
            全レビュー ({total})
          </button>
          <button
            onClick={() => setTab('stats')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition ${tab === 'stats' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-600 dark:text-slate-400'}`}
          >
            集計
          </button>
        </div>

        {/* Products tab */}
        {tab === 'products' && (
          <div className="space-y-3">
            {loading ? (
              <div className="text-center py-12 text-slate-400">読み込み中...</div>
            ) : products.length === 0 ? (
              <div className="text-center py-12 text-slate-400">商品がありません</div>
            ) : (
              products.map(p => (
                <ProductCard
                  key={p.id}
                  product={p}
                  stats={getStatsForProduct(p.shopify_product_id)}
                  reviews={reviews}
                  onRefresh={() => { fetchReviews(); fetchStats() }}
                />
              ))
            )}
          </div>
        )}

        {/* Stats tab */}
        {tab === 'stats' && (
          <div className="bg-white dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-400">商品</th>
                  <th className="text-center px-4 py-3 font-medium text-slate-600 dark:text-slate-400">平均</th>
                  <th className="text-center px-4 py-3 font-medium text-slate-600 dark:text-slate-400">件数</th>
                  <th className="text-center px-4 py-3 font-medium text-slate-600 dark:text-slate-400">分布</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {stats.map(s => (
                  <tr key={s.shopify_product_id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                    <td className="px-4 py-3 text-slate-900 dark:text-white max-w-xs truncate">{s.product_title || s.shopify_product_id}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center gap-1">
                        <Star size={14} className="fill-yellow-400 text-yellow-400" />
                        <span className="font-bold text-slate-900 dark:text-white">{s.average_rating}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-slate-900 dark:text-white font-medium">{s.total_count}</td>
                    <td className="px-4 py-3 text-center text-xs text-slate-500">
                      5:{s.rating_5} 4:{s.rating_4} 3:{s.rating_3} 2:{s.rating_2} 1:{s.rating_1}
                    </td>
                  </tr>
                ))}
                {stats.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">データなし</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Reviews tab */}
        {tab === 'reviews' && (
          <>
            <div className="flex flex-wrap gap-3 mb-4 items-center">
              <div className="flex items-center gap-2">
                <Filter size={16} className="text-slate-400" />
                <select
                  value={filter.status}
                  onChange={e => setFilter(f => ({ ...f, status: e.target.value }))}
                  className="text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  <option value="">全ステータス</option>
                  <option value="pending">保留</option>
                  <option value="approved">承認済</option>
                  <option value="rejected">却下</option>
                </select>
                <select
                  value={filter.source}
                  onChange={e => setFilter(f => ({ ...f, source: e.target.value }))}
                  className="text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  <option value="">全ソース</option>
                  <option value="survey">アンケート</option>
                  <option value="amazon">Amazon</option>
                  <option value="manual">手動</option>
                </select>
              </div>
              <div className="flex gap-2 ml-auto">
                {selectedIds.size > 0 && (
                  <button onClick={handleBulkApprove} className="flex items-center gap-1 px-3 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700">
                    <Check size={14} />{selectedIds.size}件を承認
                  </button>
                )}
                <button onClick={fetchAll} className="flex items-center gap-1 px-3 py-2 border border-slate-200 dark:border-slate-700 text-sm rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300">
                  <RefreshCw size={14} />更新
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {loading ? (
                <div className="text-center py-12 text-slate-400">読み込み中...</div>
              ) : reviews.length === 0 ? (
                <div className="text-center py-12 text-slate-400">レビューがありません</div>
              ) : reviews.map(r => (
                <div key={r.id} className="bg-white dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
                  <div className="flex items-start gap-3">
                    <input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => toggleSelect(r.id)} className="mt-1 rounded border-slate-300" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <Stars rating={r.rating} />
                        <span className={`text-xs px-2 py-0.5 rounded-full ${statusLabel[r.status]?.color || ''}`}>{statusLabel[r.status]?.text || r.status}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">{sourceLabel[r.source] || r.source}</span>
                        {r.verified_purchase && <span className="text-xs text-green-600 font-medium">認証済み購入</span>}
                      </div>
                      <p className="text-xs text-slate-500 mb-1">{r.author_name} - {r.product_title || r.shopify_product_id} - {new Date(r.created_at).toLocaleDateString('ja-JP')}</p>
                      {r.title && <p className="text-sm font-medium text-slate-900 dark:text-white mb-1">{r.title}</p>}
                      <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{r.body}</p>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      {r.status !== 'approved' && <button onClick={() => handleApprove(r.id)} className="p-1.5 rounded-lg hover:bg-green-50 text-green-600" title="承認"><Check size={16} /></button>}
                      {r.status !== 'rejected' && <button onClick={() => handleReject(r.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-500" title="却下"><X size={16} /></button>}
                      <button onClick={() => handleDelete(r.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-400" title="削除"><Trash2 size={16} /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
