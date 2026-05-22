import { useState, useEffect, useRef, useCallback } from 'react'
import { Send, ArrowLeft, User, MessageCircle, ImagePlus, X, Film, LayoutGrid, ShieldBan, ShieldCheck } from 'lucide-react'
import { chatApi } from './api'
import type { Friend, ChatMessage } from './types'

interface ChatViewProps {
  friend: Friend
  onBack: () => void
  onFriendUpdated?: (friend: Friend) => void
}

export default function ChatView({ friend, onBack, onFriendUpdated }: ChatViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [enterReady, setEnterReady] = useState(false)
  const [mediaPreview, setMediaPreview] = useState<{ file: File; url: string; type: 'image' | 'video' } | null>(null)
  const [templateNames, setTemplateNames] = useState<Record<string, string>>({})
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchMessages = useCallback(async () => {
    setLoading(true)
    try {
      const res = await chatApi.getMessages(friend.id)
      setMessages(res)
      setHasMore(res.length >= 200)
    } catch (err) {
      console.error('Failed to fetch messages:', err)
    } finally {
      setLoading(false)
    }
  }, [friend.id])

  const loadOlderMessages = async () => {
    if (loadingMore || messages.length === 0) return
    setLoadingMore(true)
    try {
      const oldest = messages[0]?.sent_at || messages[0]?.created_at
      const res = await fetch(`/api/line-crm/chat/${friend.id}/messages?limit=200&before=${oldest}`)
      if (res.ok) {
        const older: ChatMessage[] = await res.json()
        if (older.length > 0) {
          setMessages(prev => [...older, ...prev])
        }
        setHasMore(older.length >= 200)
      }
    } catch (err) {
      console.error('Failed to load older messages:', err)
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    fetchMessages()
    // チャットを開いた時に既読にする
    chatApi.markAsRead(friend.id).catch(() => {})
  }, [fetchMessages])

  // postbackメッセージ内のtemplate_idからテンプレート名を取得
  useEffect(() => {
    const ids = new Set<string>()
    for (const msg of messages) {
      const ct = msg.content as unknown as Record<string, unknown> | undefined
      if (!ct) continue
      // postback の data から
      if (msg.message_type === 'postback' && ct.data) {
        const params = new URLSearchParams(String(ct.data))
        const tid = params.get('template_id')
        if (tid && !templateNames[tid]) ids.add(tid)
      }
      // outbound template_postback の template_id から
      if (ct.template_id && typeof ct.template_id === 'string' && !templateNames[ct.template_id]) {
        ids.add(ct.template_id)
      }
    }
    if (ids.size === 0) return
    ;(async () => {
      try {
        const res = await fetch('/api/line-crm/message-templates')
        if (!res.ok) return
        const templates: { id: string; name: string }[] = await res.json()
        const map: Record<string, string> = {}
        for (const t of templates) {
          if (ids.has(t.id)) map[t.id] = t.name
        }
        if (Object.keys(map).length > 0) {
          setTemplateNames(prev => ({ ...prev, ...map }))
        }
      } catch { /* ignore */ }
    })()
  }, [messages])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async () => {
    if (!input.trim() || sending) return
    const content = input.trim()
    setInput('')
    setEnterReady(false)
    setSending(true)
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }

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
      setMessages(prev => prev.filter(m => m.id !== tempMsg.id))
      setInput(content)
    } finally {
      setSending(false)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const isVideo = file.type.startsWith('video/')
    const isImage = file.type.startsWith('image/')
    if (!isVideo && !isImage) {
      alert('画像または動画ファイルを選択してください')
      return
    }
    const previewUrl = URL.createObjectURL(file)
    setMediaPreview({ file, url: previewUrl, type: isVideo ? 'video' : 'image' })
    // reset file input
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const cancelMedia = () => {
    if (mediaPreview) {
      URL.revokeObjectURL(mediaPreview.url)
      setMediaPreview(null)
    }
  }

  const handleSendMedia = async () => {
    if (!mediaPreview || sending) return
    setSending(true)

    const tempMsg: ChatMessage = {
      id: `temp-media-${Date.now()}`,
      friend_id: friend.id,
      direction: 'outgoing',
      message_type: mediaPreview.type,
      content: mediaPreview.url,
      sent_at: new Date().toISOString(),
    }
    setMessages(prev => [...prev, tempMsg])
    const file = mediaPreview.file
    const type = mediaPreview.type
    cancelMedia()

    try {
      const uploaded = await chatApi.upload(file)
      const sent = await chatApi.sendMedia(friend.id, uploaded.url, type)
      setMessages(prev => prev.map(m => m.id === tempMsg.id ? sent : m))
    } catch (err) {
      console.error('Failed to send media:', err)
      setMessages(prev => prev.filter(m => m.id !== tempMsg.id))
      alert('メディアの送信に失敗しました')
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!input.trim()) return
      if (enterReady) {
        handleSend()
      } else {
        setEnterReady(true)
      }
    } else {
      if (e.key !== 'Shift') {
        setEnterReady(false)
      }
    }
  }

  const [currentStatus, setCurrentStatus] = useState(friend.status)
  const [blocking, setBlocking] = useState(false)

  useEffect(() => { setCurrentStatus(friend.status) }, [friend.status])

  const handleBlock = async () => {
    const isBlocked = currentStatus === 'blocked'
    const msg = isBlocked ? 'この友だちのブロックを解除しますか？' : 'この友だちをブロックしますか？'
    if (!confirm(msg)) return
    setBlocking(true)
    try {
      const res = await fetch(`/api/line-crm/friends/${friend.id}/block`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocked: !isBlocked }),
      })
      if (res.ok) {
        const updated = await res.json()
        setCurrentStatus(updated.status)
        onFriendUpdated?.({ ...friend, status: updated.status })
      }
    } catch (err) {
      console.error('Block toggle failed:', err)
    } finally {
      setBlocking(false)
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

  // Render message content (text, image, video)
  const renderContent = (msg: ChatMessage) => {
    const ct = msg.content
    // Handle object content (from DB: { text, url, type, messages })
    if (typeof ct === 'object' && ct !== null) {
      const obj = ct as Record<string, unknown>
      // Image
      if (obj.type === 'image' || msg.message_type === 'image') {
        const imgUrl = (obj.url || obj.originalContentUrl || obj.previewUrl || '') as string
        if (imgUrl) {
          return (
            <img
              src={imgUrl}
              alt="画像"
              className="w-[240px] max-w-full rounded-lg cursor-pointer shadow-sm"
              style={{ minHeight: 60 }}
              onClick={() => window.open(imgUrl, '_blank')}
              onError={e => {
                const el = e.currentTarget
                el.style.display = 'none'
                const fallback = document.createElement('div')
                fallback.textContent = '画像を読み込めません'
                fallback.className = 'px-3 py-2 bg-slate-100 dark:bg-slate-700 rounded-lg text-sm text-slate-500'
                el.parentNode?.appendChild(fallback)
              }}
            />
          )
        }
        return (
          <div className="flex items-center gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-700 rounded-lg text-sm text-slate-500">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
            画像
          </div>
        )
      }
      // Video
      if (obj.type === 'video' || msg.message_type === 'video') {
        const vidUrl = (obj.url || obj.originalContentUrl || '') as string
        if (vidUrl) {
          return <video src={vidUrl} controls className="w-[240px] max-w-full rounded-lg shadow-sm" />
        }
        return (
          <div className="flex items-center gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-700 rounded-lg text-sm text-slate-500">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            動画
          </div>
        )
      }
      // Sticker
      if (msg.message_type === 'sticker') {
        return <span className="text-2xl">🏷️ スタンプ</span>
      }
      // Postback (リッチメニューやテンプレート選択)
      if (msg.message_type === 'postback' && obj.data) {
        const params = new URLSearchParams(obj.data as string)
        const action = params.get('action')
        if (action === 'send_template') {
          const tid = params.get('template_id') || ''
          const name = templateNames[tid]
          return (
            <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 italic">
              <LayoutGrid size={14} />
              {name ? `テンプレート「${name}」を選択` : 'テンプレートを選択'}
            </span>
          )
        }
        if (action === 'register_email') {
          return <span className="text-xs text-slate-500 dark:text-slate-400 italic">会員登録ボタンをタップ</span>
        }
        if (action === 'check_orders') {
          return <span className="text-xs text-slate-500 dark:text-slate-400 italic">注文確認ボタンをタップ</span>
        }
        if (action === 'rich_menu') {
          return <span className="text-xs text-slate-500 dark:text-slate-400 italic">リッチメニューをタップ</span>
        }
        // displayText があれば表示
        if (obj.displayText) return <span className="text-xs text-slate-500 dark:text-slate-400 italic">{obj.displayText as string}</span>
        return <span className="text-xs text-slate-500 dark:text-slate-400 italic">ボタン操作</span>
      }
      // Auto-response / template messages array
      if (obj.messages && Array.isArray(obj.messages)) {
        const elements: React.ReactNode[] = []
        for (const m of obj.messages as Array<Record<string, unknown>>) {
          if (m.type === 'text' && typeof m.text === 'string') {
            elements.push(<p key={elements.length} className="whitespace-pre-wrap">{m.text}</p>)
          } else if (m.type === 'image') {
            const imgUrl = (m.originalContentUrl || m.previewImageUrl || m.url || '') as string
            if (imgUrl) {
              elements.push(
                <img key={elements.length} src={imgUrl} alt="" className="max-w-[240px] rounded-lg cursor-pointer mt-1" onClick={() => window.open(imgUrl, '_blank')} />
              )
            }
          } else if (m.type === 'video') {
            const vidUrl = (m.originalContentUrl || m.url || '') as string
            if (vidUrl) {
              elements.push(<video key={elements.length} src={vidUrl} controls className="max-w-[240px] rounded-lg mt-1" />)
            }
          } else if (m.type === 'template' && m.template) {
            const tmpl = m.template as Record<string, unknown>
            if (typeof tmpl.text === 'string') elements.push(<p key={elements.length}>{tmpl.text}</p>)
            if (Array.isArray(tmpl.actions)) {
              const labels = (tmpl.actions as Array<Record<string, unknown>>)
                .map(a => typeof a.label === 'string' ? `[${a.label}]` : '')
                .filter(Boolean)
              if (labels.length > 0) elements.push(<p key={elements.length} className="text-xs opacity-70">{labels.join('  ')}</p>)
            }
          }
        }
        if (elements.length > 0) return <div className="space-y-1">{elements}</div>
        // template_id があればテンプレート名で表示
        if (obj.template_id && typeof obj.template_id === 'string') {
          const name = templateNames[obj.template_id]
          return (
            <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 italic">
              <LayoutGrid size={14} />
              {name ? `テンプレート「${name}」を送信` : 'テンプレートを送信'}
            </span>
          )
        }
      }
      // Fallback to text
      if (obj.text) return <>{obj.text as string}</>
      return <span className="text-slate-400 text-xs">（メディアメッセージ）</span>
    }
    // String content - check if it's a blob/object URL (media preview)
    if (typeof ct === 'string' && (ct.startsWith('blob:') || ct.startsWith('http'))) {
      if (msg.message_type === 'video') {
        return <video src={ct} controls className="w-[240px] max-w-full rounded-lg shadow-sm" />
      }
      if (msg.message_type === 'image') {
        return <img src={ct} alt="画像" className="w-[240px] max-w-full rounded-lg shadow-sm" style={{ minHeight: 60 }} />
      }
    }
    return <>{ct}</>
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
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-slate-900 dark:text-white truncate">{friend.display_name}</h3>
            {currentStatus === 'blocked' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">ブロック中</span>
            )}
            {currentStatus === 'unfollowed' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">ブロックされた</span>
            )}
          </div>
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
        <button
          onClick={handleBlock}
          disabled={blocking || currentStatus === 'unfollowed'}
          title={currentStatus === 'blocked' ? 'ブロック解除' : 'ブロック'}
          className={`p-2 rounded-lg transition-colors cursor-pointer disabled:opacity-40 ${
            currentStatus === 'blocked'
              ? 'text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20'
              : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
          }`}
        >
          {currentStatus === 'blocked' ? <ShieldBan size={20} /> : <ShieldCheck size={20} />}
        </button>
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
          <>
          {hasMore && (
            <div className="flex justify-center py-3">
              <button onClick={loadOlderMessages} disabled={loadingMore}
                className="text-xs px-4 py-1.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600 cursor-pointer disabled:opacity-50">
                {loadingMore ? '読み込み中...' : '過去のメッセージを読み込む'}
              </button>
            </div>
          )}
          {groupedMessages.map((group, gi) => (
            <div key={gi}>
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
                    {(msg.message_type === 'image' || msg.message_type === 'video') ? (
                      <div className="max-w-[240px]">
                        {renderContent(msg)}
                      </div>
                    ) : (
                    <div
                      className={`max-w-[320px] px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                        msg.direction === 'outgoing'
                          ? 'bg-[#06C755] text-white rounded-[20px] rounded-br-md'
                          : 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white rounded-[20px] rounded-bl-md shadow-sm'
                      }`}
                    >
                      {renderContent(msg)}
                    </div>
                    )}
                    <span className="text-[10px] text-slate-400 mt-1 px-1">
                      {formatTime(msg.sent_at)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ))}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Media Preview */}
      {mediaPreview && (
        <div className="pt-3 -mx-6 px-6 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
          <div className="relative inline-block">
            {mediaPreview.type === 'video' ? (
              <video src={mediaPreview.url} className="h-24 rounded-lg" />
            ) : (
              <img src={mediaPreview.url} alt="" className="h-24 rounded-lg" />
            )}
            <button
              onClick={cancelMedia}
              className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center cursor-pointer hover:bg-red-600"
            >
              <X size={14} />
            </button>
            <div className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1">
              {mediaPreview.type === 'video' ? <Film size={10} /> : <ImagePlus size={10} />}
              {mediaPreview.type === 'video' ? '動画' : '画像'}
            </div>
          </div>
          <button
            onClick={handleSendMedia}
            disabled={sending}
            className="ml-3 px-4 py-2 bg-[#06C755] text-white text-sm font-medium rounded-lg hover:bg-[#05b34c] disabled:opacity-40 cursor-pointer"
          >
            {sending ? '送信中...' : '送信'}
          </button>
        </div>
      )}

      {/* Input Area */}
      <div className="pt-4 border-t border-slate-200 dark:border-slate-700 -mx-6 px-6">
        <div className="flex items-end gap-2">
          {/* File upload button */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            onChange={handleFileSelect}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={sending}
            className="w-11 h-11 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 flex items-center justify-center disabled:opacity-40 transition-colors flex-shrink-0 cursor-pointer"
            title="画像・動画を送信"
          >
            <ImagePlus size={18} />
          </button>

          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => { setInput(e.target.value); setEnterReady(false) }}
            onKeyDown={handleKeyDown}
            placeholder={enterReady ? '↵ Enterまたは送信ボタンで送信確定' : 'メッセージを入力...'}
            rows={1}
            className={`flex-1 resize-none px-4 py-3 rounded-xl border transition-colors text-sm ${
              enterReady
                ? 'border-[#06C755] bg-[#06C755]/5 ring-2 ring-[#06C755]/40'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
            } text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755]`}
            style={{ minHeight: '44px', maxHeight: '120px' }}
            onInput={e => {
              const t = e.currentTarget
              t.style.height = 'auto'
              t.style.height = Math.min(t.scrollHeight, 120) + 'px'
            }}
          />
          <button
            onClick={() => {
              if (!input.trim() || sending) return
              if (enterReady) {
                handleSend()
              } else {
                setEnterReady(true)
              }
            }}
            disabled={!input.trim() || sending}
            className={`w-11 h-11 rounded-xl text-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0 cursor-pointer ${
              enterReady ? 'bg-red-500 hover:bg-red-600 animate-pulse' : 'bg-[#06C755] hover:bg-[#05b34c]'
            }`}
            title={enterReady ? 'もう一度クリックで送信' : '送信確認'}
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  )
}
