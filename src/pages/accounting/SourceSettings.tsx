import { useState, useEffect } from 'react'
import { sourceApi, fetchLogApi, gmailFetchApi, fiscalYearApi } from './api'
import type { AccountingSource, AccountingFetchLog } from './types'
import { Plus, Trash2, Globe, Mail, Play, Loader2, CheckCircle, XCircle, Clock, Building2, Save } from 'lucide-react'

const MONTHS = [1,2,3,4,5,6,7,8,9,10,11,12]

function CompanyProfile() {
  const [endMonth, setEndMonth] = useState<number>(3)
  const [firstStart, setFirstStart] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ generated: number; total: number } | null>(null)

  useEffect(() => {
    fiscalYearApi.getProfile().then(p => {
      if (p.fiscal_end_month) setEndMonth(p.fiscal_end_month)
      if (p.first_period_start) setFirstStart(p.first_period_start)
    }).catch(console.error).finally(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    if (!firstStart) return alert('第1期開始日を入力してください')
    setSaving(true); setResult(null)
    try {
      const res = await fiscalYearApi.saveProfile({ fiscalEndMonth: endMonth, firstPeriodStart: firstStart })
      setResult(res)
    } catch (err: any) {
      alert('保存に失敗しました: ' + (err?.response?.data?.error || err.message))
    } finally { setSaving(false) }
  }

  if (loading) return <div className="p-4 text-center text-gray-400 text-sm">読み込み中...</div>

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-violet-50 rounded-lg">
          <Building2 size={20} className="text-violet-500" />
        </div>
        <div>
          <h3 className="text-sm font-medium text-gray-900">決算期プロフィール</h3>
          <p className="text-xs text-gray-500">決算月と第1期開始日を設定すると、事業年度が自動生成されます</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">決算月 *</label>
          <select value={endMonth} onChange={e => setEndMonth(Number(e.target.value))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
            {MONTHS.map(m => (
              <option key={m} value={m}>{m}月</option>
            ))}
          </select>
          <p className="text-xs text-gray-400 mt-1">例: 3月決算なら「3月」、12月決算なら「12月」</p>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">第1期 開始日 *</label>
          <input type="date" value={firstStart} onChange={e => setFirstStart(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          <p className="text-xs text-gray-400 mt-1">会社設立日（法人）/ 開業日（個人）</p>
        </div>
        <div className="flex items-end">
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 text-white text-sm rounded-lg hover:bg-violet-700 disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? '保存中...' : '保存して年度生成'}
          </button>
        </div>
      </div>

      {result && (
        <div className="mt-3 text-sm bg-emerald-50 border border-emerald-200 rounded-lg p-3">
          事業年度を{result.generated > 0 ? `${result.generated}件新規生成` : '確認'}しました（全{result.total}期分）
        </div>
      )}
    </div>
  )
}

export function SourceSettings() {
  const [sources, setSources] = useState<AccountingSource[]>([])
  const [logs, setLogs] = useState<AccountingFetchLog[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<{ found: number; saved: number } | null>(null)
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    Promise.all([sourceApi.list(), fetchLogApi.list(10)])
      .then(([s, l]) => { setSources(s); setLogs(l) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const handleGmailScan = async () => {
    setScanning(true)
    setScanResult(null)
    try {
      const result = await gmailFetchApi.scan()
      setScanResult(result)
      const newLogs = await fetchLogApi.list(10)
      setLogs(newLogs)
    } catch (err: any) {
      alert(err.response?.data?.error || 'スキャン失敗')
    } finally {
      setScanning(false)
    }
  }

  const handleDeleteSource = async (id: string) => {
    if (!confirm('この収集元を削除しますか？')) return
    await sourceApi.delete(id)
    setSources(s => s.filter(x => x.id !== id))
  }

  if (loading) return <div className="p-8 text-center text-gray-400">読み込み中...</div>

  return (
    <div className="space-y-6">
      {/* 決算期プロフィール */}
      <CompanyProfile />

      {/* Gmail スキャン */}
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-50 rounded-lg">
              <Mail size={20} className="text-red-500" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-900">Gmailスキャン</h3>
              <p className="text-xs text-gray-500">請求書・領収書キーワードでメールを検索し、添付ファイルを自動取得</p>
            </div>
          </div>
          <button
            onClick={handleGmailScan}
            disabled={scanning}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50"
          >
            {scanning ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {scanning ? 'スキャン中...' : 'スキャン実行'}
          </button>
        </div>
        {scanResult && (
          <div className="text-sm bg-green-50 border border-green-200 rounded-lg p-3">
            検出: {scanResult.found}件 / 保存: {scanResult.saved}件
          </div>
        )}
      </div>

      {/* 収集元一覧 */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-700">Webサイト収集元</h3>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-1 text-xs px-3 py-1.5 bg-violet-600 text-white rounded-md hover:bg-violet-700"
          >
            <Plus size={12} /> 追加
          </button>
        </div>

        {showForm && (
          <SourceForm
            onSaved={async () => {
              setShowForm(false)
              const s = await sourceApi.list()
              setSources(s)
            }}
            onCancel={() => setShowForm(false)}
          />
        )}

        {sources.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            <Globe size={24} className="mx-auto mb-2" />
            <p className="text-sm">Webサイト収集元がまだ登録されていません</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {sources.map(src => (
              <div key={src.id} className="px-5 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">{src.name}</p>
                  <p className="text-xs text-gray-500">
                    {src.url || '-'}
                    {src.searchKeywords?.length > 0 && ` · キーワード: ${src.searchKeywords.join(', ')}`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    src.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {src.isActive ? '有効' : '無効'}
                  </span>
                  <button onClick={() => handleDeleteSource(src.id)} className="text-gray-300 hover:text-red-500">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 収集ログ */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-medium text-gray-700">収集ログ</h3>
        </div>
        {logs.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">ログがありません</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {logs.map(log => (
              <div key={log.id} className="px-5 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {log.status === 'success' ? <CheckCircle size={14} className="text-emerald-500" /> :
                   log.status === 'error' ? <XCircle size={14} className="text-red-500" /> :
                   log.status === 'running' ? <Loader2 size={14} className="text-blue-500 animate-spin" /> :
                   <Clock size={14} className="text-amber-500" />}
                  <span className="text-sm text-gray-700">
                    検出 {log.documentsFound} / 保存 {log.documentsSaved} / スキップ {log.documentsSkipped}
                  </span>
                </div>
                <span className="text-xs text-gray-400">
                  {new Date(log.startedAt).toLocaleString('ja-JP')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SourceForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    sourceType: 'website' as const,
    name: '',
    url: '',
    searchKeywords: '',
    isActive: true,
  })
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await sourceApi.create({
        ...form,
        searchKeywords: form.searchKeywords ? form.searchKeywords.split(',').map(s => s.trim()) : [],
      } as any)
      onSaved()
    } catch (err) {
      alert('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="px-5 py-4 border-b border-gray-100 space-y-3 bg-gray-50">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">名前</label>
          <input type="text" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" placeholder="例: Amazon管理画面" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">URL</label>
          <input type="url" value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" placeholder="https://..." />
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">検索キーワード (カンマ区切り)</label>
        <input type="text" value={form.searchKeywords} onChange={e => setForm(f => ({ ...f, searchKeywords: e.target.value }))}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" placeholder="請求書, invoice, receipt" />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="text-sm px-3 py-1.5 text-gray-500 hover:text-gray-700">キャンセル</button>
        <button type="submit" disabled={saving} className="text-sm px-4 py-1.5 bg-violet-600 text-white rounded-md hover:bg-violet-700 disabled:opacity-50">
          {saving ? '保存中...' : '追加'}
        </button>
      </div>
    </form>
  )
}
