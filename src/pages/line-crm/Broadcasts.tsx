import { useState, useEffect, useCallback } from 'react'
import { Plus, Send, Megaphone, X, Clock, CheckCircle, AlertCircle, Radio, Users, Tag as TagIcon, Eye, Filter, Calendar, FileText } from 'lucide-react'
import axios from 'axios'
import { broadcastApi, tagApi, friendApi } from './api'
import type { Broadcast, Tag } from './types'
import TestSendWidget from './TestSendWidget'

interface Template {
  id: string
  name: string
  content: { messages: Array<{ type: string; text?: string } & Record<string, unknown>> }
}

type TargetType = 'all' | 'filtered'
type MessageMode = 'text' | 'template'

const lineCrmApi = axios.create({ baseURL: '/api/line-crm' })
lineCrmApi.interceptors.request.use((config) => { const token = localStorage.getItem('auth_token'); if (token) config.headers.Authorization = `Bearer ${token}`; return config })
export default function Broadcasts() {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [totalFriends, setTotalFriends] = useState(0)
  const [sending, setSending] = useState(false)

  // Form state
  const [formName, setFormName] = useState('')
  const [messageMode, setMessageMode] = useState<MessageMode>('text')
  const [formMessage, setFormMessage] = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [targetType, setTargetType] = useState<TargetType>('all')
  const [includeTags, setIncludeTags] = useState<string[]>([])
  const [excludeTags, setExcludeTags] = useState<string[]>([])
  const [tagLogic, setTagLogic] = useState<'or' | 'and'>('or')
  const [registeredFrom, setRegisteredFrom] = useState('')
  const [registeredTo, setRegisteredTo] = useState('')
  const [scheduleType, setScheduleType] = useState<'now' | 'scheduled'>('now')
  const [scheduledAt, setScheduledAt] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [previewCount, setPreviewCount] = useState<number | null>(null)
  const [loadingCount, setLoadingCount] = useState(false)

  const fetchBroadcasts = useCallback(async () => {
    setLoading(true)
    try {
      const res = await broadcastApi.list()
      setBroadcasts(res)
    } catch (err) {
      console.error('Failed to fetch broadcasts:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchTags = useCallback(async () => {
    try {
      const res = await tagApi.list()
      setTags(res)
    } catch (err) {
      console.error('Failed to fetch tags:', err)
    }
  }, [])

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await lineCrmApi.get<Template[]>('/message-templates')
      setTemplates(res.data)
    } catch { /* ignore */ }
  }, [])

  const fetchFriendCount = useCallback(async () => {
    try {
      const res = await friendApi.list({ page: 1, per_page: 1 })
      setTotalFriends(res.pagination.total)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    fetchBroadcasts()
    fetchTags()
    fetchTemplates()
    fetchFriendCount()
  }, [fetchBroadcasts, fetchTags, fetchTemplates, fetchFriendCount])

  // フィルター変更時に対象人数を取得
  useEffect(() => {
    if (targetType === 'all') {
      setPreviewCount(totalFriends)
      return
    }
    const timer = setTimeout(async () => {
      setLoadingCount(true)
      try {
        const res = await broadcastApi.previewCount({
          include_tags: includeTags.length > 0 ? includeTags : undefined,
          exclude_tags: excludeTags.length > 0 ? excludeTags : undefined,
          tag_logic: tagLogic,
          registered_from: registeredFrom || undefined,
          registered_to: registeredTo || undefined,
        })
        setPreviewCount(res.count)
      } catch {
        setPreviewCount(null)
      } finally {
        setLoadingCount(false)
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [targetType, includeTags, excludeTags, tagLogic, registeredFrom, registeredTo, totalFriends])

  const resetForm = () => {
    setFormName('')
    setMessageMode('text')
    setFormMessage('')
    setSelectedTemplateId('')
    setTargetType('all')
    setIncludeTags([])
    setExcludeTags([])
    setTagLogic('or')
    setRegisteredFrom('')
    setRegisteredTo('')
    setScheduleType('now')
    setScheduledAt('')
    setShowPreview(false)
    setPreviewCount(null)
  }

  const handleCreate = async () => {
    setSending(true)
    try {
      const filters = targetType === 'filtered' ? {
        include_tags: includeTags.length > 0 ? includeTags : undefined,
        exclude_tags: excludeTags.length > 0 ? excludeTags : undefined,
        tag_logic: tagLogic,
        registered_from: registeredFrom || undefined,
        registered_to: registeredTo || undefined,
      } : null

      const selectedTpl = messageMode === 'template' ? templates.find(t => t.id === selectedTemplateId) : null
      const messages = selectedTpl?.content?.messages || undefined

      await broadcastApi.create({
        name: formName,
        message_content: messageMode === 'text' ? formMessage : (selectedTpl ? `[テンプレート: ${selectedTpl.name}]` : ''),
        messages,
        target_tags: targetType === 'filtered' && includeTags.length > 0 ? includeTags : null,
        target_filters: filters,
        scheduled_at: scheduleType === 'scheduled' && scheduledAt ? scheduledAt : null,
      })
      setShowForm(false)
      resetForm()
      fetchBroadcasts()
    } catch (err) {
      console.error('Failed to create broadcast:', err)
      alert('作成に失敗しました。もう一度お試しください。')
    } finally {
      setSending(false)
    }
  }

  const handleSend = async (id: string) => {
    if (!confirm('この一斉配信を送信しますか？')) return
    try {
      await broadcastApi.send(id)
      fetchBroadcasts()
    } catch (err) {
      console.error('Failed to send broadcast:', err)
    }
  }

  const handleCreateAndSend = async () => {
    if (!confirm('この一斉配信を今すぐ送信しますか？')) return
    setSending(true)
    try {
      const filters = targetType === 'filtered' ? {
        include_tags: includeTags.length > 0 ? includeTags : undefined,
        exclude_tags: excludeTags.length > 0 ? excludeTags : undefined,
        tag_logic: tagLogic,
        registered_from: registeredFrom || undefined,
        registered_to: registeredTo || undefined,
      } : null

      const selectedTpl = messageMode === 'template' ? templates.find(t => t.id === selectedTemplateId) : null
      const messages = selectedTpl?.content?.messages || undefined

      const created = await broadcastApi.create({
        name: formName,
        message_content: messageMode === 'text' ? formMessage : (selectedTpl ? `[テンプレート: ${selectedTpl.name}]` : ''),
        messages,
        target_tags: targetType === 'filtered' && includeTags.length > 0 ? includeTags : null,
        target_filters: filters,
        scheduled_at: null,
      })

      await broadcastApi.send(created.id)
      setShowForm(false)
      resetForm()
      fetchBroadcasts()
    } catch (err) {
      console.error('Failed to create and send:', err)
    } finally {
      setSending(false)
    }
  }

  const toggleIncludeTag = (tagId: string) => {
    setIncludeTags(prev =>
      prev.includes(tagId) ? prev.filter(t => t !== tagId) : [...prev, tagId]
    )
  }

  const toggleExcludeTag = (tagId: string) => {
    setExcludeTags(prev =>
      prev.includes(tagId) ? prev.filter(t => t !== tagId) : [...prev, tagId]
    )
  }

  const statusConfig = (status: Broadcast['status']) => {
    switch (status) {
      case 'draft': return { icon: <Clock size={14} />, text: '下書き', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' }
      case 'scheduled': return { icon: <Clock size={14} />, text: '予約済み', cls: 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' }
      case 'sending': return { icon: <Radio size={14} />, text: '送信中', cls: 'bg-yellow-50 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400' }
      case 'sent': return { icon: <CheckCircle size={14} />, text: '送信済み', cls: 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400' }
      case 'failed': return { icon: <AlertCircle size={14} />, text: '失敗', cls: 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400' }
      default: return { icon: null, text: status, cls: 'bg-slate-100 text-slate-500' }
    }
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleString('ja-JP', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })
  }

  const canCreate = formName.trim() && (messageMode === 'text' ? formMessage.trim() : selectedTemplateId)

  // -- Create Form --
  if (showForm) {
    return (
      <div>
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setShowForm(false); resetForm() }}
              className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 transition-colors cursor-pointer"
            >
              <X size={20} />
            </button>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">新しい一斉配信</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowPreview(!showPreview)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-sm transition-colors cursor-pointer"
            >
              <Eye size={14} />
              プレビュー
            </button>
            {scheduleType === 'now' && (
              <button
                onClick={handleCreateAndSend}
                disabled={!canCreate || sending}
                className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-[#06C755] hover:bg-[#05b34c] text-white text-sm font-medium disabled:opacity-40 transition-colors cursor-pointer"
              >
                <Send size={14} />
                {sending ? '送信中...' : '今すぐ送信'}
              </button>
            )}
            <button
              onClick={handleCreate}
              disabled={!canCreate || sending}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-sm font-medium disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer"
            >
              {sending ? '処理中...' : scheduleType === 'scheduled' ? '予約作成' : '下書き保存'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Message composition */}
          <div className="lg:col-span-2 space-y-5">
            {/* Step 1 */}
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-6 h-6 rounded-full bg-[#06C755] text-white text-xs font-bold flex items-center justify-center">1</div>
                <h3 className="font-medium text-slate-900 dark:text-white">メッセージ作成</h3>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1.5">配信名（管理用）</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    placeholder="例: 新商品のお知らせ"
                    className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755] text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1.5">メッセージ内容</label>
                  <div className="flex gap-2 mb-3">
                    <button
                      type="button"
                      onClick={() => setMessageMode('text')}
                      className={`px-3 py-1.5 text-xs rounded-lg cursor-pointer ${
                        messageMode === 'text' ? 'bg-[#06C755] text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      テキスト入力
                    </button>
                    <button
                      type="button"
                      onClick={() => setMessageMode('template')}
                      className={`px-3 py-1.5 text-xs rounded-lg cursor-pointer flex items-center gap-1 ${
                        messageMode === 'template' ? 'bg-[#06C755] text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      <FileText size={12} />
                      テンプレート選択
                    </button>
                  </div>
                  {messageMode === 'text' ? (
                    <>
                      <textarea
                        value={formMessage}
                        onChange={e => setFormMessage(e.target.value)}
                        placeholder="配信メッセージを入力..."
                        rows={8}
                        className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755] text-sm resize-none leading-relaxed"
                      />
                      <p className="text-xs text-slate-400 mt-1.5">{formMessage.length} 文字</p>
                    </>
                  ) : (
                    <div className="space-y-2">
                      <select
                        value={selectedTemplateId}
                        onChange={e => setSelectedTemplateId(e.target.value)}
                        className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755]"
                      >
                        <option value="">テンプレートを選択</option>
                        {templates.map(tpl => (
                          <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
                        ))}
                      </select>
                      {selectedTemplateId && (() => {
                        const tpl = templates.find(t => t.id === selectedTemplateId)
                        if (!tpl) return null
                        const msgs = tpl.content?.messages || []
                        const preview = msgs.map(m => m.type === 'text' && m.text ? m.text.slice(0, 60) : `(${m.type})`).join(' / ')
                        return (
                          <div className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-500">
                            <span className="font-medium text-slate-700 dark:text-slate-300">プレビュー:</span> {preview}
                            <span className="ml-1 text-slate-400">({msgs.length}件のメッセージ)</span>
                          </div>
                        )
                      })()}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Step 2: 配信先 */}
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-6 h-6 rounded-full bg-[#06C755] text-white text-xs font-bold flex items-center justify-center">2</div>
                <h3 className="font-medium text-slate-900 dark:text-white">配信先</h3>
              </div>

              <div className="space-y-3">
                {/* 全員 */}
                <label className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                  <input
                    type="radio"
                    name="targetType"
                    checked={targetType === 'all'}
                    onChange={() => { setTargetType('all'); setIncludeTags([]); setExcludeTags([]); setRegisteredFrom(''); setRegisteredTo('') }}
                    className="w-4 h-4 text-[#06C755] accent-[#06C755]"
                  />
                  <Users size={18} className="text-slate-500" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-900 dark:text-white">友だち全員に配信</p>
                    <p className="text-xs text-slate-400">{totalFriends.toLocaleString()} 人</p>
                  </div>
                </label>

                {/* 絞り込み */}
                <label className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                  <input
                    type="radio"
                    name="targetType"
                    checked={targetType === 'filtered'}
                    onChange={() => setTargetType('filtered')}
                    className="w-4 h-4 text-[#06C755] accent-[#06C755] mt-0.5"
                  />
                  <Filter size={18} className="text-slate-500 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-900 dark:text-white">条件で絞り込み</p>
                    <p className="text-xs text-slate-400">タグ・登録日など複数条件で対象を指定</p>
                  </div>
                </label>

                {/* フィルター詳細 */}
                {targetType === 'filtered' && (
                  <div className="ml-10 space-y-4">
                    {/* 登録日範囲 */}
                    <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700">
                      <div className="flex items-center gap-2 mb-2">
                        <Calendar size={14} className="text-slate-500" />
                        <span className="text-xs font-medium text-slate-700 dark:text-slate-300">友だち登録日</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="date"
                          value={registeredFrom}
                          onChange={e => setRegisteredFrom(e.target.value)}
                          className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white"
                        />
                        <span className="text-xs text-slate-400">〜</span>
                        <input
                          type="date"
                          value={registeredTo}
                          onChange={e => setRegisteredTo(e.target.value)}
                          className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white"
                        />
                      </div>
                    </div>

                    {/* タグ含む */}
                    <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <TagIcon size={14} className="text-[#06C755]" />
                          <span className="text-xs font-medium text-slate-700 dark:text-slate-300">含むタグ</span>
                        </div>
                        <div className="flex items-center gap-1 text-xs">
                          <button
                            onClick={() => setTagLogic('or')}
                            className={`px-2 py-0.5 rounded cursor-pointer ${tagLogic === 'or' ? 'bg-[#06C755] text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}
                          >
                            OR
                          </button>
                          <button
                            onClick={() => setTagLogic('and')}
                            className={`px-2 py-0.5 rounded cursor-pointer ${tagLogic === 'and' ? 'bg-[#06C755] text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}
                          >
                            AND
                          </button>
                        </div>
                      </div>
                      <p className="text-xs text-slate-400 mb-2">
                        {tagLogic === 'or' ? 'いずれかのタグを持つ友だち' : '全てのタグを持つ友だち'}
                      </p>
                      {tags.length === 0 ? (
                        <p className="text-xs text-slate-400">タグがありません</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {tags.map(tag => (
                            <button
                              key={tag.id}
                              onClick={() => toggleIncludeTag(tag.id)}
                              className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors cursor-pointer ${
                                includeTags.includes(tag.id)
                                  ? 'text-white shadow-sm'
                                  : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 border border-slate-200 dark:border-slate-600'
                              }`}
                              style={includeTags.includes(tag.id) ? { backgroundColor: tag.color || '#06C755' } : undefined}
                            >
                              {tag.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* タグ除��� */}
                    <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700">
                      <div className="flex items-center gap-2 mb-2">
                        <TagIcon size={14} className="text-red-400" />
                        <span className="text-xs font-medium text-slate-700 dark:text-slate-300">除外タグ</span>
                      </div>
                      <p className="text-xs text-slate-400 mb-2">このタグを持つ友だちを除外</p>
                      {tags.length === 0 ? (
                        <p className="text-xs text-slate-400">タグが��りません</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {tags.map(tag => (
                            <button
                              key={tag.id}
                              onClick={() => toggleExcludeTag(tag.id)}
                              className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors cursor-pointer ${
                                excludeTags.includes(tag.id)
                                  ? 'bg-red-500 text-white shadow-sm'
                                  : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 border border-slate-200 dark:border-slate-600'
                              }`}
                            >
                              {tag.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 対象人数プレビュー */}
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                      <Users size={16} className="text-blue-600 dark:text-blue-400" />
                      <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                        {loadingCount ? '計算中...' : previewCount !== null ? `対象: ${previewCount.toLocaleString()} 人` : '条件を設定してください'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Step 3: 配信日時 */}
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-6 h-6 rounded-full bg-[#06C755] text-white text-xs font-bold flex items-center justify-center">3</div>
                <h3 className="font-medium text-slate-900 dark:text-white">配信日時</h3>
              </div>
              <div className="space-y-3">
                <label className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                  <input
                    type="radio"
                    name="scheduleType"
                    checked={scheduleType === 'now'}
                    onChange={() => { setScheduleType('now'); setScheduledAt('') }}
                    className="w-4 h-4 text-[#06C755] accent-[#06C755]"
                  />
                  <Send size={18} className="text-slate-500" />
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-white">下書きとして保存</p>
                    <p className="text-xs text-slate-400">送信ボタンで手動配信</p>
                  </div>
                </label>
                <label className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                  <input
                    type="radio"
                    name="scheduleType"
                    checked={scheduleType === 'scheduled'}
                    onChange={() => setScheduleType('scheduled')}
                    className="w-4 h-4 text-[#06C755] accent-[#06C755] mt-0.5"
                  />
                  <Clock size={18} className="text-slate-500 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-900 dark:text-white">日時を指定して予約</p>
                    {scheduleType === 'scheduled' && (
                      <input
                        type="datetime-local"
                        value={scheduledAt}
                        onChange={e => setScheduledAt(e.target.value)}
                        className="mt-2 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755] text-sm"
                      />
                    )}
                  </div>
                </label>
              </div>
            </div>
          </div>

          {/* Right: Preview */}
          <div className={`${showPreview ? 'block' : 'hidden lg:block'}`}>
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 sticky top-4">
              <h3 className="font-medium text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                <Eye size={16} />
                プレビュー
              </h3>
              <div className="bg-[#7494C0] rounded-xl p-4 min-h-[300px]">
                {(() => {
                  if (messageMode === 'template' && selectedTemplateId) {
                    const tpl = templates.find(t => t.id === selectedTemplateId)
                    const msgs = tpl?.content?.messages || []
                    if (msgs.length === 0) return <p className="text-white/50 text-sm text-center mt-20">テンプレートを選択してください</p>
                    return (
                      <div className="space-y-2">
                        {msgs.map((m, i) => (
                          <div key={i} className="flex justify-end">
                            <div className="bg-[#06C755] text-white text-sm px-4 py-2.5 rounded-2xl rounded-tr-sm max-w-[85%] whitespace-pre-wrap leading-relaxed">
                              {m.type === 'text' && m.text ? m.text : `(${m.type})`}
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  }
                  if (formMessage) {
                    return (
                      <div className="flex justify-end">
                        <div className="bg-[#06C755] text-white text-sm px-4 py-2.5 rounded-2xl rounded-tr-sm max-w-[85%] whitespace-pre-wrap leading-relaxed">
                          {formMessage}
                        </div>
                      </div>
                    )
                  }
                  return <p className="text-white/50 text-sm text-center mt-20">メッセージを入力するとプレビューが表示されます</p>
                })()}
              </div>
              <div className="mt-4 space-y-2 text-xs text-slate-500">
                <div className="flex justify-between">
                  <span>配信先</span>
                  <span className="text-slate-700 dark:text-slate-300">
                    {targetType === 'all'
                      ? `全友だち (${totalFriends.toLocaleString()}人)`
                      : loadingCount
                        ? '計算中...'
                        : previewCount !== null
                          ? `${previewCount.toLocaleString()} 人`
                          : '未設定'
                    }
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>配信���時</span>
                  <span className="text-slate-700 dark:text-slate-300">
                    {scheduleType === 'now' ? '手動送信' : scheduledAt ? formatDate(scheduledAt) : '未設定'}
                  </span>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                <TestSendWidget
                  getMessages={() => {
                    if (messageMode === 'template' && selectedTemplateId) {
                      const tpl = templates.find(t => t.id === selectedTemplateId)
                      return tpl?.content?.messages || null
                    }
                    return formMessage.trim() ? [{ type: 'text', text: formMessage }] : null
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // -- Broadcast List --
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#06C755]/10 flex items-center justify-center">
            <Megaphone size={20} className="text-[#06C755]" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">一斉配信</h2>
            <p className="text-sm text-slate-500">{broadcasts.length} 件の配信</p>
          </div>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#06C755] hover:bg-[#05b34c] text-white text-sm font-medium transition-colors cursor-pointer"
        >
          <Plus size={16} />
          新規作成
        </button>
      </div>

      <div className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-[#06C755] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : broadcasts.length === 0 ? (
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-center py-20 text-slate-400">
            <Megaphone size={40} className="mx-auto mb-3 opacity-50" />
            <p>一斉配信はまだありません</p>
          </div>
        ) : (
          broadcasts.map(bc => {
            const st = statusConfig(bc.status)
            return (
              <div
                key={bc.id}
                className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-medium text-slate-900 dark:text-white">{bc.name}</h3>
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${st.cls}`}>
                        {st.icon}
                        {st.text}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2 mb-2">
                      {bc.message_content}
                    </p>
                    <div className="flex items-center gap-4 text-xs text-slate-400">
                      {bc.scheduled_at && (
                        <span className="flex items-center gap-1">
                          <Clock size={12} />
                          {formatDate(bc.scheduled_at)}
                        </span>
                      )}
                      {bc.sent_count > 0 && (
                        <span>送信数: {bc.sent_count.toLocaleString()}</span>
                      )}
                      {bc.target_filters ? (
                        <span className="flex items-center gap-1">
                          <Filter size={12} />
                          絞込み配信
                        </span>
                      ) : bc.target_tags && bc.target_tags.length > 0 ? (
                        <span className="flex items-center gap-1">
                          <TagIcon size={12} />
                          タグ絞り込み: {bc.target_tags.length} 件
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <Users size={12} />
                          全友だち
                        </span>
                      )}
                    </div>
                  </div>
                  {bc.status === 'draft' && (
                    <button
                      onClick={() => handleSend(bc.id)}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#06C755] hover:bg-[#05b34c] text-white text-sm font-medium transition-colors flex-shrink-0 cursor-pointer"
                    >
                      <Send size={14} />
                      送信
                    </button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
