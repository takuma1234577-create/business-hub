import { useState, useEffect, useCallback } from 'react'
import {
  ShoppingBag,
  Music,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Package,
  AlertCircle,
  Loader2,
} from 'lucide-react'
import { orderApi } from './api'
import type {
  Order,
  OrderStatus,
  Channel,
  FulfillmentLog,
  PaginationInfo,
} from './types'

const STATUS_CONFIG: Record<
  OrderStatus,
  { label: string; bg: string; text: string }
> = {
  PENDING: { label: '保留中', bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-800 dark:text-yellow-300' },
  SUBMITTED: { label: '送信済', bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-800 dark:text-blue-300' },
  SHIPPED: { label: '出荷済', bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-800 dark:text-green-300' },
  TRACKING_UPDATED: { label: '追跡更新', bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-800 dark:text-emerald-300' },
  CANCELLED: { label: 'キャンセル', bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-600 dark:text-slate-400' },
  ERROR: { label: 'エラー', bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-800 dark:text-red-300' },
}

function StatusBadge({ status }: { status: OrderStatus }) {
  const config = STATUS_CONFIG[status]
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.bg} ${config.text}`}
    >
      {config.label}
    </span>
  )
}

function ChannelIcon({ channel }: { channel: Channel }) {
  if (channel === 'SHOPIFY') {
    return (
      <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400" title="Shopify">
        <ShoppingBag size={16} />
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-pink-600 dark:text-pink-400" title="TikTok">
      <Music size={16} />
    </span>
  )
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function OrderDetail({ order }: { order: Order }) {
  const [detail, setDetail] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    orderApi
      .getById(order.id)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoading(false))
  }, [order.id])

  if (loading) {
    return (
      <div className="px-6 py-4 flex items-center gap-2 text-slate-500 dark:text-slate-400">
        <Loader2 size={16} className="animate-spin" />
        読み込み中...
      </div>
    )
  }

  if (!detail) return null

  return (
    <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-700">
      {/* Address */}
      <div className="mb-4">
        <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase mb-1">
          配送先
        </h4>
        <p className="text-sm text-slate-700 dark:text-slate-300">
          {detail.recipientName}
          <br />
          {detail.addressLine1}
          {detail.addressLine2 && `, ${detail.addressLine2}`}
          <br />
          {detail.city}
          {detail.stateOrRegion && `, ${detail.stateOrRegion}`} {detail.postalCode} {detail.countryCode}
        </p>
      </div>

      {/* Error Message */}
      {detail.errorMessage && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
            <AlertCircle size={14} />
            <span className="text-sm font-medium">エラー内容</span>
          </div>
          <p className="text-sm text-red-600 dark:text-red-400 mt-1">{detail.errorMessage}</p>
        </div>
      )}

      {/* Items */}
      <div className="mb-4">
        <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase mb-2">
          注文アイテム
        </h4>
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800">
                <th className="text-left px-3 py-2 text-slate-500 dark:text-slate-400 font-medium">
                  商品名
                </th>
                <th className="text-left px-3 py-2 text-slate-500 dark:text-slate-400 font-medium">
                  チャネルSKU
                </th>
                <th className="text-left px-3 py-2 text-slate-500 dark:text-slate-400 font-medium">
                  Amazon SKU
                </th>
                <th className="text-right px-3 py-2 text-slate-500 dark:text-slate-400 font-medium">
                  数量
                </th>
              </tr>
            </thead>
            <tbody>
              {detail.items.map((item) => (
                <tr
                  key={item.id}
                  className="border-t border-slate-100 dark:border-slate-800"
                >
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                    {item.title || '-'}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-slate-400">
                    {item.channelSku}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-slate-400">
                    {item.amazonSku}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-300">
                    {item.quantity}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Fulfillment Logs */}
      {detail.logs && detail.logs.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase mb-2">
            フルフィルメントログ
          </h4>
          <div className="space-y-2">
            {detail.logs.map((log: FulfillmentLog) => (
              <div
                key={log.id}
                className="flex items-start gap-3 text-sm bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 p-3"
              >
                <span className="font-mono text-xs px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded">
                  {log.event}
                </span>
                <span className="text-slate-700 dark:text-slate-300 flex-1">
                  {log.message || '-'}
                </span>
                <span className="text-slate-400 dark:text-slate-500 text-xs whitespace-nowrap">
                  {formatDate(log.createdAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function OrderList() {
  const [orders, setOrders] = useState<Order[]>([])
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
  })
  const [channelFilter, setChannelFilter] = useState<Channel | ''>('')
  const [statusFilter, setStatusFilter] = useState<OrderStatus | ''>('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [fulfilling, setFulfilling] = useState<string | null>(null)
  const [fulfillingAll, setFulfillingAll] = useState(false)
  const [checkingTracking, setCheckingTracking] = useState(false)
  const [syncingShopify, setSyncingShopify] = useState<string | null>(null)
  const [syncingAllShopify, setSyncingAllShopify] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const fetchOrders = useCallback(
    async (page = 1) => {
      setLoading(true)
      try {
        const res = await orderApi.list({
          page,
          channel: channelFilter || undefined,
          status: statusFilter || undefined,
        })
        setOrders(res.data)
        setPagination(res.pagination)
      } catch (err) {
        console.error('Failed to fetch orders', err)
      } finally {
        setLoading(false)
      }
    },
    [channelFilter, statusFilter]
  )

  useEffect(() => {
    fetchOrders(1)
  }, [fetchOrders])

  const handleSync = async () => {
    setSyncing(true)
    setMessage(null)
    try {
      const res = await orderApi.syncFromShopify()
      setMessage({ type: 'success', text: `Shopifyから${res.synced}件の注文を取得しました（${res.skipped}件はスキップ）` })
      fetchOrders(1)
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || '注文同期に失敗しました' })
    }
    setSyncing(false)
  }

  const handleFulfill = async (orderId: string) => {
    setFulfilling(orderId)
    try {
      const res = await orderApi.fulfill(orderId)
      setMessage({ type: 'success', text: `Amazon MCF発送依頼を送信: ${res.mcfOrderId}` })
      fetchOrders(pagination.page)
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || '発送依頼に失敗しました' })
    }
    setFulfilling(null)
  }

  const handleFulfillAll = async () => {
    if (!confirm('全ての保留中注文をAmazon MCFで一括発送しますか？')) return
    setFulfillingAll(true)
    try {
      const res = await orderApi.fulfillAll()
      setMessage({ type: 'success', text: `${res.fulfilled}件を発送依頼（${res.skipped}件はSKU未設定でスキップ）` })
      fetchOrders(1)
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || '一括発送に失敗しました' })
    }
    setFulfillingAll(false)
  }

  const handleCheckTracking = async () => {
    setCheckingTracking(true)
    try {
      const res = await orderApi.checkTracking()
      setMessage({ type: 'success', text: `${res.total}件中${res.updated}件の配送情報を更新しました` })
      fetchOrders(pagination.page)
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || '配送情報の取得に失敗しました' })
    }
    setCheckingTracking(false)
  }

  const handleSyncToShopify = async (orderId: string) => {
    setSyncingShopify(orderId)
    try {
      await orderApi.syncToShopify(orderId)
      setMessage({ type: 'success', text: 'Shopifyに配送情報を反映しました' })
      fetchOrders(pagination.page)
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Shopify反映に失敗しました' })
    }
    setSyncingShopify(null)
  }

  const handleSyncAllToShopify = async () => {
    if (!confirm('追跡番号のある全注文をShopifyに反映しますか？')) return
    setSyncingAllShopify(true)
    try {
      const res = await orderApi.syncAllToShopify()
      setMessage({ type: 'success', text: `${res.synced}件をShopifyに反映しました` })
      fetchOrders(1)
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Shopify一括反映に失敗しました' })
    }
    setSyncingAllShopify(false)
  }

  const handleRetry = async (orderId: string) => {
    setRetrying(orderId)
    try {
      await orderApi.retry(orderId)
      await fetchOrders(pagination.page)
    } catch (err) {
      console.error('Retry failed', err)
    } finally {
      setRetrying(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* Message */}
      {message && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-50 text-green-800 dark:bg-green-950/50 dark:text-green-300 border border-green-200 dark:border-green-800' : 'bg-red-50 text-red-800 dark:bg-red-950/50 dark:text-red-300 border border-red-200 dark:border-red-800'}`}>
          {message.text}
          <button onClick={() => setMessage(null)} className="ml-auto text-xs opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#96BF48] text-white text-sm font-medium hover:bg-[#7ea33d] transition disabled:opacity-50 cursor-pointer"
        >
          {syncing ? <Loader2 size={16} className="animate-spin" /> : <ShoppingBag size={16} />}
          {syncing ? 'Shopify注文取得中...' : 'Shopify注文を取得'}
        </button>
        <button
          onClick={handleFulfillAll}
          disabled={fulfillingAll}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#FF9900] text-white text-sm font-medium hover:bg-[#E88B00] transition disabled:opacity-50 cursor-pointer"
        >
          {fulfillingAll ? <Loader2 size={16} className="animate-spin" /> : <Package size={16} />}
          {fulfillingAll ? '一括発送中...' : 'Amazon一括発送'}
        </button>
        <button
          onClick={handleCheckTracking}
          disabled={checkingTracking}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-blue-600 text-blue-600 text-sm font-medium hover:bg-blue-50 dark:hover:bg-blue-950/50 transition disabled:opacity-50 cursor-pointer"
        >
          {checkingTracking ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          {checkingTracking ? '確認中...' : 'Amazon追跡確認'}
        </button>
        <button
          onClick={handleSyncAllToShopify}
          disabled={syncingAllShopify}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[#96BF48] text-[#96BF48] text-sm font-medium hover:bg-[#96BF48]/10 transition disabled:opacity-50 cursor-pointer"
        >
          {syncingAllShopify ? <Loader2 size={16} className="animate-spin" /> : <ShoppingBag size={16} />}
          {syncingAllShopify ? '反映中...' : 'Shopify一括反映'}
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={channelFilter}
          onChange={(e) => setChannelFilter(e.target.value as Channel | '')}
          className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">全チャネル</option>
          <option value="SHOPIFY">Shopify</option>
          <option value="TIKTOK">TikTok</option>
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as OrderStatus | '')}
          className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">全ステータス</option>
          <option value="PENDING">保留中</option>
          <option value="SUBMITTED">送信済</option>
          <option value="SHIPPED">出荷済</option>
          <option value="TRACKING_UPDATED">追跡更新</option>
          <option value="CANCELLED">キャンセル</option>
          <option value="ERROR">エラー</option>
        </select>

        <button
          onClick={() => fetchOrders(pagination.page)}
          className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors cursor-pointer"
          title="更新"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>

        <span className="ml-auto text-sm text-slate-500 dark:text-slate-400">
          全 {pagination.total} 件
        </span>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        {loading && orders.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-slate-400 dark:text-slate-500">
            <Loader2 size={24} className="animate-spin mr-2" />
            読み込み中...
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500">
            <Package size={40} className="mb-2" />
            <p>注文が見つかりません</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium w-10">
                  CH
                </th>
                <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">
                  注文ID
                </th>
                <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">
                  受取人
                </th>
                <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">
                  商品
                </th>
                <th className="text-right px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">
                  金額
                </th>
                <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">
                  ステータス
                </th>
                <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">
                  追跡番号
                </th>
                <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">
                  注文日
                </th>
                <th className="w-32 px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => {
                const isExpanded = expandedId === order.id
                return (
                  <tr key={order.id} className="group">
                    <td colSpan={9} className="p-0">
                      <div
                        className={`flex items-center cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${
                          isExpanded ? 'bg-slate-50 dark:bg-slate-800/50' : ''
                        }`}
                        onClick={() =>
                          setExpandedId(isExpanded ? null : order.id)
                        }
                      >
                        <div className="w-10 px-4 py-3">
                          <ChannelIcon channel={order.channel} />
                        </div>
                        <div className="flex-1 px-4 py-3 font-mono text-xs text-slate-700 dark:text-slate-300">
                          {order.channelOrderId}
                        </div>
                        <div className="flex-1 px-4 py-3 text-slate-700 dark:text-slate-300">
                          {order.recipientName}
                        </div>
                        <div className="flex-1 px-4 py-3 text-xs text-slate-600 dark:text-slate-400 truncate max-w-[200px]">
                          {order.items?.map(i => i.title).filter(Boolean).join(', ') || '-'}
                        </div>
                        <div className="flex-1 px-4 py-3 text-right font-medium text-slate-700 dark:text-slate-300 text-xs">
                          {order.totalAmount ? `¥${Number(order.totalAmount).toLocaleString()}` : '-'}
                        </div>
                        <div className="flex-1 px-4 py-3">
                          <StatusBadge status={order.status} />
                        </div>
                        <div className="flex-1 px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-400">
                          {order.trackingNumber ? (
                            <div>
                              <span className="text-blue-600 dark:text-blue-400">{order.trackingNumber}</span>
                              {order.carrier && <span className="ml-1 text-slate-400">({order.carrier})</span>}
                            </div>
                          ) : order.mcfOrderId ? (
                            <span className="text-slate-400 text-[10px]">MCF処理中</span>
                          ) : '-'}
                        </div>
                        <div className="flex-1 px-4 py-3 text-slate-500 dark:text-slate-400 text-xs">
                          {order.orderedAt ? formatDate(order.orderedAt) : formatDate(order.createdAt)}
                        </div>
                        <div className="w-32 px-4 py-3 flex items-center justify-end gap-1">
                          {order.status === 'PENDING' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleFulfill(order.id)
                              }}
                              disabled={fulfilling === order.id}
                              className="px-2 py-1 rounded-md bg-[#FF9900] text-white text-xs font-medium hover:bg-[#E88B00] transition cursor-pointer disabled:opacity-50"
                              title="Amazon MCF発送"
                            >
                              {fulfilling === order.id ? '...' : '発送'}
                            </button>
                          )}
                          {order.trackingNumber && order.channel === 'SHOPIFY' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleSyncToShopify(order.id)
                              }}
                              disabled={syncingShopify === order.id}
                              className="px-2 py-1 rounded-md bg-[#96BF48] text-white text-xs font-medium hover:bg-[#7ea33d] transition cursor-pointer disabled:opacity-50"
                              title="Shopifyに反映"
                            >
                              {syncingShopify === order.id ? '...' : 'Shopify'}
                            </button>
                          )}
                          {order.status === 'ERROR' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleRetry(order.id)
                              }}
                              disabled={retrying === order.id}
                              className="p-1.5 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 transition-colors cursor-pointer disabled:opacity-50"
                              title="リトライ"
                            >
                              <RefreshCw
                                size={14}
                                className={
                                  retrying === order.id ? 'animate-spin' : ''
                                }
                              />
                            </button>
                          )}
                          {isExpanded ? (
                            <ChevronUp size={16} className="text-slate-400" />
                          ) : (
                            <ChevronDown size={16} className="text-slate-400" />
                          )}
                        </div>
                      </div>
                      {isExpanded && <OrderDetail order={order} />}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {pagination.page} / {pagination.totalPages} ページ
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => fetchOrders(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={() => fetchOrders(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
