import { useState, useEffect, useCallback, useRef } from 'react'
import axios from 'axios'
import { Send } from 'lucide-react'

const api = axios.create({ baseURL: '/api/line-crm' })
api.interceptors.request.use((config) => { const token = localStorage.getItem('auth_token'); if (token) config.headers.Authorization = `Bearer ${token}`; return config })
interface Props {
  getMessages: () => Array<Record<string, unknown>> | null
  label?: string
}

export default function TestSendWidget({ getMessages, label = 'テスト配信' }: Props) {
  const [friendId, setFriendId] = useState('')
  const [friendName, setFriendName] = useState('')
  const [friendSearch, setFriendSearch] = useState('')
  const [friendResults, setFriendResults] = useState<{ id: string; display_name: string }[]>([])
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const [sending, setSending] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const searchFriends = useCallback(async (query: string) => {
    setSearching(true)
    try {
      const r = await api.get('/friends', { params: { search: query, per_page: 20 } })
      const list = (r.data?.data || r.data || []) as { id: string; display_name: string }[]
      setFriendResults(list)
    } catch {
      /* ignore */
    } finally {
      setSearching(false)
    }
  }, [])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const handleSend = async () => {
    const messages = getMessages()
    if (!friendId || !messages || messages.length === 0) return
    setSending(true)
    try {
      const res = await api.post('/message-templates/test-send', {
        friend_id: friendId,
        messages,
      })
      const sentTo = res.data?.sent_to || ''
      alert(`テスト配信完了${sentTo ? `: ${sentTo} に送信しました` : ''}`)
    } catch (err) {
      const msg = axios.isAxiosError(err) ? (err.response?.data?.error || err.message) : 'テスト配信に失敗しました'
      alert('テスト配信失敗: ' + msg)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">{label}:</span>
      <div ref={dropdownRef} className="relative flex-1 min-w-0">
        <input
          type="text"
          value={dropdownOpen ? friendSearch : friendName}
          onChange={e => {
            const q = e.target.value
            setFriendSearch(q)
            setDropdownOpen(true)
            if (searchTimer.current) clearTimeout(searchTimer.current)
            searchTimer.current = setTimeout(() => {
              if (q.trim()) searchFriends(q.trim())
              else setFriendResults([])
            }, 300)
          }}
          onFocus={() => {
            setDropdownOpen(true)
            setFriendSearch('')
            if (friendResults.length === 0) searchFriends('')
          }}
          placeholder="友だちを検索..."
          className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs focus:outline-none focus:ring-2 focus:ring-[#06C755]/40"
        />
        {dropdownOpen && (
          <div className="absolute z-50 mt-1 w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl max-h-48 overflow-y-auto">
            {searching ? (
              <div className="px-3 py-2 text-xs text-slate-400">検索中...</div>
            ) : friendResults.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-400">該当なし</div>
            ) : (
              friendResults.map(f => (
                <button
                  key={f.id}
                  onClick={() => {
                    setFriendId(f.id)
                    setFriendName(f.display_name)
                    setDropdownOpen(false)
                  }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer truncate"
                >
                  {f.display_name}
                </button>
              ))
            )}
          </div>
        )}
      </div>
      <button
        onClick={handleSend}
        disabled={sending || !friendId}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
      >
        <Send size={12} />
        {sending ? '送信中...' : 'テスト送信'}
      </button>
    </div>
  )
}
