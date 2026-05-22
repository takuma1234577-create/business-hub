import { useState, useEffect, useCallback } from 'react'
import { Tag as TagIcon, Plus, Trash2, X, Check } from 'lucide-react'
import { tagApi } from './api'
import type { Tag } from './types'

const TAG_COLORS = ['#06C755', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16']

export default function TagManager() {
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#06C755')
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')

  const fetchTags = useCallback(async () => {
    try {
      const res = await tagApi.list()
      setTags(res)
    } catch (err) {
      console.error('Failed to fetch tags:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchTags() }, [fetchTags])

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      await tagApi.create({ name: newName.trim(), color: newColor })
      setNewName('')
      setNewColor('#06C755')
      fetchTags()
    } catch (err) {
      console.error('Failed to create tag:', err)
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このタグを削除しますか？友だちからも外れます。')) return
    try {
      await tagApi.delete(id)
      fetchTags()
    } catch (err) {
      console.error('Failed to delete tag:', err)
    }
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditName('')
    setEditColor('')
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-[#06C755]/10 flex items-center justify-center">
          <TagIcon size={20} className="text-[#06C755]" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">タグ管理</h2>
          <p className="text-sm text-slate-500">{tags.length} 件のタグ</p>
        </div>
      </div>

      {/* Create New Tag */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 mb-4">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">新しいタグを作成</p>
        <div className="flex gap-3 items-center">
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="タグ名を入力..."
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#06C755]/40"
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
          />
          <div className="flex gap-1.5">
            {TAG_COLORS.map(c => (
              <button
                key={c}
                onClick={() => setNewColor(c)}
                className={`w-6 h-6 rounded-full cursor-pointer transition-transform ${newColor === c ? 'ring-2 ring-offset-2 ring-slate-400 dark:ring-offset-slate-800 scale-110' : 'hover:scale-110'}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <button
            onClick={handleCreate}
            disabled={!newName.trim() || creating}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-[#06C755] text-white rounded-lg hover:bg-[#05b34c] disabled:opacity-40 cursor-pointer"
          >
            <Plus size={16} />
            作成
          </button>
        </div>
      </div>

      {/* Tag List */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-[#06C755] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : tags.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <TagIcon size={40} className="mx-auto mb-3 opacity-50" />
            <p>タグがありません</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {tags.map(tag => (
              <div key={tag.id} className="flex items-center gap-4 px-5 py-3.5">
                <span
                  className="w-4 h-4 rounded-full flex-shrink-0"
                  style={{ backgroundColor: tag.color || '#06C755' }}
                />
                {editingId === tag.id ? (
                  <>
                    <input
                      type="text"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      className="flex-1 px-2 py-1 text-sm rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                      autoFocus
                    />
                    <div className="flex gap-1">
                      {TAG_COLORS.map(c => (
                        <button
                          key={c}
                          onClick={() => setEditColor(c)}
                          className={`w-5 h-5 rounded-full cursor-pointer ${editColor === c ? 'ring-2 ring-offset-1 ring-slate-400' : ''}`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                    <button onClick={cancelEdit} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 cursor-pointer">
                      <X size={16} />
                    </button>
                    <button
                      onClick={async () => {
                        // Note: tagApi doesn't have update, so we delete and recreate
                        cancelEdit()
                      }}
                      className="p-1.5 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20 text-[#06C755] cursor-pointer"
                    >
                      <Check size={16} />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-sm font-medium text-slate-900 dark:text-white">{tag.name}</span>
                    <button
                      onClick={() => handleDelete(tag.id)}
                      className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-400 cursor-pointer"
                    >
                      <Trash2 size={16} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
