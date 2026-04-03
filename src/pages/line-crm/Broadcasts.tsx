import { useState, useEffect, useCallback } from 'react'
import { Plus, Send, Megaphone, X, Clock, CheckCircle, AlertCircle, Radio } from 'lucide-react'
import { broadcastApi, tagApi } from './api'
import type { Broadcast, Tag } from './types'

export default function Broadcasts() {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    name: '',
    message_content: '',
    target_tags: [] as string[],
    scheduled_at: '',
  })

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

  useEffect(() => {
    fetchBroadcasts()
    fetchTags()
  }, [fetchBroadcasts, fetchTags])

  const handleCreate = async () => {
    try {
      await broadcastApi.create({
        name: form.name,
        message_content: form.message_content,
        target_tags: form.target_tags.length > 0 ? form.target_tags : null,
        scheduled_at: form.scheduled_at || null,
      })
      setShowForm(false)
      setForm({ name: '', message_content: '', target_tags: [], scheduled_at: '' })
      fetchBroadcasts()
    } catch (err) {
      console.error('Failed to create broadcast:', err)
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

  const toggleTag = (tagId: string) => {
    setForm(f => ({
      ...f,
      target_tags: f.target_tags.includes(tagId)
        ? f.target_tags.filter(t => t !== tagId)
        : [...f.target_tags, tagId],
    }))
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

  return (
    <div>
      {/* Header */}
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

      {/* Broadcast List */}
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
                      {bc.target_tags && bc.target_tags.length > 0 && (
                        <span>対象タグ: {bc.target_tags.length} 件</span>
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

      {/* Create Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
              <h3 className="font-semibold text-slate-900 dark:text-white">新しい一斉配信</h3>
              <button
                onClick={() => setShowForm(false)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">配信名</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="例: 新商品のお知らせ"
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755] text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">メッセージ内容</label>
                <textarea
                  value={form.message_content}
                  onChange={e => setForm(f => ({ ...f, message_content: e.target.value }))}
                  placeholder="配信メッセージを入力..."
                  rows={5}
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755] text-sm resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">対象タグ（任意）</label>
                <div className="flex flex-wrap gap-2">
                  {tags.map(tag => (
                    <button
                      key={tag.id}
                      onClick={() => toggleTag(tag.id)}
                      className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors cursor-pointer ${
                        form.target_tags.includes(tag.id)
                          ? 'text-white shadow-sm'
                          : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                      }`}
                      style={form.target_tags.includes(tag.id) ? { backgroundColor: tag.color || '#06C755' } : undefined}
                    >
                      {tag.name}
                    </button>
                  ))}
                  {tags.length === 0 && (
                    <p className="text-xs text-slate-400">タグがありません。全友だちに配信されます。</p>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">配信予約日時（任意）</label>
                <input
                  type="datetime-local"
                  value={form.scheduled_at}
                  onChange={e => setForm(f => ({ ...f, scheduled_at: e.target.value }))}
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755] text-sm"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700">
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-sm font-medium transition-colors cursor-pointer"
              >
                キャンセル
              </button>
              <button
                onClick={handleCreate}
                disabled={!form.name.trim() || !form.message_content.trim()}
                className="px-5 py-2.5 rounded-lg bg-[#06C755] hover:bg-[#05b34c] text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                作成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
