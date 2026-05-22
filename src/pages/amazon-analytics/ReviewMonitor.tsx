import { useState, useEffect, useCallback } from 'react'
import {
  Plus, Trash2, RefreshCw, Star, AlertTriangle,
  Sparkles, Copy, Check, Search, ShieldAlert, Package,
  Send, MessageCircle, SkipForward, CheckCircle,
} from 'lucide-react'
import { reviewMonitorApi } from './review-monitor-api'
import type { MonitoredProduct, BuyerOutreach, ReviewMonitorStats } from './review-monitor-types'
import type { Pagination } from './types'

type OutreachFilter = 'pending' | 'sent' | 'resolved' | 'all'

export default function ReviewMonitor() {
  // Products
  const [products, setProducts] = useState<MonitoredProduct[]>([])
  const [loadingProducts, setLoadingProducts] = useState(true)
  const [newAsin, setNewAsin] = useState('')
  const [adding, setAdding] = useState(false)
  const [scanning, setScanning] = useState<Set<string>>(new Set())

  // Outreach
  const [outreach, setOutreach] = useState<BuyerOutreach[]>([])
  const [outreachLoading, setOutreachLoading] = useState(false)
  const [outreachFilter, setOutreachFilter] = useState<OutreachFilter>('pending')
  const [outreachAsin, setOutreachAsin] = useState('')
  const [outreachPagination, setOutreachPagination] = useState<Pagination>({ page: 1, pageSize: 30, total: 0, totalPages: 0 })

  // Message
  const [generatingId, setGeneratingId] = useState<string | null>(null)
  const [draftMessages, setDraftMessages] = useState<Record<string, string>>({})
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  // Stats
  const [stats, setStats] = useState<ReviewMonitorStats | null>(null)

  const fetchProducts = useCallback(async () => {
    try {
      const res = await reviewMonitorApi.getProducts()
      setProducts(res.data)
    } catch (err) {
      console.error('Failed to fetch products:', err)
    } finally {
      setLoadingProducts(false)
    }
  }, [])

  const fetchOutreach = useCallback(async (page = 1) => {
    setOutreachLoading(true)
    try {
      const res = await reviewMonitorApi.getOutreach({
        asin: outreachAsin || undefined,
        status: outreachFilter,
        page,
        pageSize: 30,
      })
      setOutreach(res.data.data)
      setOutreachPagination(res.data.pagination)
    } catch (err) {
      console.error('Failed to fetch outreach:', err)
    } finally {
      setOutreachLoading(false)
    }
  }, [outreachAsin, outreachFilter])

  const fetchStats = useCallback(async () => {
    try {
      const res = await reviewMonitorApi.getStats()
      setStats(res.data)
    } catch (err) {
      console.error('Failed to fetch stats:', err)
    }
  }, [])

  useEffect(() => { fetchProducts(); fetchStats() }, [fetchProducts, fetchStats])
  useEffect(() => { fetchOutreach() }, [fetchOutreach])

  // --- Product actions ---
  const handleAddProduct = async () => {
    const asin = newAsin.trim().toUpperCase()
    if (!asin) return
    setAdding(true)
    try {
      await reviewMonitorApi.addProduct(asin)
      setNewAsin('')
      fetchProducts()
      fetchOutreach()
      fetchStats()
    } catch (err: any) {
      alert(err.response?.data?.error || '追加に失敗しました')
    } finally {
      setAdding(false)
    }
  }

  const handleRemove = async (asin: string) => {
    if (!confirm(`${asin} の監視を停止しますか?`)) return
    await reviewMonitorApi.removeProduct(asin)
    fetchProducts()
  }

  const handleScan = async (asin: string) => {
    setScanning(prev => new Set(prev).add(asin))
    try {
      const res = await reviewMonitorApi.scanOrders(asin)
      alert(`スキャン完了: ${res.data.matched}件の注文を検出 (新規${res.data.new}件)`)
      fetchProducts()
      fetchOutreach()
      fetchStats()
    } catch (err: any) {
      alert(err.response?.data?.error || 'スキャンに失敗しました')
    } finally {
      setScanning(prev => { const n = new Set(prev); n.delete(asin); return n })
    }
  }

  // --- Outreach actions ---
  const handleGenerate = async (id: string) => {
    setGeneratingId(id)
    try {
      const res = await reviewMonitorApi.generateMessage(id)
      setDraftMessages(prev => ({ ...prev, [id]: res.data.message }))
    } catch (err) {
      alert('メッセージ生成に失敗しました')
    } finally {
      setGeneratingId(null)
    }
  }

  const handleSend = async (id: string) => {
    const msg = draftMessages[id]
    if (!msg) return
    setSendingId(id)
    try {
      const res = await reviewMonitorApi.sendMessage(id, msg)
      alert(res.data.note)
      setDraftMessages(prev => { const n = { ...prev }; delete n[id]; return n })
      fetchOutreach()
      fetchStats()
    } catch (err: any) {
      alert(err.response?.data?.error || '送信に失敗しました')
    } finally {
      setSendingId(null)
    }
  }

  const handleSkip = async (id: string) => {
    await reviewMonitorApi.updateStatus(id, 'skipped')
    fetchOutreach()
    fetchStats()
  }

  const handleResolve = async (id: string) => {
    await reviewMonitorApi.updateStatus(id, 'resolved')
    fetchOutreach()
    fetchStats()
  }

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  const formatDate = (d: string | null) => {
    if (!d) return '-'
    return new Date(d).toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })
  }

  const renderRating = (rating: number | null) => {
    if (rating === null) return <span className="text-slate-400">-</span>
    return (
      <div className="flex items-center gap-1">
        <Star size={14} className={rating >= 4 ? 'text-yellow-500 fill-yellow-500' : rating >= 3 ? 'text-yellow-500 fill-yellow-500' : 'text-red-500 fill-red-500'} />
        <span className={`font-medium ${rating < 3.5 ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-300'}`}>
          {rating.toFixed(1)}
        </span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: '監視中の商品', value: stats.monitoredProducts, icon: Package, color: 'text-slate-900 dark:text-white' },
            { label: '要フォロー', value: stats.pendingOutreach, icon: AlertTriangle, color: 'text-amber-600 dark:text-amber-400' },
            { label: '送信済み', value: stats.sentOutreach, icon: Send, color: 'text-blue-600 dark:text-blue-400' },
            { label: '解決済み', value: stats.resolvedOutreach, icon: CheckCircle, color: 'text-emerald-600 dark:text-emerald-400' },
            { label: '評価低下', value: stats.ratingDroppedProducts, icon: ShieldAlert, color: 'text-red-600 dark:text-red-400' },
          ].map(s => (
            <div key={s.label} className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
              <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <s.icon size={12} />
                {s.label}
              </div>
              <div className={`text-xl font-bold mt-1 ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Monitored Products */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
        <h3 className="font-medium text-slate-900 dark:text-white mb-3">監視対象の商品</h3>
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={newAsin}
            onChange={e => setNewAsin(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddProduct()}
            placeholder="ASINを入力（例: B0XXXXXXXX）"
            className="flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm placeholder-slate-400"
          />
          <button
            onClick={handleAddProduct}
            disabled={adding || !newAsin.trim()}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors cursor-pointer"
          >
            <Plus size={16} />
            {adding ? '追加中...' : '追加'}
          </button>
        </div>

        {loadingProducts ? (
          <div className="flex justify-center py-6"><RefreshCw size={20} className="animate-spin text-slate-400" /></div>
        ) : products.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">ASINを追加してください</p>
        ) : (
          <div className="space-y-2">
            {products.map(p => (
              <div key={p.asin} className="flex items-center gap-3 p-3 rounded-lg border border-slate-100 dark:border-slate-700">
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt="" className="w-10 h-10 rounded object-cover shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded bg-slate-100 dark:bg-slate-700 flex items-center justify-center shrink-0">
                    <Package size={16} className="text-slate-400" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-900 dark:text-white truncate">{p.title}</div>
                  <div className="flex items-center gap-3 text-xs text-slate-400 mt-0.5">
                    <span className="font-mono">{p.asin}</span>
                    {renderRating(p.averageRating)}
                    <span>({p.ratingCount}件)</span>
                    {p.previousRating !== null && p.averageRating !== null && p.averageRating < p.previousRating && (
                      <span className="text-red-500 flex items-center gap-0.5">
                        <AlertTriangle size={10} />
                        {p.previousRating.toFixed(1)}→{p.averageRating.toFixed(1)}
                      </span>
                    )}
                    {p.outreach.pending > 0 && (
                      <span className="text-amber-500">要フォロー: {p.outreach.pending}</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleScan(p.asin)}
                  disabled={scanning.has(p.asin)}
                  className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                  title="注文スキャン"
                >
                  <RefreshCw size={16} className={`text-slate-500 ${scanning.has(p.asin) ? 'animate-spin' : ''}`} />
                </button>
                <button
                  onClick={() => handleRemove(p.asin)}
                  className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors cursor-pointer"
                >
                  <Trash2 size={16} className="text-red-400" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Buyer Outreach */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        <div className="p-4 border-b border-slate-100 dark:border-slate-700">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h3 className="font-medium text-slate-900 dark:text-white flex items-center gap-2">
              <MessageCircle size={18} />
              購入者フォローアップ
            </h3>
            <div className="flex items-center gap-2">
              <select
                value={outreachAsin}
                onChange={e => setOutreachAsin(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-300"
              >
                <option value="">全商品</option>
                {products.map(p => (
                  <option key={p.asin} value={p.asin}>{p.asin}</option>
                ))}
              </select>
              <div className="flex gap-1 border border-slate-200 dark:border-slate-600 rounded-lg overflow-hidden">
                {([
                  { key: 'pending', label: '未対応' },
                  { key: 'sent', label: '送信済' },
                  { key: 'resolved', label: '解決' },
                  { key: 'all', label: '全て' },
                ] as { key: OutreachFilter; label: string }[]).map(f => (
                  <button
                    key={f.key}
                    onClick={() => setOutreachFilter(f.key)}
                    className={`px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${
                      outreachFilter === f.key
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-700">
          {outreachLoading ? (
            <div className="flex justify-center py-12"><RefreshCw size={20} className="animate-spin text-slate-400" /></div>
          ) : outreach.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <Search size={24} className="mx-auto mb-2 opacity-50" />
              対象がありません
            </div>
          ) : outreach.map(o => (
            <div key={o.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-slate-600 dark:text-slate-400">{o.amazonOrderId}</span>
                    <span className="text-xs text-slate-400">ASIN: {o.asin}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                      o.outreachStatus === 'pending' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400'
                      : o.outreachStatus === 'sent' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400'
                      : o.outreachStatus === 'resolved' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400'
                      : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
                    }`}>
                      {o.outreachStatus === 'pending' ? '未対応' : o.outreachStatus === 'sent' ? '送信済み' : o.outreachStatus === 'resolved' ? '解決済み' : 'スキップ'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                    {o.buyerName && <span>{o.buyerName}</span>}
                    <span>注文日: {formatDate(o.orderDate)}</span>
                    {o.sentAt && <span>送信日: {formatDate(o.sentAt)}</span>}
                  </div>
                  {o.notes && <p className="text-xs text-slate-500 mt-1">{o.notes}</p>}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  {o.outreachStatus === 'pending' && (
                    <>
                      <button
                        onClick={() => handleGenerate(o.id)}
                        disabled={generatingId === o.id}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-400 hover:bg-violet-100 disabled:opacity-50 transition-colors cursor-pointer"
                      >
                        <Sparkles size={12} />
                        {generatingId === o.id ? '生成中...' : 'AI生成'}
                      </button>
                      <button
                        onClick={() => handleSkip(o.id)}
                        className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
                        title="スキップ"
                      >
                        <SkipForward size={14} className="text-slate-400" />
                      </button>
                    </>
                  )}
                  {o.outreachStatus === 'sent' && (
                    <button
                      onClick={() => handleResolve(o.id)}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400 hover:bg-emerald-100 transition-colors cursor-pointer"
                    >
                      <CheckCircle size={12} />
                      解決済み
                    </button>
                  )}
                </div>
              </div>

              {/* Draft message area */}
              {draftMessages[o.id] !== undefined && (
                <div className="mt-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-blue-600 dark:text-blue-400">メッセージ案</span>
                    <button
                      onClick={() => handleCopy(draftMessages[o.id], o.id)}
                      className="p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900/50 cursor-pointer"
                    >
                      {copied === o.id ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} className="text-blue-500" />}
                    </button>
                  </div>
                  <textarea
                    value={draftMessages[o.id]}
                    onChange={e => setDraftMessages(prev => ({ ...prev, [o.id]: e.target.value }))}
                    rows={3}
                    className="w-full px-3 py-2 rounded border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white mb-2"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSend(o.id)}
                      disabled={sendingId === o.id || !draftMessages[o.id]}
                      className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                    >
                      <Send size={12} />
                      {sendingId === o.id ? '送信中...' : 'SP-API送信'}
                    </button>
                    <button
                      onClick={() => { handleCopy(draftMessages[o.id], o.id); handleSkip(o.id) }}
                      className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      コピーしてSeller Central送信
                    </button>
                    <button
                      onClick={() => setDraftMessages(prev => { const n = { ...prev }; delete n[o.id]; return n })}
                      className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      閉じる
                    </button>
                  </div>
                </div>
              )}

              {/* Already sent message */}
              {o.messageSent && !draftMessages[o.id] && (
                <div className="mt-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-medium">送信済みメッセージ: </span>{o.messageSent}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Pagination */}
        {outreachPagination.totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-slate-500 p-4 border-t border-slate-100 dark:border-slate-700">
            <span>{outreachPagination.total}件</span>
            <div className="flex gap-1">
              <button
                onClick={() => fetchOutreach(outreachPagination.page - 1)}
                disabled={outreachPagination.page <= 1}
                className="px-3 py-1 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-30 cursor-pointer"
              >
                前へ
              </button>
              <button
                onClick={() => fetchOutreach(outreachPagination.page + 1)}
                disabled={outreachPagination.page >= outreachPagination.totalPages}
                className="px-3 py-1 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-30 cursor-pointer"
              >
                次へ
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
