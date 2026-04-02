import { useState, useEffect } from 'react'
import { documentApi } from './api'
import type { AccountingDocument, DocumentType, DocumentStatus } from './types'
import { DOCUMENT_TYPE_LABELS, DOCUMENT_STATUS_LABELS, COMMON_ACCOUNT_TITLES } from './types'
import { ArrowLeft, Save, RefreshCw, ExternalLink } from 'lucide-react'

interface Props {
  documentId: string
  onBack: () => void
}

export function DocumentDetail({ documentId, onBack }: Props) {
  const [doc, setDoc] = useState<AccountingDocument | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [form, setForm] = useState<Partial<AccountingDocument>>({})

  useEffect(() => {
    documentApi.get(documentId).then(d => {
      setDoc(d)
      setForm(d)
    }).catch(console.error).finally(() => setLoading(false))
  }, [documentId])

  const handleSave = async () => {
    setSaving(true)
    try {
      const updated = await documentApi.update(documentId, form)
      setDoc(updated)
      setForm(updated)
    } catch (err) {
      console.error(err)
      alert('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleReanalyze = async () => {
    setAnalyzing(true)
    try {
      const updated = await documentApi.analyze(documentId)
      setDoc(updated)
      setForm(updated)
    } catch (err) {
      console.error(err)
      alert('AI解析に失敗しました')
    } finally {
      setAnalyzing(false)
    }
  }

  if (loading) return <div className="p-8 text-center text-gray-400">読み込み中...</div>
  if (!doc) return <div className="p-8 text-center text-red-500">書類が見つかりません</div>

  return (
    <div className="space-y-6">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft size={16} /> 一覧に戻る
        </button>
        <div className="flex gap-2">
          <button
            onClick={handleReanalyze}
            disabled={analyzing || !doc.supabaseStoragePath}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw size={14} className={analyzing ? 'animate-spin' : ''} />
            AI再解析
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50"
          >
            <Save size={14} />
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 左: フォーム */}
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
            <h3 className="text-sm font-medium text-gray-700 border-b border-gray-100 pb-2">基本情報</h3>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">書類種別</label>
                <select
                  value={form.documentType || ''}
                  onChange={e => setForm(f => ({ ...f, documentType: e.target.value as DocumentType }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                >
                  {Object.entries(DOCUMENT_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">ステータス</label>
                <select
                  value={form.status || ''}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value as DocumentStatus }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                >
                  {Object.entries(DOCUMENT_STATUS_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">取引先名</label>
              <input
                type="text"
                value={form.vendorName || ''}
                onChange={e => setForm(f => ({ ...f, vendorName: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">取引先住所</label>
              <input
                type="text"
                value={form.vendorAddress || ''}
                onChange={e => setForm(f => ({ ...f, vendorAddress: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">書類日付</label>
                <input
                  type="date"
                  value={form.documentDate || ''}
                  onChange={e => setForm(f => ({ ...f, documentDate: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">支払期日</label>
                <input
                  type="date"
                  value={form.dueDate || ''}
                  onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">書類番号</label>
              <input
                type="text"
                value={form.documentNumber || ''}
                onChange={e => setForm(f => ({ ...f, documentNumber: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
              />
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
            <h3 className="text-sm font-medium text-gray-700 border-b border-gray-100 pb-2">金額情報</h3>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">税抜金額</label>
                <input
                  type="number"
                  value={form.amountExcludingTax ?? ''}
                  onChange={e => setForm(f => ({ ...f, amountExcludingTax: e.target.value ? Number(e.target.value) : null }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">消費税額</label>
                <input
                  type="number"
                  value={form.taxAmount ?? ''}
                  onChange={e => setForm(f => ({ ...f, taxAmount: e.target.value ? Number(e.target.value) : null }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">税込金額</label>
                <input
                  type="number"
                  value={form.amountIncludingTax ?? ''}
                  onChange={e => setForm(f => ({ ...f, amountIncludingTax: e.target.value ? Number(e.target.value) : null }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">通貨</label>
                <select
                  value={form.currency || 'JPY'}
                  onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                >
                  <option value="JPY">JPY (日本円)</option>
                  <option value="USD">USD (米ドル)</option>
                  <option value="CNY">CNY (人民元)</option>
                  <option value="EUR">EUR (ユーロ)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">勘定科目</label>
                <select
                  value={form.accountTitle || ''}
                  onChange={e => setForm(f => ({ ...f, accountTitle: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                >
                  <option value="">選択してください</option>
                  {COMMON_ACCOUNT_TITLES.map(title => (
                    <option key={title} value={title}>{title}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
            <h3 className="text-sm font-medium text-gray-700 border-b border-gray-100 pb-2">メモ</h3>
            <textarea
              value={form.notes || ''}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={3}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none"
              placeholder="メモを入力..."
            />
          </div>
        </div>

        {/* 右: メタ情報 */}
        <div className="space-y-4">
          {/* ファイル情報 */}
          <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-3">
            <h3 className="text-sm font-medium text-gray-700 border-b border-gray-100 pb-2">ファイル情報</h3>
            <div className="text-sm space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-500">ファイル名</span>
                <span className="text-gray-900">{doc.originalFilename || '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">取得元</span>
                <span className="text-gray-900">{doc.source === 'gmail' ? 'Gmail' : doc.source === 'website' ? 'Webサイト' : '手動'}</span>
              </div>
              {doc.googleDriveUrl && (
                <a href={doc.googleDriveUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-blue-600 hover:underline">
                  Googleドライブで開く <ExternalLink size={12} />
                </a>
              )}
            </div>
          </div>

          {/* AI解析結果 */}
          {doc.aiConfidence != null && (
            <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-3">
              <h3 className="text-sm font-medium text-gray-700 border-b border-gray-100 pb-2">AI解析結果</h3>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">信頼度</span>
                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      doc.aiConfidence > 0.8 ? 'bg-emerald-500' :
                      doc.aiConfidence > 0.5 ? 'bg-amber-500' : 'bg-red-500'
                    }`}
                    style={{ width: `${(doc.aiConfidence * 100)}%` }}
                  />
                </div>
                <span className="text-xs text-gray-600">{Math.round(doc.aiConfidence * 100)}%</span>
              </div>
              {doc.aiRawResponse && (
                <details className="text-xs">
                  <summary className="text-gray-500 cursor-pointer hover:text-gray-700">JSON詳細</summary>
                  <pre className="mt-2 p-3 bg-gray-50 rounded-lg overflow-auto max-h-60 text-gray-600">
                    {JSON.stringify(doc.aiRawResponse, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          )}

          {/* タイムスタンプ */}
          <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-2">
            <h3 className="text-sm font-medium text-gray-700 border-b border-gray-100 pb-2">履歴</h3>
            <div className="text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-500">登録日時</span>
                <span className="text-gray-600">{new Date(doc.createdAt).toLocaleString('ja-JP')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">更新日時</span>
                <span className="text-gray-600">{new Date(doc.updatedAt).toLocaleString('ja-JP')}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
