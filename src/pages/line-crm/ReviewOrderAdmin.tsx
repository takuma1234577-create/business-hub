import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { RefreshCw, Check, X, ShieldCheck, AlertTriangle, Search, Settings2, Package } from 'lucide-react'

const api = axios.create({ baseURL: '/api/review-order-verify' })
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

interface Config {
  channel_id: string
  enabled: boolean
  auto_reply: boolean
  tag_id: string | null
  allowed_asins: string[]
  amount_tolerance: number
  max_order_age_days: number
  success_message: string | null
  resend_message: string | null
  mismatch_message: string | null
}

interface Extracted {
  order_number?: string | null
  total_amount?: number | null
  items?: { name?: string; qty?: number | null; price?: number | null }[]
  confidence?: number
}
interface OrderData {
  order_status?: string
  order_total?: { Amount?: string; CurrencyCode?: string }
  purchase_date?: string
  items?: { asin?: string; title?: string; qty?: number; price?: { Amount?: string } }[]
}
interface VerifyRecord {
  id: string
  status: string
  reason: string | null
  order_number: string | null
  image_url: string | null
  extracted: Extracted | null
  order_data: OrderData | null
  created_at: string
  friend?: { id: string; display_name: string; picture_url: string | null } | null
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  verified: { label: '照合OK', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  mismatch: { label: '不一致', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  not_found: { label: '該当なし', cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  cancelled: { label: 'キャンセル', cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  unreadable: { label: '読取不可', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  not_order: { label: '注文画面でない', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  error: { label: 'エラー', cls: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200' },
}

const STATUS_TABS = [
  { key: '', label: 'すべて' },
  { key: 'verified', label: '照合OK' },
  { key: 'mismatch', label: '不一致' },
  { key: 'not_found', label: '該当なし' },
  { key: 'unreadable', label: '読取不可' },
]

export default function ReviewOrderAdmin({ channelId }: { channelId: string }) {
  const [config, setConfig] = useState<Config | null>(null)
  const [records, setRecords] = useState<VerifyRecord[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [zoom, setZoom] = useState<string | null>(null)
  const [showConfig, setShowConfig] = useState(false)

  const fetchConfig = useCallback(async () => {
    try { const r = await api.get('/config', { params: { channel_id: channelId } }); setConfig(r.data.config) } catch { /* ignore */ }
  }, [channelId])

  const fetchRecords = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.get('/records', { params: { channel_id: channelId, ...(status ? { status } : {}), limit: 100 } })
      setRecords(r.data.data || [])
    } catch { /* ignore */ }
    setLoading(false)
  }, [channelId, status])

  const fetchStats = useCallback(async () => {
    try { const r = await api.get('/stats', { params: { channel_id: channelId } }); setCounts(r.data.counts || {}) } catch { /* ignore */ }
  }, [channelId])

  useEffect(() => { fetchConfig() }, [fetchConfig])
  useEffect(() => { fetchRecords() }, [fetchRecords])
  useEffect(() => { fetchStats() }, [fetchStats])

  const saveConfig = async (patch: Partial<Config>) => {
    if (!config) return
    setSaving(true)
    try {
      const r = await api.put('/config', { channel_id: channelId, ...patch })
      setConfig(r.data.config)
    } catch { /* ignore */ }
    setSaving(false)
  }

  const yen = (v?: number | string | null) => {
    if (v == null) return '—'
    const n = typeof v === 'number' ? v : parseFloat(String(v))
    if (isNaN(n)) return '—'
    return '¥' + Math.round(n).toLocaleString()
  }

  return (
    <div>
      {/* ヘッダー: 概要 + 設定トグル */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="text-emerald-600" size={22} />
          <div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">注文確認（Amazonレビュー案件）</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">友だちが送った注文完了スクショをAI解析→セラーセントラルで照合し、合致すれば「注文完了」タグを自動付与します。</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { fetchRecords(); fetchStats() }} className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800" title="更新">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={() => setShowConfig((v) => !v)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm">
            <Settings2 size={16} /> 設定
          </button>
        </div>
      </div>

      {/* 集計 */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-5">
        {[
          { k: 'verified', label: '照合OK' },
          { k: 'mismatch', label: '不一致' },
          { k: 'not_found', label: '該当なし' },
          { k: 'unreadable', label: '読取不可' },
          { k: 'error', label: 'エラー' },
        ].map(({ k, label }) => (
          <div key={k} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 text-center">
            <div className="text-xl font-bold text-slate-800 dark:text-slate-100">{counts[k] || 0}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
          </div>
        ))}
      </div>

      {/* 設定パネル */}
      {showConfig && config && (
        <div className="mb-6 rounded-xl border border-slate-200 dark:border-slate-700 p-4 bg-slate-50 dark:bg-slate-800/50 space-y-4">
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={config.enabled} onChange={(e) => saveConfig({ enabled: e.target.checked })} disabled={saving} />
              自動照合を有効化
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={config.auto_reply} onChange={(e) => saveConfig({ auto_reply: e.target.checked })} disabled={saving} />
              友だちへ自動返信する
            </label>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="text-sm">
              <span className="block text-xs text-slate-500 dark:text-slate-400 mb-1">合計金額の許容差（円）</span>
              <input type="number" defaultValue={config.amount_tolerance} onBlur={(e) => saveConfig({ amount_tolerance: parseInt(e.target.value, 10) || 0 })}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-slate-500 dark:text-slate-400 mb-1">購入日の上限（日）これより古いと要確認</span>
              <input type="number" defaultValue={config.max_order_age_days} onBlur={(e) => saveConfig({ max_order_age_days: parseInt(e.target.value, 10) || 30 })}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
            </label>
          </div>
          <label className="text-sm block">
            <span className="block text-xs text-slate-500 dark:text-slate-400 mb-1">対象ASIN（カンマ区切り・空欄なら自社の全注文を許可）</span>
            <input type="text" defaultValue={(config.allowed_asins || []).join(', ')}
              onBlur={(e) => saveConfig({ allowed_asins: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
              placeholder="B0FSK6ZYW4, B0..." className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
          </label>
          <div className="grid sm:grid-cols-3 gap-3">
            <label className="text-sm block">
              <span className="block text-xs text-slate-500 dark:text-slate-400 mb-1">照合OK時の返信（空欄で既定文）</span>
              <textarea defaultValue={config.success_message || ''} onBlur={(e) => saveConfig({ success_message: e.target.value || null })} rows={3}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
            </label>
            <label className="text-sm block">
              <span className="block text-xs text-slate-500 dark:text-slate-400 mb-1">読取不可時の返信</span>
              <textarea defaultValue={config.resend_message || ''} onBlur={(e) => saveConfig({ resend_message: e.target.value || null })} rows={3}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
            </label>
            <label className="text-sm block">
              <span className="block text-xs text-slate-500 dark:text-slate-400 mb-1">不一致時の返信</span>
              <textarea defaultValue={config.mismatch_message || ''} onBlur={(e) => saveConfig({ mismatch_message: e.target.value || null })} rows={3}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
            </label>
          </div>
          {saving && <div className="text-xs text-slate-400">保存中...</div>}
        </div>
      )}

      {/* ステータスフィルタ */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {STATUS_TABS.map((t) => (
          <button key={t.key} onClick={() => setStatus(t.key)}
            className={`px-3 py-1.5 rounded-lg text-sm ${status === t.key ? 'bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900' : 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* レコード一覧 */}
      {loading ? (
        <div className="text-center py-10 text-slate-400 text-sm">読み込み中...</div>
      ) : records.length === 0 ? (
        <div className="text-center py-10 text-slate-400 text-sm">まだ照合履歴がありません。</div>
      ) : (
        <div className="space-y-3">
          {records.map((r: VerifyRecord) => {
            const meta = STATUS_META[r.status] || { label: r.status, cls: 'bg-slate-100 text-slate-600' }
            const realTotal = r.order_data?.order_total?.Amount
            const shotTotal = r.extracted?.total_amount
            return (
              <div key={r.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 flex gap-4">
                {r.image_url && (
                  <img src={r.image_url} alt="proof" onClick={() => setZoom(r.image_url!)}
                    className="w-20 h-20 object-cover rounded-lg cursor-zoom-in border border-slate-200 dark:border-slate-700 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${meta.cls}`}>{meta.label}</span>
                    {r.friend?.display_name && <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{r.friend.display_name}</span>}
                    <span className="text-xs text-slate-400">{new Date(r.created_at).toLocaleString('ja-JP')}</span>
                  </div>
                  <div className="text-sm text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                    <Search size={13} className="text-slate-400" /> 注文番号: <span className="font-mono">{r.order_number || '—'}</span>
                  </div>
                  <div className="text-sm text-slate-600 dark:text-slate-300 flex items-center gap-3 mt-0.5 flex-wrap">
                    <span className="flex items-center gap-1">
                      合計: <b>{yen(shotTotal)}</b>
                      <span className="text-slate-400">（スクショ）</span>
                      {realTotal != null && <> / <b>{yen(realTotal)}</b><span className="text-slate-400">（実注文）</span></>}
                    </span>
                  </div>
                  {r.order_data?.items && r.order_data.items.length > 0 && (
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1">
                      <Package size={12} /> {r.order_data.items.map((i) => i.title).filter(Boolean).join(' / ').slice(0, 80)}
                    </div>
                  )}
                  {r.reason && (
                    <div className={`text-xs mt-1.5 flex items-center gap-1 ${r.status === 'verified' ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {r.status === 'verified' ? <Check size={12} /> : <AlertTriangle size={12} />} {r.reason}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {zoom && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6" onClick={() => setZoom(null)}>
          <button className="absolute top-4 right-4 text-white"><X size={28} /></button>
          <img src={zoom} alt="zoom" className="max-w-full max-h-full rounded-lg" />
        </div>
      )}
    </div>
  )
}
