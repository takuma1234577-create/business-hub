import { useState, useEffect, useCallback } from 'react'
import { fiscalYearApi } from './api'
import type { FiscalDocument, FiscalMetric, DocumentType } from './api'
import { useFiscalYear } from '../AccountingTool'
import {
  Upload, Trash2, FileText, CheckCircle, AlertCircle, Loader2,
  ChevronDown, ChevronRight, TrendingUp, TrendingDown, BarChart3,
  PieChart, DollarSign,
} from 'lucide-react'

const fmt = (n: number | null) => n != null ? `¥${Math.round(n).toLocaleString()}` : '-'

type SubView = 'overview' | 'bs' | 'pl' | 'documents' | 'comparison'

// メトリクスからB/S・P/Lデータを構築するヘルパー
function buildBSFromMetrics(metrics: FiscalMetric[]) {
  const assets = metrics.filter(m => m.category === '資産' && !m.metric_label.includes('合計') && !m.metric_label.includes('の部') && m.metric_value != null)
  const liabilities = metrics.filter(m => m.category === '負債' && !m.metric_label.includes('合計') && !m.metric_label.includes('の部') && m.metric_value != null)
  const equity = metrics.filter(m => m.category === '純資産' && !m.metric_label.includes('合計') && !m.metric_label.includes('の部') && !m.metric_label.includes('負債及び') && m.metric_value != null)

  const totalAssets = metrics.find(m => m.category === '資産' && m.metric_label.includes('資産の部合計'))?.metric_value
    || metrics.find(m => m.category === '資産' && m.metric_label.includes('資産合計'))?.metric_value
    || assets.reduce((s, m) => s + (m.metric_value || 0), 0)
  const totalLiabilities = metrics.find(m => m.category === '負債' && m.metric_label.includes('負債の部合計'))?.metric_value
    || metrics.find(m => m.category === '負債' && m.metric_label.includes('負債合計'))?.metric_value
    || liabilities.reduce((s, m) => s + (m.metric_value || 0), 0)
  const totalEquity = metrics.find(m => m.category === '純資産' && m.metric_label.includes('純資産の部合計'))?.metric_value
    || metrics.find(m => m.category === '純資産' && m.metric_label.includes('純資産合計'))?.metric_value
    || equity.reduce((s, m) => s + (m.metric_value || 0), 0)

  return { assets, liabilities, equity, totalAssets, totalLiabilities, totalEquity }
}

function buildPLFromMetrics(metrics: FiscalMetric[]) {
  const salesItems = metrics.filter(m => m.category === '売上・収益' && !m.metric_label.includes('合計') && !m.metric_label.includes('売上総利益') && m.metric_value != null)
  const costItems = metrics.filter(m => m.category === '売上原価' && !m.metric_label.includes('合計') && !m.metric_label.includes('売上原価') && m.metric_value != null)
  const sgaItems = metrics.filter(m => m.category === '販管費' && !m.metric_label.includes('合計') && m.metric_value != null)
  const otherItems = metrics.filter(m => m.category === '営業外損益' && m.metric_value != null && !m.metric_label.includes('合計'))
  const taxItems = metrics.filter(m => m.category === '税金・利益' && m.metric_value != null)

  const sales = metrics.find(m => m.metric_label === '売上高' || m.metric_label === '売上高合計')?.metric_value || 0
  const costTotal = metrics.find(m => m.metric_label === '売上原価' && m.category === '売上原価')?.metric_value || 0
  const grossProfit = metrics.find(m => m.metric_label.includes('売上総利益'))?.metric_value || (sales - costTotal)
  const sgaTotal = metrics.find(m => m.metric_label.includes('販売費及び一般管理費合計'))?.metric_value || sgaItems.reduce((s, m) => s + (m.metric_value || 0), 0)
  const operatingIncome = metrics.find(m => m.metric_label.includes('営業利益'))?.metric_value || (grossProfit - sgaTotal)
  const ordinaryIncome = metrics.find(m => m.metric_label.includes('経常利益'))?.metric_value || null
  const incomeBeforeTax = metrics.find(m => m.metric_label.includes('税引前'))?.metric_value || null
  const tax = metrics.find(m => m.metric_label.includes('法人税') && m.category === '税金・利益')?.metric_value || 0
  const netIncome = metrics.find(m => m.metric_label.includes('当期純利益'))?.metric_value || null

  return { salesItems, costItems, sgaItems, otherItems, taxItems, sales, costTotal, grossProfit, sgaTotal, operatingIncome, ordinaryIncome, incomeBeforeTax, tax, netIncome }
}

export function FiscalAnalysis() {
  const { fiscalYear } = useFiscalYear()
  const [subView, setSubView] = useState<SubView>('overview')
  const [documents, setDocuments] = useState<FiscalDocument[]>([])
  const [metrics, setMetrics] = useState<FiscalMetric[]>([])
  const [docTypes, setDocTypes] = useState<DocumentType[]>([])
  const [loading, setLoading] = useState(true)
  const [comparison, setComparison] = useState<{ years: any[]; metrics: Record<string, Record<string, { label: string; values: Record<string, number | string> }>> } | null>(null)

  const [selectedMonth, setSelectedMonth] = useState<string | null>(null) // null=年間, "YYYY-MM"=月別
  const [showUpload, setShowUpload] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadDocType, setUploadDocType] = useState('')
  const [uploading, setUploading] = useState(false)
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set())

  useEffect(() => { fiscalYearApi.listDocumentTypes().then(setDocTypes).catch(console.error) }, [])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const fyId = fiscalYear?.id
      const month = selectedMonth || undefined
      const [docs, mets] = await Promise.all([
        fiscalYearApi.listDocuments(fyId, month),
        fiscalYearApi.listMetrics(fyId, month),
      ])
      setDocuments(docs)
      setMetrics(mets)
      setExpandedCats(new Set(mets.map(m => m.category)))
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }, [fiscalYear, selectedMonth])

  useEffect(() => { setSelectedMonth(null) }, [fiscalYear])
  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => {
    if (subView === 'comparison') fiscalYearApi.getComparison().then(setComparison).catch(console.error)
  }, [subView])

  // 未解析の書類があれば自動で解析APIを呼ぶ
  useEffect(() => {
    const pending = documents.filter(d => d.ai_status === 'analyzing' || d.ai_status === 'pending')
    if (pending.length === 0) return
    // 1件ずつ解析を呼ぶ
    let cancelled = false
    const run = async () => {
      for (const doc of pending) {
        if (cancelled) break
        try { await fiscalYearApi.analyzeDocument(doc.id) } catch { /* retry on next poll */ }
      }
      if (!cancelled) fetchData()
    }
    run()
    return () => { cancelled = true }
  }, [documents.map(d => d.id + d.ai_status).join(',')])

  const handleUpload = async () => {
    if (!uploadFile || !uploadDocType || !fiscalYear) { if (!fiscalYear) alert('書類をアップロードするには年度を選択してください'); return }
    setUploading(true)
    try {
      await fiscalYearApi.uploadDocument(uploadFile, fiscalYear.id, uploadDocType, undefined, selectedMonth || undefined)
      setUploadFile(null); setUploadDocType('')
      fetchData()
    } catch (err: any) {
      const e = err?.response?.data?.error
      const msg = typeof e === 'string' ? e : (err?.message || JSON.stringify(e || err))
      alert('アップロードに失敗しました: ' + msg)
    } finally { setUploading(false) }
  }

  const handleDeleteDoc = async (id: string) => {
    if (!confirm('この書類と解析データを削除しますか？')) return
    try { await fiscalYearApi.deleteDocument(id); fetchData() }
    catch (err) { console.error(err) }
  }

  const toggleCat = (cat: string) => {
    setExpandedCats(prev => { const next = new Set(prev); next.has(cat) ? next.delete(cat) : next.add(cat); return next })
  }

  const groupedMetrics = metrics.reduce<Record<string, FiscalMetric[]>>((g, m) => {
    if (!g[m.category]) g[m.category] = []; g[m.category].push(m); return g
  }, {})

  const docTypeGroups = docTypes.reduce<Record<string, DocumentType[]>>((g, t) => {
    if (!g[t.category]) g[t.category] = []; g[t.category].push(t); return g
  }, {})

  // メトリクスからB/S・P/Lを構築
  const bs = buildBSFromMetrics(metrics)
  const pl = buildPLFromMetrics(metrics)
  const hasMetrics = metrics.length > 0

  const yearLabel = fiscalYear?.year_label || '全期'
  const periodLabel = fiscalYear
    ? `${fiscalYear.start_date} 〜 ${fiscalYear.end_date}`
    : '全事業年度合算'

  // 選択年度の月リストを生成
  const monthOptions: { value: string; label: string }[] = []
  if (fiscalYear) {
    const start = new Date(fiscalYear.start_date)
    const end = new Date(fiscalYear.end_date)
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
    while (cursor <= end) {
      const y = cursor.getFullYear()
      const m = cursor.getMonth() + 1
      monthOptions.push({
        value: `${y}-${String(m).padStart(2, '0')}`,
        label: `${m}月`,
      })
      cursor.setMonth(cursor.getMonth() + 1)
    }
  }

  const subTabs: { id: SubView; label: string }[] = [
    { id: 'overview', label: '概要' },
    { id: 'pl', label: '損益計算書' },
    { id: 'bs', label: '貸借対照表' },
    { id: 'documents', label: '書類・AI解析' },
    { id: 'comparison', label: '年度比較' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
        {subTabs.map(t => (
          <button key={t.id} onClick={() => setSubView(t.id)}
            className={`px-4 py-2 text-sm rounded-md transition ${subView === t.id ? 'bg-white shadow text-violet-700 font-medium' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* 月セレクター（年度選択時・比較タブ以外で表示） */}
      {fiscalYear && subView !== 'comparison' && monthOptions.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          <button
            onClick={() => setSelectedMonth(null)}
            className={`px-3 py-1.5 text-xs rounded-lg border whitespace-nowrap transition ${
              !selectedMonth ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-gray-600 border-gray-200 hover:border-violet-300'
            }`}
          >年間</button>
          {monthOptions.map(m => (
            <button
              key={m.value}
              onClick={() => setSelectedMonth(m.value)}
              className={`px-3 py-1.5 text-xs rounded-lg border whitespace-nowrap transition ${
                selectedMonth === m.value ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-gray-600 border-gray-200 hover:border-violet-300'
              }`}
            >{m.label}</button>
          ))}
        </div>
      )}

      {loading && subView !== 'comparison' ? (
        <div className="flex items-center justify-center py-12 text-gray-400">
          <Loader2 size={20} className="animate-spin mr-2" /> 読み込み中...
        </div>
      ) : (
        <>
          {/* ===== 概要 ===== */}
          {subView === 'overview' && (
            <div className="space-y-6">
              {hasMetrics ? (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <KPICard label="売上高" value={pl.sales} icon={TrendingUp} color="blue" />
                    <KPICard label="営業利益" value={pl.operatingIncome || 0} icon={(pl.operatingIncome || 0) >= 0 ? TrendingUp : TrendingDown} color={(pl.operatingIncome || 0) >= 0 ? 'emerald' : 'red'} />
                    <KPICard label="当期純利益" value={pl.netIncome || 0} icon={DollarSign} color={(pl.netIncome || 0) >= 0 ? 'violet' : 'red'} />
                    <KPICard label="総資産" value={bs.totalAssets || 0} icon={PieChart} color="gray" />
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="bg-white border border-gray-200 rounded-lg p-5">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2"><FileText size={16} className="text-violet-500" /><h3 className="text-sm font-medium text-gray-700">損益計算書</h3></div>
                        <button onClick={() => setSubView('pl')} className="text-xs text-violet-600 hover:text-violet-700">詳細 →</button>
                      </div>
                      <div className="space-y-1.5">
                        <MiniRow label="売上高" amount={pl.sales} bold />
                        <MiniRow label="売上原価" amount={pl.costTotal} indent />
                        <MiniRow label="売上総利益" amount={pl.grossProfit} border />
                        <MiniRow label="販管費" amount={pl.sgaTotal} indent />
                        <MiniRow label="営業利益" amount={pl.operatingIncome || 0} bold border />
                        {pl.netIncome != null && <MiniRow label="当期純利益" amount={pl.netIncome} bold highlight />}
                      </div>
                    </div>
                    <div className="bg-white border border-gray-200 rounded-lg p-5">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2"><PieChart size={16} className="text-violet-500" /><h3 className="text-sm font-medium text-gray-700">貸借対照表</h3></div>
                        <button onClick={() => setSubView('bs')} className="text-xs text-violet-600 hover:text-violet-700">詳細 →</button>
                      </div>
                      <div className="space-y-3">
                        <BSBar label="資産合計" amount={bs.totalAssets || 0} color="bg-blue-500" total={bs.totalAssets || 1} />
                        <BSBar label="負債合計" amount={bs.totalLiabilities || 0} color="bg-red-400" total={bs.totalAssets || 1} />
                        <BSBar label="純資産合計" amount={bs.totalEquity || 0} color="bg-emerald-500" total={bs.totalAssets || 1} />
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-gray-400">
                  <FileText size={32} className="mx-auto mb-2" />
                  <p>決算データがありません</p>
                  <p className="text-xs mt-1">「書類・AI解析」タブから決算書をアップロードしてください</p>
                </div>
              )}
              {documents.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-lg p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-medium text-gray-700">アップロード済み書類</h4>
                    <button onClick={() => setSubView('documents')} className="text-xs text-violet-600 hover:text-violet-700">管理 →</button>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {documents.slice(0, 5).map(doc => {
                      const typeInfo = docTypes.find(t => t.id === doc.document_type)
                      return (
                        <div key={doc.id} className="py-2 flex items-center gap-3">
                          {doc.ai_status === 'done' ? <CheckCircle size={14} className="text-emerald-500" /> :
                           doc.ai_status === 'error' ? <AlertCircle size={14} className="text-red-500" /> :
                           <Loader2 size={14} className="text-blue-500 animate-spin" />}
                          <span className="text-sm text-gray-700">{typeInfo?.label || doc.document_type}</span>
                          <span className="text-xs text-gray-400">{doc.original_filename}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ===== 損益計算書（メトリクスから） ===== */}
          {subView === 'pl' && (
            <div className="bg-white border border-gray-200 rounded-lg p-6 max-w-2xl">
              <div className="text-center mb-6">
                <h2 className="text-lg font-bold text-gray-900">損益計算書</h2>
                <p className="text-sm text-gray-500">{yearLabel} — {periodLabel}</p>
              </div>
              {!hasMetrics ? (
                <EmptyState message="決算データがありません" sub="書類・AI解析タブから決算書をアップロードしてください" />
              ) : (
                <div className="space-y-4">
                  <MetricSection title="売上高" items={pl.salesItems} />
                  <PLSubTotal label="売上高" amount={pl.sales} />
                  <MetricSection title="売上原価" items={pl.costItems} />
                  <PLSubTotal label="売上総利益" amount={pl.grossProfit} />
                  <MetricSection title="販売費及び一般管理費" items={pl.sgaItems} />
                  <PLSubTotal label="営業利益" amount={pl.operatingIncome || 0} bold />
                  {pl.otherItems.length > 0 && <MetricSection title="営業外損益" items={pl.otherItems} />}
                  {pl.ordinaryIncome != null && <PLSubTotal label="経常利益" amount={pl.ordinaryIncome} bold />}
                  {pl.incomeBeforeTax != null && <PLSubTotal label="税引前当期純利益" amount={pl.incomeBeforeTax} />}
                  {pl.tax > 0 && (
                    <div className="flex justify-between py-0.5 text-sm pl-4">
                      <span className="text-gray-700">法人税、住民税及び事業税</span>
                      <span className="text-gray-900 font-mono">{fmt(pl.tax)}</span>
                    </div>
                  )}
                  {pl.netIncome != null && <PLSubTotal label="当期純利益" amount={pl.netIncome} bold highlight />}
                </div>
              )}
            </div>
          )}

          {/* ===== 貸借対照表（メトリクスから） ===== */}
          {subView === 'bs' && (
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <div className="text-center mb-6">
                <h2 className="text-lg font-bold text-gray-900">貸借対照表</h2>
                <p className="text-sm text-gray-500">{yearLabel} — {periodLabel}</p>
              </div>
              {!hasMetrics ? (
                <EmptyState message="決算データがありません" sub="書類・AI解析タブから決算書をアップロードしてください" />
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                      <h3 className="text-sm font-bold text-gray-800 border-b-2 border-gray-800 pb-1 mb-3">資産の部</h3>
                      {bs.assets.map(m => (
                        <div key={m.id} className="flex justify-between py-0.5 text-sm">
                          <span className="text-gray-700">{m.metric_label}</span>
                          <span className="text-gray-900 font-mono">{fmt(m.metric_value)}</span>
                        </div>
                      ))}
                      <div className="flex justify-between py-1 text-sm font-bold border-t-2 border-gray-800 mt-2">
                        <span>資産合計</span><span className="font-mono">{fmt(bs.totalAssets)}</span>
                      </div>
                    </div>
                    <div className="space-y-6">
                      <div>
                        <h3 className="text-sm font-bold text-gray-800 border-b-2 border-gray-800 pb-1 mb-3">負債の部</h3>
                        {bs.liabilities.map(m => (
                          <div key={m.id} className="flex justify-between py-0.5 text-sm">
                            <span className="text-gray-700">{m.metric_label}</span>
                            <span className="text-gray-900 font-mono">{fmt(m.metric_value)}</span>
                          </div>
                        ))}
                        <div className="flex justify-between py-1 text-sm font-bold border-t-2 border-gray-800 mt-2">
                          <span>負債合計</span><span className="font-mono">{fmt(bs.totalLiabilities)}</span>
                        </div>
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-gray-800 border-b-2 border-gray-800 pb-1 mb-3">純資産の部</h3>
                        {bs.equity.map(m => (
                          <div key={m.id} className="flex justify-between py-0.5 text-sm">
                            <span className="text-gray-700">{m.metric_label}</span>
                            <span className="text-gray-900 font-mono">{fmt(m.metric_value)}</span>
                          </div>
                        ))}
                        <div className="flex justify-between py-1 text-sm font-bold border-t-2 border-gray-800 mt-2">
                          <span>純資産合計</span><span className="font-mono">{fmt(bs.totalEquity)}</span>
                        </div>
                      </div>
                      <div className="flex justify-between py-2 text-sm font-bold bg-gray-100 px-3 rounded-lg">
                        <span>負債・純資産合計</span>
                        <span className="font-mono">{fmt((bs.totalLiabilities || 0) + (bs.totalEquity || 0))}</span>
                      </div>
                    </div>
                  </div>
                  {bs.totalAssets != null && bs.totalAssets > 0 && (
                    <div className={`mt-6 p-3 rounded-lg text-sm text-center ${
                      Math.abs((bs.totalAssets || 0) - ((bs.totalLiabilities || 0) + (bs.totalEquity || 0))) < 2
                        ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                    }`}>
                      {Math.abs((bs.totalAssets || 0) - ((bs.totalLiabilities || 0) + (bs.totalEquity || 0))) < 2
                        ? '貸借一致' : `貸借不一致: 差額 ${fmt(Math.abs((bs.totalAssets || 0) - ((bs.totalLiabilities || 0) + (bs.totalEquity || 0))))}`}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ===== 書類・AI解析 ===== */}
          {subView === 'documents' && (
            <div className="space-y-4">
              <div className="bg-white border border-gray-200 rounded-lg p-5">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-medium text-gray-700">書類アップロード（{yearLabel}）</h4>
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
                  </div>
                )}
                {documents.length > 0 ? (
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
                ) : (
                  <EmptyState message="書類がまだアップロードされていません" />
                )}
              </div>
              {Object.keys(groupedMetrics).length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-gray-700">AI抽出データ</h4>
                  {Object.entries(groupedMetrics).map(([category, items]) => (
                    <div key={category} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                      <button onClick={() => toggleCat(category)} className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50 text-left">
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
                              <span className="text-gray-900 font-mono font-medium">{m.metric_value != null ? fmt(m.metric_value) : m.metric_text || '-'}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ===== 年度比較 ===== */}
          {subView === 'comparison' && (
            comparison && Object.keys(comparison.metrics).length > 0 ? (
              <div className="space-y-4">
                {Object.entries(comparison.metrics).map(([category, metricsMap]) => (
                  <div key={category} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                    <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
                      <span className="text-sm font-medium text-gray-800">{category}</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-100">
                            <th className="text-left px-5 py-2 text-xs text-gray-500 font-medium w-48">項目</th>
                            {comparison.years.map((y: any) => (
                              <th key={y.id} className="text-right px-4 py-2 text-xs text-gray-500 font-medium">{y.year_label}</th>
                            ))}
                            {comparison.years.length >= 2 && <th className="text-right px-4 py-2 text-xs text-gray-500 font-medium">前年比</th>}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {Object.values(metricsMap).map((metric, i) => {
                            const vals = comparison.years.map((y: any) => typeof metric.values[y.id] === 'number' ? metric.values[y.id] as number : null)
                            const last = vals[vals.length - 1]
                            const prev = vals.length >= 2 ? vals[vals.length - 2] : null
                            const change = last != null && prev != null && prev !== 0 ? ((last - prev) / Math.abs(prev)) * 100 : null
                            return (
                              <tr key={i}>
                                <td className="px-5 py-2 text-gray-600">{metric.label}</td>
                                {vals.map((v, vi) => (
                                  <td key={vi} className="text-right px-4 py-2 font-mono text-gray-900">{v != null ? fmt(v) : '-'}</td>
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
                ))}
              </div>
            ) : (
              <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-gray-400">
                <BarChart3 size={32} className="mx-auto mb-2" />
                <p>比較データがありません</p>
                <p className="text-xs mt-1">複数年度の書類をアップロードすると年度比較ができます</p>
              </div>
            )
          )}
        </>
      )}
    </div>
  )
}

// ========== 共通コンポーネント ==========

function EmptyState({ message, sub }: { message: string; sub?: string }) {
  return (
    <div className="text-center py-8 text-gray-400">
      <FileText size={32} className="mx-auto mb-2" />
      <p>{message}</p>
      {sub && <p className="text-xs mt-1">{sub}</p>}
    </div>
  )
}

function KPICard({ label, value, icon: Icon, color }: { label: string; value: number; icon: any; color: string }) {
  const colorMap: Record<string, { bg: string; text: string }> = {
    blue: { bg: 'bg-blue-50', text: 'text-blue-600' }, emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600' },
    violet: { bg: 'bg-violet-50', text: 'text-violet-600' }, red: { bg: 'bg-red-50', text: 'text-red-600' },
    gray: { bg: 'bg-gray-50', text: 'text-gray-600' },
  }
  const c = colorMap[color] || colorMap.gray
  const display = Math.abs(value) >= 10000 ? `${Math.round(value / 10000).toLocaleString()}万` : fmt(value)
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${c.bg}`}><Icon size={18} className={c.text} /></div>
        <div><p className="text-xl font-bold text-gray-900">{display}</p><p className="text-xs text-gray-500">{label}</p></div>
      </div>
    </div>
  )
}

function MiniRow({ label, amount, bold, indent, border, highlight }: { label: string; amount: number; bold?: boolean; indent?: boolean; border?: boolean; highlight?: boolean }) {
  return (
    <div className={`flex justify-between py-1 text-sm ${border ? 'border-t border-gray-200 pt-2' : ''} ${highlight ? 'bg-violet-50 px-3 -mx-3 rounded py-2' : ''}`}>
      <span className={`${bold ? 'font-medium text-gray-900' : 'text-gray-600'} ${indent ? 'pl-3' : ''}`}>{label}</span>
      <span className={`font-mono ${bold ? 'font-medium' : ''} ${amount >= 0 ? 'text-gray-900' : 'text-red-600'}`}>{fmt(amount)}</span>
    </div>
  )
}

function BSBar({ label, amount, color, total }: { label: string; amount: number; color: string; total: number }) {
  const pct = total > 0 ? Math.max((amount / total) * 100, 2) : 0
  return (
    <div>
      <div className="flex justify-between text-sm mb-1"><span className="text-gray-700">{label}</span><span className="font-mono text-gray-900">{fmt(amount)}</span></div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} /></div>
    </div>
  )
}

function MetricSection({ title, items }: { title: string; items: FiscalMetric[] }) {
  if (items.length === 0) return null
  return (
    <div>
      <h3 className="text-xs font-medium text-gray-500 mb-1">{title}</h3>
      {items.map(m => (
        <div key={m.id} className="flex justify-between py-0.5 text-sm pl-4">
          <span className="text-gray-700">{m.metric_label}</span>
          <span className="text-gray-900 font-mono">{fmt(m.metric_value)}</span>
        </div>
      ))}
    </div>
  )
}

function PLSubTotal({ label, amount, bold, highlight }: { label: string; amount: number; bold?: boolean; highlight?: boolean }) {
  return (
    <div className={`flex justify-between py-1.5 border-t ${bold ? 'border-gray-800 border-t-2' : 'border-gray-300'} ${highlight ? 'bg-violet-50 px-3 -mx-3 rounded' : ''}`}>
      <span className={`text-sm ${bold ? 'font-bold text-gray-900' : 'font-medium text-gray-700'}`}>{label}</span>
      <span className={`font-mono text-sm ${amount >= 0 ? 'text-gray-900' : 'text-red-600'} ${bold ? 'font-bold' : ''}`}>{fmt(amount)}</span>
    </div>
  )
}
