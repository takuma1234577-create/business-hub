import { useState, useEffect, useCallback } from 'react'
import { Search, Filter, ChevronLeft, ChevronRight, User, Users } from 'lucide-react'
import { friendApi, tagApi } from './api'
import type { Friend, Tag } from './types'

interface FriendListProps {
  onSelectFriend: (friend: Friend) => void
}

export default function FriendList({ onSelectFriend }: FriendListProps) {
  const [friends, setFriends] = useState<Friend[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [search, setSearch] = useState('')
  const [selectedTag, setSelectedTag] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [showTagFilter, setShowTagFilter] = useState(false)
  const perPage = 20

  const fetchFriends = useCallback(async () => {
    setLoading(true)
    try {
      const res = await friendApi.list({
        search: search || undefined,
        tag_id: selectedTag || undefined,
        page,
        per_page: perPage,
      })
      setFriends(res.data)
      setTotal(res.total)
    } catch (err) {
      console.error('Failed to fetch friends:', err)
    } finally {
      setLoading(false)
    }
  }, [search, selectedTag, page])

  const fetchTags = useCallback(async () => {
    try {
      const res = await tagApi.list()
      setTags(res)
    } catch (err) {
      console.error('Failed to fetch tags:', err)
    }
  }, [])

  useEffect(() => {
    fetchFriends()
  }, [fetchFriends])

  useEffect(() => {
    fetchTags()
  }, [fetchTags])

  const totalPages = Math.ceil(total / perPage)

  const statusLabel = (status: Friend['status']) => {
    switch (status) {
      case 'active': return { text: 'アクティブ', cls: 'bg-green-100 text-green-700' }
      case 'blocked': return { text: 'ブロック', cls: 'bg-red-100 text-red-700' }
      case 'unfollowed': return { text: '解除済み', cls: 'bg-slate-100 text-slate-500' }
      default: return { text: status, cls: 'bg-slate-100 text-slate-500' }
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-[#06C755]/10 flex items-center justify-center">
          <Users size={20} className="text-[#06C755]" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">友だち一覧</h2>
          <p className="text-sm text-slate-500">{total.toLocaleString()} 件の友だち</p>
        </div>
      </div>

      {/* Search & Filter */}
      <div className="flex gap-3 mb-4">
        <div className="flex-1 relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="表示名で検索..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755] transition-colors text-sm"
          />
        </div>
        <div className="relative">
          <button
            onClick={() => setShowTagFilter(!showTagFilter)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors cursor-pointer ${
              selectedTag
                ? 'border-[#06C755] bg-[#06C755]/5 text-[#06C755]'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
            }`}
          >
            <Filter size={16} />
            タグ
          </button>
          {showTagFilter && (
            <div className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-20 py-1 max-h-64 overflow-y-auto">
              <button
                onClick={() => { setSelectedTag(''); setShowTagFilter(false); setPage(1) }}
                className="w-full text-left px-4 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
              >
                すべて表示
              </button>
              {tags.map(tag => (
                <button
                  key={tag.id}
                  onClick={() => { setSelectedTag(tag.id); setShowTagFilter(false); setPage(1) }}
                  className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2 cursor-pointer ${
                    selectedTag === tag.id ? 'bg-[#06C755]/5 text-[#06C755]' : 'text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: tag.color || '#06C755' }}
                  />
                  {tag.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Friend List */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-[#06C755] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : friends.length === 0 ? (
          <div className="text-center py-20 text-slate-400">
            <User size={40} className="mx-auto mb-3 opacity-50" />
            <p>友だちが見つかりません</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {friends.map(friend => {
              const st = statusLabel(friend.status)
              return (
                <button
                  key={friend.id}
                  onClick={() => onSelectFriend(friend)}
                  className="w-full flex items-center gap-4 px-5 py-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors text-left cursor-pointer"
                >
                  {/* Avatar */}
                  <div className="w-11 h-11 rounded-full bg-slate-200 dark:bg-slate-600 flex-shrink-0 overflow-hidden">
                    {friend.picture_url ? (
                      <img
                        src={friend.picture_url}
                        alt={friend.display_name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <User size={20} className="text-slate-400" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900 dark:text-white truncate">
                        {friend.display_name}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.cls}`}>
                        {st.text}
                      </span>
                    </div>
                    {friend.status_message && (
                      <p className="text-sm text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {friend.status_message}
                      </p>
                    )}
                    {/* Tags */}
                    {friend.tags && friend.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {friend.tags.slice(0, 5).map(tag => (
                          <span
                            key={tag.id}
                            className="text-xs px-2 py-0.5 rounded-full text-white font-medium"
                            style={{ backgroundColor: tag.color || '#06C755' }}
                          >
                            {tag.name}
                          </span>
                        ))}
                        {friend.tags.length > 5 && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-600 text-slate-500 dark:text-slate-300">
                            +{friend.tags.length - 5}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <ChevronRight size={18} className="text-slate-300 flex-shrink-0" />
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-slate-500">
            {(page - 1) * perPage + 1} - {Math.min(page * perPage, total)} / {total} 件
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300 min-w-[80px] text-center">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
