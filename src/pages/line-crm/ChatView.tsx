import { useState, useEffect, useRef, useCallback } from 'react'
import { Send, ArrowLeft, User, MessageCircle } from 'lucide-react'
import { chatApi } from './api'
import type { Friend, ChatMessage } from './types'

interface ChatViewProps {
  friend: Friend
  onBack: () => void
}

export default function ChatView({ friend, onBack }: ChatViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const fetchMessages = useCallback(async () => {
    setLoading(true)
    try {
      const res = await chatApi.getMessages(friend.id)
      setMessages(res)
    } catch (err) {
      console.error('Failed to fetch messages:', err)
    } finally {
      setLoading(false)
    }
  }, [friend.id])

  useEffect(() => {
    fetchMessages()
  }, [fetchMessages])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async () => {
    if (!input.trim() || sending) return
    const content = input.trim()
    setInput('')
    setSending(true)

    // Optimistic update
    const tempMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      friend_id: friend.id,
      direction: 'outgoing',
      message_type: 'text',
      content,
      sent_at: new Date().toISOString(),
    }
    setMessages(prev => [...prev, tempMsg])

    try {
      const sent = await chatApi.send(friend.id, content)
      setMessages(prev => prev.map(m => m.id === tempMsg.id ? sent : m))
    } catch (err) {
      console.error('Failed to send message:', err)
      // Remove optimistic message on error
      setMessages(prev => prev.filter(m => m.id !== tempMsg.id))
      setInput(content) // Restore input
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
  }

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })
  }

  // Group messages by date
  const groupedMessages: { date: string; messages: ChatMessage[] }[] = []
  let currentDate = ''
  for (const msg of messages) {
    const msgDate = new Date(msg.sent_at).toDateString()
    if (msgDate !== currentDate) {
      currentDate = msgDate
      groupedMessages.push({ date: msg.sent_at, messages: [msg] })
    } else {
      groupedMessages[groupedMessages.length - 1].messages.push(msg)
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-120px)]">
      {/* Header */}
      <div className="flex items-center gap-3 pb-4 border-b border-slate-200 dark:border-slate-700 mb-0">
        <button
          onClick={onBack}
          className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 transition-colors cursor-pointer"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-600 flex-shrink-0 overflow-hidden">
          {friend.picture_url ? (
            <img src={friend.picture_url} alt={friend.display_name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <User size={20} className="text-slate-400" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-slate-900 dark:text-white truncate">{friend.display_name}</h3>
          {friend.tags && friend.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-0.5">
              {friend.tags.slice(0, 3).map(tag => (
                <span
                  key={tag.id}
                  className="text-[10px] px-1.5 py-0.5 rounded-full text-white font-medium"
                  style={{ backgroundColor: tag.color || '#06C755' }}
                >
                  {tag.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto py-4 space-y-1 bg-[#7494C0]/10 dark:bg-slate-900/50 -mx-6 px-6 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-8 h-8 border-2 border-[#06C755] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <MessageCircle size={40} className="mb-3 opacity-50" />
            <p>メッセージはまだありません</p>
          </div>
        ) : (
          groupedMessages.map((group, gi) => (
            <div key={gi}>
              {/* Date separator */}
              <div className="flex justify-center my-4">
                <span className="text-xs bg-slate-500/20 text-slate-600 dark:text-slate-300 px-3 py-1 rounded-full">
                  {formatDate(group.date)}
                </span>
              </div>
              {group.messages.map(msg => (
                <div
                  key={msg.id}
                  className={`flex mb-2 ${msg.direction === 'outgoing' ? 'justify-end' : 'justify-start'}`}
                >
                  {msg.direction === 'incoming' && (
                    <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-600 flex-shrink-0 overflow-hidden mr-2 mt-1">
                      {friend.picture_url ? (
                        <img src={friend.picture_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <User size={14} className="text-slate-400" />
                        </div>
                      )}
                    </div>
                  )}
                  <div className={`flex flex-col ${msg.direction === 'outgoing' ? 'items-end' : 'items-start'}`}>
                    <div
                      className={`max-w-[320px] px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                        msg.direction === 'outgoing'
                          ? 'bg-[#06C755] text-white rounded-[20px] rounded-br-md'
                          : 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white rounded-[20px] rounded-bl-md shadow-sm'
                      }`}
                    >
                      {msg.content}
                    </div>
                    <span className="text-[10px] text-slate-400 mt-1 px-1">
                      {formatTime(msg.sent_at)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="pt-4 border-t border-slate-200 dark:border-slate-700 -mx-6 px-6">
        <div className="flex items-end gap-3">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="メッセージを入力..."
            rows={1}
            className="flex-1 resize-none px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755] transition-colors text-sm"
            style={{ minHeight: '44px', maxHeight: '120px' }}
            onInput={e => {
              const t = e.currentTarget
              t.style.height = 'auto'
              t.style.height = Math.min(t.scrollHeight, 120) + 'px'
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="w-11 h-11 rounded-xl bg-[#06C755] hover:bg-[#05b34c] text-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0 cursor-pointer"
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  )
}
