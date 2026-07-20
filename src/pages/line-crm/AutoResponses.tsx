import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { Plus, Pencil, Trash2, Zap, X, ToggleLeft, ToggleRight, Tag } from 'lucide-react'
import FolderTabs, { filterByFolder, computeFolderCounts } from './FolderTabs'
import TestSendWidget from './TestSendWidget'
import { getChannelId } from './lineAccount'

interface TagAction {
  action: 'add' | 'remove'
  tag_id: string
}

interface TagItem {
  id: string
  name: string
  color: string
}

interface AutoResponse {
  id: string
  name: string
  keywords: string[]
  match_type: 'exact' | 'contains' | 'starts_with' | 'regex'
  response_messages: Array<{ type: string; text?: string } & Record<string, unknown>>
  is_active: boolean
  priority?: number
  folder: string | null
  tag_actions?: TagAction[]
}

interface Template {
  id: string
  name: string
  content: { messages: Array<{ type: string; text?: string } & Record<string, unknown>> }
}

const api = axios.create({ baseURL: '/api/line-crm' })
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  config.params = { ...config.params, channel_id: getChannelId() }
  return config
})
type MessageBlock = { type: string; text?: string } & Record<string, unknown>

type FormData = {
  name: string
  folder: string
  keywords: string[]
  match_type: AutoResponse['match_type']
  response_mode: 'text' | 'template'
  response_text: string
  template_id: string
  is_active: boolean
  tag_actions: TagAction[]
  existing_messages: MessageBlock[]
}

const emptyForm: FormData = {
  name: '',
  folder: '',
  keywords: [],
  match_type: 'contains',
  response_mode: 'text',
  response_text: '',
  template_id: '',
  is_active: true,
  tag_actions: [],
  existing_messages: [],
}

const parseKeywordsRaw = (raw: string): string[] =>
  (raw || '')
    .split(/[,\s]+/)
    .map(s => s.trim())
    .filter(Boolean)

const extractText = (msg: { type: string; text?: string }): string => {
  if (msg.type === 'text' && typeof msg.text === 'string') return msg.text
  return `(${msg.type})`
}

export default function AutoResponses() {
  const [responses, setResponses] = useState<AutoResponse[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [tags, setTags] = useState<TagItem[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormData>(emptyForm)
  const [keywordInput, setKeywordInput] = useState('')
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [pendingFolders, setPendingFolders] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const fetchResponses = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<AutoResponse[]>('/auto-responses')
      setResponses(res.data)
    } catch (err) {
      console.error('Failed to fetch auto responses:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await api.get<Template[]>('/message-templates')
      setTemplates(res.data)
    } catch (err) {
      console.error('Failed to fetch templates:', err)
    }
  }, [])

  const fetchTags = useCallback(async () => {
    try {
      const res = await api.get<TagItem[]>('/tags')
      setTags(res.data)
    } catch (err) {
      console.error('Failed to fetch tags:', err)
    }
  }, [])

  useEffect(() => { fetchResponses() }, [fetchResponses])
  useEffect(() => { fetchTemplates() }, [fetchTemplates])
  useEffect(() => { fetchTags() }, [fetchTags])

  const openCreate = () => {
    const initialFolder = selectedFolder && selectedFolder !== '__uncategorized__' ? selectedFolder : ''
    setForm({ ...emptyForm, folder: initialFolder })
    setKeywordInput('')
    setEditingId(null)
    setShowForm(true)
  }

  const openEdit = (resp: AutoResponse) => {
    const isSimpleText = resp.response_messages.length === 1 && resp.response_messages[0].type === 'text'
    setForm({
      name: resp.name || '',
      folder: resp.folder || '',
      keywords: resp.keywords || [],
      match_type: resp.match_type,
      response_mode: isSimpleText ? 'text' : 'template',
      response_text: isSimpleText ? (resp.response_messages[0].text || '') : '',
      template_id: '',
      is_active: resp.is_active,
      tag_actions: resp.tag_actions || [],
      existing_messages: resp.response_messages || [],
    })
    setKeywordInput('')
    setEditingId(resp.id)
    setShowForm(true)
  }

  const commitKeywordInput = () => {
    const parts = parseKeywordsRaw(keywordInput)
    if (parts.length === 0) return
    setForm(f => ({ ...f, keywords: Array.from(new Set([...f.keywords, ...parts])) }))
    setKeywordInput('')
  }

  const removeKeyword = (idx: number) => {
    setForm(f => ({ ...f, keywords: f.keywords.filter((_, i) => i !== idx) }))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const pending = parseKeywordsRaw(keywordInput)
      const finalKeywords = Array.from(new Set([...form.keywords, ...pending]))
      if (finalKeywords.length === 0) { alert('キーワードを1件以上追加してください'); setSaving(false); return }
      if (!form.name.trim()) { alert('ルール名を入力してください'); setSaving(false); return }

      let response_messages: unknown[]
      if (form.response_mode === 'template') {
        if (form.template_id) {
          const tmpl = templates.find(t => t.id === form.template_id)
          if (!tmpl || !tmpl.content?.messages?.length) { alert('テンプレートを選択してください'); setSaving(false); return }
          response_messages = tmpl.content.messages
        } else if (form.existing_messages.length > 0) {
          response_messages = form.existing_messages
        } else {
          alert('テンプレートを選択してください'); setSaving(false); return
        }
      } else {
        if (!form.response_text.trim()) { alert('返信メッセージを入力してください'); setSaving(false); return }
        response_messages = [{ type: 'text', text: form.response_text }]
      }

      const payload = {
        name: form.name,
        folder: form.folder.trim() || null,
        keywords: finalKeywords,
        match_type: form.match_type,
        response_messages,
        is_active: form.is_active,
        tag_actions: form.tag_actions.filter(a => a.tag_id),
      }

      if (editingId) {
        await api.put(`/auto-responses/${editingId}`, payload)
      } else {
        await api.post('/auto-responses', payload)
      }
      setShowForm(false)
      fetchResponses()
    } catch (err) {
      const msg = axios.isAxiosError(err) ? (err.response?.data?.error || err.message) : (err instanceof Error ? err.message : '保存に失敗しました')
      alert('保存失敗: ' + msg)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('この自動応答を削除しますか？')) return
    try {
      await api.delete(`/auto-responses/${id}`)
      fetchResponses()
    } catch (err) {
      console.error('delete:', err)
    }
  }

  const handleToggle = async (resp: AutoResponse) => {
    try {
      await api.patch(`/auto-responses/${resp.id}/toggle`, { is_active: !resp.is_active })
      setResponses(prev => prev.map(r => r.id === resp.id ? { ...r, is_active: !r.is_active } : r))
    } catch (err) {
      console.error('toggle:', err)
    }
  }

  const matchTypeLabel = (t: string) => {
    switch (t) {
      case 'exact': return '完全一致'
      case 'contains': return '部分一致'
      case 'starts_with': return '前方一致'
      case 'regex': return '正規表現'
      default: return t
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#06C755]/10 flex items-center justify-center">
            <Zap size={20} className="text-[#06C755]" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">自動応答</h2>
            <p className="text-sm text-slate-500">{responses.length} 件の自動応答ルール</p>
          </div>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#06C755] hover:bg-[#05b34c] text-white text-sm font-medium transition-colors cursor-pointer"
        >
          <Plus size={16} />
          新規作成
        </button>
      </div>

      {(() => {
        const { folders, counts } = computeFolderCounts(responses)
        const mergedFolders = Array.from(new Set([...folders, ...pendingFolders])).sort((a, b) => a.localeCompare(b, 'ja'))
        const filtered = filterByFolder(responses, selectedFolder)
        return (
          <>
            <FolderTabs
              folders={mergedFolders}
              selected={selectedFolder}
              onSelect={setSelectedFolder}
              onCreate={name => {
                setPendingFolders(p => Array.from(new Set([...p, name])))
                setSelectedFolder(name)
              }}
              counts={counts}
            />
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="w-8 h-8 border-2 border-[#06C755] border-t-transparent rounded-full animate-spin" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-20 text-slate-400">
                  <Zap size={40} className="mx-auto mb-3 opacity-50" />
                  <p>自動応答ルールがありません</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                      <th className="text-left px-5 py-3 font-medium text-slate-500 dark:text-slate-400">ルール名</th>
                      <th className="text-left px-5 py-3 font-medium text-slate-500 dark:text-slate-400">キーワード</th>
                      <th className="text-left px-5 py-3 font-medium text-slate-500 dark:text-slate-400">マッチ</th>
                      <th className="text-left px-5 py-3 font-medium text-slate-500 dark:text-slate-400">応答内容</th>
                      <th className="text-center px-5 py-3 font-medium text-slate-500 dark:text-slate-400">有効</th>
                      <th className="text-right px-5 py-3 font-medium text-slate-500 dark:text-slate-400">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    {filtered.map(resp => (
                <tr key={resp.id} className={`hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors ${!resp.is_active ? 'opacity-50' : ''}`}>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900 dark:text-white">{resp.name}</span>
                      {resp.folder && (
                        <span className="text-xs text-slate-500 bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded">📁 {resp.folder}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(resp.keywords || []).map((kw, i) => (
                        <code key={i} className="text-xs bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded font-mono text-slate-700 dark:text-slate-300">
                          {kw}
                        </code>
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-xs px-2 py-1 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium">
                      {matchTypeLabel(resp.match_type)}
                    </span>
                  </td>
                  <td className="px-5 py-3 max-w-[240px]">
                    <p className="text-slate-700 dark:text-slate-300 truncate">
                      {(resp.response_messages || []).map(m => extractText(m)).join(' / ')}
                    </p>
                    {(resp.tag_actions || []).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {resp.tag_actions!.map((ta, i) => {
                          const tagName = tags.find(t => t.id === ta.tag_id)?.name || '?'
                          return (
                            <span key={i} className={`text-xs px-1.5 py-0.5 rounded ${ta.action === 'add' ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400'}`}>
                              {ta.action === 'add' ? '+' : '-'}{tagName}
                            </span>
                          )
                        })}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3 text-center">
                    <button onClick={() => handleToggle(resp)} className="cursor-pointer inline-flex items-center">
                      {resp.is_active ? <ToggleRight size={28} className="text-[#06C755]" /> : <ToggleLeft size={28} className="text-slate-300 dark:text-slate-600" />}
                    </button>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEdit(resp)} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer">
                        <Pencil size={15} />
                      </button>
                      <button onClick={() => handleDelete(resp.id)} className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-400 hover:text-red-500 transition-colors cursor-pointer">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )
      })()}

      {/* Modal Form */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
              <h3 className="font-semibold text-slate-900 dark:text-white">
                {editingId ? '自動応答を編集' : '自動応答を作成'}
              </h3>
              <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 transition-colors cursor-pointer">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">ルール名</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="例: 挨拶への返答"
                    className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">フォルダ <span className="text-xs text-slate-400 font-normal">（任意）</span></label>
                  <input
                    type="text"
                    value={form.folder}
                    onChange={e => setForm(f => ({ ...f, folder: e.target.value }))}
                    list="auto-response-folders-list"
                    placeholder="例: 挨拶"
                    className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755]"
                  />
                  <datalist id="auto-response-folders-list">
                    {computeFolderCounts(responses).folders.map(f => (
                      <option key={f} value={f} />
                    ))}
                  </datalist>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  キーワード <span className="text-xs text-slate-400 font-normal">（Enter / スペース / , で区切る）</span>
                </label>
                <div className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus-within:ring-2 focus-within:ring-[#06C755]/40 focus-within:border-[#06C755]">
                  <div className="flex flex-wrap gap-1.5">
                    {form.keywords.map((kw, i) => (
                      <span key={i} className="inline-flex items-center gap-1 text-xs bg-[#06C755]/10 text-[#06C755] px-2 py-1 rounded-md font-medium">
                        {kw}
                        <button type="button" onClick={() => removeKeyword(i)} className="hover:bg-[#06C755]/20 rounded-full p-0.5 cursor-pointer">
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                    <input
                      type="text"
                      value={keywordInput}
                      onChange={e => setKeywordInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
                          e.preventDefault()
                          commitKeywordInput()
                        } else if (e.key === 'Backspace' && keywordInput === '' && form.keywords.length > 0) {
                          e.preventDefault()
                          removeKeyword(form.keywords.length - 1)
                        }
                      }}
                      onBlur={commitKeywordInput}
                      placeholder={form.keywords.length === 0 ? '例: こんにちは' : ''}
                      className="flex-1 min-w-[120px] bg-transparent text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none text-sm py-0.5"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">マッチタイプ</label>
                <select
                  value={form.match_type}
                  onChange={e => setForm(f => ({ ...f, match_type: e.target.value as FormData['match_type'] }))}
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755] text-sm"
                >
                  <option value="contains">部分一致</option>
                  <option value="exact">完全一致</option>
                  <option value="starts_with">前方一致</option>
                  <option value="regex">正規表現</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">応答内容</label>
                <div className="flex gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, response_mode: 'text' }))}
                    className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors cursor-pointer ${form.response_mode === 'text' ? 'border-[#06C755] bg-[#06C755]/5 text-[#06C755]' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}
                  >
                    テキスト
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, response_mode: 'template' }))}
                    className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors cursor-pointer ${form.response_mode === 'template' ? 'border-[#06C755] bg-[#06C755]/5 text-[#06C755]' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}
                  >
                    テンプレート
                  </button>
                </div>
                {form.response_mode === 'text' ? (
                  <textarea
                    value={form.response_text}
                    onChange={e => setForm(f => ({ ...f, response_text: e.target.value }))}
                    placeholder="返信メッセージを入力..."
                    rows={4}
                    className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755] text-sm resize-none"
                  />
                ) : (
                  <div className="space-y-2">
                    <select
                      value={form.template_id}
                      onChange={e => setForm(f => ({ ...f, template_id: e.target.value }))}
                      className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755] text-sm"
                    >
                      <option value="">{editingId && form.existing_messages.length > 0 ? '現在のメッセージを維持（変更する場合は選択）' : 'テンプレートを選択...'}</option>
                      {templates.map(t => (
                        <option key={t.id} value={t.id}>{t.name}（{t.content?.messages?.length || 0}件）</option>
                      ))}
                    </select>
                    {!form.template_id && editingId && form.existing_messages.length > 0 && (
                      <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-400 space-y-1">
                        <p className="font-medium text-slate-500 dark:text-slate-400 mb-1">現在の応答内容:</p>
                        {form.existing_messages.map((m, i) => (
                          <p key={i}>
                            {m.type === 'text' ? m.text : m.type === 'image' ? '🖼️ 画像' : m.type === 'video' ? '🎥 動画' : `[${m.type}]`}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* タグアクション設定 */}
              <div>
                <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  <Tag size={14} />
                  タグアクション <span className="text-xs text-slate-400 font-normal">（任意）</span>
                </label>
                <p className="text-xs text-slate-400 mb-2">自動応答マッチ時にタグを自動で付けたり外したりできます</p>
                {form.tag_actions.map((ta, idx) => (
                  <div key={idx} className="flex items-center gap-2 mb-2">
                    <select
                      value={ta.action}
                      onChange={e => {
                        const updated = [...form.tag_actions]
                        updated[idx] = { ...updated[idx], action: e.target.value as 'add' | 'remove' }
                        setForm(f => ({ ...f, tag_actions: updated }))
                      }}
                      className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#06C755]/40"
                    >
                      <option value="add">追加</option>
                      <option value="remove">削除</option>
                    </select>
                    <select
                      value={ta.tag_id}
                      onChange={e => {
                        const updated = [...form.tag_actions]
                        updated[idx] = { ...updated[idx], tag_id: e.target.value }
                        setForm(f => ({ ...f, tag_actions: updated }))
                      }}
                      className="flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#06C755]/40"
                    >
                      <option value="">タグを選択...</option>
                      {tags.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setForm(f => ({ ...f, tag_actions: f.tag_actions.filter((_, i) => i !== idx) }))}
                      className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-400 hover:text-red-500 transition-colors cursor-pointer"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, tag_actions: [...f.tag_actions, { action: 'add', tag_id: '' }] }))}
                  className="flex items-center gap-1.5 text-sm text-[#06C755] hover:text-[#05b34c] font-medium transition-colors cursor-pointer"
                >
                  <Plus size={14} />
                  タグアクションを追加
                </button>
              </div>
            </div>
            <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-700 flex-shrink-0">
              <TestSendWidget
                getMessages={() => {
                  if (form.response_mode === 'template') {
                    if (form.template_id) {
                      const tmpl = templates.find(t => t.id === form.template_id)
                      return tmpl?.content?.messages || null
                    }
                    return form.existing_messages.length > 0 ? form.existing_messages : null
                  }
                  return form.response_text.trim() ? [{ type: 'text', text: form.response_text }] : null
                }}
              />
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex-shrink-0">
              <button onClick={() => setShowForm(false)} className="px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-sm font-medium transition-colors cursor-pointer">
                キャンセル
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2.5 rounded-lg bg-[#06C755] hover:bg-[#05b34c] text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                {saving ? '保存中...' : editingId ? '更新' : '作成'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
