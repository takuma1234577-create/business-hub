import { useState, useEffect, useCallback } from 'react'
import { Search, MessageCircle, User } from 'lucide-react'
import { chatApi, friendApi } from './api'
import type { Friend } from './types'

interface ChatThreadsProps {
  onSelectFriend: (friend: Friend) => void
}

type Thread = Awaited<ReturnType<typeof chatApi.listThreads>>[number]

const extractText = (content: unknown): string => {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (typeof content === 'object') {
    const c = content as Record<string, unknown>
    if (typeof c.text === 'string') return c.text
  }
  return ''
}

const formatTime = (iso?: string): string => {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) {
    return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
  }
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return '昨日'
  return d.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
}

export default function ChatThreads({ onSelectFriend }: ChatThreadsProps) {
  const [threads, setThreads] = useState<Thread[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')

  const fetchThreads = useCallback(async () => {
    setLoading(true)
    try {
      const res = await chatApi.listThreads(search || undefined)
      setThreads(res)
    } catch (err) {
      console.error('Failed to fetch chat threads:', err)
    } finally {
      setLoading(false)
    }
  }, [search])

  useEffect(() => {
    fetchThreads()
  }, [fetchThreads])

  const handleClick = async (t: Thread) => {
    // 完全なFriendオブジェクトを取得してからChatViewへ
    try {
      const full = await friendApi.getById(t.friend.id)
      onSelectFriend(full)
    } catch (err) {
      console.error('Failed to load friend:', err)
      // フォールバック: スレッドの情報のみで開く
      onSelectFriend({
        id: t.friend.id,
        line_user_id: t.friend.line_user_id,
        display_name: t.friend.display_name,
        picture_url: t.friend.picture_url,
        status_message: null,
        status: t.friend.status,
      } as Friend)
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-[#06C755]/10 flex items-center justify-center">
          <MessageCircle size={20} className="text-[#06C755]" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">チャット一覧</h2>
          <p className="text-sm text-slate-500">{threads.length} 件のトーク</p>
        </div>
      </div>

      {/* Search */}
      <div className="mb-4">
        <div className="relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="名前で検索..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755] transition-colors text-sm"
          />
        </div>
      </div>

      {/* Threads */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-[#06C755] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : threads.length === 0 ? (
          <div className="text-center py-20 text-slate-400">
            <MessageCircle size={40} className="mx-auto mb-3 opacity-50" />
            <p>トークはまだありません</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-700">
            {threads.map(t => {
              const text = extractText(t.last_message?.content)
              const isOut = t.last_message?.direction === 'outgoing'
              return (
                <li key={t.friend.id}>
                  <button
                    onClick={() => handleClick(t)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors text-left cursor-pointer"
                  >
                    {t.friend.picture_url ? (
                      <img
                        src={t.friend.picture_url}
                        alt=""
                        className="w-12 h-12 rounded-full object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
                        <User size={20} className="text-slate-400" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium text-slate-900 dark:text-white truncate">
                          {t.friend.display_name || '(名前なし)'}
                        </p>
                        <span className="text-xs text-slate-400 flex-shrink-0">
                          {formatTime(t.last_message?.created_at)}
                        </span>
                      </div>
                      <p className="text-sm text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {isOut && <span className="text-slate-400">自分: </span>}
                        {text || `(${t.last_message?.message_type || 'メッセージ'})`}
                      </p>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
