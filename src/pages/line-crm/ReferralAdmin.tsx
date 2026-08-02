import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { Gift, RefreshCw, Check, Copy, Package, ExternalLink } from 'lucide-react'

const api = axios.create({ baseURL: '/api/line-crm' })
api.interceptors.request.use((config) => { const token = localStorage.getItem('auth_token'); if (token) config.headers.Authorization = `Bearer ${token}`; return config })

interface Friend { display_name: string; picture_url: string | null }
interface ReferralRow {
  id: string
  referral_code: string | null
  referrer_email: string | null
  referrer_line_user_id: string | null
  referred_email: string | null
  referred_name: string | null
  referred_line_user_id: string | null
  order_number: string | null
  order_total: number | null
  gift_amount: number | null
  status: 'pending_bind' | 'confirmed' | 'completed' | string
  referrer_gift_sent_at: string | null
  referred_gift_sent_at: string | null
  referrer_gift_code: string | null
  referred_gift_code: string | null
  referrer_confirmed_at: string | null
  referee_bound_at: string | null
  created_at: string
  referrer_friend?: Friend | null
  referred_friend?: Friend | null
}

const STATUS_TABS: { key: string; label: string }[] = [
  { key: 'confirmed', label: '成立・送付待ち' },
  { key: 'pending_bind', label: '確認待ち' },
  { key: 'completed', label: '完了' },
  { key: '', label: 'すべて' },
]

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-')

export default function ReferralAdmin() {
  const [status, setStatus] = useState('confirmed')
  const [rows, setRows] = useState<ReferralRow[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [stock, setStock] = useState<{ available: number; assigned: number; sent: number }>({ available: 0, assigned: 0, sent: 0 })
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState('')

  const fetchRows = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/fitpeak/referrals', { params: status ? { status } : {} })
      setRows(res.data.data || [])
      setCounts(res.data.counts || {})
    } catch { /* ignore */ }
    setLoading(false)
  }, [status])

  const fetchStock = useCallback(async () => {
    try { const res = await api.get('/fitpeak/gift-codes/stats'); setStock(res.data || { available: 0, assigned: 0, sent: 0 }) } catch { /* ignore */ }
  }, [])

  useEffect(() => { fetchRows() }, [fetchRows])
  useEffect(() => { fetchStock() }, [fetchStock])

  const handleImport = async () => {
    setImporting(true); setImportMsg('')
    try {
      const res = await api.post('/fitpeak/gift-codes/import', { codes: importText, amount: 500 })
      setImportMsg(`${res.data.added}件を追加しました（重複スキップ ${res.data.skipped}件）`)
      setImportText('')
      await fetchStock()
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } } }
      setImportMsg(err.response?.data?.error || '追加に失敗しました')
    }
    setImporting(false)
  }

  const assignCode = async (id: string, side: 'referrer' | 'referred') => {
    setBusyId(id)
    try {
      await api.post(`/fitpeak/referrals/${id}/assign-code`, { side })
      await Promise.all([fetchRows(), fetchStock()])
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } } }
      alert(err.response?.data?.error || 'コードの引き当てに失敗しました')
    }
    setBusyId(null)
  }

  const markSent = async (id: string, side: 'referrer' | 'referred') => {
    setBusyId(id)
    try {
      await api.post(`/fitpeak/referrals/${id}/mark-sent`, { side })
      await Promise.all([fetchRows(), fetchStock()])
    } catch { /* ignore */ }
    setBusyId(null)
  }

  const statusBadge = (s: string) => {
    if (s === 'confirmed') return <span className="px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">成立・送付待ち</span>
    if (s === 'pending_bind') return <span className="px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">確認待ち</span>
    if (s === 'completed') return <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">完了</span>
    return <span className="text-xs text-slate-400">{s}</span>
  }

  const partyLabel = (friend?: Friend | null, name?: string | null, email?: string | null) =>
    friend?.display_name || name || email || '-'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium text-slate-900 dark:text-white flex items-center gap-2">
          <Gift size={16} className="text-[#c8a960]" /> 紹介管理
        </h2>
        <button onClick={() => { fetchRows(); fetchStock() }} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer" aria-label="更新">
          <RefreshCw size={15} />
        </button>
      </div>

      {/* ギフト券在庫 */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <Package size={15} className="text-[#c8a960]" />
            <span>ギフト券在庫: <span className={`font-bold ${stock.available <= 5 ? 'text-red-500' : 'text-slate-900 dark:text-white'}`}>{stock.available}</span> 件（未使用）</span>
            <span className="text-xs text-slate-400">送付済 {stock.sent}</span>
          </div>
          <button onClick={() => setImportOpen(v => !v)} className="text-xs px-2.5 py-1 rounded-md bg-[#c8a960]/15 text-[#a8863f] hover:bg-[#c8a960]/25 cursor-pointer">
            コードを追加
          </button>
        </div>
        {stock.available <= 5 && (
          <p className="text-xs text-red-500 mt-1.5">在庫が残りわずかです。Amazonギフト券コードを追加してください。</p>
        )}
        {importOpen && (
          <div className="mt-3 space-y-2">
            <textarea
              value={importText}
              onChange={e => setImportText(e.target.value)}
              placeholder="Amazonギフト券のリンク(URL)を1行に1つずつ貼り付け（500円分。例: https://www.amazon.co.jp/g/XXXX）"
              rows={5}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#06C755]/40"
            />
            <div className="flex items-center gap-3">
              <button onClick={handleImport} disabled={importing || !importText.trim()} className="text-sm px-3 py-1.5 rounded-lg bg-[#06C755] text-white font-medium disabled:opacity-40 cursor-pointer">
                {importing ? '追加中...' : '在庫に追加'}
              </button>
              {importMsg && <span className="text-xs text-slate-500 dark:text-slate-400">{importMsg}</span>}
            </div>
          </div>
        )}
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        「送付リンクを取得」で在庫から500円分を1件引き当て→「メッセージをコピー」して公式LINEで本人に送信→「送付済み」を押してください。
      </p>

      <div className="flex gap-1 flex-wrap">
        {STATUS_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setStatus(t.key)}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg cursor-pointer ${status === t.key ? 'bg-[#06C755] text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
          >
            {t.label}
            {t.key && counts[t.key] != null ? <span className="ml-1 opacity-70">({counts[t.key]})</span> : null}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-12 text-center text-slate-400 text-sm">読み込み中...</div>
      ) : rows.length === 0 ? (
        <div className="py-12 text-center text-slate-400 text-sm">該当する紹介はありません</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200 dark:border-slate-700">
                <th className="py-2 pr-3">状態</th>
                <th className="py-2 pr-3">紹介した人</th>
                <th className="py-2 pr-3">紹介された人</th>
                <th className="py-2 pr-3">注文</th>
                <th className="py-2 pr-3">ギフト送付</th>
                <th className="py-2 pr-3">日時</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800 align-top">
                  <td className="py-3 pr-3">{statusBadge(r.status)}</td>
                  <td className="py-3 pr-3">
                    <div className="text-slate-900 dark:text-white">{partyLabel(r.referrer_friend, null, r.referrer_email)}</div>
                    <div className="text-xs text-slate-400">{r.referral_code}</div>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="text-slate-900 dark:text-white">{partyLabel(r.referred_friend, r.referred_name, r.referred_email)}</div>
                    {r.status === 'pending_bind' && <div className="text-xs text-amber-500">バインド待ち</div>}
                  </td>
                  <td className="py-3 pr-3 text-slate-600 dark:text-slate-300">
                    <div>{r.order_number || '-'}</div>
                    <div className="text-xs text-slate-400">{r.order_total != null ? `¥${Math.round(r.order_total).toLocaleString()}` : ''}</div>
                  </td>
                  <td className="py-3 pr-3">
                    {r.status === 'pending_bind' ? (
                      <span className="text-xs text-slate-400">-</span>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <GiftCell label="紹介者" sent={!!r.referrer_gift_sent_at} code={r.referrer_gift_code} busy={busyId === r.id}
                          onAssign={() => assignCode(r.id, 'referrer')} onSent={() => markSent(r.id, 'referrer')} />
                        <GiftCell label="友だち" sent={!!r.referred_gift_sent_at} code={r.referred_gift_code} busy={busyId === r.id}
                          onAssign={() => assignCode(r.id, 'referred')} onSent={() => markSent(r.id, 'referred')} />
                      </div>
                    )}
                  </td>
                  <td className="py-3 pr-3 text-xs text-slate-400">{fmtDate(r.referee_bound_at || r.referrer_confirmed_at || r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function GiftCell({ label, sent, code, busy, onAssign, onSent }: {
  label: string; sent: boolean; code: string | null; busy: boolean; onAssign: () => void; onSent: () => void
}) {
  const [copied, setCopied] = useState(false)
  const isUrl = !!code && /^https?:\/\//i.test(code)
  const message = code
    ? (isUrl ? `【FITPEAK】Amazonギフト券500円分をお届けします。下のリンクをタップするとAmazon残高に反映されます。\n${code}` : code)
    : ''
  const copy = async () => { if (!message) return; try { await navigator.clipboard.writeText(message); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* ignore */ } }

  if (sent) {
    return <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400"><Check size={12} /> {label}送付済</span>
  }
  if (code) {
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs text-slate-400 w-8">{label}</span>
        <button onClick={copy} className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer" title={code}>
          {copied ? <Check size={11} className="text-green-500" /> : <Copy size={11} />} {copied ? 'コピー済' : 'メッセージをコピー'}
        </button>
        {isUrl && (
          <a href={code} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700" title="リンクを開いて確認">
            <ExternalLink size={11} /> 開く
          </a>
        )}
        <button onClick={onSent} disabled={busy} className="text-xs px-2 py-1 rounded-md bg-[#06C755] text-white disabled:opacity-40 cursor-pointer">送付済み</button>
      </div>
    )
  }
  return (
    <button onClick={onAssign} disabled={busy} className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-[#c8a960]/15 text-[#a8863f] hover:bg-[#c8a960]/25 disabled:opacity-40 cursor-pointer w-fit">
      {label}: 送付リンクを取得
    </button>
  )
}
