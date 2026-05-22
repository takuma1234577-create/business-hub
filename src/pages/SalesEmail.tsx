import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Mail, RefreshCw, Eye, Send, CheckCircle, AlertCircle, Clock, Trash2, Plus, X, PenLine, Sparkles, Copy, Check } from 'lucide-react'

interface Lead {
  id: string
  row_index: number
  company_name: string
  contact_name: string
  email: string
  challenges: string
  category: string
  status: 'unsent' | 'sent' | 'error'
  sent_at: string | null
  generated_subject: string | null
  generated_body: string | null
}

interface SendResult {
  total: number
  sent: number
  errors: number
  details: { company: string; success: boolean; error?: string }[]
}

type TabId = 'leads' | 'compose' | 'add' | 'history'

export default function SalesEmail() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<TabId>('leads')
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [sending, setSending] = useState(false)
  const [dryRun, setDryRun] = useState(true)
  const [sendLimit, setSendLimit] = useState(10)
  const [sendResult, setSendResult] = useState<SendResult | null>(null)
  const [previewLead, setPreviewLead] = useState<Lead | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewData, setPreviewData] = useState<{ subject: string; body: string } | null>(null)
  const [error, setError] = useState('')

  // Compose
  const [composeTo, setComposeTo] = useState('')
  const [composeCompany, setComposeCompany] = useState('')
  const [composeContact, setComposeContact] = useState('')
  const [composeChallenges, setComposeChallenges] = useState('')
  const [composeCategory, setComposeCategory] = useState('')
  const [composeSubject, setComposeSubject] = useState('')
  const [composeBody, setComposeBody] = useState('')
  const [composeGenerating, setComposeGenerating] = useState(false)
  const [composeSending, setComposeSending] = useState(false)
  const [composeMode, setComposeMode] = useState<'draft' | 'send'>('draft')
  const [composeResult, setComposeResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [composeCopied, setComposeCopied] = useState(false)

  // Manual add
  const [addForm, setAddForm] = useState({ company_name: '', contact_name: '', email: '', challenges: '', category: '' })
  const [adding, setAdding] = useState(false)

  // History
  const [history, setHistory] = useState<Lead[]>([])

  const fetchLeads = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/sales-email/leads')
      if (res.ok) {
        const data = await res.json()
        setLeads(data.filter((l: Lead) => l.status === 'unsent'))
        setHistory(data.filter((l: Lead) => l.status !== 'unsent'))
      }
    } catch {
      setError('リード取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchLeads() }, [fetchLeads])

  const handleSync = async () => {
    setSyncing(true)
    setError('')
    try {
      const res = await fetch('/api/sales-email/sync-sheet', { method: 'POST' })
      if (!res.ok) throw new Error('同期失敗')
      await fetchLeads()
    } catch {
      setError('スプレッドシート同期に失敗しました')
    } finally {
      setSyncing(false)
    }
  }

  const handlePreview = async (lead: Lead) => {
    setPreviewLead(lead)
    setPreviewing(true)
    setPreviewData(null)
    try {
      const res = await fetch('/api/sales-email/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lead),
      })
      if (res.ok) setPreviewData(await res.json())
    } catch {} finally {
      setPreviewing(false)
    }
  }

  const handleSend = async () => {
    if (!dryRun && !confirm(`${leads.length}件のリードに営業メールを送信します。\nAIが各リードの課題に合わせてメールを自動生成し、Gmailから送信します。\n\n続行しますか？`)) return
    setSending(true)
    setSendResult(null)
    setError('')
    try {
      const res = await fetch('/api/sales-email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: dryRun, limit: sendLimit }),
      })
      if (res.ok) {
        const data = await res.json()
        setSendResult(data)
        await fetchLeads()
      } else {
        throw new Error('送信処理に失敗しました')
      }
    } catch {
      setError('送信処理でエラーが発生しました')
    } finally {
      setSending(false)
    }
  }

  const handleAddLead = async () => {
    if (!addForm.company_name.trim() || !addForm.email.trim()) return
    setAdding(true)
    try {
      await fetch('/api/sales-email/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addForm),
      })
      setAddForm({ company_name: '', contact_name: '', email: '', challenges: '', category: '' })
      await fetchLeads()
      setTab('leads')
    } catch {} finally {
      setAdding(false)
    }
  }

  const handleComposeGenerate = async () => {
    if (!composeCompany.trim() && !composeChallenges.trim()) return
    setComposeGenerating(true)
    setComposeResult(null)
    try {
      const res = await fetch('/api/sales-email/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: composeCompany,
          contact_name: composeContact,
          challenges: composeChallenges,
          category: composeCategory,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setComposeSubject(data.subject)
        setComposeBody(data.body)
      } else {
        const data = await res.json().catch(() => ({}))
        setComposeResult({ type: 'error', message: data.error || 'AI生成に失敗しました' })
      }
    } catch {
      setComposeResult({ type: 'error', message: 'AI生成に失敗しました' })
    } finally {
      setComposeGenerating(false)
    }
  }

  const handleComposeSend = async () => {
    if (!composeTo || !composeSubject || !composeBody) return
    setComposeSending(true)
    setComposeResult(null)
    try {
      const res = await fetch('/api/sales-email/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: composeTo,
          subject: composeSubject,
          body: composeBody,
          company_name: composeCompany,
          mode: composeMode,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setComposeResult({
          type: 'success',
          message: data.status === 'sent' ? `${composeTo} にメールを送信しました` : '下書きを保存しました',
        })
        fetchLeads()
      } else {
        const data = await res.json().catch(() => ({}))
        setComposeResult({ type: 'error', message: data.error || '送信に失敗しました' })
      }
    } catch {
      setComposeResult({ type: 'error', message: '送信に失敗しました' })
    } finally {
      setComposeSending(false)
    }
  }

  const handleComposeCopy = async () => {
    const text = `件名: ${composeSubject}\n\n${composeBody}`
    await navigator.clipboard.writeText(text)
    setComposeCopied(true)
    setTimeout(() => setComposeCopied(false), 2000)
  }

  const resetCompose = () => {
    setComposeTo('')
    setComposeCompany('')
    setComposeContact('')
    setComposeChallenges('')
    setComposeCategory('')
    setComposeSubject('')
    setComposeBody('')
    setComposeResult(null)
  }

  const handleDelete = async (id: string) => {
    await fetch(`/api/sales-email/leads/${id}`, { method: 'DELETE' })
    fetchLeads()
  }

  const statusIcon = (status: string) => {
    switch (status) {
      case 'sent': return <CheckCircle size={14} className="text-green-500" />
      case 'error': return <AlertCircle size={14} className="text-red-500" />
      default: return <Clock size={14} className="text-slate-400" />
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-4">
          <button onClick={() => navigate('/')} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 cursor-pointer">
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-3 flex-1">
            <div className="w-8 h-8 rounded-lg bg-teal-500 flex items-center justify-center">
              <Mail size={16} className="text-white" />
            </div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-white">営業メール自動送信</h1>
          </div>
          <button onClick={fetchLeads} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 cursor-pointer">
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex gap-1 -mb-px">
            {([['leads', '未送信リード'], ['compose', 'メール作成'], ['add', 'リード追加'], ['history', '送信履歴']] as [TabId, string][]).map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors cursor-pointer ${tab === id ? 'border-teal-500 text-teal-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
              >{label}</button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6">
        {error && (
          <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* Leads tab */}
        {tab === 'leads' && (
          <div>
            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                <p className="text-xs text-slate-500 mb-1">未送信</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">{leads.length}</p>
              </div>
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                <p className="text-xs text-slate-500 mb-1">送信済み</p>
                <p className="text-2xl font-bold text-green-600">{history.filter(h => h.status === 'sent').length}</p>
              </div>
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                <p className="text-xs text-slate-500 mb-1">エラー</p>
                <p className="text-2xl font-bold text-red-600">{history.filter(h => h.status === 'error').length}</p>
              </div>
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                <p className="text-xs text-slate-500 mb-1">合計</p>
                <p className="text-2xl font-bold text-teal-600">{leads.length + history.length}</p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <button onClick={handleSync} disabled={syncing}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 cursor-pointer disabled:opacity-50">
                <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
                {syncing ? '同期中...' : 'スプレッドシート同期'}
              </button>
              <div className="flex items-center gap-2 ml-auto">
                <label className="text-xs text-slate-500">
                  送信上限:
                  <input type="number" value={sendLimit} onChange={e => setSendLimit(Number(e.target.value))} min={1} max={50}
                    className="w-14 ml-1 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white" />
                </label>
                <button onClick={() => { setDryRun(true); handleSend() }} disabled={sending || leads.length === 0}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 cursor-pointer disabled:opacity-50">
                  {sending && dryRun ? <RefreshCw size={14} className="animate-spin" /> : <Eye size={14} />}
                  プレビュー
                </button>
                <button onClick={() => { setDryRun(false); setTimeout(() => handleSend(), 0) }} disabled={sending || leads.length === 0}
                  className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-teal-500 hover:bg-teal-600 text-white text-sm font-medium disabled:opacity-50 cursor-pointer">
                  {sending && !dryRun ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                  {sending && !dryRun ? 'AI生成・送信中...' : `${leads.length}件を自動送信`}
                </button>
              </div>
            </div>

            {/* Description */}
            <div className="mb-4 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 rounded-xl px-4 py-3">
              <p className="text-xs text-teal-700 dark:text-teal-400">
                各リードの会社名・課題・カテゴリをもとにClaude AIがパーソナライズした営業メールを自動生成し、Gmailから送信します。初月無料コンサルでクロージングします。
              </p>
            </div>

            {/* Send result */}
            {sendResult && (
              <div className="mb-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
                <h3 className="text-sm font-medium text-slate-900 dark:text-white mb-3">
                  {dryRun ? 'プレビュー結果' : '送信結果'}
                </h3>
                <div className="flex gap-4 mb-3">
                  <span className="text-sm text-slate-600 dark:text-slate-400">対象: {sendResult.total}件</span>
                  <span className="text-sm text-green-600">成功: {sendResult.sent}件</span>
                  <span className="text-sm text-red-600">エラー: {sendResult.errors}件</span>
                </div>
                <div className="space-y-1.5 max-h-60 overflow-y-auto">
                  {sendResult.details.map((d, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      {d.success ? <CheckCircle size={12} className="text-green-500" /> : <AlertCircle size={12} className="text-red-500" />}
                      <span className="text-slate-700 dark:text-slate-300">{d.company}</span>
                      {d.error && <span className="text-red-500 ml-auto">{d.error}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Lead list */}
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 text-xs font-medium text-slate-500">
                <span className="flex-1">会社名</span>
                <span className="w-32 hidden sm:block">担当者</span>
                <span className="w-48 hidden sm:block">メール</span>
                <span className="w-40 hidden md:block">課題</span>
                <span className="w-20 text-center">状態</span>
                <span className="w-16"></span>
              </div>
              {leads.length === 0 ? (
                <div className="text-center py-16 text-slate-400">
                  <Mail size={32} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm">未送信リードがありません</p>
                  <p className="text-xs mt-1">「スプレッドシート同期」または「手動追加」でリードを取得してください</p>
                </div>
              ) : leads.map(lead => (
                <div key={lead.id} className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{lead.company_name}</p>
                    <p className="text-xs text-slate-400 truncate sm:hidden">{lead.email}</p>
                  </div>
                  <span className="w-32 hidden sm:block text-xs text-slate-600 dark:text-slate-400 truncate">{lead.contact_name}</span>
                  <span className="w-48 hidden sm:block text-xs text-slate-600 dark:text-slate-400 truncate">{lead.email}</span>
                  <span className="w-40 hidden md:block text-xs text-slate-500 truncate">{lead.challenges}</span>
                  <span className="w-20 flex justify-center">{statusIcon(lead.status)}</span>
                  <div className="w-16 flex gap-1 justify-end">
                    <button onClick={() => handlePreview(lead)} className="p-1.5 rounded hover:bg-teal-50 dark:hover:bg-teal-900/20 text-slate-400 hover:text-teal-600 cursor-pointer">
                      <Eye size={14} />
                    </button>
                    <button onClick={() => handleDelete(lead.id)} className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-300 hover:text-red-500 cursor-pointer">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Compose tab */}
        {tab === 'compose' && (
          <div className="space-y-6">
            {composeResult && (
              <div className={`px-4 py-3 rounded-xl text-sm ${
                composeResult.type === 'error'
                  ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'
                  : 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
              }`}>
                {composeResult.message}
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left: Lead info + AI generate */}
              <div className="space-y-4">
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
                  <h3 className="font-medium text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                    <Sparkles size={16} className="text-teal-500" /> リード情報からAI生成
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">会社名 *</label>
                      <input type="text" value={composeCompany} onChange={e => setComposeCompany(e.target.value)}
                        placeholder="株式会社〇〇"
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/40" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">担当者名</label>
                      <input type="text" value={composeContact} onChange={e => setComposeContact(e.target.value)}
                        placeholder="山田太郎"
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/40" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">課題・悩み *</label>
                      <textarea value={composeChallenges} onChange={e => setComposeChallenges(e.target.value)}
                        placeholder="月商500万円だがレビュー率が低い、広告ROASが悪化している..."
                        rows={3}
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/40 resize-y" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">業種・商品カテゴリ</label>
                      <input type="text" value={composeCategory} onChange={e => setComposeCategory(e.target.value)}
                        placeholder="サプリメント、ヘアケア..."
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/40" />
                    </div>
                    <button onClick={handleComposeGenerate}
                      disabled={composeGenerating || (!composeCompany.trim() && !composeChallenges.trim())}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-teal-500 hover:bg-teal-600 text-white text-sm font-medium disabled:opacity-50 cursor-pointer transition-colors">
                      {composeGenerating ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
                      {composeGenerating ? 'AI生成中...' : 'AIでメールを生成'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Right: Email form */}
              <div className="space-y-4">
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
                  <h3 className="font-medium text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                    <PenLine size={16} className="text-teal-500" /> メール内容
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">宛先メールアドレス *</label>
                      <input type="email" value={composeTo} onChange={e => setComposeTo(e.target.value)}
                        placeholder="info@example.co.jp"
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/40" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">件名 *</label>
                      <input type="text" value={composeSubject} onChange={e => setComposeSubject(e.target.value)}
                        placeholder="AIで生成されます"
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/40" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">本文 *</label>
                      <textarea value={composeBody} onChange={e => setComposeBody(e.target.value)}
                        placeholder="左側のフォームからAIで生成するか、直接入力してください"
                        rows={12}
                        className="w-full px-3 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/40 resize-y leading-relaxed" />
                      <p className="text-xs text-slate-400 mt-1">{composeBody.length} 文字</p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                    <div className="flex gap-2">
                      <button onClick={() => setComposeMode('draft')}
                        className={`px-3 py-2 rounded-lg text-xs font-medium transition cursor-pointer ${
                          composeMode === 'draft' ? 'bg-blue-500 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                        }`}>下書き保存</button>
                      <button onClick={() => setComposeMode('send')}
                        className={`px-3 py-2 rounded-lg text-xs font-medium transition cursor-pointer ${
                          composeMode === 'send' ? 'bg-teal-500 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                        }`}>直接送信</button>
                    </div>
                    <div className="flex gap-2">
                      {composeBody && (
                        <button onClick={handleComposeCopy}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer">
                          {composeCopied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                          {composeCopied ? 'コピー済み' : 'コピー'}
                        </button>
                      )}
                      <button onClick={resetCompose}
                        className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-50 cursor-pointer">
                        リセット
                      </button>
                      <button onClick={handleComposeSend}
                        disabled={composeSending || !composeTo || !composeSubject || !composeBody}
                        className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-teal-500 hover:bg-teal-600 text-white text-sm font-medium disabled:opacity-50 cursor-pointer transition-colors">
                        {composeSending ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                        {composeSending ? '処理中...' : composeMode === 'send' ? '送信' : '下書き保存'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Add tab */}
        {tab === 'add' && (
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 max-w-lg">
            <h3 className="font-medium text-slate-900 dark:text-white mb-4 flex items-center gap-2">
              <Plus size={16} /> リードを手動追加
            </h3>
            <div className="space-y-3">
              {[
                { key: 'company_name', label: '会社名 *', placeholder: '株式会社〇〇' },
                { key: 'contact_name', label: '担当者名', placeholder: '山田太郎' },
                { key: 'email', label: 'メールアドレス *', placeholder: 'info@example.co.jp' },
                { key: 'challenges', label: '課題・悩み', placeholder: 'Amazon広告のROASが低い' },
                { key: 'category', label: '業種・商品カテゴリ', placeholder: 'サプリメント' },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">{f.label}</label>
                  {f.key === 'challenges' ? (
                    <textarea
                      value={(addForm as Record<string, string>)[f.key]}
                      onChange={e => setAddForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                      placeholder={f.placeholder} rows={3}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/40 resize-y"
                    />
                  ) : (
                    <input type={f.key === 'email' ? 'email' : 'text'}
                      value={(addForm as Record<string, string>)[f.key]}
                      onChange={e => setAddForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/40"
                    />
                  )}
                </div>
              ))}
            </div>
            <button onClick={handleAddLead} disabled={adding || !addForm.company_name.trim() || !addForm.email.trim()}
              className="mt-4 flex items-center gap-2 px-5 py-2.5 rounded-lg bg-teal-500 hover:bg-teal-600 text-white text-sm font-medium disabled:opacity-50 cursor-pointer">
              {adding ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />}
              追加
            </button>
          </div>
        )}

        {/* History tab */}
        {tab === 'history' && (
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 text-xs font-medium text-slate-500">
              <span className="w-5"></span>
              <span className="flex-1">会社名</span>
              <span className="w-48 hidden sm:block">メール</span>
              <span className="w-40 hidden sm:block">送信日時</span>
              <span className="w-20 text-center">状態</span>
            </div>
            {history.length === 0 ? (
              <div className="text-center py-16 text-slate-400">
                <Send size={32} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">送信履歴はありません</p>
              </div>
            ) : history.map(h => (
              <div key={h.id} className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-700/50">
                <span className="w-5">{statusIcon(h.status)}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{h.company_name}</p>
                  {h.generated_subject && <p className="text-xs text-slate-400 truncate">{h.generated_subject}</p>}
                </div>
                <span className="w-48 hidden sm:block text-xs text-slate-500 truncate">{h.email}</span>
                <span className="w-40 hidden sm:block text-xs text-slate-400">{h.sent_at ? new Date(h.sent_at).toLocaleString('ja-JP') : '-'}</span>
                <span className={`w-20 text-center text-[10px] px-2 py-0.5 rounded-full font-medium ${h.status === 'sent' ? 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400'}`}>
                  {h.status === 'sent' ? '送信済' : 'エラー'}
                </span>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Preview Modal */}
      {previewLead && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-lg shadow-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
              <h3 className="font-semibold text-slate-900 dark:text-white">メールプレビュー: {previewLead.company_name}</h3>
              <button onClick={() => { setPreviewLead(null); setPreviewData(null) }} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 cursor-pointer"><X size={18} /></button>
            </div>
            <div className="px-6 py-5 overflow-y-auto flex-1">
              {previewing ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw size={24} className="animate-spin text-teal-500" />
                  <span className="ml-2 text-sm text-slate-500">AIがメールを生成中...</span>
                </div>
              ) : previewData ? (
                <div>
                  <div className="mb-4">
                    <p className="text-xs text-slate-500 mb-1">件名</p>
                    <p className="text-sm font-medium text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-900/50 rounded-lg px-3 py-2">{previewData.subject}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-1">本文</p>
                    <div className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap bg-slate-50 dark:bg-slate-900/50 rounded-lg px-3 py-3 leading-relaxed">
                      {previewData.body}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-center text-slate-400 py-8">プレビュー生成に失敗しました</p>
              )}
            </div>
            <div className="flex justify-end px-6 py-4 border-t border-slate-200 dark:border-slate-700">
              <button onClick={() => { setPreviewLead(null); setPreviewData(null) }}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-600 cursor-pointer">閉じる</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
