import { useState, useEffect } from 'react'
import { dashboardApi, documentApi } from './api'
import type { DashboardStats, AccountingDocument } from './types'
import { DOCUMENT_TYPE_LABELS, DOCUMENT_STATUS_LABELS } from './types'
import { FileText, Clock, CheckCircle, BookOpen, TrendingUp, AlertCircle } from 'lucide-react'

const formatCurrency = (amount: number, currency = 'JPY') => {
  if (currency === 'JPY') return `¥${amount.toLocaleString()}`
  if (currency === 'USD') return `$${amount.toLocaleString()}`
  return `${amount.toLocaleString()} ${currency}`
}

const formatDate = (dateStr: string | null) => {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

export function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [recentDocs, setRecentDocs] = useState<AccountingDocument[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      dashboardApi.stats(),
      documentApi.list({ limit: 10 }),
    ]).then(([s, d]) => {
      setStats(s)
      setRecentDocs(d.documents)
    }).catch(console.error).finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-24 bg-gray-100 rounded-lg animate-pulse" />
        ))}
      </div>
    )
  }

  if (!stats) return <p className="text-gray-500">データの取得に失敗しました</p>

  const statCards = [
    { label: '総書類数', value: stats.totalDocuments, icon: FileText, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: '未確認', value: stats.pendingCount, icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50' },
    { label: '確認済み', value: stats.confirmedCount, icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: '仕訳済み', value: stats.journalizedCount, icon: BookOpen, color: 'text-purple-600', bg: 'bg-purple-50' },
  ]

  return (
    <div className="space-y-6">
      {/* サマリーカード */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statCards.map(card => (
          <div key={card.label} className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${card.bg}`}>
                <card.icon size={20} className={card.color} />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{card.value}</p>
                <p className="text-xs text-gray-500">{card.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 金額サマリー */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={18} className="text-blue-500" />
            <span className="text-sm text-gray-500">今月の合計金額</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(stats.thisMonthTotal)}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={18} className="text-emerald-500" />
            <span className="text-sm text-gray-500">今年の合計金額</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(stats.thisYearTotal)}</p>
        </div>
      </div>

      {/* 書類種別内訳 */}
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <h3 className="text-sm font-medium text-gray-700 mb-3">書類種別内訳</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {(Object.entries(DOCUMENT_TYPE_LABELS) as [string, string][]).map(([key, label]) => (
            <div key={key} className="text-center p-3 bg-gray-50 rounded-lg">
              <p className="text-lg font-semibold text-gray-900">{stats.byType[key as keyof typeof stats.byType] || 0}</p>
              <p className="text-xs text-gray-500">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 最近の書類 */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-medium text-gray-700">最近の書類</h3>
        </div>
        {recentDocs.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            <AlertCircle size={24} className="mx-auto mb-2" />
            <p>書類がまだありません</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {recentDocs.map(doc => (
              <div key={doc.id} className="px-5 py-3 flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {doc.vendorName || doc.originalFilename || '不明'}
                  </p>
                  <p className="text-xs text-gray-500">
                    {DOCUMENT_TYPE_LABELS[doc.documentType]} · {formatDate(doc.documentDate)}
                  </p>
                </div>
                <div className="text-right ml-4">
                  {doc.amountIncludingTax != null && (
                    <p className="text-sm font-medium text-gray-900">
                      {formatCurrency(doc.amountIncludingTax, doc.currency)}
                    </p>
                  )}
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    doc.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                    doc.status === 'confirmed' ? 'bg-emerald-100 text-emerald-700' :
                    'bg-purple-100 text-purple-700'
                  }`}>
                    {DOCUMENT_STATUS_LABELS[doc.status]}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
