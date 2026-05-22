import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { Plus, Pencil, Trash2, Clock, X, ToggleLeft, ToggleRight, Play, Users, ChevronDown, ChevronUp } from 'lucide-react'
import TestSendWidget from './TestSendWidget'

interface TagScheduledReply {
  id: string
  tag_id: string
  name: string
  delay_hours: number
  response_messages: Array<{ type: string; text?: string } & Record<string, unknown>>
  is_active: boolean
  created_at: string
  tags?: { id: string; name: string; color: string }
}

interface TagOption {
  id: string
  name: string
  color: string
}

interface PendingItem {
  rule_id: string
  rule_name: string
  tag_name: string
  tag_color: string
  delay_hours: number
  friend_id: string
  friend_name: string
  friend_picture: string | null
  tagged_at: string
  scheduled_send_at: string
  is_overdue: boolean
}

interface Template {
  id: string
  name: string
  content: { messages: Array<{ type: string; text?: string } & Record<string, unknown>> }
}

const api = axios.create({ baseURL: '/api/line-crm' })
api.interceptors.request.use((config) => { const token = localStorage.getItem('auth_token'); if (token) config.headers.Authorization = `Bearer ${token}`; return config })
type FormData = {
  name: string
  tag_id: string
  delay_days: number
  response_mode: 'text' | 'template'
  response_text: string
  template_id: string
  is_active: boolean
}

const emptyForm: FormData = {
  name: '',
  tag_id: '',
  delay_days: 1,
  response_mode: 'text',
  response_text: '',
  template_id: '',
  is_active: true,
}

export default function TagScheduledReplies() {
  const [rules, setRules] = useState<TagScheduledReply[]>([])
  const [tags, setTags] = useState<TagOption[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormData>(emptyForm)
  const [processing, setProcessing] = useState(false)
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([])
  const [showPending, setShowPending] = useState(false)
  const [loadingPending, setLoadingPending] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [rulesRes, tagsRes, tplRes] = await Promise.all([
        api.get('/tag-scheduled-replies'),
        api.get('/tags'),
        api.get('/message-templates'),
      ])
      setRules(rulesRes.data)
      setTags(tagsRes.data)
      setTemplates(tplRes.data)
    } catch (err) {
      console.error('Failed to fetch:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchPending = useCallback(async () => {
    setLoadingPending(true)
    try {
      const res = await api.get<PendingItem[]>('/tag-scheduled-replies/pending')
      setPendingItems(res.data)
    } catch (err) {
      console.error('Failed to fetch pending:', err)
    } finally {
      setLoadingPending(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => { fetchPending() }, [fetchPending])

  const openCreate = () => {
    setForm(emptyForm)
    setEditingId(null)
    setShowForm(true)
  }

  const openEdit = (rule: TagScheduledReply) => {
    const msgs = rule.response_messages || []
    const allText = msgs.length > 0 && msgs.every(m => m.type === 'text')
    const textParts = allText ? msgs.filter(m => m.text).map(m => m.text).join('\n---\n') : ''
    setForm({
      name: rule.name,
      tag_id: rule.tag_id,
      delay_days: Math.max(1, Math.round(rule.delay_hours / 24)),
      response_mode: allText ? 'text' : 'template',
      response_text: textParts,
      template_id: '',
      is_active: rule.is_active,
    })
    setEditingId(rule.id)
    setShowForm(true)
  }

  const handleSave = async () => {
    const totalHours = form.delay_days * 24
    if (!form.tag_id || form.delay_days <= 0) return

    let response_messages: Array<{ type: string; text?: string } & Record<string, unknown>> = []
    if (form.response_mode === 'text' && form.response_text.trim()) {
      response_messages = form.response_text.split('\n---\n').map(block => ({
        type: 'text',
        text: block.trim(),
      })).filter(m => m.text)
    } else if (form.response_mode === 'template' && form.template_id) {
      const tpl = templates.find(t => t.id === form.template_id)
      if (tpl) response_messages = tpl.content.messages
    } else if (form.response_mode === 'template' && !form.template_id && editingId) {
      // テンプレート未変更 → 既存のresponse_messagesを維持
      const existing = rules.find(r => r.id === editingId)
      if (existing) response_messages = existing.response_messages
    }

    if (response_messages.length === 0) return

    const payload = {
      name: form.name,
      tag_id: form.tag_id,
      delay_hours: totalHours,
      response_messages,
      is_active: form.is_active,
    }

    try {
      if (editingId) {
        await api.put(`/tag-scheduled-replies/${editingId}`, payload)
      } else {
        await api.post('/tag-scheduled-replies', payload)
      }
      setShowForm(false)
      fetchData()
    } catch (err) {
      console.error('Save failed:', err)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このルールを削除しますか？')) return
    await api.delete(`/tag-scheduled-replies/${id}`)
    fetchData()
  }

  const handleToggle = async (id: string, current: boolean) => {
    await api.patch(`/tag-scheduled-replies/${id}/toggle`, { is_active: !current })
    fetchData()
  }

  const handleProcess = async () => {
    setProcessing(true)
    try {
      let totalSent = 0
      for (let i = 0; i < 50; i++) {
        const res = await api.get('/tag-scheduled-replies/process')
        const sent = res.data.processed || 0
        totalSent += sent
        if (sent === 0) break
      }
      alert(`処理完了: ${totalSent}件送信`)
      fetchPending()
    } catch (err) {
      console.error('Process failed:', err)
      alert('処理に失敗しました')
    } finally {
      setProcessing(false)
    }
  }

  const getTagName = (tagId: string) => tags.find(t => t.id === tagId)
  const getPreviewText = (msgs: Array<{ type: string; text?: string }>) => {
    const texts = msgs.filter(m => m.type === 'text' && m.text).map(m => m.text)
    return texts.length > 0 ? texts[0]!.slice(0, 60) + (texts[0]!.length > 60 ? '...' : '') : '(メディアメッセージ)'
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">タグ遅延配信</h2>
          <p className="text-sm text-slate-500">特定タグが付与された友だちに、指定時間後にメッセージを自動送信</p>
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

      {/* Rules List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-[#06C755] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : rules.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <Clock size={40} className="mx-auto mb-3 opacity-50" />
          <p>タグ遅延配信ルールがありません</p>
          <p className="text-xs mt-1">「ルール追加」から作成してください</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map(rule => {
            const tag = getTagName(rule.tag_id)
            return (
              <div
                key={rule.id}
                className={`bg-white dark:bg-slate-800 rounded-xl border p-4 transition-all ${
                  rule.is_active ? 'border-slate-200 dark:border-slate-700' : 'border-slate-100 dark:border-slate-800 opacity-50'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      {tag && (
                        <span
                          className="text-xs px-2 py-0.5 rounded-full text-white font-medium"
                          style={{ backgroundColor: tag.color || '#06C755' }}
                        >
                          {tag.name}
                        </span>
                      )}
                      <span className="text-xs text-slate-500 flex items-center gap-1">
                        <Clock size={12} />
                        {Math.round(rule.delay_hours / 24)}日後に送信
                      </span>
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

      {/* Pending Deliveries */}
      {!loading && rules.length > 0 && (
        <div className="mt-6">
          <button
            onClick={() => setShowPending(v => !v)}
            className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer mb-3"
          >
            <Users size={16} />
            配信予定の友だち一覧 ({pendingItems.length}件)
            {showPending ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {showPending && (
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
              {loadingPending ? (
                <div className="flex justify-center py-8">
                  <div className="w-6 h-6 border-2 border-[#06C755] border-t-transparent rounded-full animate-spin" />
                </div>
              ) : pendingItems.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-sm">
                  配信予定の友だちはいません
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                      <th className="text-left px-4 py-2.5 font-medium text-slate-500 dark:text-slate-400">友だち</th>
                      <th className="text-left px-4 py-2.5 font-medium text-slate-500 dark:text-slate-400">ルール</th>
                      <th className="text-left px-4 py-2.5 font-medium text-slate-500 dark:text-slate-400">タグ付与日</th>
                      <th className="text-left px-4 py-2.5 font-medium text-slate-500 dark:text-slate-400">配信予定日時</th>
                      <th className="text-center px-4 py-2.5 font-medium text-slate-500 dark:text-slate-400">状態</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    {pendingItems.map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            {item.friend_picture ? (
                              <img src={item.friend_picture} alt="" className="w-6 h-6 rounded-full object-cover" />
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-600" />
                            )}
                            <span className="text-slate-900 dark:text-white">{item.friend_name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400">{item.rule_name || '-'}</td>
                        <td className="px-4 py-2.5 text-slate-500 text-xs">
                          {new Date(item.tagged_at).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`text-xs font-medium ${item.is_overdue ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-300'}`}>
                            {new Date(item.scheduled_send_at).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {item.is_overdue ? (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 font-medium">送信待ち</span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium">予約中</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
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
                  placeholder="例: 購入者フォローアップ"
                />
              </div>

              {/* Tag */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  対象タグ <span className="text-red-400">*</span>
                </label>
                <select
                  value={form.tag_id}
                  onChange={e => setForm(f => ({ ...f, tag_id: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                >
                  <option value="">タグを選択</option>
                  {tags.map(tag => (
                    <option key={tag.id} value={tag.id}>{tag.name}</option>
                  ))}
                </select>
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
                  タグ付与から{form.delay_days}日後に自動送信されます（毎日AM9:00に処理）
                </p>
              </div>

              {/* Response Mode */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">返信内容</label>
                <div className="flex gap-2 mb-2">
                  <button
                    onClick={() => setForm(f => ({ ...f, response_mode: 'text' }))}
                    className={`px-3 py-1.5 text-xs rounded-lg cursor-pointer ${
                      form.response_mode === 'text' ? 'bg-[#06C755] text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    テキスト入力
                  </button>
                  <button
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
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                    >
                      <option value="">{editingId ? '変更する場合はテンプレートを選択...' : 'テンプレートを選択'}</option>
                      {templates.map(tpl => (
                        <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
                      ))}
                    </select>
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
                onClick={() => setShowForm(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg cursor-pointer"
              >
                キャンセル
              </button>
              <button
                onClick={handleSave}
                disabled={!form.tag_id || form.delay_days <= 0}
                className="px-4 py-2 text-sm font-medium bg-[#06C755] text-white rounded-lg hover:bg-[#05b34c] disabled:opacity-40 cursor-pointer"
              >
                {editingId ? '更新' : '作成'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
