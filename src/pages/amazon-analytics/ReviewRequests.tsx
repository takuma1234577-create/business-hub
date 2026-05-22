import { useState, useEffect, useCallback } from 'react'
import { Send, CheckCircle, XCircle, Clock, RefreshCw, Settings, ChevronDown, ChevronUp } from 'lucide-react'
import { reviewApi } from './api'
import type { ReviewOrder, SolicitationStats, SolicitationHistory, AutoConfig, Pagination } from './types'

type FilterTab = 'eligible' | 'sent' | 'all'

export default function ReviewRequests() {
  const [orders, setOrders] = useState<ReviewOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterTab>('eligible')
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 20, total: 0, totalPages: 0 })
  const [stats, setStats] = useState<SolicitationStats | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [sending, setSending] = useState<Set<string>>(new Set())
  const [bulkSending, setBulkSending] = useState(false)

  // Auto config
  const [showConfig, setShowConfig] = useState(false)
  const [autoConfig, setAutoConfig] = useState<AutoConfig>({ enabled: false, delayDays: 7, maxPerDay: 50 })
  const [savingConfig, setSavingConfig] = useState(false)

  // History
  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory] = useState<SolicitationHistory[]>([])
  const [historyPagination, setHistoryPagination] = useState<Pagination>({ page: 1, pageSize: 20, total: 0, totalPages: 0 })

  const fetchOrders = useCallback(async (page = 1) => {
    setLoading(true)
    try {
      const res = await reviewApi.getOrders({ page, pageSize: 20, filter })
      setOrders(res.data.data)
      setPagination(res.data.pagination)
    } catch (err) {
      console.error('Failed to fetch orders:', err)
    } finally {
      setLoading(false)
    }
  }, [filter])

  const fetchStats = useCallback(async () => {
    try {
      const res = await reviewApi.getStats()
      setStats(res.data)
    } catch (err) {
      console.error('Failed to fetch stats:', err)
    }
  }, [])

  const fetchAutoConfig = useCallback(async () => {
    try {
      const res = await reviewApi.getAutoConfig()
      setAutoConfig(res.data)
    } catch (err) {
      console.error('Failed to fetch auto config:', err)
    }
  }, [])

  useEffect(() => {
    fetchOrders()
    fetchStats()
    fetchAutoConfig()
  }, [fetchOrders, fetchStats, fetchAutoConfig])

  const handleSendSingle = async (orderId: string) => {
    setSending(prev => new Set(prev).add(orderId))
    try {
      await reviewApi.sendSolicitation(orderId)
      setOrders(prev => prev.map(o =>
        o.amazonOrderId === orderId
          ? { ...o, solicitationStatus: 'sent', solicitedAt: new Date().toISOString() }
          : o
      ))
      fetchStats()
    } catch (err: any) {
      alert(err.response?.data?.error || '送信に失敗しました')
    } finally {
      setSending(prev => {
        const next = new Set(prev)
        next.delete(orderId)
        return next
      })
    }
  }

  const handleSendBulk = async () => {
    if (selectedIds.size === 0) return
    setBulkSending(true)
    try {
      const res = await reviewApi.sendBulk([...selectedIds])
      const result = res.data
      const sentSet = new Set(result.sent)
      setOrders(prev => prev.map(o =>
        sentSet.has(o.amazonOrderId)
          ? { ...o, solicitationStatus: 'sent', solicitedAt: new Date().toISOString() }
          : o
      ))
      setSelectedIds(new Set())
      fetchStats()

      const msg = []
      if (result.sent.length > 0) msg.push(`${result.sent.length}件 送信成功`)
      if (result.failed.length > 0) msg.push(`${result.failed.length}件 失敗`)
      if (result.skipped.length > 0) msg.push(`${result.skipped.length}件 スキップ(送信済み)`)
      alert(msg.join('\n'))
    } catch (err: any) {
      alert(err.response?.data?.error || '一括送信に失敗しました')
    } finally {
      setBulkSending(false)
    }
  }

  const handleSaveConfig = async () => {
    setSavingConfig(true)
    try {
      const res = await reviewApi.updateAutoConfig(autoConfig)
      setAutoConfig(res.data)
    } catch (err) {
      alert('設定の保存に失敗しました')
    } finally {
      setSavingConfig(false)
    }
  }

  const fetchHistory = async (page = 1) => {
    try {
      const res = await reviewApi.getHistory({ page, pageSize: 20 })
      setHistory(res.data.data)
      setHistoryPagination(res.data.pagination)
    } catch (err) {
      console.error('Failed to fetch history:', err)
    }
  }

  const toggleHistory = () => {
    if (!showHistory) fetchHistory()
    setShowHistory(prev => !prev)
  }

  const toggleSelectAll = () => {
    const eligible = orders.filter(o => !o.solicitationStatus)
    if (selectedIds.size === eligible.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(eligible.map(o => o.amazonOrderId)))
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const formatDate = (d: string) => {
    return new Date(d).toLocaleDateString('ja-JP', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })
  }

  const daysSince = (d: string) => {
    return Math.floor((Date.now() - new Date(d).getTime()) / (1000 * 60 * 60 * 24))
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
            <div className="text-sm text-slate-500 dark:text-slate-400">本日送信数</div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{stats.today.sent}</div>
          </div>
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
            <div className="text-sm text-slate-500 dark:text-slate-400">過去30日 送信数</div>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">{stats.last30Days.sent}</div>
          </div>
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
            <div className="text-sm text-slate-500 dark:text-slate-400">過去30日 失敗数</div>
            <div className="text-2xl font-bold text-red-600 dark:text-red-400 mt-1">{stats.last30Days.failed}</div>
          </div>
        </div>
      )}

      {/* Auto Config Toggle */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        <button
          onClick={() => setShowConfig(prev => !prev)}
          className="w-full flex items-center justify-between p-4 text-left cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <Settings size={18} className="text-slate-500" />
            <span className="font-medium text-slate-900 dark:text-white">自動送信設定</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              autoConfig.enabled
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400'
                : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
            }`}>
              {autoConfig.enabled ? 'ON' : 'OFF'}
            </span>
          </div>
          {showConfig ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
        </button>

        {showConfig && (
          <div className="px-4 pb-4 border-t border-slate-100 dark:border-slate-700 pt-4 space-y-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={autoConfig.enabled}
                onChange={e => setAutoConfig(prev => ({ ...prev, enabled: e.target.checked }))}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-slate-700 dark:text-slate-300">自動レビューリクエスト送信を有効化</span>
            </label>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1">
                  購入後の待機日数
                </label>
                <input
                  type="number"
                  min={5}
                  max={30}
                  value={autoConfig.delayDays}
                  onChange={e => setAutoConfig(prev => ({ ...prev, delayDays: parseInt(e.target.value) || 7 }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm"
                />
                <p className="text-xs text-slate-400 mt-1">5〜30日（推奨: 7日）</p>
              </div>
              <div>
                <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1">
                  1日の最大送信数
                </label>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={autoConfig.maxPerDay}
                  onChange={e => setAutoConfig(prev => ({ ...prev, maxPerDay: parseInt(e.target.value) || 50 }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm"
                />
                <p className="text-xs text-slate-400 mt-1">SP-APIのレート制限に注意</p>
              </div>
            </div>

            <button
              onClick={handleSaveConfig}
              disabled={savingConfig}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors cursor-pointer"
            >
              {savingConfig ? '保存中...' : '設定を保存'}
            </button>
          </div>
        )}
      </div>

      {/* Filter Tabs & Actions */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700">
          {([
            { key: 'eligible', label: '未送信' },
            { key: 'sent', label: '送信済み' },
            { key: 'all', label: 'すべて' },
          ] as { key: FilterTab; label: string }[]).map(tab => (
            <button
              key={tab.key}
              onClick={() => { setFilter(tab.key); setSelectedIds(new Set()) }}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                filter === tab.key
                  ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {filter === 'eligible' && selectedIds.size > 0 && (
            <button
              onClick={handleSendBulk}
              disabled={bulkSending}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors cursor-pointer"
            >
              <Send size={14} />
              {bulkSending ? '送信中...' : `${selectedIds.size}件を一括送信`}
            </button>
          )}
          <button
            onClick={() => fetchOrders(pagination.page)}
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <RefreshCw size={16} className="text-slate-500" />
          </button>
        </div>
      </div>

      {/* Orders Table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
              {filter === 'eligible' && (
                <th className="w-10 px-3 py-3">
                  <input
                    type="checkbox"
                    onChange={toggleSelectAll}
                    checked={orders.filter(o => !o.solicitationStatus).length > 0 && selectedIds.size === orders.filter(o => !o.solicitationStatus).length}
                    className="w-4 h-4 rounded border-slate-300"
                  />
                </th>
              )}
              <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-400">注文ID</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-400">購入日</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-400">経過日数</th>
              <th className="text-right px-4 py-3 font-medium text-slate-600 dark:text-slate-400">金額</th>
              <th className="text-center px-4 py-3 font-medium text-slate-600 dark:text-slate-400">商品数</th>
              <th className="text-center px-4 py-3 font-medium text-slate-600 dark:text-slate-400">ステータス</th>
              <th className="text-center px-4 py-3 font-medium text-slate-600 dark:text-slate-400">アクション</th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-slate-900">
            {loading ? (
              <tr>
                <td colSpan={8} className="text-center py-12 text-slate-400">
                  <RefreshCw size={20} className="animate-spin mx-auto mb-2" />
                  読み込み中...
                </td>
              </tr>
            ) : orders.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-12 text-slate-400">
                  対象のオーダーがありません
                </td>
              </tr>
            ) : orders.map(order => (
              <tr key={order.amazonOrderId} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/30">
                {filter === 'eligible' && (
                  <td className="px-3 py-3">
                    {!order.solicitationStatus && (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(order.amazonOrderId)}
                        onChange={() => toggleSelect(order.amazonOrderId)}
                        className="w-4 h-4 rounded border-slate-300"
                      />
                    )}
                  </td>
                )}
                <td className="px-4 py-3 font-mono text-xs text-slate-700 dark:text-slate-300">
                  {order.amazonOrderId}
                </td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                  {formatDate(order.purchaseDate)}
                </td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                  {daysSince(order.purchaseDate)}日前
                </td>
                <td className="px-4 py-3 text-right text-slate-700 dark:text-slate-300">
                  {order.orderTotal
                    ? `${order.orderTotal.currency === 'JPY' ? '¥' : order.orderTotal.currency}${Number(order.orderTotal.amount).toLocaleString()}`
                    : '-'
                  }
                </td>
                <td className="px-4 py-3 text-center text-slate-600 dark:text-slate-400">
                  {order.numberOfItemsShipped}
                </td>
                <td className="px-4 py-3 text-center">
                  {order.solicitationStatus === 'sent' ? (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400">
                      <CheckCircle size={12} /> 送信済み
                    </span>
                  ) : order.solicitationStatus === 'failed' ? (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400">
                      <XCircle size={12} /> 失敗
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400">
                      <Clock size={12} /> 未送信
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  {!order.solicitationStatus && (
                    <button
                      onClick={() => handleSendSingle(order.amazonOrderId)}
                      disabled={sending.has(order.amazonOrderId)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/50 disabled:opacity-50 transition-colors cursor-pointer"
                    >
                      <Send size={12} />
                      {sending.has(order.amazonOrderId) ? '送信中' : '送信'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>{pagination.total}件中 {(pagination.page - 1) * pagination.pageSize + 1}-{Math.min(pagination.page * pagination.pageSize, pagination.total)}件</span>
          <div className="flex gap-1">
            <button
              onClick={() => fetchOrders(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="px-3 py-1 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-30 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              前へ
            </button>
            <button
              onClick={() => fetchOrders(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              className="px-3 py-1 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-30 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              次へ
            </button>
          </div>
        </div>
      )}

      {/* History Section */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        <button
          onClick={toggleHistory}
          className="w-full flex items-center justify-between p-4 text-left cursor-pointer"
        >
          <span className="font-medium text-slate-900 dark:text-white">送信履歴</span>
          {showHistory ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
        </button>

        {showHistory && (
          <div className="border-t border-slate-100 dark:border-slate-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/50">
                  <th className="text-left px-4 py-2 font-medium text-slate-600 dark:text-slate-400">注文ID</th>
                  <th className="text-center px-4 py-2 font-medium text-slate-600 dark:text-slate-400">ステータス</th>
                  <th className="text-left px-4 py-2 font-medium text-slate-600 dark:text-slate-400">送信日時</th>
                  <th className="text-left px-4 py-2 font-medium text-slate-600 dark:text-slate-400">エラー</th>
                </tr>
              </thead>
              <tbody>
                {history.length === 0 ? (
                  <tr><td colSpan={4} className="text-center py-8 text-slate-400">履歴がありません</td></tr>
                ) : history.map(h => (
                  <tr key={h.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-4 py-2 font-mono text-xs text-slate-700 dark:text-slate-300">{h.amazonOrderId}</td>
                    <td className="px-4 py-2 text-center">
                      {h.status === 'sent' ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400">成功</span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400">失敗</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{formatDate(h.sentAt)}</td>
                    <td className="px-4 py-2 text-xs text-red-500 truncate max-w-48">{h.errorMessage || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {historyPagination.totalPages > 1 && (
              <div className="flex justify-end gap-1 p-3">
                <button
                  onClick={() => fetchHistory(historyPagination.page - 1)}
                  disabled={historyPagination.page <= 1}
                  className="px-3 py-1 text-xs rounded border border-slate-200 dark:border-slate-700 disabled:opacity-30 cursor-pointer"
                >
                  前へ
                </button>
                <button
                  onClick={() => fetchHistory(historyPagination.page + 1)}
                  disabled={historyPagination.page >= historyPagination.totalPages}
                  className="px-3 py-1 text-xs rounded border border-slate-200 dark:border-slate-700 disabled:opacity-30 cursor-pointer"
                >
                  次へ
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
