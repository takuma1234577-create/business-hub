import { useState, useEffect, useCallback } from 'react'
import { ArrowLeft, MessageCircle, User, Calendar, Tag as TagIcon, X, Plus, Clock } from 'lucide-react'
import { friendApi, tagApi } from './api'
import type { Friend, Tag } from './types'

interface FriendDetailProps {
  friend: Friend
  onBack: () => void
  onOpenChat: (friend: Friend) => void
}

export default function FriendDetail({ friend, onBack, onOpenChat }: FriendDetailProps) {
  const [tags, setTags] = useState<Tag[]>([])
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [showTagPicker, setShowTagPicker] = useState(false)
  const [saving, setSaving] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState('#06C755')
  const [creatingTag, setCreatingTag] = useState(false)

  const TAG_COLORS = ['#06C755', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316']

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return
    setCreatingTag(true)
    try {
      const created = await tagApi.create({ name: newTagName.trim(), color: newTagColor })
      setAllTags(prev => [...prev, created])
      setNewTagName('')
      // 作成したタグを自動的にこの友だちに付ける
      const updated = [...tags, created]
      setTags(updated)
      await friendApi.updateTags(friend.id, updated.map(t => t.id))
    } catch { /* ignore */ }
    finally { setCreatingTag(false) }
  }

  const fetchTags = useCallback(async () => {
    try {
      const res = await tagApi.list()
      setAllTags(res)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    setTags(friend.tags || [])
    fetchTags()
  }, [friend, fetchTags])

  const handleToggleTag = async (tag: Tag) => {
    setSaving(true)
    const hasTag = tags.some(t => t.id === tag.id)
    const newTags = hasTag ? tags.filter(t => t.id !== tag.id) : [...tags, tag]
    setTags(newTags)
    try {
      await friendApi.updateTags(friend.id, newTags.map(t => t.id))
    } catch {
      setTags(tags) // revert
    } finally {
      setSaving(false)
    }
  }

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString('ja-JP', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  const statusConfig = (status: Friend['status']) => {
    switch (status) {
      case 'active': return { text: 'アクティブ', cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' }
      case 'blocked': return { text: 'ブロック', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' }
      case 'unfollowed': return { text: '解除済み', cls: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400' }
      default: return { text: status, cls: 'bg-slate-100 text-slate-500' }
    }
  }

  const st = statusConfig(friend.status)

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 transition-colors cursor-pointer"
          >
            <ArrowLeft size={20} />
          </button>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">友だち情報</h2>
        </div>
        <button
          onClick={() => onOpenChat(friend)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#06C755] hover:bg-[#05b34c] text-white text-sm font-medium transition-colors cursor-pointer"
        >
          <MessageCircle size={16} />
          チャットを開く
        </button>
      </div>

      {/* Profile Card */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 mb-4">
        <div className="flex items-center gap-4 mb-5">
          <div className="w-16 h-16 rounded-full bg-slate-200 dark:bg-slate-600 flex-shrink-0 overflow-hidden">
            {friend.picture_url ? (
              <img src={friend.picture_url} alt={friend.display_name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <User size={28} className="text-slate-400" />
              </div>
            )}
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white">{friend.display_name}</h3>
            {friend.status_message && (
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{friend.status_message}</p>
            )}
            <span className={`inline-block text-xs px-2.5 py-0.5 rounded-full font-medium mt-1.5 ${st.cls}`}>
              {st.text}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mb-1">
              <Calendar size={12} />
              友だち登録日
            </div>
            <p className="text-sm font-medium text-slate-900 dark:text-white">{formatDate(friend.created_at)}</p>
          </div>
          <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mb-1">
              <Clock size={12} />
              最終更新
            </div>
            <p className="text-sm font-medium text-slate-900 dark:text-white">{formatDate(friend.updated_at)}</p>
          </div>
        </div>
      </div>

      {/* Tags */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 mb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <TagIcon size={16} className="text-[#06C755]" />
            <h3 className="font-medium text-slate-900 dark:text-white">タグ</h3>
          </div>
          <button
            onClick={() => setShowTagPicker(!showTagPicker)}
            className="flex items-center gap-1 text-xs text-[#06C755] hover:underline cursor-pointer"
          >
            <Plus size={14} />
            タグを編集
          </button>
        </div>

        {tags.length === 0 ? (
          <p className="text-sm text-slate-400">タグなし</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tags.map(tag => (
              <span
                key={tag.id}
                className="text-xs px-3 py-1 rounded-full text-white font-medium"
                style={{ backgroundColor: tag.color || '#06C755' }}
              >
                {tag.name}
              </span>
            ))}
          </div>
        )}

        {/* Tag Picker */}
        {showTagPicker && (
          <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-slate-500">タップで追加/削除</p>
              <button onClick={() => setShowTagPicker(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X size={14} />
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {allTags.map(tag => {
                const active = tags.some(t => t.id === tag.id)
                return (
                  <button
                    key={tag.id}
                    onClick={() => handleToggleTag(tag)}
                    disabled={saving}
                    className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors cursor-pointer ${
                      active
                        ? 'text-white shadow-sm'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 border border-slate-200 dark:border-slate-600'
                    }`}
                    style={active ? { backgroundColor: tag.color || '#06C755' } : undefined}
                  >
                    {active ? '✓ ' : ''}{tag.name}
                  </button>
                )
              })}
            </div>
            {/* New Tag Creator */}
            <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
              <p className="text-xs text-slate-500 mb-2">新しいタグを作成</p>
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  value={newTagName}
                  onChange={e => setNewTagName(e.target.value)}
                  placeholder="タグ名"
                  className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                  onKeyDown={e => e.key === 'Enter' && handleCreateTag()}
                />
                <div className="flex gap-1">
                  {TAG_COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => setNewTagColor(c)}
                      className={`w-5 h-5 rounded-full cursor-pointer ${newTagColor === c ? 'ring-2 ring-offset-1 ring-slate-400' : ''}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <button
                  onClick={handleCreateTag}
                  disabled={!newTagName.trim() || creatingTag}
                  className="px-3 py-1.5 text-xs font-medium bg-[#06C755] text-white rounded-lg hover:bg-[#05b34c] disabled:opacity-40 cursor-pointer"
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* LINE User ID */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6">
        <h3 className="font-medium text-slate-900 dark:text-white mb-3">詳細情報</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">LINE User ID</span>
            <span className="text-slate-700 dark:text-slate-300 font-mono text-xs">{friend.line_user_id}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">内部ID</span>
            <span className="text-slate-700 dark:text-slate-300 font-mono text-xs">{friend.id}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
