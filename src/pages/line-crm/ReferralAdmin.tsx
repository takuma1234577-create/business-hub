import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { Gift, RefreshCw, Check } from 'lucide-react'

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
  bind_method: string | null
  referrer_gift_sent_at: string | null
  referred_gift_sent_at: string | null
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

  const fetchRows = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/fitpeak/referrals', { params: status ? { status } : {} })
      setRows(res.data.data || [])
      setCounts(res.data.counts || {})
    } catch { /* ignore */ }
    setLoading(false)
  }, [status])

  useEffect(() => { fetchRows() }, [fetchRows])

  const markSent = async (id: string, side: 'referrer' | 'referred' | 'both') => {
    setBusyId(id)
    try {
      await api.post(`/fitpeak/referrals/${id}/mark-sent`, { side })
      await fetchRows()
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
        <button onClick={fetchRows} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer" aria-label="更新">
          <RefreshCw size={15} />
        </button>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        「成立・送付待ち」= 紹介者・被紹介者の両方が登録済み。公式LINEでAmazonギフト券{rows[0]?.gift_amount || 500}円を各自に送ったら「送付済み」を押してください。
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
                <th className="py-2 pr-3">金額</th>
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
                  <td className="py-3 pr-3 text-slate-600 dark:text-slate-300">{r.order_number || '-'}</td>
                  <td className="py-3 pr-3 text-slate-600 dark:text-slate-300">{r.order_total != null ? `¥${Math.round(r.order_total).toLocaleString()}` : '-'}</td>
                  <td className="py-3 pr-3">
                    {r.status === 'pending_bind' ? (
                      <span className="text-xs text-slate-400">-</span>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <SentButton label="紹介者へ" sent={!!r.referrer_gift_sent_at} busy={busyId === r.id} onClick={() => markSent(r.id, 'referrer')} />
                        <SentButton label="友だちへ" sent={!!r.referred_gift_sent_at} busy={busyId === r.id} onClick={() => markSent(r.id, 'referred')} />
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

function SentButton({ label, sent, busy, onClick }: { label: string; sent: boolean; busy: boolean; onClick: () => void }) {
  if (sent) {
    return <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400"><Check size={12} /> {label}送付済</span>
  }
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-[#c8a960]/15 text-[#a8863f] hover:bg-[#c8a960]/25 disabled:opacity-40 cursor-pointer"
    >
      {label}送付済みにする
    </button>
  )
}
