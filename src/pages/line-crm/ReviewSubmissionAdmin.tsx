import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { RefreshCw, X, Star, Check, Ban, MessageSquareText, Image as ImageIcon, FileText } from 'lucide-react'

const api = axios.create({ baseURL: '/api/review-submission' })
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

interface Submission {
  id: string
  status: 'awaiting_draft' | 'draft_received' | 'approved' | 'awaiting_invoice' | 'invoice_submitted' | 'completed' | 'rejected'
  order_number: string | null
  product_name: string | null
  purchase_date: string | null
  review_date: string | null
  order_total: number | null
  draft_title: string | null
  draft_body: string | null
  draft_image_url: string | null
  proof_image_url: string | null
  verify_status: string | null
  verify_reason: string | null
  verify_result: { reviewer_name?: string; star_rating?: number; title?: string; body?: string } | null
  invoice_url: string | null
  invoice_verify_status: string | null
  invoice_verify_reason: string | null
  invoice_result: { total_amount?: number; invoice_date?: string; sender?: { name?: string; bank_info?: string } } | null
  admin_note: string | null
  created_at: string
  friend?: { id: string; display_name: string; picture_url: string | null } | null
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  awaiting_draft: { label: '下書き待ち', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  draft_received: { label: '下書き承認待ち', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  approved: { label: '投稿待ち', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  awaiting_invoice: { label: '請求書待ち', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  invoice_submitted: { label: '請求書承認待ち', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  completed: { label: '完了', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  rejected: { label: '却下', cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
}

const STATUS_TABS = [
  { key: '', label: 'すべて' },
  { key: 'draft_received', label: '下書き承認待ち' },
  { key: 'invoice_submitted', label: '請求書承認待ち' },
  { key: 'approved', label: '投稿待ち' },
  { key: 'awaiting_invoice', label: '請求書待ち' },
  { key: 'completed', label: '完了' },
  { key: 'rejected', label: '却下' },
]

function formatJpDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()]
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${w}）`
}

export default function ReviewSubmissionAdmin({ channelId }: { channelId: string }) {
  const [subs, setSubs] = useState<Submission[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [zoom, setZoom] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const fetchSubs = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.get('/submissions', { params: { channel_id: channelId, ...(status ? { status } : {}), limit: 200 } })
      setSubs(r.data.data || [])
    } catch { /* ignore */ }
    setLoading(false)
  }, [channelId, status])

  const fetchStats = useCallback(async () => {
    try { const r = await api.get('/stats', { params: { channel_id: channelId } }); setCounts(r.data.counts || {}) } catch { /* ignore */ }
  }, [channelId])

  useEffect(() => { fetchSubs() }, [fetchSubs])
  useEffect(() => { fetchStats() }, [fetchStats])

  const update = async (id: string, patch: { status?: string; admin_note?: string }) => {
    setBusyId(id)
    try { await api.patch(`/submissions/${id}`, patch); await fetchSubs(); await fetchStats() } catch { /* ignore */ }
    setBusyId(null)
  }

  const approveDraft = async (id: string) => {
    setBusyId(id)
    try {
      const r = await api.post(`/submissions/${id}/approve`)
      const rd = r.data?.review_date ? formatJpDate(r.data.review_date) : ''
      setFlash(r.data?.notified
        ? `承認しました。レビュー投稿日（${rd}）をユーザーへ通知しました。`
        : `承認しました（投稿日 ${rd}）。ただしLINE通知に失敗しました。友だちのLINE連携をご確認ください。`)
      await fetchSubs(); await fetchStats()
    } catch {
      setFlash('承認に失敗しました。時間をおいて再度お試しください。')
    }
    setBusyId(null)
  }

  const advanceReview = async (id: string) => {
    setBusyId(id)
    try {
      const r = await api.post(`/submissions/${id}/advance`)
      setFlash(r.data?.status === 'completed' ? '完了にしました（クラウドワークス経由）。' : '請求書の提出を依頼しました。')
      await fetchSubs(); await fetchStats()
    } catch { setFlash('操作に失敗しました。') }
    setBusyId(null)
  }

  const completeInvoice = async (id: string) => {
    setBusyId(id)
    try {
      const r = await api.post(`/submissions/${id}/complete`)
      setFlash(r.data?.notified ? '完了にし、ユーザーへ通知しました。お振込をお願いします。' : '完了にしました（LINE通知は失敗）。')
      await fetchSubs(); await fetchStats()
    } catch { setFlash('操作に失敗しました。') }
    setBusyId(null)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <MessageSquareText className="text-emerald-600" size={22} />
          <div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">レビュー管理</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">レビュー下書き（タイトル・本文・画像）の提出と、投稿後の確認スクショのAI照合を一括管理します。</p>
          </div>
        </div>
        <button onClick={() => { fetchSubs(); fetchStats() }} className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800" title="更新">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {flash && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 flex items-start justify-between gap-3">
          <span>{flash}</span>
          <button onClick={() => setFlash(null)} className="shrink-0"><X size={16} /></button>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
        {[
          { k: 'draft_received', label: '下書き承認待ち' },
          { k: 'invoice_submitted', label: '請求書承認待ち' },
          { k: 'awaiting_invoice', label: '請求書待ち' },
          { k: 'completed', label: '完了' },
        ].map(({ k, label }) => (
          <div key={k} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 text-center">
            <div className="text-xl font-bold text-slate-800 dark:text-slate-100">{counts[k] || 0}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {STATUS_TABS.map((t) => (
          <button key={t.key} onClick={() => setStatus(t.key)}
            className={`px-3 py-1.5 rounded-lg text-sm ${status === t.key ? 'bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900' : 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-10 text-slate-400 text-sm">読み込み中...</div>
      ) : subs.length === 0 ? (
        <div className="text-center py-10 text-slate-400 text-sm">まだ提出がありません。</div>
      ) : (
        <div className="space-y-3">
          {subs.map((s) => {
            const meta = STATUS_META[s.status] || { label: s.status, cls: 'bg-slate-100 text-slate-600' }
            return (
              <div key={s.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${meta.cls}`}>{meta.label}</span>
                  {s.friend?.display_name && <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{s.friend.display_name}</span>}
                  {s.product_name && <span className="text-xs text-slate-400">{s.product_name.slice(0, 30)}</span>}
                  {s.review_date && <span className="text-xs px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">投稿日: {formatJpDate(s.review_date)}</span>}
                  <span className="text-xs text-slate-400 ml-auto">{new Date(s.created_at).toLocaleString('ja-JP')}</span>
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  {/* 下書き */}
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                    <p className="text-xs text-slate-400 mb-1">レビュー下書き</p>
                    {s.draft_title ? (
                      <>
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{s.draft_title}</p>
                        <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 whitespace-pre-wrap line-clamp-4">{s.draft_body}</p>
                        {s.draft_image_url && (
                          <img src={s.draft_image_url} onClick={() => setZoom(s.draft_image_url!)} className="mt-2 w-16 h-16 object-cover rounded-lg cursor-zoom-in border border-slate-200 dark:border-slate-700" />
                        )}
                      </>
                    ) : <p className="text-xs text-slate-400">未提出</p>}
                  </div>

                  {/* 投稿確認 */}
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                    <p className="text-xs text-slate-400 mb-1 flex items-center gap-1"><ImageIcon size={12} /> 投稿確認スクショ</p>
                    {s.proof_image_url ? (
                      <div className="flex items-start gap-2">
                        <img src={s.proof_image_url} onClick={() => setZoom(s.proof_image_url!)} className="w-16 h-16 object-cover rounded-lg cursor-zoom-in border border-slate-200 dark:border-slate-700" />
                        <div className="text-xs">
                          {s.verify_result?.star_rating != null && (
                            <div className="flex items-center gap-0.5 text-amber-500">{Array.from({ length: 5 }).map((_, i) => <Star key={i} size={12} fill={i < (s.verify_result?.star_rating || 0) ? 'currentColor' : 'none'} />)}</div>
                          )}
                          <div className={`mt-1 ${s.verify_status === 'verified' ? 'text-emerald-600' : 'text-amber-600'}`}>{s.verify_reason || s.verify_status}</div>
                        </div>
                      </div>
                    ) : <p className="text-xs text-slate-400">未提出</p>}
                  </div>
                </div>

                {/* 請求書 */}
                {(s.invoice_url || s.status === 'awaiting_invoice' || s.status === 'invoice_submitted' || s.status === 'completed') && (
                  <div className="mt-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                    <p className="text-xs text-slate-400 mb-1 flex items-center gap-1"><FileText size={12} /> 請求書</p>
                    {s.invoice_url ? (
                      <div className="text-xs space-y-0.5">
                        <div className="flex flex-wrap items-center gap-x-3">
                          <span>請求額: <b>{s.invoice_result?.total_amount != null ? '¥' + Number(s.invoice_result.total_amount).toLocaleString() : '—'}</b></span>
                          <span className="text-slate-400">正: ¥{((s.order_total || 0) + 1000).toLocaleString()}</span>
                          {s.invoice_result?.sender?.bank_info && <span className="text-slate-500">振込先: {s.invoice_result.sender.bank_info.slice(0, 30)}</span>}
                        </div>
                        <div className={s.invoice_verify_status === 'verified' ? 'text-emerald-600' : 'text-amber-600'}>{s.invoice_verify_reason || s.invoice_verify_status}</div>
                        <a href={s.invoice_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline inline-block mt-0.5">請求書を開く</a>
                      </div>
                    ) : <p className="text-xs text-slate-400">未提出</p>}
                  </div>
                )}

                {/* アクション */}
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  {s.status === 'draft_received' && (
                    <button onClick={() => approveDraft(s.id)} disabled={busyId === s.id}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                      <Check size={13} /> 下書きを承認（投稿日を通知）
                    </button>
                  )}
                  {s.status === 'approved' && (
                    <button onClick={() => advanceReview(s.id)} disabled={busyId === s.id}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs border border-emerald-300 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 disabled:opacity-50">
                      <Check size={13} /> レビュー確認を手動でOK→次へ
                    </button>
                  )}
                  {s.status === 'invoice_submitted' && (
                    <button onClick={() => completeInvoice(s.id)} disabled={busyId === s.id}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                      <Check size={13} /> 請求書を承認して完了（振込は手動）
                    </button>
                  )}
                  {s.status !== 'rejected' && s.status !== 'completed' && (
                    <button onClick={() => update(s.id, { status: 'rejected' })} disabled={busyId === s.id}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs border border-red-200 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50">
                      <Ban size={13} /> 却下
                    </button>
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
