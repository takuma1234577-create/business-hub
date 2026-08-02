import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Gift, RefreshCw, Send, Sparkles, Settings as SettingsIcon,
  CheckCircle, AlertCircle, PenLine, Save, Package, Mail, Users, Upload, X,
  MessageCircle, Copy, ExternalLink,
} from 'lucide-react'

interface Candidate {
  id: string
  source: string
  platform: string
  handle: string
  profile_url: string | null
  full_name: string | null
  email: string | null
  followers: number | null
  engagement_rate: number | null
  niche: string | null
  country: string | null
  bio: string | null
  score: number | null
  fit_segment: string | null
  score_reasoning: string | null
  stage: string
  recipient_name: string | null
  postal_code: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state_or_region: string | null
  created_at: string
}

interface Message {
  id: string
  candidate_id: string
  channel: 'email' | 'dm_draft'
  direction: 'outbound' | 'inbound'
  subject: string | null
  body: string | null
  status: string
  error: string | null
  sent_at: string | null
  created_at: string
}

interface Shipment {
  id: string
  candidate_id: string
  mcf_order_id: string | null
  sku: string | null
  quantity: number
  recipient_name: string | null
  postal_code: string | null
  address_line1: string | null
  city: string | null
  status: string
  error: string | null
  created_at: string
}

interface Settings {
  enabled: boolean
  research_mode: 'db_api' | 'manual'
  send_mode: 'approval' | 'auto'
  ship_mode: 'approval' | 'auto'
  daily_research_limit: number
  daily_send_limit: number
  min_followers: number
  max_followers: number
  min_engagement: number
  target_niches: string
  target_country: string
  platforms: string
  product_sku: string
  product_name: string
  gift_qty: number
  from_name: string
  email_subject: string
  gift_message_instructions: string
  reply_instructions: string
  min_score: number
}

type TabId = 'overview' | 'candidates' | 'outreach' | 'dm' | 'shipments' | 'import' | 'settings'

const STAGE_LABEL: Record<string, string> = {
  researched: 'リサーチ済', selected: '選定済', rejected: '除外', queued: '文面生成済',
  contacted: '送信済', replied: '返信あり', address_pending: '住所待ち',
  address_collected: '住所収集済', ship_pending: '発送待ち', shipped: '発送済', declined: '辞退', failed: '失敗',
}
const STAGE_COLOR: Record<string, string> = {
  researched: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  selected: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  rejected: 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500',
  queued: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
  contacted: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  replied: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300',
  address_pending: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  address_collected: 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300',
  ship_pending: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300',
  shipped: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300',
  declined: 'bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
}

function fmtNum(n: number | null): string {
  if (n == null) return '-'
  if (n >= 10000) return (n / 10000).toFixed(1) + '万'
  return n.toLocaleString()
}

export default function Gifting() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<TabId>('overview')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [stats, setStats] = useState<{ stages?: Record<string, number>; shipStatus?: Record<string, number>; total_candidates?: number; sent?: number; pending_send?: number }>({})
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editSubject, setEditSubject] = useState('')
  const [editBody, setEditBody] = useState('')
  const [importText, setImportText] = useState('')
  const [importing, setImporting] = useState(false)
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  const flash = (type: 'success' | 'error', msg: string) => {
    setBanner({ type, msg }); setTimeout(() => setBanner(null), 4000)
  }

  const candMap = Object.fromEntries(candidates.map((c) => [c.id, c]))

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [cRes, mRes, sRes, stRes, setRes] = await Promise.all([
        fetch('/api/gifting/candidates'),
        fetch('/api/gifting/messages'),
        fetch('/api/gifting/shipments'),
        fetch('/api/gifting/stats'),
        fetch('/api/gifting/settings'),
      ])
      if (cRes.ok) setCandidates(await cRes.json())
      if (mRes.ok) setMessages(await mRes.json())
      if (sRes.ok) setShipments(await sRes.json())
      if (stRes.ok) setStats(await stRes.json())
      if (setRes.ok) setSettings(await setRes.json())
    } catch {
      flash('error', 'データの取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const pendingEmails = messages.filter((m) => m.channel === 'email' && m.direction === 'outbound' && m.status === 'pending')
  const dmDrafts = messages.filter((m) => m.channel === 'dm_draft' && m.status !== 'sent')
  const pendingShipments = shipments.filter((s) => s.status === 'pending_approval')

  // ── アクション ──
  const post = async (url: string, body?: unknown) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `${res.status}`)
    return data
  }

  const doScore = async () => {
    setBusyId('score')
    try { const r = await post('/api/gifting/score', { limit: 50 }); flash('success', `${r.scored}件を採点、${r.selected}件を選定`); await fetchAll() }
    catch (e) { flash('error', (e as Error).message) } finally { setBusyId(null) }
  }
  const doDraft = async () => {
    setBusyId('draft')
    try { const r = await post('/api/gifting/draft-outreach', {}); flash('success', `${r.drafted}件の提案文を生成`); await fetchAll() }
    catch (e) { flash('error', (e as Error).message) } finally { setBusyId(null) }
  }
  const doCheckReplies = async () => {
    setBusyId('replies')
    try { const r = await post('/api/gifting/check-replies', { limit: 30 }); flash('success', `返信${r.replied}件、住所${r.addresses}件を収集`); await fetchAll() }
    catch (e) { flash('error', (e as Error).message) } finally { setBusyId(null) }
  }
  const selectCand = async (id: string, reject = false) => {
    setBusyId(id)
    try { await post(`/api/gifting/candidates/${id}/${reject ? 'reject' : 'select'}`); await fetchAll() }
    catch (e) { flash('error', (e as Error).message) } finally { setBusyId(null) }
  }
  const sendEmail = async (m: Message) => {
    setBusyId(m.id)
    try { await post(`/api/gifting/messages/${m.id}/send`); flash('success', '送信しました'); await fetchAll() }
    catch (e) { flash('error', (e as Error).message) } finally { setBusyId(null) }
  }
  const saveEdit = async (id: string) => {
    setBusyId(id)
    try {
      await fetch(`/api/gifting/messages/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: editSubject, body: editBody }),
      })
      setEditId(null); await fetchAll()
    } catch (e) { flash('error', (e as Error).message) } finally { setBusyId(null) }
  }
  const prepareShip = async (candidateId: string) => {
    setBusyId(candidateId)
    try { await post(`/api/gifting/candidates/${candidateId}/prepare-ship`); flash('success', '発送を準備しました（承認待ち）'); await fetchAll() }
    catch (e) { flash('error', (e as Error).message) } finally { setBusyId(null) }
  }
  const approveShip = async (s: Shipment) => {
    if (!confirm(`${s.recipient_name} 宛にFBA(MCF)発送依頼を送信します。よろしいですか？`)) return
    setBusyId(s.id)
    try { const r = await post(`/api/gifting/shipments/${s.id}/approve`); flash('success', `発送依頼を送信: ${r.mcf_order_id}`); await fetchAll() }
    catch (e) { flash('error', (e as Error).message) } finally { setBusyId(null) }
  }
  const markDmSent = async (m: Message) => {
    setBusyId(m.id)
    try { await post(`/api/gifting/messages/${m.id}/mark-sent`); flash('success', '送信済みにしました'); await fetchAll() }
    catch (e) { flash('error', (e as Error).message) } finally { setBusyId(null) }
  }
  const copyText = async (text: string) => {
    try { await navigator.clipboard.writeText(text); flash('success', 'コピーしました') }
    catch { flash('error', 'コピーできませんでした') }
  }
  // DMを開く＝文面コピー＋Instagram DMを開く＋送信済み化 をワンクリックで
  const openCopySend = (m: Message, handle?: string | null) => {
    try { navigator.clipboard?.writeText(m.body || '') } catch { /* noop */ }
    if (handle) window.open(`https://ig.me/m/${handle}`, '_blank', 'noopener')
    markDmSent(m)
  }
  const sendAll = async () => {
    if (pendingEmails.length === 0) return
    if (!confirm(`承認待ちのメール ${pendingEmails.length}件をまとめて送信します。よろしいですか？`)) return
    setBusyId('send-all')
    try { const r = await post('/api/gifting/messages/send-all'); flash('success', `${r.sent}件送信${r.failed ? `・${r.failed}件失敗` : ''}`); await fetchAll() }
    catch (e) { flash('error', (e as Error).message) } finally { setBusyId(null) }
  }
  const approveAllShip = async () => {
    if (pendingShipments.length === 0) return
    if (!confirm(`承認待ちの発送 ${pendingShipments.length}件をまとめてFBA(MCF)発送します。よろしいですか？`)) return
    setBusyId('ship-all')
    try { const r = await post('/api/gifting/shipments/approve-all'); flash('success', `${r.submitted}件発送${r.failed ? `・${r.failed}件失敗` : ''}`); await fetchAll() }
    catch (e) { flash('error', (e as Error).message) } finally { setBusyId(null) }
  }
  const doImport = async () => {
    setImporting(true)
    try {
      let arr: unknown
      try { arr = JSON.parse(importText) } catch { throw new Error('JSONの形式が不正です') }
      const candArr = Array.isArray(arr) ? arr : (arr as { candidates?: unknown[] }).candidates
      const r = await post('/api/gifting/import', { candidates: candArr })
      flash('success', `${r.inserted}件を取り込みました`); setImportText(''); await fetchAll(); setTab('candidates')
    } catch (e) { flash('error', (e as Error).message) } finally { setImporting(false) }
  }
  const saveSettings = async () => {
    if (!settings) return
    setBusyId('settings')
    try {
      const res = await fetch('/api/gifting/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings),
      })
      if (!res.ok) throw new Error((await res.json()).error || '保存失敗')
      setSettings(await res.json()); flash('success', '設定を保存しました')
    } catch (e) { flash('error', (e as Error).message) } finally { setBusyId(null) }
  }

  const TABS: { id: TabId; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'overview', label: '概要', icon: <Gift size={16} /> },
    { id: 'candidates', label: '候補', icon: <Users size={16} />, badge: candidates.filter((c) => c.stage === 'researched' || c.stage === 'selected').length },
    { id: 'outreach', label: 'メール送信', icon: <Mail size={16} />, badge: pendingEmails.length },
    { id: 'dm', label: 'DM送信', icon: <MessageCircle size={16} />, badge: dmDrafts.length },
    { id: 'shipments', label: '発送承認', icon: <Package size={16} />, badge: pendingShipments.length },
    { id: 'import', label: '取込', icon: <Upload size={16} /> },
    { id: 'settings', label: '設定', icon: <SettingsIcon size={16} /> },
  ]

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <button onClick={() => navigate('/')} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 mb-4">
          <ArrowLeft size={16} /> ホームに戻る
        </button>

        <div className="flex items-center gap-3 mb-1">
          <div className="p-2 rounded-lg bg-pink-50 dark:bg-pink-950/50 text-pink-600 dark:text-pink-400"><Gift size={26} /></div>
          <div>
            <h1 className="text-xl font-bold">ギフティング エージェント</h1>
            <p className="text-sm text-gray-500">インフルエンサーへの商品ギフティングを、リサーチ→選定→送信→返信→FBA発送まで半自動化</p>
          </div>
        </div>

        {banner && (
          <div className={`mt-4 flex items-center gap-2 px-4 py-2 rounded-lg text-sm ${banner.type === 'success' ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300' : 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'}`}>
            {banner.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />} {banner.msg}
          </div>
        )}

        {/* タブ */}
        <div className="flex gap-1 mt-5 border-b border-gray-200 dark:border-gray-800 overflow-x-auto">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap -mb-px ${tab === t.id ? 'border-pink-500 text-pink-600 dark:text-pink-400' : 'border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}>
              {t.icon} {t.label}
              {t.badge ? <span className="ml-1 px-1.5 py-0.5 rounded-full text-[11px] bg-pink-500 text-white">{t.badge}</span> : null}
            </button>
          ))}
          <button onClick={fetchAll} className="ml-auto flex items-center gap-1 px-3 py-2 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> 更新
          </button>
        </div>

        {/* ── 概要 ── */}
        {tab === 'overview' && (
          <div className="mt-5 space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="候補総数" value={stats.total_candidates ?? 0} />
              <Stat label="送信済メール" value={stats.sent ?? 0} />
              <Stat label="送信承認待ち" value={pendingEmails.length} accent="amber" />
              <Stat label="発送承認待ち" value={pendingShipments.length} accent="cyan" />
            </div>

            <div className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800">
              <h3 className="text-sm font-semibold mb-3">パイプライン</h3>
              <div className="flex flex-wrap gap-2">
                {['researched', 'selected', 'queued', 'contacted', 'replied', 'address_pending', 'address_collected', 'ship_pending', 'shipped', 'declined'].map((st) => (
                  <span key={st} className={`px-2.5 py-1 rounded-full text-xs ${STAGE_COLOR[st]}`}>
                    {STAGE_LABEL[st]} {stats.stages?.[st] ?? 0}
                  </span>
                ))}
              </div>
            </div>

            <div className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800">
              <h3 className="text-sm font-semibold mb-3">手動トリガー（Cowork連携）</h3>
              <p className="text-xs text-gray-500 mb-3">通常はCowork（AI）が候補を「取込」に流し込みます。ここから各工程を手動でも回せます。</p>
              <div className="flex flex-wrap gap-2">
                <ActionBtn onClick={doScore} busy={busyId === 'score'} icon={<Sparkles size={15} />}>採点・選定</ActionBtn>
                <ActionBtn onClick={doDraft} busy={busyId === 'draft'} icon={<PenLine size={15} />}>提案文を生成</ActionBtn>
                <ActionBtn onClick={doCheckReplies} busy={busyId === 'replies'} icon={<Mail size={15} />}>返信をチェック</ActionBtn>
              </div>
            </div>

            {settings && !settings.product_sku && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-lg text-sm bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                <AlertCircle size={16} /> 発送するFBAのSKU（product_sku）が未設定です。「設定」タブで指定してください。
              </div>
            )}
          </div>
        )}

        {/* ── 候補 ── */}
        {tab === 'candidates' && (
          <div className="mt-5 space-y-2">
            {candidates.length === 0 && <Empty text="候補がありません。「取込」タブからCoworkのリサーチ結果を投入してください。" />}
            {candidates.map((c) => (
              <div key={c.id} className="bg-white dark:bg-gray-900 rounded-lg p-3 border border-gray-200 dark:border-gray-800">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">@{c.handle}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[11px] ${STAGE_COLOR[c.stage] || ''}`}>{STAGE_LABEL[c.stage] || c.stage}</span>
                      {c.score != null && <span className="text-xs text-gray-500">スコア {c.score.toFixed(2)}</span>}
                      {c.fit_segment && <span className="text-xs text-gray-400">{c.fit_segment}</span>}
                    </div>
                    <div className="text-xs text-gray-500 mt-1 flex flex-wrap gap-x-3">
                      <span>{c.platform}</span>
                      <span>フォロワー {fmtNum(c.followers)}</span>
                      {c.engagement_rate != null && <span>ER {c.engagement_rate}%</span>}
                      <span>{c.email ? `✉ ${c.email}` : '✉ メールなし(DM運用)'}</span>
                    </div>
                    {c.score_reasoning && <p className="text-xs text-gray-400 mt-1">{c.score_reasoning}</p>}
                    {(c.address_line1) && <p className="text-xs text-teal-600 dark:text-teal-400 mt-1">📮 {c.recipient_name} 〒{c.postal_code} {c.state_or_region}{c.city}{c.address_line1}</p>}
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    {(c.stage === 'researched' || c.stage === 'rejected') && (
                      <button disabled={busyId === c.id} onClick={() => selectCand(c.id)} className="px-2.5 py-1 text-xs rounded-md bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50">選定</button>
                    )}
                    {c.stage !== 'rejected' && c.stage !== 'shipped' && (
                      <button disabled={busyId === c.id} onClick={() => selectCand(c.id, true)} className="px-2.5 py-1 text-xs rounded-md border border-gray-300 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50">除外</button>
                    )}
                    {c.stage === 'address_collected' && (
                      <button disabled={busyId === c.id} onClick={() => prepareShip(c.id)} className="px-2.5 py-1 text-xs rounded-md bg-cyan-500 text-white hover:bg-cyan-600 disabled:opacity-50">発送準備</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── 送信承認 ── */}
        {tab === 'outreach' && (
          <div className="mt-5 space-y-3">
            {pendingEmails.length > 0 && (
              <div className="flex items-center justify-between bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-900 rounded-lg px-4 py-3">
                <span className="text-sm text-green-800 dark:text-green-300">承認待ちのメール {pendingEmails.length}件</span>
                <button disabled={busyId === 'send-all'} onClick={sendAll} className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
                  {busyId === 'send-all' ? <RefreshCw size={15} className="animate-spin" /> : <Send size={15} />} ワンクリック一括送信
                </button>
              </div>
            )}
            {pendingEmails.length === 0 && <Empty text="送信待ちのメールはありません。候補を選定→「提案文を生成」で作成されます。" />}
            {pendingEmails.map((m) => {
              const c = candMap[m.candidate_id]
              const editing = editId === m.id
              return (
                <div key={m.id} className="bg-white dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-800">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold">@{c?.handle} <span className="text-gray-400 font-normal">→ {c?.email}</span></span>
                    <span className="text-xs text-gray-400">{c?.fit_segment}</span>
                  </div>
                  {editing ? (
                    <div className="space-y-2">
                      <input value={editSubject} onChange={(e) => setEditSubject(e.target.value)} className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-transparent" />
                      <textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={8} className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-transparent" />
                      <div className="flex gap-2">
                        <button disabled={busyId === m.id} onClick={() => saveEdit(m.id)} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-gray-800 dark:bg-gray-200 dark:text-gray-900 text-white"><Save size={13} /> 保存</button>
                        <button onClick={() => setEditId(null)} className="px-3 py-1.5 text-xs rounded-md border border-gray-300 dark:border-gray-700"><X size={13} /></button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm font-medium">{m.subject}</p>
                      <p className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap mt-1">{m.body}</p>
                      <div className="flex gap-2 mt-3">
                        <button disabled={busyId === m.id} onClick={() => sendEmail(m)} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-green-500 text-white hover:bg-green-600 disabled:opacity-50"><Send size={13} /> 承認して送信</button>
                        <button onClick={() => { setEditId(m.id); setEditSubject(m.subject || ''); setEditBody(m.body || '') }} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md border border-gray-300 dark:border-gray-700"><PenLine size={13} /> 編集</button>
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* ── DM送信（半自動） ── */}
        {tab === 'dm' && (
          <div className="mt-5 space-y-3">
            <div className="text-xs text-gray-600 dark:text-gray-300 bg-pink-50 dark:bg-pink-950/30 border border-pink-100 dark:border-pink-900/50 rounded-lg px-4 py-3">
              Instagram DMは規約上、自動送信できません（アカウントBAN回避のため）。下書きを<b>コピー</b>→<b>DMを開く</b>→貼り付けて送信、の半自動運用です。相手が受け取りリンクをタップすれば、住所入力→FBA発送準備までは自動で進みます。
            </div>
            {dmDrafts.length === 0 && <Empty text="DM下書きはありません。候補を選定→「提案文を生成」で作成されます。" />}
            {dmDrafts.map((m) => {
              const c = candMap[m.candidate_id]
              return (
                <div key={m.id} className="bg-white dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-800">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold">@{c?.handle}</span>
                    <span className="text-xs text-gray-400">{c?.followers != null ? fmtNum(c.followers) + 'フォロワー' : ''} {c?.fit_segment}</span>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap">{m.body}</p>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <button disabled={busyId === m.id} onClick={() => openCopySend(m, c?.handle)} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-pink-500 text-white hover:bg-pink-600 disabled:opacity-50">
                      {busyId === m.id ? <RefreshCw size={13} className="animate-spin" /> : <MessageCircle size={13} />} DMを開く（コピー＆送信済み） <ExternalLink size={11} />
                    </button>
                    <button onClick={() => copyText(m.body || '')} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"><Copy size={13} /> コピーのみ</button>
                    <button disabled={busyId === m.id} onClick={() => markDmSent(m)} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md border border-green-300 text-green-700 dark:text-green-400 dark:border-green-800 hover:bg-green-50 dark:hover:bg-green-950 disabled:opacity-50"><CheckCircle size={13} /> 送信済みのみ</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── 発送承認 ── */}
        {tab === 'shipments' && (
          <div className="mt-5 space-y-3">
            {pendingShipments.length > 0 && (
              <div className="flex items-center justify-between bg-cyan-50 dark:bg-cyan-950/40 border border-cyan-200 dark:border-cyan-900 rounded-lg px-4 py-3">
                <span className="text-sm text-cyan-800 dark:text-cyan-300">承認待ちの発送 {pendingShipments.length}件</span>
                <button disabled={busyId === 'ship-all'} onClick={approveAllShip} className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-md bg-cyan-600 text-white hover:bg-cyan-700 disabled:opacity-50">
                  {busyId === 'ship-all' ? <RefreshCw size={15} className="animate-spin" /> : <Package size={15} />} ワンクリック一括発送
                </button>
              </div>
            )}
            {shipments.length === 0 && <Empty text="発送レコードはありません。住所収集済みの候補を「発送準備」すると表示されます。" />}
            {shipments.map((s) => {
              const c = candMap[s.candidate_id]
              return (
                <div key={s.id} className="bg-white dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-800">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">@{c?.handle}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[11px] ${s.status === 'submitted' ? STAGE_COLOR.shipped : s.status === 'failed' ? STAGE_COLOR.failed : STAGE_COLOR.ship_pending}`}>
                          {s.status === 'submitted' ? '発送依頼済' : s.status === 'failed' ? '失敗' : '承認待ち'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">SKU: {s.sku} × {s.quantity}</p>
                      <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5">{s.recipient_name} 〒{s.postal_code} {s.city}{s.address_line1}</p>
                      {s.mcf_order_id && <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">MCF: {s.mcf_order_id}</p>}
                      {s.error && <p className="text-xs text-red-500 mt-0.5">{s.error}</p>}
                    </div>
                    {s.status === 'pending_approval' && (
                      <button disabled={busyId === s.id} onClick={() => approveShip(s)} className="shrink-0 flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-cyan-500 text-white hover:bg-cyan-600 disabled:opacity-50"><Package size={13} /> 承認して発送</button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── 取込 ── */}
        {tab === 'import' && (
          <div className="mt-5 space-y-3">
            <div className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800">
              <h3 className="text-sm font-semibold mb-2">候補インフルエンサーを取り込む</h3>
              <p className="text-xs text-gray-500 mb-3">Coworkのリサーチ結果（JSON配列）を貼り付けます。各要素: <code>handle, platform, email, full_name, followers, engagement_rate, niche, bio, profile_url</code></p>
              <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={10} placeholder='[{"handle":"muscle_taro","platform":"instagram","email":"taro@example.com","full_name":"筋トレ太郎","followers":45000,"engagement_rate":3.2,"niche":"筋トレ","bio":"..."}]'
                className="w-full px-3 py-2 text-xs font-mono rounded-md border border-gray-300 dark:border-gray-700 bg-transparent" />
              <button disabled={importing || !importText.trim()} onClick={doImport} className="mt-3 flex items-center gap-1 px-4 py-2 text-sm rounded-md bg-pink-500 text-white hover:bg-pink-600 disabled:opacity-50">
                <Upload size={15} /> {importing ? '取込中...' : '取り込む'}
              </button>
            </div>
          </div>
        )}

        {/* ── 設定 ── */}
        {tab === 'settings' && settings && (
          <div className="mt-5 space-y-4 max-w-2xl">
            <Section title="実行モード">
              <Toggle label="エージェント有効化（日次cron）" checked={settings.enabled} onChange={(v) => setSettings({ ...settings, enabled: v })} />
              <SelectRow label="リサーチ方式" value={settings.research_mode} onChange={(v) => setSettings({ ...settings, research_mode: v as Settings['research_mode'] })} options={[['manual', 'Cowork/手動取込'], ['db_api', 'DB API(Modash)']]} />
              <SelectRow label="送信モード" value={settings.send_mode} onChange={(v) => setSettings({ ...settings, send_mode: v as Settings['send_mode'] })} options={[['approval', '承認制（推奨）'], ['auto', '自動送信']]} />
              <SelectRow label="発送モード" value={settings.ship_mode} onChange={(v) => setSettings({ ...settings, ship_mode: v as Settings['ship_mode'] })} options={[['approval', '承認制（推奨）'], ['auto', '自動発送']]} />
            </Section>

            <Section title="発送する商品（FBA / MCF）">
              <TextRow label="発送SKU (sellerSku)" value={settings.product_sku} onChange={(v) => setSettings({ ...settings, product_sku: v })} placeholder="例: FP-WRISTWRAP-BK" />
              <TextRow label="商品名（文面用）" value={settings.product_name} onChange={(v) => setSettings({ ...settings, product_name: v })} />
              <NumRow label="発送数量" value={settings.gift_qty} onChange={(v) => setSettings({ ...settings, gift_qty: v })} />
            </Section>

            <Section title="送信文面">
              <TextRow label="差出人名" value={settings.from_name} onChange={(v) => setSettings({ ...settings, from_name: v })} />
              <TextRow label="デフォルト件名" value={settings.email_subject} onChange={(v) => setSettings({ ...settings, email_subject: v })} />
              <AreaRow label="文面への補足指示" value={settings.gift_message_instructions} onChange={(v) => setSettings({ ...settings, gift_message_instructions: v })} />
              <AreaRow label="返信対応への補足指示" value={settings.reply_instructions} onChange={(v) => setSettings({ ...settings, reply_instructions: v })} />
            </Section>

            <Section title="選定基準（採点用）">
              <NumRow label="選定スコア閾値 (0-1)" value={settings.min_score} step={0.05} onChange={(v) => setSettings({ ...settings, min_score: v })} />
              <NumRow label="最小フォロワー" value={settings.min_followers} onChange={(v) => setSettings({ ...settings, min_followers: v })} />
              <NumRow label="最大フォロワー" value={settings.max_followers} onChange={(v) => setSettings({ ...settings, max_followers: v })} />
              <NumRow label="最小エンゲージ率(%)" value={settings.min_engagement} step={0.1} onChange={(v) => setSettings({ ...settings, min_engagement: v })} />
              <TextRow label="狙うニッチ（カンマ区切り）" value={settings.target_niches} onChange={(v) => setSettings({ ...settings, target_niches: v })} />
              <NumRow label="1日の送信上限" value={settings.daily_send_limit} onChange={(v) => setSettings({ ...settings, daily_send_limit: v })} />
            </Section>

            <button disabled={busyId === 'settings'} onClick={saveSettings} className="flex items-center gap-1 px-4 py-2 text-sm rounded-md bg-pink-500 text-white hover:bg-pink-600 disabled:opacity-50">
              <Save size={15} /> 設定を保存
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── 小コンポーネント ──
function Stat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  const c = accent === 'amber' ? 'text-amber-600 dark:text-amber-400' : accent === 'cyan' ? 'text-cyan-600 dark:text-cyan-400' : 'text-gray-900 dark:text-gray-100'
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800">
      <div className={`text-2xl font-bold ${c}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  )
}
function ActionBtn({ onClick, busy, icon, children }: { onClick: () => void; busy: boolean; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button disabled={busy} onClick={onClick} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50">
      {busy ? <RefreshCw size={15} className="animate-spin" /> : icon} {children}
    </button>
  )
}
function Empty({ text }: { text: string }) {
  return <div className="text-center py-12 text-sm text-gray-400">{text}</div>
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800 space-y-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </div>
  )
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between cursor-pointer">
      <span className="text-sm">{label}</span>
      <button type="button" onClick={() => onChange(!checked)} className={`w-11 h-6 rounded-full transition ${checked ? 'bg-pink-500' : 'bg-gray-300 dark:bg-gray-700'}`}>
        <span className={`block w-5 h-5 bg-white rounded-full transition transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </label>
  )
}
function TextRow({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="text-xs text-gray-500">{label}</label>
      <input value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-transparent" />
    </div>
  )
}
function AreaRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-xs text-gray-500">{label}</label>
      <textarea value={value ?? ''} rows={2} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-transparent" />
    </div>
  )
}
function NumRow({ label, value, onChange, step }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <div>
      <label className="text-xs text-gray-500">{label}</label>
      <input type="number" step={step} value={value ?? 0} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-transparent" />
    </div>
  )
}
function SelectRow({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="flex items-center justify-between">
      <label className="text-sm">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-transparent">
        {options.map(([v, l]) => <option key={v} value={v} className="dark:bg-gray-900">{l}</option>)}
      </select>
    </div>
  )
}
