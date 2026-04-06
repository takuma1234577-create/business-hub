import { useState, useEffect } from 'react'
import ToolLayout from '../components/ToolLayout'
import {
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react'

interface ReviewLog {
  id: string
  order_id: string
  customer_name: string
  request_type: 'return' | 'exchange'
  reason: string
  reason_detail: string | null
  image_count: number
  ai_approved: boolean
  ai_confidence: number
  ai_reason: string
  ai_flags: string[]
  rule_check_passed: boolean
  rule_fail_reasons: string[]
  final_result: 'approved' | 'denied'
  shopify_result: string
  line_notified: boolean
  created_at: string
}

interface Pagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

const REASON_MAP: Record<string, string> = {
  defective: '初期不良',
  wrong_item: '誤送品',
  size_color_mismatch: 'サイズ・カラー不一致',
  changed_mind: '気が変わった',
  other: 'その他',
}

export default function ReturnLogs() {
  const [logs, setLogs] = useState<ReviewLog[]>([])
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
  })
  const [loading, setLoading] = useState(true)
  const [filterResult, setFilterResult] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selectedLog, setSelectedLog] = useState<ReviewLog | null>(null)

  const fetchLogs = async (page = 1) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' })
      if (filterResult !== 'all') params.set('result', filterResult)
      if (filterType !== 'all') params.set('requestType', filterType)
      if (dateFrom) params.set('dateFrom', dateFrom)
      if (dateTo) params.set('dateTo', dateTo)

      const resp = await fetch(`/api/return-review/logs?${params}`)
      const data = await resp.json()
      setLogs(data.data || [])
      setPagination(data.pagination || { page: 1, pageSize: 20, total: 0, totalPages: 0 })
    } catch {
      setLogs([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchLogs(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterResult, filterType, dateFrom, dateTo])

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <ToolLayout title="審査ログ一覧">
      <div className="space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-end bg-white dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
          <div>
            <label className="block text-xs text-slate-500 mb-1">判定結果</label>
            <select
              value={filterResult}
              onChange={(e) => setFilterResult(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">すべて</option>
              <option value="approved">承認のみ</option>
              <option value="denied">否認のみ</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">申請タイプ</label>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">すべて</option>
              <option value="return">返品</option>
              <option value="exchange">交換</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">開始日</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">終了日</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 size={32} className="animate-spin text-slate-400" />
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            審査ログがありません
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900">
                    <th className="text-left px-4 py-3 font-medium text-slate-500">
                      申請日時
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-slate-500">
                      注文番号
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-slate-500">
                      タイプ
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-slate-500">
                      判定
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-slate-500">
                      確信度
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-slate-500">
                      理由
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr
                      key={log.id}
                      onClick={() => setSelectedLog(log)}
                      className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900/50 cursor-pointer transition"
                    >
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {formatDate(log.created_at)}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-900 dark:text-white">
                        {log.order_id}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                            log.request_type === 'return'
                              ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400'
                              : 'bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400'
                          }`}
                        >
                          {log.request_type === 'return' ? '返品' : '交換'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {log.final_result === 'approved' ? (
                          <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                            <CheckCircle2 size={14} /> 承認
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
                            <XCircle size={14} /> 否認
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                        {(log.ai_confidence * 100).toFixed(0)}%
                      </td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400 max-w-[240px] truncate">
                        {REASON_MAP[log.reason] || log.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {pagination.totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 dark:border-slate-800">
                <span className="text-sm text-slate-500">
                  {pagination.total}件中 {(pagination.page - 1) * pagination.pageSize + 1}〜
                  {Math.min(pagination.page * pagination.pageSize, pagination.total)}件
                </span>
                <div className="flex gap-1">
                  <button
                    disabled={pagination.page <= 1}
                    onClick={() => fetchLogs(pagination.page - 1)}
                    className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 transition cursor-pointer"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    disabled={pagination.page >= pagination.totalPages}
                    onClick={() => fetchLogs(pagination.page + 1)}
                    className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 transition cursor-pointer"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Detail Modal */}
        {selectedLog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto">
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
                <h3 className="font-semibold text-slate-900 dark:text-white">
                  審査詳細
                </h3>
                <button
                  onClick={() => setSelectedLog(null)}
                  className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="px-6 py-4 space-y-3 text-sm">
                <Row label="申請日時" value={formatDate(selectedLog.created_at)} />
                <Row label="注文番号" value={selectedLog.order_id} />
                <Row label="お客様名" value={selectedLog.customer_name} />
                <Row
                  label="申請タイプ"
                  value={selectedLog.request_type === 'return' ? '返品・返金' : '交換'}
                />
                <Row
                  label="返品理由"
                  value={REASON_MAP[selectedLog.reason] || selectedLog.reason}
                />
                {selectedLog.reason_detail && (
                  <Row label="補足説明" value={selectedLog.reason_detail} />
                )}
                <Row label="写真枚数" value={`${selectedLog.image_count}枚`} />
                <hr className="border-slate-200 dark:border-slate-800" />
                <Row
                  label="最終判定"
                  value={selectedLog.final_result === 'approved' ? '承認' : '否認'}
                  highlight={selectedLog.final_result}
                />
                <Row
                  label="AI判定"
                  value={selectedLog.ai_approved ? '承認' : '否認'}
                />
                <Row
                  label="AI確信度"
                  value={`${(selectedLog.ai_confidence * 100).toFixed(0)}%`}
                />
                <Row label="AI判定理由" value={selectedLog.ai_reason} />
                {selectedLog.ai_flags?.length > 0 && (
                  <Row label="AIフラグ" value={selectedLog.ai_flags.join(', ')} />
                )}
                {selectedLog.rule_fail_reasons?.length > 0 && (
                  <div>
                    <span className="text-slate-500 block mb-1">ルールチェック不合格理由</span>
                    <ul className="list-disc pl-5 text-red-600 dark:text-red-400">
                      {selectedLog.rule_fail_reasons.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <hr className="border-slate-200 dark:border-slate-800" />
                <Row
                  label="Shopify処理"
                  value={
                    selectedLog.shopify_result === 'success'
                      ? '完了'
                      : selectedLog.shopify_result === 'skipped'
                        ? 'スキップ'
                        : 'エラー'
                  }
                />
                <Row
                  label="LINE通知"
                  value={selectedLog.line_notified ? '送信済み' : '未送信'}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </ToolLayout>
  )
}

function Row({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight?: string
}) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span
        className={`text-right ${
          highlight === 'approved'
            ? 'text-green-600 dark:text-green-400 font-semibold'
            : highlight === 'denied'
              ? 'text-red-600 dark:text-red-400 font-semibold'
              : 'text-slate-900 dark:text-white'
        }`}
      >
        {value}
      </span>
    </div>
  )
}
