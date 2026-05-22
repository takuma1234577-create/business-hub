import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { Plus, Pencil, Trash2, Clock, X, ToggleLeft, ToggleRight, Play, MessageCircle, Star, Users, User, CheckCircle, Send } from 'lucide-react'
import TestSendWidget from './TestSendWidget'

interface FollowupRule {
  id: string
  name: string
  type: 'no_survey' | 'no_review'
  delay_days: number
  min_rating: number
  response_messages: Array<{ type: string; text?: string } & Record<string, unknown>>
  is_active: boolean
  created_at: string
}

interface Template {
  id: string
  name: string
  content: { messages: Array<{ type: string; text?: string } & Record<string, unknown>> }
}

interface Stats {
  totalSent: number
  rules: Array<{ id: string; name: string; type: string; sent_count: number }>
}

const api = axios.create({ baseURL: '/api/line-crm' })
api.interceptors.request.use((config) => { const token = localStorage.getItem('auth_token'); if (token) config.headers.Authorization = `Bearer ${token}`; return config })
type FormData = {
  name: string
  type: 'no_survey' | 'no_review'
  delay_days: number
  min_rating: number
  response_mode: 'text' | 'template'
  response_text: string
  template_id: string
  is_active: boolean
}

const emptyForm: FormData = {
  name: '',
  type: 'no_survey',
  delay_days: 3,
  min_rating: 4,
  response_mode: 'text',
  response_text: '',
  template_id: '',
  is_active: true,
}

const TYPE_LABELS: Record<string, { label: string; desc: string; color: string }> = {
  no_survey: { label: 'アンケート未回答', desc: 'リンク送信後、未回答の人にリマインド', color: '#F59E0B' },
  no_review: { label: 'レビュー未投稿', desc: 'アンケート回答後、Amazonレビュー未クリックの人にリマインド', color: '#3B82F6' },
}

export default function SurveyFollowups() {
  const [rules, setRules] = useState<FollowupRule[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormData>(emptyForm)
  const [processing, setProcessing] = useState(false)
  const [recipientModal, setRecipientModal] = useState<{ ruleId: string; ruleName: string } | null>(null)
  const [recipientTab, setRecipientTab] = useState<'pending' | 'sent'>('pending')
  const [recipients, setRecipients] = useState<{ pending: Array<{ id: string; display_name: string; picture_url: string | null }>; sent: Array<{ id: string; display_name: string; picture_url: string | null; sent_at: string }> }>({ pending: [], sent: [] })
  const [recipientLoading, setRecipientLoading] = useState(false)

  const openRecipients = async (ruleId: string, ruleName: string) => {
    setRecipientModal({ ruleId, ruleName })
    setRecipientTab('pending')
    setRecipientLoading(true)
    try {
      const res = await api.get(`/survey-followups/${ruleId}/recipients`)
      setRecipients(res.data)
    } catch (err) {
      console.error('Failed to fetch recipients:', err)
      setRecipients({ pending: [], sent: [] })
    } finally {
      setRecipientLoading(false)
    }
  }

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [rulesRes, tplRes, statsRes] = await Promise.allSettled([
        api.get('/survey-followups'),
        api.get('/message-templates'),
        api.get('/survey-followups/stats'),
      ])
      if (rulesRes.status === 'fulfilled') setRules(rulesRes.value.data)
      if (tplRes.status === 'fulfilled') setTemplates(tplRes.value.data)
      if (statsRes.status === 'fulfilled') setStats(statsRes.value.data)
    } catch (err) {
      console.error('Failed to fetch:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const openCreate = () => {
    setForm(emptyForm)
    setEditingId(null)
    setShowForm(true)
  }

  const openEdit = (rule: FollowupRule) => {
    const msgs = rule.response_messages || []
    const allText = msgs.length > 0 && msgs.every(m => m.type === 'text')
    const textParts = allText ? msgs.filter(m => m.text).map(m => m.text).join('\n---\n') : ''
    setForm({
      name: rule.name,
      type: rule.type,
      delay_days: rule.delay_days,
      min_rating: rule.min_rating || 4,
      response_mode: allText ? 'text' : 'template',
      response_text: textParts,
      template_id: '',
      is_active: rule.is_active,
    })
    setEditingId(rule.id)
    setShowForm(true)
  }

  const handleSave = async () => {
    if (form.delay_days <= 0) return

    let response_messages: Array<{ type: string; text?: string } & Record<string, unknown>> = []
    if (form.response_mode === 'text' && form.response_text.trim()) {
      response_messages = form.response_text.split('\n---\n').map(block => ({
        type: 'text', text: block.trim(),
      })).filter(m => m.text)
    } else if (form.response_mode === 'template' && form.template_id) {
      const tpl = templates.find(t => t.id === form.template_id)
      if (tpl) response_messages = tpl.content.messages
    } else if (form.response_mode === 'template' && !form.template_id && editingId) {
      const existing = rules.find(r => r.id === editingId)
      if (existing) response_messages = existing.response_messages
    }

    if (response_messages.length === 0) return

    const payload = {
      name: form.name,
      type: form.type,
      delay_days: form.delay_days,
      min_rating: form.type === 'no_review' ? form.min_rating : 4,
      response_messages,
      is_active: form.is_active,
    }

    try {
      if (editingId) {
        await api.put(`/survey-followups/${editingId}`, payload)
      } else {
        await api.post('/survey-followups', payload)
      }
      setShowForm(false)
      fetchData()
    } catch (err) {
      console.error('Save failed:', err)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このルールを削除しますか？')) return
    await api.delete(`/survey-followups/${id}`)
    fetchData()
  }

  const handleToggle = async (id: string, current: boolean) => {
    await api.patch(`/survey-followups/${id}/toggle`, { is_active: !current })
    fetchData()
  }

  const handleProcess = async () => {
    setProcessing(true)
    try {
      const res = await api.get('/survey-followups/process')
      alert(`処理完了: ${res.data.processed || 0}件送信`)
      fetchData()
    } catch (err) {
      console.error('Process failed:', err)
      alert('処理に失敗しました')
    } finally {
      setProcessing(false)
    }
  }

  const getPreviewText = (msgs: Array<{ type: string; text?: string }>) => {
    const texts = msgs.filter(m => m.type === 'text' && m.text).map(m => m.text)
    return texts.length > 0 ? texts[0]!.slice(0, 60) + (texts[0]!.length > 60 ? '...' : '') : '(メディアメッセージ)'
  }

  const getSentCount = (ruleId: string) => {
    return stats?.rules.find(r => r.id === ruleId)?.sent_count || 0
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">アンケートフォローアップ</h2>
          <p className="text-sm text-slate-500">未回答者・レビュー未投稿者に自動でリマインドメッセージを送信</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleProcess}
            disabled={processing}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
          >
            <Play size={14} />
            {processing ? '処理中...' : '今すぐ実行'}
          </button>
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-[#06C755] text-white rounded-lg hover:bg-[#05b34c] cursor-pointer"
          >
            <Plus size={16} />
            ルール追加
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && stats.totalSent > 0 && (
        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 mb-6">
          <p className="text-xs text-slate-500 mb-1">フォローアップ送信実績</p>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.totalSent}<span className="text-sm font-normal text-slate-500 ml-1">件送信済み</span></p>
        </div>
      )}

      {/* Rules List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-[#06C755] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : rules.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <MessageCircle size={40} className="mx-auto mb-3 opacity-50" />
          <p>フォローアップルールがありません</p>
          <p className="text-xs mt-1">「ルール追加」から作成してください</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map(rule => {
            const typeInfo = TYPE_LABELS[rule.type]
            const sentCount = getSentCount(rule.id)
            return (
              <div
                key={rule.id}
                className={`bg-white dark:bg-slate-800 rounded-xl border p-4 transition-all ${
                  rule.is_active ? 'border-slate-200 dark:border-slate-700' : 'border-slate-100 dark:border-slate-800 opacity-50'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span
                        className="text-xs px-2 py-0.5 rounded-full text-white font-medium"
                        style={{ backgroundColor: typeInfo.color }}
                      >
                        {rule.type === 'no_survey' ? <MessageCircle size={10} className="inline mr-1" /> : <Star size={10} className="inline mr-1" />}
                        {typeInfo.label}
                      </span>
                      <span className="text-xs text-slate-500 flex items-center gap-1">
                        <Clock size={12} />
                        {rule.delay_days}日後に送信
                      </span>
                      {sentCount > 0 && (
                        <span className="text-xs text-slate-400">{sentCount}件送信済</span>
                      )}
                    </div>
                    {rule.name && (
                      <p className="text-sm font-medium text-slate-900 dark:text-white mb-1">{rule.name}</p>
                    )}
                    <p className="text-xs text-slate-500 truncate">
                      {getPreviewText(rule.response_messages)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 ml-3">
                    <button
                      onClick={() => openRecipients(rule.id, rule.name || typeInfo.label)}
                      className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 cursor-pointer"
                      title="配信対象者"
                    >
                      <Users size={16} />
                    </button>
                    <button
                      onClick={() => handleToggle(rule.id, rule.is_active)}
                      className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
                    >
                      {rule.is_active ? (
                        <ToggleRight size={20} className="text-[#06C755]" />
                      ) : (
                        <ToggleLeft size={20} className="text-slate-400" />
                      )}
                    </button>
                    <button
                      onClick={() => openEdit(rule)}
                      className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 cursor-pointer"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      onClick={() => handleDelete(rule.id)}
                      className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-400 cursor-pointer"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-700">
              <h3 className="font-semibold text-slate-900 dark:text-white">
                {editingId ? 'ルールを編集' : 'ルールを作成'}
              </h3>
              <button onClick={() => setShowForm(false)} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer">
                <X size={20} className="text-slate-500" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">ルール名</label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  placeholder="例: アンケート未回答リマインド（3日後）"
                />
              </div>

              {/* Type */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  フォローアップ種類 <span className="text-red-400">*</span>
                </label>
                <div className="space-y-2">
                  {Object.entries(TYPE_LABELS).map(([key, info]) => (
                    <label
                      key={key}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                        form.type === key
                          ? 'border-[#06C755] bg-[#06C755]/5'
                          : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="type"
                        value={key}
                        checked={form.type === key}
                        onChange={() => setForm(f => ({ ...f, type: key as FormData['type'] }))}
                        className="mt-0.5 accent-[#06C755]"
                      />
                      <div>
                        <p className="text-sm font-medium text-slate-900 dark:text-white">{info.label}</p>
                        <p className="text-xs text-slate-500">{info.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Delay */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  遅延日数 <span className="text-red-400">*</span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={form.delay_days}
                    onChange={e => setForm(f => ({ ...f, delay_days: Math.max(1, parseInt(e.target.value) || 1) }))}
                    className="w-20 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                  <span className="text-sm text-slate-500">日後に送信</span>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  {form.type === 'no_survey'
                    ? `アンケートリンク送信から${form.delay_days}日後に未回答者へリマインド`
                    : `アンケート回答から${form.delay_days}日後にレビュー未クリック者へリマインド`
                  }
                </p>
              </div>

              {/* Min Rating (no_review only) */}
              {form.type === 'no_review' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    対象の最低評価
                  </label>
                  <div className="flex gap-2">
                    {[4, 5].map(r => (
                      <button
                        type="button"
                        key={r}
                        onClick={() => setForm(f => ({ ...f, min_rating: r }))}
                        className={`px-4 py-2 rounded-lg text-sm font-medium cursor-pointer ${
                          form.min_rating === r
                            ? 'bg-[#06C755] text-white'
                            : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {'★'.repeat(r)}{r === 4 ? ' 以上' : ' のみ'}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    {form.min_rating === 5 ? '★5をつけた人のみ対象' : '★4以上をつけた人が対象'}
                  </p>
                </div>
              )}

              {/* Response Mode */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">メッセージ内容</label>
                <div className="flex gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, response_mode: 'text' }))}
                    className={`px-3 py-1.5 text-xs rounded-lg cursor-pointer ${
                      form.response_mode === 'text' ? 'bg-[#06C755] text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    テキスト入力
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, response_mode: 'template' }))}
                    className={`px-3 py-1.5 text-xs rounded-lg cursor-pointer ${
                      form.response_mode === 'template' ? 'bg-[#06C755] text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    テンプレート選択
                  </button>
                </div>
                {form.response_mode === 'text' ? (
                  <div>
                    <textarea
                      value={form.response_text}
                      onChange={e => setForm(f => ({ ...f, response_text: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm resize-none"
                      rows={5}
                      placeholder={"メッセージを入力\n\n複数メッセージに分ける場合は\n---\nで区切ってください"}
                    />
                    <p className="text-xs text-slate-400 mt-1">「---」で区切ると複数メッセージとして送信されます</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {editingId && !form.template_id && (() => {
                      const existing = rules.find(r => r.id === editingId)
                      if (!existing || existing.response_messages.length === 0) return null
                      const msgs = existing.response_messages
                      const preview = msgs.map(m => m.type === 'text' && m.text ? m.text.slice(0, 40) : `(${m.type})`).join(' / ')
                      return (
                        <div className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-500">
                          <span className="font-medium text-slate-700 dark:text-slate-300">現在の内容:</span> {preview}
                          <span className="ml-1 text-slate-400">({msgs.length}件)</span>
                        </div>
                      )
                    })()}
                    <select
                      value={form.template_id}
                      onChange={e => setForm(f => ({ ...f, template_id: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm relative z-10"
                    >
                      <option value="">{editingId ? '変更する場合はテンプレートを選択...' : 'テンプレートを選択'}</option>
                      {templates.map(tpl => (
                        <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
                      ))}
                    </select>
                    {templates.length === 0 && (
                      <p className="text-xs text-slate-400 mt-1">テンプレートがありません。先にコンテンツ→テンプレートで作成してください。</p>
                    )}
                    {templates.length > 0 && !form.template_id && (
                      <div className="mt-2 space-y-1">
                        {templates.slice(0, 8).map(tpl => (
                          <button
                            type="button"
                            key={tpl.id}
                            onClick={() => setForm(f => ({ ...f, template_id: tpl.id }))}
                            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition cursor-pointer ${
                              form.template_id === tpl.id
                                ? 'bg-[#06C755]/10 border border-[#06C755] text-[#06C755] font-medium'
                                : 'bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            {tpl.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Test Send */}
            <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-700">
              <TestSendWidget
                getMessages={() => {
                  if (form.response_mode === 'text' && form.response_text.trim()) {
                    return form.response_text.split('\n---\n').map(block => ({
                      type: 'text', text: block.trim(),
                    })).filter(m => m.text)
                  }
                  if (form.response_mode === 'template' && form.template_id) {
                    const tpl = templates.find(t => t.id === form.template_id)
                    return tpl?.content?.messages || null
                  }
                  if (form.response_mode === 'template' && !form.template_id && editingId) {
                    const existing = rules.find(r => r.id === editingId)
                    return existing?.response_messages || null
                  }
                  return null
                }}
              />
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 p-5 border-t border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg cursor-pointer"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={form.delay_days <= 0}
                className="px-4 py-2 text-sm font-medium bg-[#06C755] text-white rounded-lg hover:bg-[#05b34c] disabled:opacity-40 cursor-pointer"
              >
                {editingId ? '更新' : '作成'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Recipients Modal */}
      {recipientModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-700">
              <div>
                <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                  <Users size={18} /> 配信対象者
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">{recipientModal.ruleName}</p>
              </div>
              <button onClick={() => setRecipientModal(null)} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer">
                <X size={20} className="text-slate-500" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-slate-200 dark:border-slate-700">
              <button
                onClick={() => setRecipientTab('pending')}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                  recipientTab === 'pending'
                    ? 'border-[#F59E0B] text-[#F59E0B]'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <Send size={14} />
                配信予定
                {!recipientLoading && <span className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-1.5 py-0.5 rounded-full">{recipients.pending.length}</span>}
              </button>
              <button
                onClick={() => setRecipientTab('sent')}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                  recipientTab === 'sent'
                    ? 'border-[#06C755] text-[#06C755]'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <CheckCircle size={14} />
                配信済み
                {!recipientLoading && <span className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-1.5 py-0.5 rounded-full">{recipients.sent.length}</span>}
              </button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-4">
              {recipientLoading ? (
                <div className="flex justify-center py-12">
                  <div className="w-7 h-7 border-2 border-[#06C755] border-t-transparent rounded-full animate-spin" />
                </div>
              ) : recipientTab === 'pending' ? (
                recipients.pending.length === 0 ? (
                  <div className="text-center py-12 text-slate-400">
                    <Send size={32} className="mx-auto mb-2 opacity-50" />
                    <p className="text-sm">配信予定者はいません</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {recipients.pending.map(f => (
                      <div key={f.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50">
                        <div className="w-9 h-9 rounded-full bg-slate-200 dark:bg-slate-600 flex-shrink-0 overflow-hidden">
                          {f.picture_url ? (
                            <img src={f.picture_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center"><User size={16} className="text-slate-400" /></div>
                          )}
                        </div>
                        <span className="text-sm text-slate-900 dark:text-white truncate">{f.display_name}</span>
                        <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">予定</span>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                recipients.sent.length === 0 ? (
                  <div className="text-center py-12 text-slate-400">
                    <CheckCircle size={32} className="mx-auto mb-2 opacity-50" />
                    <p className="text-sm">配信済みの人はいません</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {recipients.sent.map(f => (
                      <div key={f.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50">
                        <div className="w-9 h-9 rounded-full bg-slate-200 dark:bg-slate-600 flex-shrink-0 overflow-hidden">
                          {f.picture_url ? (
                            <img src={f.picture_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center"><User size={16} className="text-slate-400" /></div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm text-slate-900 dark:text-white truncate block">{f.display_name}</span>
                          <span className="text-[10px] text-slate-400">
                            {new Date(f.sent_at).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">送信済</span>
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
