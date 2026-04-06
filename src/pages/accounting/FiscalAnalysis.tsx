import { useState, useEffect, useCallback } from 'react'
import { fiscalYearApi } from './api'
import type { FiscalYear, FiscalDocument, FiscalMetric, DocumentType } from './api'
import {
  Plus, Upload, Trash2, FileText, CheckCircle, AlertCircle, Loader2,
  ChevronDown, ChevronRight, TrendingUp, TrendingDown, BarChart3, Calendar,
} from 'lucide-react'

const fmt = (n: number | null) => n != null ? `¥${n.toLocaleString()}` : '-'
const fmtCompact = (n: number | null) => {
  if (n == null) return '-'
  if (Math.abs(n) >= 100000000) return `${(n / 100000000).toFixed(1)}億`
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(0)}万`
  return n.toLocaleString()
}

export function FiscalAnalysis() {
  const [years, setYears] = useState<FiscalYear[]>([])
  const [selectedYearId, setSelectedYearId] = useState('')
  const [documents, setDocuments] = useState<FiscalDocument[]>([])
  const [metrics, setMetrics] = useState<FiscalMetric[]>([])
  const [docTypes, setDocTypes] = useState<DocumentType[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'detail' | 'comparison'>('detail')

  // 年度追加フォーム
  const [showYearForm, setShowYearForm] = useState(false)
  const [yearLabel, setYearLabel] = useState('')
  const [yearStart, setYearStart] = useState('')
  const [yearEnd, setYearEnd] = useState('')

  // アップロード
  const [showUpload, setShowUpload] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadDocType, setUploadDocType] = useState('')
  const [uploading, setUploading] = useState(false)

  // 比較データ
  const [comparison, setComparison] = useState<{ years: FiscalYear[]; metrics: Record<string, Record<string, { label: string; values: Record<string, number | string> }>> } | null>(null)

  // 展開カテゴリ
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set())

  const fetchYears = useCallback(async () => {
    try {
      const [y, dt] = await Promise.all([fiscalYearApi.listYears(), fiscalYearApi.listDocumentTypes()])
      setYears(y)
      setDocTypes(dt)
      if (y.length > 0 && !selectedYearId) setSelectedYearId(y[0].id)
    } catch (err) { console.error(err) }
  }, [selectedYearId])

  const fetchYearData = useCallback(async () => {
    if (!selectedYearId) { setDocuments([]); setMetrics([]); setLoading(false); return }
    setLoading(true)
    try {
      const [docs, mets] = await Promise.all([
        fiscalYearApi.listDocuments(selectedYearId),
        fiscalYearApi.listMetrics(selectedYearId),
      ])
      setDocuments(docs)
      setMetrics(mets)
      // 全カテゴリ展開
      setExpandedCats(new Set(mets.map(m => m.category)))
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }, [selectedYearId])

  const fetchComparison = useCallback(async () => {
    try { setComparison(await fiscalYearApi.getComparison()) }
    catch (err) { console.error(err) }
  }, [])

  useEffect(() => { fetchYears() }, [])
  useEffect(() => { if (view === 'detail') fetchYearData(); else fetchComparison() }, [fetchYearData, view, fetchComparison])

  // ポーリング（解析中の書類があれば）
  useEffect(() => {
    const analyzing = documents.some(d => d.ai_status === 'analyzing' || d.ai_status === 'pending')
    if (!analyzing) return
    const interval = setInterval(() => fetchYearData(), 5000)
    return () => clearInterval(interval)
  }, [documents, fetchYearData])

  const handleCreateYear = async () => {
    if (!yearLabel || !yearStart || !yearEnd) return alert('全項目を入力してください')
    try {
      await fiscalYearApi.createYear({ yearLabel, startDate: yearStart, endDate: yearEnd })
      setShowYearForm(false); setYearLabel(''); setYearStart(''); setYearEnd('')
      fetchYears()
    } catch (err: unknown) {
      console.error(err)
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || '不明なエラー'
      alert('作成に失敗しました: ' + msg)
    }
  }

  const handleUpload = async () => {
    if (!uploadFile || !uploadDocType || !selectedYearId) return
    setUploading(true)
    try {
      await fiscalYearApi.uploadDocument(uploadFile, selectedYearId, uploadDocType)
      setUploadFile(null); setUploadDocType('')
      fetchYearData()
    } catch (err: unknown) {
      console.error(err)
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || '不明なエラー'
      alert('アップロードに失敗しました: ' + msg)
    }
    finally { setUploading(false) }
  }

  const handleDeleteDoc = async (id: string) => {
    if (!confirm('この書類と解析データを削除しますか？')) return
    try { await fiscalYearApi.deleteDocument(id); fetchYearData() }
    catch (err) { console.error(err) }
  }

  const toggleCat = (cat: string) => {
    setExpandedCats(prev => {
      const next = new Set(prev)
      next.has(cat) ? next.delete(cat) : next.add(cat)
      return next
    })
  }

  // メトリクスをカテゴリ別にグループ化
  const groupedMetrics = metrics.reduce<Record<string, FiscalMetric[]>>((g, m) => {
    if (!g[m.category]) g[m.category] = []
    g[m.category].push(m)
    return g
  }, {})

  const selectedYear = years.find(y => y.id === selectedYearId)

  // ドキュメント種別グループ
  const docTypeGroups = docTypes.reduce<Record<string, DocumentType[]>>((g, t) => {
    if (!g[t.category]) g[t.category] = []
    g[t.category].push(t)
    return g
  }, {})

  return (
    <div className="space-y-6">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-medium text-gray-700">事業年度分析</h3>
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button onClick={() => setView('detail')} className={`px-3 py-1 text-xs rounded-md ${view === 'detail' ? 'bg-white shadow text-violet-700' : 'text-gray-500'}`}>
              年度詳細
            </button>
            <button onClick={() => setView('comparison')} className={`px-3 py-1 text-xs rounded-md ${view === 'comparison' ? 'bg-white shadow text-violet-700' : 'text-gray-500'}`}>
              年度比較
            </button>
          </div>
        </div>
        <button onClick={() => setShowYearForm(true)} className="flex items-center gap-1 px-3 py-2 bg-violet-600 text-white text-sm rounded-lg hover:bg-violet-700">
          <Plus size={14} /> 事業年度追加
        </button>
      </div>

      {/* 年度追加フォーム */}
      {showYearForm && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">年度名 *</label>
              <input value={yearLabel} onChange={e => setYearLabel(e.target.value)} placeholder="例: 第5期（2025年度）"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">開始日 *</label>
              <input type="date" value={yearStart} onChange={e => setYearStart(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">終了日 *</label>
              <input type="date" value={yearEnd} onChange={e => setYearEnd(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="flex items-end gap-2">
              <button onClick={handleCreateYear} className="px-4 py-2 bg-violet-600 text-white text-sm rounded-lg hover:bg-violet-700">作成</button>
              <button onClick={() => setShowYearForm(false)} className="px-4 py-2 bg-gray-200 text-gray-700 text-sm rounded-lg">キャンセル</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 年度詳細ビュー ===== */}
      {view === 'detail' && (
        <>
          {/* 年度セレクター */}
          {years.length > 0 && (
            <div className="flex items-center gap-3 flex-wrap">
              {years.map(y => (
                <button key={y.id} onClick={() => setSelectedYearId(y.id)}
                  className={`px-4 py-2 rounded-lg text-sm border-2 transition-all ${
                    selectedYearId === y.id ? 'border-violet-500 bg-violet-50 text-violet-700 font-medium' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}>
                  <Calendar size={14} className="inline mr-1.5" />{y.year_label}
                </button>
              ))}
            </div>
          )}

          {years.length === 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-gray-400">
              <BarChart3 size={32} className="mx-auto mb-2" />
              <p>事業年度が登録されていません</p>
              <p className="text-xs mt-1">「事業年度追加」から登録してください</p>
            </div>
          )}

          {selectedYearId && (
            <>
              {/* アップロードエリア */}
              <div className="bg-white border border-gray-200 rounded-lg p-5">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-medium text-gray-700">
                    書類アップロード（{selectedYear?.year_label}）
                  </h4>
                  <button onClick={() => setShowUpload(!showUpload)} className="flex items-center gap-1 text-sm text-violet-600 hover:text-violet-700">
                    <Upload size={14} /> 書類を追加
                  </button>
                </div>

                {showUpload && (
                  <div className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">書類種別 *</label>
                        <select value={uploadDocType} onChange={e => setUploadDocType(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                          <option value="">選択...</option>
                          {Object.entries(docTypeGroups).map(([group, items]) => (
                            <optgroup key={group} label={group}>
                              {items.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                            </optgroup>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">ファイル *</label>
                        <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={e => setUploadFile(e.target.files?.[0] || null)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                      </div>
                      <div className="flex items-end">
                        <button onClick={handleUpload} disabled={!uploadFile || !uploadDocType || uploading}
                          className="px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                          {uploading ? 'アップロード中...' : 'AI解析開始'}
                        </button>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-gray-400">PDF・画像をアップロードするとClaudeが自動で数値データを抽出します</p>
                  </div>
                )}

                {/* アップロード済み書類一覧 */}
                {documents.length > 0 && (
                  <div className="divide-y divide-gray-100">
                    {documents.map(doc => {
                      const typeInfo = docTypes.find(t => t.id === doc.document_type)
                      return (
                        <div key={doc.id} className="py-2.5 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {doc.ai_status === 'done' ? <CheckCircle size={16} className="text-emerald-500" /> :
                             doc.ai_status === 'error' ? <AlertCircle size={16} className="text-red-500" /> :
                             <Loader2 size={16} className="text-blue-500 animate-spin" />}
                            <div>
                              <p className="text-sm text-gray-900">{typeInfo?.label || doc.document_type}</p>
                              <p className="text-xs text-gray-500">{doc.original_filename} · {doc.ai_summary || (doc.ai_status === 'analyzing' ? 'AI解析中...' : doc.ai_error || '')}</p>
                            </div>
                          </div>
                          <button onClick={() => handleDeleteDoc(doc.id)} className="text-gray-300 hover:text-red-500"><Trash2 size={14} /></button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* 抽出データ表示 */}
              {loading ? (
                <div className="p-8 text-center"><Loader2 size={24} className="mx-auto animate-spin text-violet-500" /></div>
              ) : Object.keys(groupedMetrics).length === 0 ? (
                <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-gray-400">
                  <FileText size={32} className="mx-auto mb-2" />
                  <p>解析データがありません</p>
                  <p className="text-xs mt-1">上から書類をアップロードしてください</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {Object.entries(groupedMetrics).map(([category, items]) => (
                    <div key={category} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                      <button onClick={() => toggleCat(category)}
                        className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50 text-left">
                        <span className="text-sm font-medium text-gray-800">{category}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-400">{items.length}項目</span>
                          {expandedCats.has(category) ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
                        </div>
                      </button>
                      {expandedCats.has(category) && (
                        <div className="border-t border-gray-100 divide-y divide-gray-50">
                          {items.map(m => (
                            <div key={m.id} className="flex justify-between px-5 py-2 text-sm">
                              <span className="text-gray-600">{m.metric_label}</span>
                              <span className="text-gray-900 font-mono font-medium">
                                {m.metric_value != null ? fmt(m.metric_value) : m.metric_text || '-'}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ===== 年度比較ビュー ===== */}
      {view === 'comparison' && comparison && (
        <div className="space-y-4">
          {Object.keys(comparison.metrics).length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-gray-400">
              <BarChart3 size={32} className="mx-auto mb-2" />
              <p>比較データがありません</p>
              <p className="text-xs mt-1">複数年度の書類をアップロードすると年度比較ができます</p>
            </div>
          ) : (
            Object.entries(comparison.metrics).map(([category, metricsMap]) => (
              <div key={category} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
                  <span className="text-sm font-medium text-gray-800">{category}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left px-5 py-2 text-xs text-gray-500 font-medium w-48">項目</th>
                        {comparison.years.map(y => (
                          <th key={y.id} className="text-right px-4 py-2 text-xs text-gray-500 font-medium">{y.year_label}</th>
                        ))}
                        {comparison.years.length >= 2 && (
                          <th className="text-right px-4 py-2 text-xs text-gray-500 font-medium">前年比</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {Object.values(metricsMap).map((metric, i) => {
                        const vals = comparison.years.map(y => typeof metric.values[y.id] === 'number' ? metric.values[y.id] as number : null)
                        const last = vals[vals.length - 1]
                        const prev = vals.length >= 2 ? vals[vals.length - 2] : null
                        const change = last != null && prev != null && prev !== 0 ? ((last - prev) / Math.abs(prev)) * 100 : null

                        return (
                          <tr key={i}>
                            <td className="px-5 py-2 text-gray-600">{metric.label}</td>
                            {vals.map((v, vi) => (
                              <td key={vi} className="text-right px-4 py-2 font-mono text-gray-900">
                                {v != null ? fmtCompact(v) : (typeof metric.values[comparison.years[vi].id] === 'string' ? metric.values[comparison.years[vi].id] : '-')}
                              </td>
                            ))}
                            {comparison.years.length >= 2 && (
                              <td className="text-right px-4 py-2">
                                {change != null && (
                                  <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${change >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                    {change >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                    {change >= 0 ? '+' : ''}{change.toFixed(1)}%
                                  </span>
                                )}
                              </td>
                            )}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
