import { useState, useEffect, useCallback, useRef } from 'react'
import { Search, MessageCircle, User } from 'lucide-react'
import { chatApi, friendApi } from './api'
import { getChannelId } from './lineAccount'
import type { Friend } from './types'

interface ChatThreadsProps {
  onSelectFriend: (friend: Friend) => void
}

type Thread = Awaited<ReturnType<typeof chatApi.listThreads>>[number]

// チャット一覧はアカウント(channel)ごとにメモリキャッシュ。
// 画面を離れて戻っても即表示（3秒待ちを解消）し、裏でポーリング更新する。
const threadsCache: Record<string, Thread[]> = {}
const POLL_MS = 4000

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
  const channelId = getChannelId()
  const [threads, setThreads] = useState<Thread[]>(() => threadsCache[channelId] || [])
  // キャッシュがあればスピナーは出さない（即表示）
  const [loading, setLoading] = useState(!threadsCache[channelId])
  const [search, setSearch] = useState('')
  const fetchingRef = useRef(false)

  const fetchThreads = useCallback(async () => {
    if (fetchingRef.current) return
    fetchingRef.current = true
    try {
      const res = await chatApi.listThreads()
      threadsCache[channelId] = res
      setThreads(res)
    } catch (err) {
      console.error('Failed to fetch chat threads:', err)
    } finally {
      fetchingRef.current = false
      setLoading(false)
    }
  }, [channelId])

  useEffect(() => {
    // 表示は即キャッシュ、裏で最新を取得
    if (threadsCache[channelId]) { setThreads(threadsCache[channelId]); setLoading(false) }
    fetchThreads()
    // リアルタイム更新（ポーリング）＋タブ復帰時に即更新
    const iv = setInterval(fetchThreads, POLL_MS)
    const onVisible = () => { if (!document.hidden) fetchThreads() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      clearInterval(iv)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [fetchThreads, channelId])

  // 検索はクライアント側で絞り込み（再取得しない＝キャッシュ維持・即応答）
  const q = search.trim().toLowerCase()
  const visibleThreads = q
    ? threads.filter(t => (t.friend.display_name || '').toLowerCase().includes(q))
    : threads

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
          <p className="text-sm text-slate-500">{visibleThreads.length} 件のトーク</p>
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
        {loading && threads.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-[#06C755] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : visibleThreads.length === 0 ? (
          <div className="text-center py-20 text-slate-400">
            <MessageCircle size={40} className="mx-auto mb-3 opacity-50" />
            <p>{q ? '該当するトークがありません' : 'トークはまだありません'}</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-700">
            {visibleThreads.map(t => {
              const text = extractText(t.last_message?.content)
              const isOut = t.last_message?.direction === 'outgoing'
              const unread = t.friend.unread_count || 0
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
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <p className={`text-sm truncate ${unread > 0 ? 'text-slate-900 dark:text-white font-medium' : 'text-slate-500 dark:text-slate-400'}`}>
                          {isOut && <span className="text-slate-400">自分: </span>}
                          {text || `(${t.last_message?.message_type || 'メッセージ'})`}
                        </p>
                        {unread > 0 && (
                          <span className="flex-shrink-0 min-w-[20px] h-5 px-1.5 bg-[#06C755] text-white text-xs font-bold rounded-full flex items-center justify-center">
                            {unread > 99 ? '99+' : unread}
                          </span>
                        )}
                      </div>
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
