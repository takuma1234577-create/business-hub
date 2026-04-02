import { useState, useEffect, useCallback, useRef } from 'react'
import { documentApi } from './api'
import type { AccountingDocument, DocumentType } from './types'
import { DOCUMENT_TYPE_LABELS, COMMON_ACCOUNT_TITLES } from './types'
import { Upload, FileUp, X, Loader2, CheckCircle, AlertTriangle } from 'lucide-react'

const formatCurrency = (amount: number | null, currency = 'JPY') => {
  if (amount == null) return '-'
  if (currency === 'JPY') return `¥${amount.toLocaleString()}`
  return `${amount.toLocaleString()} ${currency}`
}

export function PendingDocuments() {
  const [pendingDocs, setPendingDocs] = useState<AccountingDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [uploadResults, setUploadResults] = useState<{ name: string; success: boolean; error?: string }[]>([])
  const [showManualForm, setShowManualForm] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchPending = useCallback(async () => {
    setLoading(true)
    try {
      const res = await documentApi.list({ status: 'pending', limit: 100 })
      setPendingDocs(res.documents)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchPending() }, [fetchPending])

  const handleFiles = async (files: FileList | File[]) => {
    setUploading(true)
    const results: typeof uploadResults = []

    for (const file of Array.from(files)) {
      try {
        await documentApi.upload(file)
        results.push({ name: file.name, success: true })
      } catch (err: any) {
        const msg = err.response?.data?.error || err.message
        results.push({ name: file.name, success: false, error: msg })
      }
    }

    setUploadResults(results)
    setUploading(false)
    fetchPending()
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragActive(false)
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files)
  }

  const handleConfirm = async (id: string) => {
    await documentApi.update(id, { status: 'confirmed' } as any)
    fetchPending()
  }

  return (
    <div className="space-y-6">
      {/* アップロードゾーン */}
      <div
        className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
          dragActive ? 'border-violet-400 bg-violet-50' : 'border-gray-200 bg-white hover:border-gray-300'
        }`}
        onDragOver={e => { e.preventDefault(); setDragActive(true) }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
      >
        {uploading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 size={32} className="text-violet-500 animate-spin" />
            <p className="text-sm text-gray-600">アップロード中...</p>
          </div>
        ) : (
          <>
            <Upload size={32} className="mx-auto text-gray-400 mb-3" />
            <p className="text-sm text-gray-600 mb-1">
              PDF・画像ファイルをドラッグ＆ドロップ
            </p>
            <p className="text-xs text-gray-400 mb-3">または</p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700"
            >
              <FileUp size={14} className="inline mr-1" />
              ファイルを選択
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.gif"
              multiple
              className="hidden"
              onChange={e => e.target.files && handleFiles(e.target.files)}
            />
          </>
        )}
      </div>

      {/* アップロード結果 */}
      {uploadResults.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-700">アップロード結果</h3>
            <button onClick={() => setUploadResults([])} className="text-gray-400 hover:text-gray-600">
              <X size={16} />
            </button>
          </div>
          {uploadResults.map((r, i) => (
            <div key={i} className={`flex items-center gap-2 text-sm ${r.success ? 'text-emerald-600' : 'text-red-600'}`}>
              {r.success ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
              <span>{r.name}</span>
              {r.error && <span className="text-xs text-gray-500">({r.error})</span>}
            </div>
          ))}
        </div>
      )}

      {/* 手動登録ボタン */}
      <div className="flex justify-end">
        <button
          onClick={() => setShowManualForm(!showManualForm)}
          className="text-sm px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50"
        >
          {showManualForm ? '閉じる' : '手動で書類を登録'}
        </button>
      </div>

      {/* 手動登録フォーム */}
      {showManualForm && <ManualForm onSaved={() => { setShowManualForm(false); fetchPending() }} />}

      {/* 未確認書類一覧 */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-medium text-gray-700">
            未確認書類 ({pendingDocs.length}件)
          </h3>
        </div>
        {loading ? (
          <div className="p-8 text-center text-gray-400">読み込み中...</div>
        ) : pendingDocs.length === 0 ? (
          <div className="p-8 text-center text-gray-400">未確認の書類はありません</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {pendingDocs.map(doc => (
              <div key={doc.id} className="px-5 py-4 flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {doc.vendorName || doc.originalFilename || '不明'}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {DOCUMENT_TYPE_LABELS[doc.documentType]}
                    {doc.amountIncludingTax != null && ` · ${formatCurrency(doc.amountIncludingTax, doc.currency)}`}
                    {doc.accountTitle && ` · ${doc.accountTitle}`}
                    {doc.aiConfidence != null && ` · AI信頼度 ${Math.round(doc.aiConfidence * 100)}%`}
                  </p>
                </div>
                <div className="flex gap-2 ml-4">
                  <button
                    onClick={() => handleConfirm(doc.id)}
                    className="text-xs px-3 py-1.5 bg-emerald-500 text-white rounded-md hover:bg-emerald-600"
                  >
                    確認済みにする
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// 手動登録フォーム
function ManualForm({ onSaved }: { onSaved: () => void }) {
  const [form, setForm] = useState({
    documentType: 'other' as DocumentType,
    source: 'manual' as const,
    status: 'pending' as const,
    vendorName: '',
    documentDate: '',
    dueDate: '',
    amountExcludingTax: '',
    taxAmount: '',
    amountIncludingTax: '',
    currency: 'JPY',
    documentNumber: '',
    accountTitle: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await documentApi.create({
        ...form,
        amountExcludingTax: form.amountExcludingTax ? Number(form.amountExcludingTax) : null,
        taxAmount: form.taxAmount ? Number(form.taxAmount) : null,
        amountIncludingTax: form.amountIncludingTax ? Number(form.amountIncludingTax) : null,
      } as any)
      onSaved()
    } catch (err) {
      console.error(err)
      alert('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
      <h3 className="text-sm font-medium text-gray-700 border-b border-gray-100 pb-2">書類手動登録</h3>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">書類種別</label>
          <select value={form.documentType} onChange={e => setForm(f => ({ ...f, documentType: e.target.value as DocumentType }))}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg">
            {Object.entries(DOCUMENT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">取引先名</label>
          <input type="text" value={form.vendorName} onChange={e => setForm(f => ({ ...f, vendorName: e.target.value }))}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">書類日付</label>
          <input type="date" value={form.documentDate} onChange={e => setForm(f => ({ ...f, documentDate: e.target.value }))}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">支払期日</label>
          <input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">税抜金額</label>
          <input type="number" value={form.amountExcludingTax} onChange={e => setForm(f => ({ ...f, amountExcludingTax: e.target.value }))}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">消費税額</label>
          <input type="number" value={form.taxAmount} onChange={e => setForm(f => ({ ...f, taxAmount: e.target.value }))}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">税込金額</label>
          <input type="number" value={form.amountIncludingTax} onChange={e => setForm(f => ({ ...f, amountIncludingTax: e.target.value }))}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">通貨</label>
          <select value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg">
            <option value="JPY">JPY</option>
            <option value="USD">USD</option>
            <option value="CNY">CNY</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">書類番号</label>
          <input type="text" value={form.documentNumber} onChange={e => setForm(f => ({ ...f, documentNumber: e.target.value }))}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">勘定科目</label>
          <select value={form.accountTitle} onChange={e => setForm(f => ({ ...f, accountTitle: e.target.value }))}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg">
            <option value="">選択してください</option>
            {COMMON_ACCOUNT_TITLES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">メモ</label>
        <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          rows={2} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none" />
      </div>

      <div className="flex justify-end">
        <button type="submit" disabled={saving}
          className="px-4 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50">
          {saving ? '保存中...' : '登録'}
        </button>
      </div>
    </form>
  )
}
