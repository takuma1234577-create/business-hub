import { useState, useEffect, useCallback } from 'react'
import { documentApi } from './api'
import type { AccountingDocument, DocumentType, DocumentStatus } from './types'
import { DOCUMENT_TYPE_LABELS, DOCUMENT_STATUS_LABELS, DOCUMENT_SOURCE_LABELS } from './types'
import { Search, ChevronLeft, ChevronRight, CheckSquare, Square, Trash2 } from 'lucide-react'

const formatCurrency = (amount: number | null, currency = 'JPY') => {
  if (amount == null) return '-'
  if (currency === 'JPY') return `¥${amount.toLocaleString()}`
  if (currency === 'USD') return `$${amount.toLocaleString()}`
  return `${amount.toLocaleString()} ${currency}`
}

const formatDate = (dateStr: string | null) => {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

interface Props {
  onSelect?: (doc: AccountingDocument) => void
}

export function DocumentList({ onSelect }: Props) {
  const [documents, setDocuments] = useState<AccountingDocument[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<DocumentStatus | ''>('')
  const [filterType, setFilterType] = useState<DocumentType | ''>('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const limit = 20

  const fetchDocs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await documentApi.list({
        page,
        limit,
        status: filterStatus || undefined,
        type: filterType || undefined,
        search: search || undefined,
      })
      setDocuments(res.documents)
      setTotal(res.total)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [page, filterStatus, filterType, search])

  useEffect(() => { fetchDocs() }, [fetchDocs])

  const totalPages = Math.ceil(total / limit)

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === documents.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(documents.map(d => d.id)))
    }
  }

  const handleBulkStatus = async (status: DocumentStatus) => {
    if (selected.size === 0) return
    await documentApi.bulkUpdateStatus([...selected], status)
    setSelected(new Set())
    fetchDocs()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('この書類を削除しますか？')) return
    await documentApi.delete(id)
    fetchDocs()
  }

  return (
    <div className="space-y-4">
      {/* フィルター */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="取引先名・書類番号で検索..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
          />
        </div>
        <select
          value={filterStatus}
          onChange={e => { setFilterStatus(e.target.value as DocumentStatus | ''); setPage(1) }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white"
        >
          <option value="">全ステータス</option>
          {Object.entries(DOCUMENT_STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          value={filterType}
          onChange={e => { setFilterType(e.target.value as DocumentType | ''); setPage(1) }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white"
        >
          <option value="">全種別</option>
          {Object.entries(DOCUMENT_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      {/* 一括操作 */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 bg-violet-50 border border-violet-200 rounded-lg px-4 py-2">
          <span className="text-sm text-violet-700 font-medium">{selected.size}件選択中</span>
          <button onClick={() => handleBulkStatus('confirmed')} className="text-xs px-3 py-1 bg-emerald-500 text-white rounded-md hover:bg-emerald-600">確認済みにする</button>
          <button onClick={() => handleBulkStatus('journalized')} className="text-xs px-3 py-1 bg-purple-500 text-white rounded-md hover:bg-purple-600">仕訳済みにする</button>
          <button onClick={() => setSelected(new Set())} className="text-xs text-gray-500 hover:text-gray-700 ml-auto">選択解除</button>
        </div>
      )}

      {/* テーブル */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400">読み込み中...</div>
        ) : documents.length === 0 ? (
          <div className="p-8 text-center text-gray-400">書類が見つかりません</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-3 py-3 text-left w-10">
                    <button onClick={toggleAll} className="text-gray-400 hover:text-gray-600">
                      {selected.size === documents.length ? <CheckSquare size={16} /> : <Square size={16} />}
                    </button>
                  </th>
                  <th className="px-3 py-3 text-left">取引先</th>
                  <th className="px-3 py-3 text-left">種別</th>
                  <th className="px-3 py-3 text-left">日付</th>
                  <th className="px-3 py-3 text-right">金額</th>
                  <th className="px-3 py-3 text-left">勘定科目</th>
                  <th className="px-3 py-3 text-left">取得元</th>
                  <th className="px-3 py-3 text-left">ステータス</th>
                  <th className="px-3 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {documents.map(doc => (
                  <tr
                    key={doc.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => onSelect?.(doc)}
                  >
                    <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                      <button onClick={() => toggleSelect(doc.id)} className="text-gray-400 hover:text-gray-600">
                        {selected.has(doc.id) ? <CheckSquare size={16} className="text-violet-500" /> : <Square size={16} />}
                      </button>
                    </td>
                    <td className="px-3 py-3 font-medium text-gray-900 max-w-[200px] truncate">
                      {doc.vendorName || doc.originalFilename || '-'}
                    </td>
                    <td className="px-3 py-3 text-gray-600">{DOCUMENT_TYPE_LABELS[doc.documentType]}</td>
                    <td className="px-3 py-3 text-gray-600">{formatDate(doc.documentDate)}</td>
                    <td className="px-3 py-3 text-right font-medium text-gray-900">
                      {formatCurrency(doc.amountIncludingTax, doc.currency)}
                    </td>
                    <td className="px-3 py-3 text-gray-600">{doc.accountTitle || '-'}</td>
                    <td className="px-3 py-3 text-gray-600">{DOCUMENT_SOURCE_LABELS[doc.source]}</td>
                    <td className="px-3 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        doc.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                        doc.status === 'confirmed' ? 'bg-emerald-100 text-emerald-700' :
                        'bg-purple-100 text-purple-700'
                      }`}>
                        {DOCUMENT_STATUS_LABELS[doc.status]}
                      </span>
                    </td>
                    <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                      <button onClick={() => handleDelete(doc.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ページネーション */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <span className="text-xs text-gray-500">全{total}件中 {(page - 1) * limit + 1}〜{Math.min(page * limit, total)}件</span>
            <div className="flex gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-1 rounded hover:bg-gray-100 disabled:opacity-30">
                <ChevronLeft size={16} />
              </button>
              <span className="px-3 py-1 text-sm text-gray-600">{page} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-1 rounded hover:bg-gray-100 disabled:opacity-30">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
