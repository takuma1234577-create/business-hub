import { useState, useEffect, useCallback } from 'react'
import { Mail, Save, Play, ToggleLeft, ToggleRight, Clock, CheckCircle, XCircle, AlertTriangle, ChevronLeft, ChevronRight, PenLine, Send, Sparkles, X, RefreshCw } from 'lucide-react'
import axios from 'axios'

interface EmailSettings {
  id?: string
  enabled: boolean
  mode: 'draft' | 'send'
  gmail_query: string
  max_emails_per_run: number
  reply_prefix: string
  reply_suffix: string
}

interface EmailLog {
  id: string
  gmail_message_id: string
  customer_email: string
  subject: string
  customer_message: string
  ai_reply: string | null
  status: 'sent' | 'draft' | 'skipped' | 'error'
  error: string | null
  created_at: string
}

interface LogPagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

const api = axios.create({ baseURL: '/api/line-crm/email-auto-reply' })
api.interceptors.request.use((config) => { const token = localStorage.getItem('auth_token'); if (token) config.headers.Authorization = `Bearer ${token}`; return config })
export default function EmailAutoReply() {
  const [settings, setSettings] = useState<EmailSettings>({
    enabled: false,
    mode: 'draft',
    gmail_query: 'from:noreply@shopify.com is:unread',
    max_emails_per_run: 10,
    reply_prefix: '',
    reply_suffix: '\n\n---\nFITPEAK カスタマーサポート',
  })
  const [logs, setLogs] = useState<EmailLog[]>([])
  const [pagination, setPagination] = useState<LogPagination>({ page: 1, pageSize: 20, total: 0, totalPages: 0 })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [triggering, setTriggering] = useState(false)
  const [triggerResult, setTriggerResult] = useState<string | null>(null)
  const [expandedLog, setExpandedLog] = useState<string | null>(null)
  const [syncingKnowledge, setSyncingKnowledge] = useState(false)

  // Compose
  const [showCompose, setShowCompose] = useState(false)
  const [composeTo, setComposeTo] = useState('')
  const [composeSubject, setComposeSubject] = useState('')
  const [composeBody, setComposeBody] = useState('')
  const [composeContext, setComposeContext] = useState('')
  const [composeTone, setComposeTone] = useState<'formal' | 'friendly' | 'casual'>('formal')
  const [composeMode, setComposeMode] = useState<'draft' | 'send'>('draft')
  const [composing, setComposing] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [composeResult, setComposeResult] = useState<string | null>(null)

  const handleSyncKnowledge = async () => {
    if (!confirm('既存の返信ログをナレッジベースに同期します。数分かかる場合があります。続行しますか？')) return
    setSyncingKnowledge(true)
    try {
      const res = await api.post('/sync-knowledge')
      setTriggerResult(`ナレッジベースに ${res.data.synced}/${res.data.total} 件同期しました`)
    } catch (err: any) {
      setTriggerResult('エラー: ' + (err?.response?.data?.error || err.message))
    } finally { setSyncingKnowledge(false) }
  }

  const fetchSettings = useCallback(async () => {
    try {
      const res = await api.get('/settings')
      setSettings(res.data)
    } catch (err) {
      console.error('Failed to fetch email settings:', err)
    }
  }, [])

  const fetchLogs = useCallback(async (page = 1) => {
    try {
      const res = await api.get('/logs', { params: { page, pageSize: 20 } })
      setLogs(res.data.data)
      setPagination(res.data.pagination)
    } catch (err) {
      console.error('Failed to fetch email logs:', err)
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    Promise.all([fetchSettings(), fetchLogs()]).finally(() => setLoading(false))
  }, [fetchSettings, fetchLogs])

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await api.put('/settings', settings)
      setSettings(res.data)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error('Failed to save email settings:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleTrigger = async () => {
    setTriggering(true)
    setTriggerResult(null)
    try {
      const res = await api.post('/trigger')
      const data = res.data
      if (data.skipped) {
        setTriggerResult('自動返信が無効です。有効にしてから実行してください。')
      } else {
        const sent = data.results?.filter((r: { status: string }) => r.status === 'sent').length || 0
        const drafted = data.results?.filter((r: { status: string }) => r.status === 'draft').length || 0
        const parts = [`${data.processed}件処理`]
        if (drafted > 0) parts.push(`${drafted}件下書き作成`)
        if (sent > 0) parts.push(`${sent}件送信済み`)
        setTriggerResult(`完了: ${parts.join('、')}`)
        fetchLogs()
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '実行に失敗しました'
      setTriggerResult(`エラー: ${message}`)
    } finally {
      setTriggering(false)
    }
  }

  const handleGenerateEmail = async () => {
    if (!composeContext.trim()) return
    setGenerating(true)
    try {
      const res = await api.post('/compose/ai', {
        to: composeTo,
        subject: composeSubject,
        context: composeContext,
        tone: composeTone,
      })
      if (res.data.subject && !composeSubject) setComposeSubject(res.data.subject)
      setComposeBody(res.data.body)
    } catch (err: any) {
      setComposeResult('AI生成エラー: ' + (err?.response?.data?.error || err.message))
    } finally {
      setGenerating(false)
    }
  }

  const handleSendCompose = async () => {
    if (!composeTo || !composeSubject || !composeBody) return
    setComposing(true)
    setComposeResult(null)
    try {
      const res = await api.post('/compose/send', {
        to: composeTo,
        subject: composeSubject,
        body: composeBody,
        mode: composeMode,
      })
      setComposeResult(res.data.status === 'sent' ? `${composeTo} にメールを送信しました` : `下書きを保存しました`)
      fetchLogs()
      // フォームリセット
      setComposeTo('')
      setComposeSubject('')
      setComposeBody('')
      setComposeContext('')
    } catch (err: any) {
      setComposeResult('エラー: ' + (err?.response?.data?.error || err.message))
    } finally {
      setComposing(false)
    }
  }

  const resetCompose = () => {
    setShowCompose(false)
    setComposeTo('')
    setComposeSubject('')
    setComposeBody('')
    setComposeContext('')
    setComposeResult(null)
  }

  const statusIcon = (status: string) => {
    switch (status) {
      case 'sent': return <CheckCircle size={16} className="text-green-500" />
      case 'draft': return <Mail size={16} className="text-blue-500" />
      case 'skipped': return <AlertTriangle size={16} className="text-yellow-500" />
      case 'error': return <XCircle size={16} className="text-red-500" />
      default: return <Clock size={16} className="text-slate-400" />
    }
  }

  const statusLabel = (status: string) => {
    switch (status) {
      case 'sent': return '送信済み'
      case 'draft': return '下書き'
      case 'skipped': return 'スキップ'
      case 'error': return 'エラー'
      default: return status
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-[#06C755] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Settings Section */}
      <div>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-50 dark:bg-orange-900/20 flex items-center justify-center">
              <Mail size={20} className="text-orange-500" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">メール自動返信</h2>
              <p className="text-sm text-slate-500">Shopifyからの問い合わせメールにAIで自動返信</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowCompose(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium transition-colors cursor-pointer"
            >
              <PenLine size={16} />
              メール作成
            </button>
            <button
              onClick={handleSyncKnowledge}
              disabled={syncingKnowledge}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium transition-colors disabled:opacity-50 cursor-pointer"
              title="過去の返信ログをナレッジベースに反映"
            >
              {syncingKnowledge ? '同期中...' : 'ナレッジ同期'}
            </button>
            <button
              onClick={handleTrigger}
              disabled={triggering}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium transition-colors disabled:opacity-50 cursor-pointer"
            >
              <Play size={16} />
              {triggering ? '実行中...' : '手動実行'}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${
                saved
                  ? 'bg-green-100 text-green-700'
                  : 'bg-[#06C755] hover:bg-[#05b34c] text-white'
              } disabled:opacity-50`}
            >
              <Save size={16} />
              {saved ? '保存しました' : saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>

        {triggerResult && (
          <div className={`mb-4 px-4 py-3 rounded-lg text-sm ${
            triggerResult.startsWith('エラー')
              ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
              : 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
          }`}>
            {triggerResult}
          </div>
        )}

        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 space-y-6">
          {/* Enable Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-slate-900 dark:text-white">自動返信</h3>
              <p className="text-sm text-slate-500 mt-0.5">有効にすると、15分ごとにメールをチェックしてAIが自動返信します</p>
            </div>
            <button
              onClick={() => setSettings({ ...settings, enabled: !settings.enabled })}
              className="cursor-pointer"
            >
              {settings.enabled ? (
                <ToggleRight size={36} className="text-[#06C755]" />
              ) : (
                <ToggleLeft size={36} className="text-slate-300 dark:text-slate-600" />
              )}
            </button>
          </div>

          <hr className="border-slate-200 dark:border-slate-700" />

          {/* Mode */}
          <div>
            <h3 className="font-medium text-slate-900 dark:text-white mb-2">動作モード</h3>
            <div className="flex gap-3">
              <button
                onClick={() => setSettings({ ...settings, mode: 'draft' })}
                className={`flex-1 p-3 rounded-lg border-2 text-sm font-medium transition cursor-pointer ${
                  settings.mode === 'draft'
                    ? 'border-[#06C755] bg-[#06C755]/5 text-[#06C755]'
                    : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-300'
                }`}
              >
                下書き作成
                <p className="text-xs font-normal mt-0.5 opacity-70">Gmailに下書きを保存（送信前に確認可能）</p>
              </button>
              <button
                onClick={() => setSettings({ ...settings, mode: 'send' })}
                className={`flex-1 p-3 rounded-lg border-2 text-sm font-medium transition cursor-pointer ${
                  settings.mode === 'send'
                    ? 'border-orange-500 bg-orange-50 text-orange-600'
                    : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-300'
                }`}
              >
                自動送信
                <p className="text-xs font-normal mt-0.5 opacity-70">AIの返信を直接送信（確認なし）</p>
              </button>
            </div>
          </div>

          <hr className="border-slate-200 dark:border-slate-700" />

          {/* Gmail Query */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Gmailの検索クエリ</label>
            <input
              type="text"
              value={settings.gmail_query}
              onChange={e => setSettings({ ...settings, gmail_query: e.target.value })}
              placeholder="例: from:noreply@shopify.com is:unread"
              className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755] text-sm font-mono"
            />
            <p className="text-xs text-slate-400 mt-1.5">
              Shopifyからのメールを取得するGmail検索フィルタ。例: from:notifications@shopify.com, label:shopify-support
            </p>
          </div>

          {/* Max Emails */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              1回あたりの最大処理件数: {settings.max_emails_per_run}
            </label>
            <input
              type="range"
              min="1"
              max="50"
              value={settings.max_emails_per_run}
              onChange={e => setSettings({ ...settings, max_emails_per_run: parseInt(e.target.value) })}
              className="w-full h-2 rounded-full appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, #06C755 ${(settings.max_emails_per_run / 50) * 100}%, #e2e8f0 ${(settings.max_emails_per_run / 50) * 100}%)`,
              }}
            />
          </div>

          {/* Reply Prefix */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">返信の冒頭文</label>
            <textarea
              value={settings.reply_prefix}
              onChange={e => setSettings({ ...settings, reply_prefix: e.target.value })}
              placeholder="例: お問い合わせいただきありがとうございます。"
              rows={2}
              className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755] text-sm resize-none"
            />
          </div>

          {/* Reply Suffix */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">返信の署名</label>
            <textarea
              value={settings.reply_suffix}
              onChange={e => setSettings({ ...settings, reply_suffix: e.target.value })}
              placeholder="例: ---\nFITPEAK カスタマーサポート"
              rows={3}
              className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755] text-sm resize-none"
            />
          </div>
        </div>
      </div>

      {/* Logs Section */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
            <Clock size={20} className="text-slate-500" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">処理ログ</h2>
            <p className="text-sm text-slate-500">自動返信の実行履歴</p>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
          {logs.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <Mail size={36} className="mx-auto mb-3 opacity-50" />
              <p>まだ処理ログがありません</p>
            </div>
          ) : (
            <>
              <div className="divide-y divide-slate-100 dark:divide-slate-700">
                {logs.map(log => (
                  <div key={log.id}>
                    <button
                      onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                      className="w-full px-5 py-4 flex items-center gap-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors text-left cursor-pointer"
                    >
                      {statusIcon(log.status)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-medium text-sm text-slate-900 dark:text-white truncate">
                            {log.subject || '(件名なし)'}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            log.status === 'sent'
                              ? 'bg-green-50 dark:bg-green-900/30 text-green-600'
                              : log.status === 'draft'
                                ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600'
                                : log.status === 'error'
                                  ? 'bg-red-50 dark:bg-red-900/30 text-red-600'
                                  : 'bg-yellow-50 dark:bg-yellow-900/30 text-yellow-600'
                          }`}>
                            {statusLabel(log.status)}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-400">
                          <span>{log.customer_email}</span>
                          <span>{new Date(log.created_at).toLocaleString('ja-JP')}</span>
                        </div>
                      </div>
                    </button>

                    {expandedLog === log.id && (
                      <div className="px-5 pb-4 space-y-3">
                        <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-4">
                          <h4 className="text-xs font-medium text-slate-500 mb-1">お客様のメッセージ</h4>
                          <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{log.customer_message}</p>
                        </div>
                        {log.ai_reply && (
                          <div className="bg-green-50 dark:bg-green-900/10 rounded-lg p-4">
                            <h4 className="text-xs font-medium text-green-600 mb-1">AI返信</h4>
                            <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{log.ai_reply}</p>
                          </div>
                        )}
                        {log.error && (
                          <div className="bg-red-50 dark:bg-red-900/10 rounded-lg p-4">
                            <h4 className="text-xs font-medium text-red-600 mb-1">エラー</h4>
                            <p className="text-sm text-red-700 dark:text-red-400">{log.error}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Pagination */}
              {pagination.totalPages > 1 && (
                <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 dark:border-slate-700">
                  <span className="text-xs text-slate-400">
                    {pagination.total}件中 {(pagination.page - 1) * pagination.pageSize + 1}-{Math.min(pagination.page * pagination.pageSize, pagination.total)}件
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => fetchLogs(pagination.page - 1)}
                      disabled={pagination.page <= 1}
                      className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 cursor-pointer"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <span className="text-xs text-slate-500">{pagination.page} / {pagination.totalPages}</span>
                    <button
                      onClick={() => fetchLogs(pagination.page + 1)}
                      disabled={pagination.page >= pagination.totalPages}
                      className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 cursor-pointer"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Compose Modal */}
      {showCompose && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
              <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <PenLine size={18} /> メール作成
              </h3>
              <button onClick={resetCompose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 cursor-pointer">
                <X size={18} />
              </button>
            </div>

            <div className="px-6 py-5 overflow-y-auto flex-1 space-y-4">
              {composeResult && (
                <div className={`px-4 py-3 rounded-lg text-sm ${
                  composeResult.startsWith('エラー') || composeResult.startsWith('AI生成エラー')
                    ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                    : 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                }`}>
                  {composeResult}
                </div>
              )}

              {/* To */}
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">宛先</label>
                <input
                  type="email" value={composeTo} onChange={e => setComposeTo(e.target.value)}
                  placeholder="example@example.com"
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500/40"
                />
              </div>

              {/* Subject */}
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">件名</label>
                <input
                  type="text" value={composeSubject} onChange={e => setComposeSubject(e.target.value)}
                  placeholder="メールの件名"
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500/40"
                />
              </div>

              {/* AI Generation */}
              <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-4 space-y-3">
                <h4 className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
                  <Sparkles size={12} /> AI本文生成
                </h4>
                <textarea
                  value={composeContext} onChange={e => setComposeContext(e.target.value)}
                  placeholder="メールの目的・伝えたい内容を入力してください（例: 商品の発送遅延のお詫びと到着予定日の案内）"
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500/40 resize-y"
                />
                <div className="flex items-center gap-3">
                  <div className="flex gap-1.5">
                    {([['formal', 'フォーマル'], ['friendly', '親しみやすい'], ['casual', 'カジュアル']] as const).map(([val, label]) => (
                      <button key={val} onClick={() => setComposeTone(val)}
                        className={`px-2.5 py-1 rounded-md text-xs font-medium transition cursor-pointer ${
                          composeTone === val
                            ? 'bg-orange-500 text-white'
                            : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                        }`}
                      >{label}</button>
                    ))}
                  </div>
                  <button
                    onClick={handleGenerateEmail} disabled={generating || !composeContext.trim()}
                    className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-medium disabled:opacity-50 cursor-pointer transition-colors"
                  >
                    {generating ? <RefreshCw size={12} className="animate-spin" /> : <Sparkles size={12} />}
                    {generating ? '生成中...' : 'AIで生成'}
                  </button>
                </div>
              </div>

              {/* Body */}
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">本文</label>
                <textarea
                  value={composeBody} onChange={e => setComposeBody(e.target.value)}
                  placeholder="メール本文を入力またはAIで生成してください"
                  rows={10}
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500/40 resize-y leading-relaxed"
                />
                <p className="text-xs text-slate-400 mt-1">{composeBody.length} 文字</p>
              </div>
            </div>

            <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 dark:border-slate-700">
              <div className="flex gap-2">
                <button onClick={() => setComposeMode('draft')}
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition cursor-pointer ${
                    composeMode === 'draft' ? 'bg-blue-500 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                  }`}>
                  下書き保存
                </button>
                <button onClick={() => setComposeMode('send')}
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition cursor-pointer ${
                    composeMode === 'send' ? 'bg-orange-500 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                  }`}>
                  直接送信
                </button>
              </div>
              <div className="flex gap-3">
                <button onClick={resetCompose} className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-400 cursor-pointer">
                  キャンセル
                </button>
                <button
                  onClick={handleSendCompose}
                  disabled={composing || !composeTo || !composeSubject || !composeBody}
                  className="flex items-center gap-2 px-5 py-2 rounded-lg bg-[#06C755] hover:bg-[#05b34c] text-white text-sm font-medium disabled:opacity-50 cursor-pointer transition-colors"
                >
                  {composing ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                  {composing ? '処理中...' : composeMode === 'send' ? '送信する' : '下書き保存'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
