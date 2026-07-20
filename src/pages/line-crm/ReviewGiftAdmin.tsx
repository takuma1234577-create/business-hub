import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { Gift, Check, X, RefreshCw, ExternalLink, BookOpen, Trash2, Plus, Link2 } from 'lucide-react'

const api = axios.create({ baseURL: '/api/line-crm' })
api.interceptors.request.use((config) => { const token = localStorage.getItem('auth_token'); if (token) config.headers.Authorization = `Bearer ${token}`; return config })

interface MatchResult {
  is_amazon?: boolean | null
  is_posted?: boolean | null
  name_match?: boolean | null
  star_match?: boolean | null
  title_match?: boolean | null
  body_match?: boolean | null
  has_title?: boolean | null
  has_body?: boolean | null
}
interface Claim {
  id: string
  survey_id: string | null
  line_user_id: string | null
  user_id: string | null
  product_name: string | null
  proof_screenshot_url: string | null
  proof_screenshot_url_2: string | null
  verification_status: 'pending' | 'verified' | 'rejected'
  verification_result: { reason?: string; confidence?: number } | null
  reviewer_name: string | null
  star_count: number | null
  review_title: string | null
  review_body: string | null
  match_result: MatchResult | null
  shopify_invoice_url: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  manual_note: string | null
  created_at: string
  friend?: { display_name: string; picture_url: string | null } | null
}
interface KbItem { id: string; reason: string; note: string | null; is_active: boolean; created_by: string | null; created_at: string }

const STATUS_TABS: { key: string; label: string }[] = [
  { key: 'pending', label: '保留中' },
  { key: 'verified', label: '検証済' },
  { key: 'rejected', label: '却下' },
  { key: '', label: 'すべて' },
]

export default function ReviewGiftAdmin() {
  const [status, setStatus] = useState('pending')
  const [claims, setClaims] = useState<Claim[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [zoom, setZoom] = useState<string | null>(null)
  const [showKb, setShowKb] = useState(false)
  const [kb, setKb] = useState<KbItem[]>([])
  const [newKb, setNewKb] = useState('')

  const fetchClaims = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/fitpeak/review-gifts', { params: status ? { status } : {} })
      setClaims(res.data.data || [])
    } catch { /* ignore */ }
    setLoading(false)
  }, [status])

  const fetchCounts = useCallback(async () => {
    try { const res = await api.get('/fitpeak/review-gifts/counts'); setCounts(res.data || {}) } catch { /* ignore */ }
  }, [])

  const fetchKb = useCallback(async () => {
    try { const res = await api.get('/fitpeak/verify-kb'); setKb(res.data.data || []) } catch { /* ignore */ }
  }, [])

  useEffect(() => { fetchClaims() }, [fetchClaims])
  useEffect(() => { fetchCounts() }, [fetchCounts])
  useEffect(() => { fetchKb() }, [fetchKb])

  const approve = async (c: Claim) => {
    if (!confirm(`${c.friend?.display_name || c.user_id || 'このユーザー'} に「${c.product_name || 'リストラップ'}」を無料発行します。よろしいですか？`)) return
    setBusyId(c.id)
    try {
      const res = await api.post(`/fitpeak/review-gifts/${c.id}/approve`, { by: 'admin' })
      if (res.data.issueError) alert(`承認しましたが発行に失敗: ${res.data.issueError}`)
      await fetchClaims(); await fetchCounts()
    } catch (e) { alert('承認に失敗しました') }
    setBusyId(null)
  }

  const reject = async (c: Claim) => {
    const reason = prompt('却下の理由を入力してください（AIが誤判定していた場合はこの理由が今後の判定に学習されます）')
    if (reason === null) return
    const addToKb = reason.trim().length > 0 && confirm('この理由を判定ナレッジベースに追加して、今後のAI判定に反映しますか？')
    setBusyId(c.id)
    try {
      await api.post(`/fitpeak/review-gifts/${c.id}/reject`, { reason, by: 'admin', addToKb })
      await fetchClaims(); await fetchCounts(); if (addToKb) fetchKb()
    } catch { alert('却下に失敗しました') }
    setBusyId(null)
  }

  const addKb = async () => {
    if (!newKb.trim()) return
    try { await api.post('/fitpeak/verify-kb', { reason: newKb.trim(), by: 'admin' }); setNewKb(''); fetchKb() } catch { /* ignore */ }
  }
  const toggleKb = async (id: string) => { try { await api.patch(`/fitpeak/verify-kb/${id}/toggle`); fetchKb() } catch { /* ignore */ } }
  const delKb = async (id: string) => { if (!confirm('削除しますか？')) return; try { await api.delete(`/fitpeak/verify-kb/${id}`); fetchKb() } catch { /* ignore */ } }

  const copyUrl = (c: Claim) => {
    const base = 'https://my.fitpeak.co/survey/review-gift'
    const url = c.survey_id ? `${base}?sid=${c.survey_id}` : c.line_user_id ? `${base}?line=${c.line_user_id}` : base
    const done = () => alert('レビュー提出URLをコピーしました。LINEで送ってください:\n\n' + url)
    navigator.clipboard?.writeText(url).then(done).catch(() => window.prompt('このURLをコピーしてLINEで送ってください', url))
  }

  const fmt = (d: string | null) => d ? new Date(d).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'
  const statusBadge = (c: Claim) => {
    if (c.shopify_invoice_url) return <span className="text-xs px-2 py-0.5 rounded-full bg-[#06C755]/15 text-[#06C755] font-medium">発行済</span>
    if (c.verification_status === 'verified') return <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-500 font-medium">検証済</span>
    if (c.verification_status === 'rejected') return <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-500 font-medium">却下</span>
    return <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-600 font-medium">保留中</span>
  }

  const MatchChip = ({ ok, label }: { ok: boolean | null | undefined; label: string }) => (
    <span className={`text-[11px] px-1.5 py-0.5 rounded ${ok === true ? 'bg-[#06C755]/15 text-[#06C755]' : ok === false ? 'bg-red-500/15 text-red-500' : 'bg-slate-200 dark:bg-slate-600 text-slate-500'}`}>
      {ok === true ? '✓' : ok === false ? '✕' : '—'} {label}
    </span>
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#06C755]/10 flex items-center justify-center">
            <Gift size={20} className="text-[#06C755]" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">レビュー特典（無料プレゼント）</h2>
            <p className="text-sm text-slate-500">Amazonレビューのスクショ確認・個別判定</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowKb(v => !v)} className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-1">
            <BookOpen size={14} /> 判定KB ({kb.filter(k => k.is_active).length})
          </button>
          <button onClick={() => { fetchClaims(); fetchCounts() }} className="p-2 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"><RefreshCw size={15} /></button>
        </div>
      </div>

      {showKb && (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 mb-4">
          <h3 className="text-sm font-medium text-slate-900 dark:text-white mb-2 flex items-center gap-2"><BookOpen size={14} /> AI判定ナレッジベース</h3>
          <p className="text-xs text-slate-500 mb-3">ここに追加した注意点は、次回以降のAI検証プロンプトに自動で反映されます（有効なもののみ）。</p>
          <div className="flex gap-2 mb-3">
            <input value={newKb} onChange={e => setNewKb(e.target.value)} placeholder="例: 投稿者名が一致しない申請は却下する 等" className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white" />
            <button onClick={addKb} className="px-3 py-2 rounded-lg bg-[#06C755] text-white text-sm font-medium flex items-center gap-1"><Plus size={14} /> 追加</button>
          </div>
          <div className="space-y-1.5">
            {kb.length === 0 && <p className="text-xs text-slate-400">まだありません</p>}
            {kb.map(k => (
              <div key={k.id} className="flex items-center gap-2 text-sm">
                <button onClick={() => toggleKb(k.id)} className={`text-xs px-2 py-0.5 rounded-full ${k.is_active ? 'bg-[#06C755]/15 text-[#06C755]' : 'bg-slate-200 dark:bg-slate-600 text-slate-500'}`}>{k.is_active ? '有効' : '無効'}</button>
                <span className={`flex-1 ${k.is_active ? 'text-slate-800 dark:text-slate-200' : 'text-slate-400 line-through'}`}>{k.reason}</span>
                <button onClick={() => delKb(k.id)} className="text-slate-400 hover:text-red-500"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* status tabs */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {STATUS_TABS.map(t => (
          <button key={t.key} onClick={() => setStatus(t.key)} className={`px-3 py-1.5 text-sm font-medium rounded-lg cursor-pointer ${status === t.key ? 'bg-[#06C755] text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>
            {t.label}{t.key && counts[t.key] != null ? ` (${counts[t.key]})` : ''}
          </button>
        ))}
        <span className="text-xs text-slate-400 ml-auto">発行済 {counts.issued ?? 0} 件</span>
      </div>

      {loading ? (
        <div className="text-center py-16 text-slate-400 text-sm">読み込み中...</div>
      ) : claims.length === 0 ? (
        <div className="text-center py-16 text-slate-400 text-sm">該当する申請はありません</div>
      ) : (
        <div className="space-y-4">
          {claims.map(c => {
            const m = c.match_result || {}
            return (
              <div key={c.id} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    {c.friend?.picture_url && <img src={c.friend.picture_url} alt="" className="w-7 h-7 rounded-full" />}
                    <div>
                      <p className="text-sm font-medium text-slate-900 dark:text-white">{c.friend?.display_name || c.user_id || '匿名'}</p>
                      <p className="text-[11px] text-slate-400">{fmt(c.created_at)} ・ {c.product_name || 'リストラップ'}</p>
                    </div>
                  </div>
                  {statusBadge(c)}
                </div>

                {/* screenshots */}
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {[{ u: c.proof_screenshot_url_2, l: '① レビュー作成画面' }, { u: c.proof_screenshot_url, l: '② 投稿後・反映後' }].map((s, i) => (
                    <div key={i}>
                      <p className="text-[11px] text-slate-500 mb-1">{s.l}</p>
                      {s.u ? (
                        <img src={s.u} alt={s.l} onClick={() => setZoom(s.u!)} className="w-full max-h-64 object-contain rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 cursor-zoom-in" />
                      ) : (
                        <div className="w-full h-32 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 flex items-center justify-center text-xs text-slate-400">画像なし</div>
                      )}
                    </div>
                  ))}
                </div>

                {/* AI extracted + match */}
                <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3 mb-3 text-sm">
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 mb-2">
                    <div><span className="text-slate-400 text-xs">氏名: </span><span className="text-slate-800 dark:text-slate-200">{c.reviewer_name || '—'}</span></div>
                    <div><span className="text-slate-400 text-xs">星: </span><span className="text-slate-800 dark:text-slate-200">{c.star_count ? '★'.repeat(c.star_count) : '—'}</span></div>
                    <div className="col-span-2"><span className="text-slate-400 text-xs">タイトル: </span><span className="text-slate-800 dark:text-slate-200">{c.review_title || '—'}</span></div>
                    <div className="col-span-2"><span className="text-slate-400 text-xs">本文: </span><span className="text-slate-800 dark:text-slate-200">{c.review_body || '—'}</span></div>
                  </div>
                  <div className="flex flex-wrap gap-1 mb-2">
                    <MatchChip ok={m.is_amazon} label="Amazon" />
                    <MatchChip ok={m.is_posted} label="投稿反映" />
                    <MatchChip ok={m.name_match} label="氏名一致" />
                    <MatchChip ok={m.star_match} label="星一致" />
                    <MatchChip ok={m.title_match} label="タイトル一致" />
                    <MatchChip ok={m.body_match} label="本文一致" />
                  </div>
                  {c.verification_result?.reason && (
                    <p className="text-xs text-slate-500">AI判定: {c.verification_result.reason}{c.verification_result.confidence != null ? `（確信度${c.verification_result.confidence}）` : ''}</p>
                  )}
                  {c.manual_note && <p className="text-xs text-orange-500 mt-1">手動メモ: {c.manual_note}</p>}
                </div>

                {/* actions */}
                <div className="flex items-center gap-2">
                  {c.shopify_invoice_url ? (
                    <a href={c.shopify_invoice_url} target="_blank" rel="noopener noreferrer" className="text-sm text-[#06C755] flex items-center gap-1 hover:underline">受け取りリンク <ExternalLink size={13} /></a>
                  ) : (
                    <>
                      <button disabled={busyId === c.id} onClick={() => approve(c)} className="px-3 py-1.5 rounded-lg bg-[#06C755] text-white text-sm font-medium flex items-center gap-1 disabled:opacity-50">
                        <Check size={14} /> 承認して発行
                      </button>
                      <button disabled={busyId === c.id} onClick={() => reject(c)} className="px-3 py-1.5 rounded-lg border border-red-300 text-red-500 text-sm font-medium flex items-center gap-1 disabled:opacity-50">
                        <X size={14} /> 却下
                      </button>
                    </>
                  )}
                  <button onClick={() => copyUrl(c)} className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-sm font-medium flex items-center gap-1 hover:bg-slate-100 dark:hover:bg-slate-700">
                    <Link2 size={14} /> 提出URLをコピー
                  </button>
                  {c.reviewed_by && <span className="text-[11px] text-slate-400 ml-auto">判定: {c.reviewed_by} {fmt(c.reviewed_at)}</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {zoom && (
        <div onClick={() => setZoom(null)} className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 cursor-zoom-out">
          <img src={zoom} alt="" className="max-w-full max-h-full object-contain" />
        </div>
      )}
    </div>
  )
}
