import { useState, useEffect, useCallback, useRef, type DragEvent } from 'react'
import axios from 'axios'
import { createClient } from '@supabase/supabase-js'
import {
  FileText, Plus, Pencil, Trash2, X, ArrowUp, ArrowDown,
  Type, Image as ImageIcon, Video, Music, LayoutGrid, Upload, Eye, FolderInput,
  GalleryHorizontal, ChevronLeft, ChevronRight, Copy, Send,
} from 'lucide-react'
import FolderTabs, { filterByFolder, computeFolderCounts } from './FolderTabs'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''
const supabaseClient = createClient(supabaseUrl, supabaseAnonKey)

async function uploadToStorage(file: File): Promise<string> {
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '')
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const path = `templates/${filename}`
  const { error } = await supabaseClient.storage
    .from('line-media')
    .upload(path, file, { contentType: file.type, cacheControl: '3600', upsert: false })
  if (error) throw new Error(error.message)
  const { data } = supabaseClient.storage.from('line-media').getPublicUrl(path)
  return data.publicUrl
}

// ── Message block types ──
type TextBlock = { type: 'text'; text: string }
type ImageBlock = { type: 'image'; originalContentUrl: string; previewImageUrl: string }
type VideoBlock = { type: 'video'; originalContentUrl: string; previewImageUrl: string }
type AudioBlock = { type: 'audio'; originalContentUrl: string; duration: number }
// LINE Messaging APIのactionは message / uri / postback 等をサポート。
// テンプレート送信は postback として保存（data=action=send_template&template_id=<id>）。
type ButtonAction =
  | { type: 'message'; label: string; text?: string }
  | { type: 'uri'; label: string; uri?: string }
  | { type: 'postback'; label: string; data: string; displayText?: string }
type PanelBlock = {
  type: 'template'
  altText: string
  template: {
    type: 'buttons'
    thumbnailImageUrl?: string
    title?: string
    text: string
    actions: ButtonAction[]
  }
}
interface CarouselColumn {
  thumbnailImageUrl?: string
  title?: string
  text: string
  actions: ButtonAction[]
}
type CarouselBlock = {
  type: 'template'
  altText: string
  template: {
    type: 'carousel'
    columns: CarouselColumn[]
    imageAspectRatio?: 'rectangle' | 'square'
    imageSize?: 'cover' | 'contain'
  }
}
// Discriminated union: panel or carousel
type TemplateBlock = PanelBlock | CarouselBlock
type MessageBlock = TextBlock | ImageBlock | VideoBlock | AudioBlock | TemplateBlock

interface Template {
  id: string
  name: string
  type: string
  content: { messages: MessageBlock[] }
  folder: string | null
  created_at: string
  updated_at: string
}

const api = axios.create({ baseURL: '/api/line-crm' })
api.interceptors.request.use((config) => { const token = localStorage.getItem('auth_token'); if (token) config.headers.Authorization = `Bearer ${token}`; return config })
// UI上のブロック種別（LINEの `template` を panel / carousel に細分化）
type UIBlockKind = 'text' | 'image' | 'video' | 'audio' | 'panel' | 'carousel'

const getBlockKind = (b: MessageBlock): UIBlockKind => {
  if (b.type !== 'template') return b.type
  return b.template.type === 'carousel' ? 'carousel' : 'panel'
}

const createBlock = (kind: UIBlockKind): MessageBlock => {
  switch (kind) {
    case 'text': return { type: 'text', text: '' }
    case 'image': return { type: 'image', originalContentUrl: '', previewImageUrl: '' }
    case 'video': return { type: 'video', originalContentUrl: '', previewImageUrl: '' }
    case 'audio': return { type: 'audio', originalContentUrl: '', duration: 60000 }
    case 'panel': return {
      type: 'template',
      altText: 'パネル',
      template: { type: 'buttons', text: '', actions: [{ type: 'message', label: 'ボタン1', text: '' }] },
    }
    case 'carousel': return {
      type: 'template',
      altText: 'カルーセル',
      template: {
        type: 'carousel',
        imageAspectRatio: 'square',
        imageSize: 'cover',
        columns: [
          { title: '', text: '', actions: [{ type: 'message', label: 'ボタン1', text: '' }] },
          { title: '', text: '', actions: [{ type: 'message', label: 'ボタン1', text: '' }] },
        ],
      },
    }
  }
}

const blockLabel = (k: UIBlockKind) => {
  switch (k) {
    case 'text': return 'テキスト'
    case 'image': return '画像'
    case 'video': return '動画'
    case 'audio': return '音声'
    case 'panel': return 'パネル'
    case 'carousel': return 'カルーセル'
  }
}

const blockIcon = (k: UIBlockKind, size = 16) => {
  switch (k) {
    case 'text': return <Type size={size} />
    case 'image': return <ImageIcon size={size} />
    case 'video': return <Video size={size} />
    case 'audio': return <Music size={size} />
    case 'panel': return <LayoutGrid size={size} />
    case 'carousel': return <GalleryHorizontal size={size} />
  }
}

export default function MessageTemplates() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [folder, setFolder] = useState('')
  const [blocks, setBlocks] = useState<MessageBlock[]>([])
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [pendingFolders, setPendingFolders] = useState<string[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [moveDialogOpen, setMoveDialogOpen] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewMessages, setPreviewMessages] = useState<MessageBlock[]>([])
  const [previewName, setPreviewName] = useState('')
  const [testFriendId, setTestFriendId] = useState('')
  const [testFriendName, setTestFriendName] = useState('')
  const [friendResults, setFriendResults] = useState<{ id: string; display_name: string }[]>([])
  const [testSending, setTestSending] = useState(false)
  const [friendSearch, setFriendSearch] = useState('')
  const [friendDropdownOpen, setFriendDropdownOpen] = useState(false)
  const [friendSearching, setFriendSearching] = useState(false)
  const friendDropdownRef = useRef<HTMLDivElement>(null)
  const friendSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const searchFriends = useCallback(async (query: string) => {
    setFriendSearching(true)
    try {
      const r = await api.get('/friends', { params: { search: query, per_page: 20 } })
      const list = (r.data?.data || r.data || []) as { id: string; display_name: string }[]
      setFriendResults(list)
    } catch (err) {
      console.error('search friends:', err)
    } finally {
      setFriendSearching(false)
    }
  }, [])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (friendDropdownRef.current && !friendDropdownRef.current.contains(e.target as Node)) {
        setFriendDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const handleTestSend = async () => {
    if (!testFriendId || blocks.length === 0) return
    setTestSending(true)
    try {
      const res = await api.post('/message-templates/test-send', {
        friend_id: testFriendId,
        messages: blocks,
      })
      const sentTo = res.data?.sent_to || ''
      alert(`テスト配信完了${sentTo ? `: ${sentTo} に送信しました` : ''}`)
    } catch (err) {
      const msg = axios.isAxiosError(err) ? (err.response?.data?.error || err.message) : 'テスト配信に失敗しました'
      alert('テスト配信失敗: ' + msg)
    } finally {
      setTestSending(false)
    }
  }

  const fetchTemplates = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.get<Template[]>('/message-templates')
      setTemplates(r.data)
    } catch (err) {
      console.error('fetch templates:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchTemplates() }, [fetchTemplates])

  const toggleSelect = (id: string) => {
    setSelectedIds(s => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const executeBulkMove = async (targetFolder: string | null) => {
    const idsToMove = Array.from(selectedIds)
    if (idsToMove.length === 0) return
    try {
      await api.patch('/message-templates/bulk-move', {
        ids: idsToMove,
        folder: targetFolder,
      })
      setSelectedIds(new Set())
      setMoveDialogOpen(false)
      fetchTemplates()
    } catch (err) {
      alert('移動失敗: ' + (axios.isAxiosError(err) ? err.response?.data?.error || err.message : ''))
    }
  }

  const openCreate = () => {
    setName('')
    // 選択中のフォルダがあれば初期値にする
    setFolder(selectedFolder && selectedFolder !== '__uncategorized__' ? selectedFolder : '')
    setBlocks([{ type: 'text', text: '' }])
    setEditingId(null)
    setShowForm(true)
  }

  const openEdit = (t: Template) => {
    setName(t.name)
    setFolder(t.folder || '')
    setBlocks(t.content?.messages || [])
    setEditingId(t.id)
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!name.trim() || blocks.length === 0) return
    setSaving(true)
    try {
      if (editingId) {
        await api.put(`/message-templates/${editingId}`, { name, messages: blocks, folder: folder.trim() || null })
      } else {
        await api.post('/message-templates', { name, messages: blocks, folder: folder.trim() || null })
      }
      setShowForm(false)
      fetchTemplates()
    } catch (err) {
      alert('保存失敗: ' + (err instanceof Error ? err.message : ''))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このテンプレートを削除しますか？')) return
    try {
      await api.delete(`/message-templates/${id}`)
      fetchTemplates()
    } catch (err) {
      console.error('delete:', err)
    }
  }

  const addBlock = (kind: UIBlockKind) => {
    if (blocks.length >= 5) {
      alert('1テンプレートは最大5メッセージまでです（LINE仕様）')
      return
    }
    setBlocks([...blocks, createBlock(kind)])
  }

  const importFromTemplate = (tmplId: string) => {
    const src = templates.find(t => t.id === tmplId)
    if (!src) return
    const msgs = src.content?.messages || []
    const remaining = 5 - blocks.length
    if (remaining <= 0) { alert('すでに5メッセージあります'); return }
    const toAdd = msgs.slice(0, remaining)
    if (msgs.length > remaining) {
      if (!confirm(`"${src.name}" は ${msgs.length} メッセージあります。\n上限超過分は取り込めません。${toAdd.length} メッセージを追加しますか？`)) return
    }
    setBlocks([...blocks, ...toAdd])
    setImportDialogOpen(false)
  }

  const updateBlock = (idx: number, next: MessageBlock) => {
    setBlocks(blocks.map((b, i) => (i === idx ? next : b)))
  }

  const removeBlock = (idx: number) => {
    setBlocks(blocks.filter((_, i) => i !== idx))
  }

  const moveBlock = (idx: number, dir: -1 | 1) => {
    const next = [...blocks]
    const target = idx + dir
    if (target < 0 || target >= next.length) return
    ;[next[idx], next[target]] = [next[target], next[idx]]
    setBlocks(next)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#06C755]/10 flex items-center justify-center">
            <FileText size={20} className="text-[#06C755]" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">テンプレート</h2>
            <p className="text-sm text-slate-500">{templates.length} 件のテンプレート</p>
          </div>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#06C755] hover:bg-[#05b34c] text-white text-sm font-medium cursor-pointer"
        >
          <Plus size={16} /> 新規作成
        </button>
      </div>

      {(() => {
        const { folders, counts } = computeFolderCounts(templates)
        const mergedFolders = Array.from(new Set([...folders, ...pendingFolders])).sort((a, b) => a.localeCompare(b, 'ja'))
        const filtered = filterByFolder(templates, selectedFolder)
        return (
          <>
            <FolderTabs
              folders={mergedFolders}
              selected={selectedFolder}
              onSelect={setSelectedFolder}
              onCreate={name => {
                setPendingFolders(p => Array.from(new Set([...p, name])))
                setSelectedFolder(name)
              }}
              counts={counts}
            />
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="w-8 h-8 border-2 border-[#06C755] border-t-transparent rounded-full animate-spin" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-20 text-slate-400">
                  <FileText size={40} className="mx-auto mb-3 opacity-50" />
                  <p>テンプレートがありません</p>
                </div>
              ) : (
                <>
                  {/* 一括操作ヘッダー */}
                  <div className="flex items-center gap-3 px-5 py-2.5 border-b border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50">
                    <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={filtered.length > 0 && filtered.every(t => selectedIds.has(t.id))}
                        ref={el => {
                          if (el) {
                            const sel = filtered.filter(t => selectedIds.has(t.id)).length
                            el.indeterminate = sel > 0 && sel < filtered.length
                          }
                        }}
                        onChange={e => {
                          setSelectedIds(s => {
                            const next = new Set(s)
                            if (e.target.checked) filtered.forEach(t => next.add(t.id))
                            else filtered.forEach(t => next.delete(t.id))
                            return next
                          })
                        }}
                        className="w-4 h-4 rounded border-slate-300 text-[#06C755] focus:ring-[#06C755]/40 cursor-pointer"
                      />
                      全選択
                    </label>
                    {selectedIds.size > 0 && (
                      <>
                        <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                          {selectedIds.size}件選択中
                        </span>
                        <button
                          onClick={() => setMoveDialogOpen(true)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#06C755] hover:bg-[#05b34c] text-white text-xs font-medium cursor-pointer"
                        >
                          <FolderInput size={13} />
                          フォルダに移動
                        </button>
                        <button
                          onClick={() => setSelectedIds(new Set())}
                          className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 cursor-pointer"
                        >
                          選択解除
                        </button>
                      </>
                    )}
                  </div>
                  <ul className="divide-y divide-slate-100 dark:divide-slate-700">
                    {filtered.map(t => (
              <li key={t.id} className="px-5 py-4 hover:bg-slate-50 dark:hover:bg-slate-700/30">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(t.id)}
                    onChange={() => toggleSelect(t.id)}
                    className="mt-1 w-4 h-4 rounded border-slate-300 text-[#06C755] focus:ring-[#06C755]/40 cursor-pointer flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-slate-900 dark:text-white">{t.name}</p>
                      {t.folder && (
                        <span className="inline-flex items-center gap-1 text-xs text-slate-500 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded">
                          📁 {t.folder}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {(t.content?.messages || []).map((m, i) => (
                        <span key={i} className="inline-flex items-center gap-1 text-xs bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-1 rounded-md">
                          {blockIcon(getBlockKind(m), 12)}
                          {blockLabel(getBlockKind(m))}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => {
                        setPreviewMessages(t.content?.messages || [])
                        setPreviewName(t.name)
                        setPreviewOpen(true)
                      }}
                      className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-[#06C755] cursor-pointer"
                      title="プレビュー"
                    >
                      <Eye size={15} />
                    </button>
                    <button onClick={() => openEdit(t)} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 cursor-pointer">
                      <Pencil size={15} />
                    </button>
                    <button onClick={() => handleDelete(t.id)} className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-400 hover:text-red-500 cursor-pointer">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
                  </ul>
                </>
              )}
            </div>
          </>
        )
      })()}

      {/* Builder modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-4xl shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
              <h3 className="font-semibold text-slate-900 dark:text-white">
                {editingId ? 'テンプレート編集' : 'テンプレート作成'}
              </h3>
              <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 cursor-pointer">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">テンプレート名</label>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="例: キャンペーン告知"
                    className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">フォルダ <span className="text-xs text-slate-400 font-normal">（任意）</span></label>
                  <input
                    type="text"
                    value={folder}
                    onChange={e => setFolder(e.target.value)}
                    list="template-folders-list"
                    placeholder="例: キャンペーン"
                    className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755]"
                  />
                  <datalist id="template-folders-list">
                    {computeFolderCounts(templates).folders.map(f => (
                      <option key={f} value={f} />
                    ))}
                  </datalist>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    メッセージ <span className="text-xs text-slate-400 font-normal">（最大5件・LINE仕様）</span>
                  </label>
                </div>
                <div className="space-y-3">
                  {blocks.map((b, idx) => (
                    <BlockEditor
                      key={idx}
                      block={b}
                      index={idx}
                      total={blocks.length}
                      templates={templates.filter(t => t.id !== editingId)}
                      onChange={next => updateBlock(idx, next)}
                      onRemove={() => removeBlock(idx)}
                      onMoveUp={() => moveBlock(idx, -1)}
                      onMoveDown={() => moveBlock(idx, 1)}
                    />
                  ))}
                </div>

                {blocks.length < 5 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {(['text', 'image', 'video', 'audio', 'panel', 'carousel'] as const).map(t => (
                      <button
                        key={t}
                        onClick={() => addBlock(t)}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
                      >
                        <Plus size={14} />
                        {blockIcon(t)}
                        {blockLabel(t)}
                      </button>
                    ))}
                    <button
                      onClick={() => setImportDialogOpen(true)}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-[#06C755]/60 text-sm text-[#06C755] hover:bg-[#06C755]/5 cursor-pointer"
                    >
                      <Copy size={14} />
                      テンプレートから取り込み
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-700 flex-shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">テスト配信:</span>
                <div ref={friendDropdownRef} className="relative flex-1 min-w-0">
                  <input
                    type="text"
                    value={friendDropdownOpen ? friendSearch : testFriendName}
                    onChange={e => {
                      const q = e.target.value
                      setFriendSearch(q)
                      setFriendDropdownOpen(true)
                      if (friendSearchTimer.current) clearTimeout(friendSearchTimer.current)
                      friendSearchTimer.current = setTimeout(() => {
                        if (q.trim()) searchFriends(q.trim())
                        else setFriendResults([])
                      }, 300)
                    }}
                    onFocus={() => {
                      setFriendSearch('')
                      setFriendDropdownOpen(true)
                      if (testFriendName) searchFriends(testFriendName)
                    }}
                    placeholder="名前で検索..."
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#06C755]/40"
                  />
                  {testFriendId && !friendDropdownOpen && (
                    <button
                      onClick={() => { setTestFriendId(''); setTestFriendName('') }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 cursor-pointer"
                    >
                      <X size={14} />
                    </button>
                  )}
                  {friendDropdownOpen && (
                    <div className="absolute z-10 left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {friendSearching ? (
                        <p className="px-3 py-3 text-xs text-slate-400 text-center">検索中...</p>
                      ) : friendResults.length > 0 ? (
                        friendResults.map(f => (
                          <button
                            key={f.id}
                            onClick={() => {
                              setTestFriendId(f.id)
                              setTestFriendName(f.display_name)
                              setFriendSearch('')
                              setFriendDropdownOpen(false)
                            }}
                            className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer ${f.id === testFriendId ? 'bg-[#06C755]/10 text-[#06C755] font-medium' : 'text-slate-700 dark:text-slate-300'}`}
                          >
                            {f.display_name}
                          </button>
                        ))
                      ) : friendSearch.trim() ? (
                        <p className="px-3 py-3 text-xs text-slate-400 text-center">該当する友だちがいません</p>
                      ) : (
                        <p className="px-3 py-3 text-xs text-slate-400 text-center">名前を入力して検索</p>
                      )}
                    </div>
                  )}
                </div>
                <button
                  onClick={handleTestSend}
                  disabled={testSending || !testFriendId || blocks.length === 0}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
                >
                  <Send size={14} />
                  {testSending ? '送信中...' : 'テスト送信'}
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex-shrink-0">
              <button
                onClick={() => {
                  setPreviewMessages(blocks)
                  setPreviewName(name || '(未入力)')
                  setPreviewOpen(true)
                }}
                disabled={blocks.length === 0}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <Eye size={15} />
                プレビュー
              </button>
              <div className="flex items-center gap-3">
                <button onClick={() => setShowForm(false)} className="px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-sm font-medium cursor-pointer">
                  キャンセル
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !name.trim() || blocks.length === 0}
                  className="px-5 py-2.5 rounded-lg bg-[#06C755] hover:bg-[#05b34c] text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  {saving ? '保存中...' : editingId ? '更新' : '作成'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {previewOpen && (
        <PreviewModal
          name={previewName}
          messages={previewMessages}
          onClose={() => setPreviewOpen(false)}
        />
      )}

      {importDialogOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md shadow-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
              <h3 className="font-semibold text-slate-900 dark:text-white">テンプレートから取り込み</h3>
              <button onClick={() => setImportDialogOpen(false)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 cursor-pointer">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              <p className="text-xs text-slate-500 mb-2">選択したテンプレートのメッセージを現在の位置以降に追加します</p>
              <ul className="divide-y divide-slate-100 dark:divide-slate-700">
                {templates.filter(t => t.id !== editingId).map(t => (
                  <li key={t.id}>
                    <button
                      onClick={() => importFromTemplate(t.id)}
                      className="w-full text-left px-3 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/30 rounded cursor-pointer"
                    >
                      <p className="text-sm font-medium text-slate-900 dark:text-white">{t.name}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {(t.content?.messages || []).length} メッセージ
                        {t.folder && <span className="ml-2">📁 {t.folder}</span>}
                      </p>
                    </button>
                  </li>
                ))}
                {templates.filter(t => t.id !== editingId).length === 0 && (
                  <li className="text-center py-10 text-slate-400 text-sm">取り込めるテンプレートがありません</li>
                )}
              </ul>
            </div>
          </div>
        </div>
      )}

      {moveDialogOpen && (
        <MoveFolderDialog
          count={selectedIds.size}
          folders={Array.from(new Set([...computeFolderCounts(templates).folders, ...pendingFolders]))}
          onClose={() => setMoveDialogOpen(false)}
          onMove={executeBulkMove}
        />
      )}
    </div>
  )
}

// ─────────────── Move Folder Dialog ───────────────
function MoveFolderDialog({
  count, folders, onClose, onMove,
}: {
  count: number
  folders: string[]
  onClose: () => void
  onMove: (folder: string | null) => void
}) {
  const [mode, setMode] = useState<'existing' | 'new' | 'none'>('existing')
  const [selected, setSelected] = useState<string>(folders[0] || '')
  const [newName, setNewName] = useState('')

  const handleMove = () => {
    if (mode === 'none') onMove(null)
    else if (mode === 'existing') {
      if (!selected) return
      onMove(selected)
    } else {
      const n = newName.trim()
      if (!n) return
      onMove(n)
    }
  }

  const canMove =
    mode === 'none' || (mode === 'existing' && !!selected) || (mode === 'new' && newName.trim().length > 0)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <h3 className="font-semibold text-slate-900 dark:text-white">
            {count}件をフォルダに移動
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 cursor-pointer">
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="radio"
                name="move-mode"
                checked={mode === 'existing'}
                onChange={() => setMode('existing')}
                className="text-[#06C755] focus:ring-[#06C755]/40 cursor-pointer"
              />
              既存のフォルダから選ぶ
            </label>
            {mode === 'existing' && (
              <select
                value={selected}
                onChange={e => setSelected(e.target.value)}
                className="ml-6 w-[calc(100%-1.5rem)] px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755]"
              >
                {folders.length === 0 ? (
                  <option value="">（フォルダがありません）</option>
                ) : (
                  folders.map(f => <option key={f} value={f}>{f}</option>)
                )}
              </select>
            )}
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="radio"
                name="move-mode"
                checked={mode === 'new'}
                onChange={() => setMode('new')}
                className="text-[#06C755] focus:ring-[#06C755]/40 cursor-pointer"
              />
              新しいフォルダを作成
            </label>
            {mode === 'new' && (
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="フォルダ名"
                autoFocus
                className="ml-6 w-[calc(100%-1.5rem)] px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755]"
              />
            )}
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="radio"
                name="move-mode"
                checked={mode === 'none'}
                onChange={() => setMode('none')}
                className="text-[#06C755] focus:ring-[#06C755]/40 cursor-pointer"
              />
              未分類に移動
            </label>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700">
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-sm font-medium cursor-pointer"
          >
            キャンセル
          </button>
          <button
            onClick={handleMove}
            disabled={!canMove}
            className="px-5 py-2.5 rounded-lg bg-[#06C755] hover:bg-[#05b34c] text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            移動
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────── LINE Preview ───────────────
function PreviewModal({
  name, messages, onClose,
}: { name: string; messages: MessageBlock[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-sm shadow-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
          <div>
            <h3 className="font-semibold text-slate-900 dark:text-white text-sm">プレビュー</h3>
            <p className="text-xs text-slate-500 truncate max-w-[220px]">{name}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 cursor-pointer">
            <X size={18} />
          </button>
        </div>
        {/* LINEチャット画面風の背景 */}
        <div className="flex-1 overflow-y-auto bg-[#8cabd8] px-3 py-4 space-y-2">
          {messages.map((m, i) => {
            // 空のテキストブロックはLINE同様に表示しない
            if (m.type === 'text' && !m.text) return null
            const isCarousel = m.type === 'template' && m.template.type === 'carousel'
            return (
              <div key={i} className={isCarousel ? 'w-full min-w-0' : 'flex justify-start min-w-0'}>
                <PreviewBubble block={m} />
              </div>
            )
          })}
          {messages.length === 0 && (
            <p className="text-center text-white/70 text-xs pt-10">メッセージがありません</p>
          )}
        </div>
      </div>
    </div>
  )
}

// テキスト中のURLを検出してリンクにする
function linkify(text: string) {
  const re = /(https?:\/\/[^\s]+)/g
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) parts.push(text.slice(lastIndex, m.index))
    parts.push(
      <a
        key={key++}
        href={m[0]}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[#06C755] underline break-all"
      >
        {m[0]}
      </a>,
    )
    lastIndex = m.index + m[0].length
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts.length > 0 ? parts : text
}

function PreviewBubble({ block }: { block: MessageBlock }) {
  switch (block.type) {
    case 'text':
      if (!block.text) return null
      return (
        <div className="max-w-[75%] bg-white rounded-2xl rounded-tl-sm px-3 py-2 shadow-sm">
          <p className="text-sm text-slate-900 whitespace-pre-wrap break-words">
            {linkify(block.text)}
          </p>
        </div>
      )
    case 'image':
      return block.previewImageUrl || block.originalContentUrl ? (
        <img
          src={block.previewImageUrl || block.originalContentUrl}
          alt=""
          className="max-w-[75%] max-h-64 rounded-2xl rounded-tl-sm shadow-sm object-cover"
          onError={e => (e.currentTarget.style.display = 'none')}
        />
      ) : (
        <div className="max-w-[75%] bg-white/80 rounded-2xl rounded-tl-sm px-3 py-2 text-xs text-slate-500">画像URL未設定</div>
      )
    case 'video':
      return block.originalContentUrl ? (
        <video
          src={block.originalContentUrl}
          poster={block.previewImageUrl || undefined}
          controls
          className="max-w-[75%] max-h-64 rounded-2xl rounded-tl-sm shadow-sm"
        />
      ) : (
        <div className="max-w-[75%] bg-white/80 rounded-2xl rounded-tl-sm px-3 py-2 text-xs text-slate-500">動画URL未設定</div>
      )
    case 'audio':
      return block.originalContentUrl ? (
        <div className="max-w-[75%] bg-white rounded-2xl rounded-tl-sm px-3 py-2 shadow-sm">
          <audio src={block.originalContentUrl} controls className="max-w-full" />
        </div>
      ) : (
        <div className="max-w-[75%] bg-white/80 rounded-2xl rounded-tl-sm px-3 py-2 text-xs text-slate-500">音声URL未設定</div>
      )
    case 'template': {
      if (block.template.type === 'carousel') {
        const carousel = block.template
        const cols = carousel.columns
        const thumbAspect = carousel.imageAspectRatio === 'square' ? 'aspect-square' : 'aspect-[1.51/1]'
        return (
          <div className="w-full overflow-x-auto snap-x snap-mandatory">
            <div className="flex gap-2 pb-2">
              {cols.map((c, i) => (
                <div key={i} className="snap-start flex-shrink-0 w-56 bg-white rounded-2xl overflow-hidden shadow-sm">
                  {c.thumbnailImageUrl && (
                    <img src={c.thumbnailImageUrl} alt="" className={`w-full object-cover ${thumbAspect}`} onError={e => (e.currentTarget.style.display = 'none')} />
                  )}
                  {(c.title || c.text) && (
                    <div className="px-3 py-2">
                      {c.title && <p className="font-semibold text-sm text-slate-900 mb-0.5 truncate">{c.title}</p>}
                      {c.text && (
                        <p className="text-xs text-slate-700 whitespace-pre-wrap break-words line-clamp-2">
                          {linkify(c.text)}
                        </p>
                      )}
                    </div>
                  )}
                  <div className="border-t border-slate-100">
                    {c.actions.map((a, j) => {
                      const label = a.label || '(ラベルなし)'
                      const cls = 'block w-full px-3 py-1.5 text-xs text-[#06C755] font-medium border-t border-slate-100 first:border-t-0 hover:bg-slate-50 text-center'
                      if (a.type === 'uri' && a.uri) {
                        return <a key={j} href={a.uri} target="_blank" rel="noopener noreferrer" className={cls}>{label}</a>
                      }
                      return <button key={j} type="button" className={`${cls} cursor-default opacity-90`}>{label}</button>
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      }
      const t = block.template
      return (
        <div className="max-w-[75%] bg-white rounded-2xl rounded-tl-sm overflow-hidden shadow-sm">
          {t.thumbnailImageUrl && (
            <img src={t.thumbnailImageUrl} alt="" className="w-full aspect-[1.51/1] object-cover" onError={e => (e.currentTarget.style.display = 'none')} />
          )}
          {(t.title || t.text) && (
            <div className="px-3 py-2">
              {t.title && <p className="font-semibold text-sm text-slate-900 mb-0.5">{t.title}</p>}
              {t.text && (
                <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">
                  {linkify(t.text)}
                </p>
              )}
            </div>
          )}
          <div className="border-t border-slate-100">
            {t.actions.map((a, i) => {
              const label = a.label || '(ラベルなし)'
              const cls = 'block w-full px-3 py-2 text-sm text-[#06C755] font-medium border-t border-slate-100 first:border-t-0 hover:bg-slate-50 text-center'
              if (a.type === 'uri' && a.uri) {
                return (
                  <a key={i} href={a.uri} target="_blank" rel="noopener noreferrer" className={cls}>
                    {label}
                  </a>
                )
              }
              const hoverTitle = a.type === 'message'
                ? `送信: ${a.text || '(空)'}`
                : a.type === 'postback'
                ? `テンプレート送信: ${a.displayText || '(未選択)'}`
                : 'URL未設定'
              return (
                <button
                  key={i}
                  type="button"
                  title={hoverTitle}
                  className={`${cls} cursor-default opacity-90`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      )
    }
  }
}

// ─────────────── Block Editor ───────────────
interface BlockEditorProps {
  block: MessageBlock
  index: number
  total: number
  templates: Template[]
  onChange: (b: MessageBlock) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}

function BlockEditor({ block, index, total, templates, onChange, onRemove, onMoveUp, onMoveDown }: BlockEditorProps) {
  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 bg-slate-50/50 dark:bg-slate-900/30">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
          <span className="text-xs font-mono bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded">#{index + 1}</span>
          {blockIcon(getBlockKind(block))}
          {blockLabel(getBlockKind(block))}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onMoveUp} disabled={index === 0} className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">
            <ArrowUp size={14} />
          </button>
          <button onClick={onMoveDown} disabled={index === total - 1} className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">
            <ArrowDown size={14} />
          </button>
          <button onClick={onRemove} className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-500 hover:text-red-500 cursor-pointer">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {block.type === 'text' && (
        <textarea
          value={block.text}
          onChange={e => onChange({ ...block, text: e.target.value })}
          placeholder="メッセージを入力..."
          rows={3}
          maxLength={5000}
          className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755] resize-none"
        />
      )}

      {block.type === 'image' && (
        <MediaPair
          accept="image/*"
          urlLabel="画像URL"
          previewLabel="プレビュー画像URL（省略時は同じ）"
          url={block.originalContentUrl}
          previewUrl={block.previewImageUrl}
          onUrlChange={v => onChange({ ...block, originalContentUrl: v, previewImageUrl: block.previewImageUrl || v })}
          onPreviewChange={v => onChange({ ...block, previewImageUrl: v })}
        />
      )}

      {block.type === 'video' && (
        <MediaPair
          accept="video/mp4"
          urlLabel="動画URL (mp4)"
          previewLabel="サムネイル画像URL"
          previewAccept="image/*"
          url={block.originalContentUrl}
          previewUrl={block.previewImageUrl}
          onUrlChange={v => onChange({ ...block, originalContentUrl: v })}
          onPreviewChange={v => onChange({ ...block, previewImageUrl: v })}
        />
      )}

      {block.type === 'audio' && (
        <div className="space-y-2">
          <DropUpload
            accept="audio/mp4,audio/x-m4a,.m4a"
            value={block.originalContentUrl}
            onChange={v => onChange({ ...block, originalContentUrl: v })}
            placeholder="音声URL (m4a) またはファイルをドロップ"
          />
          <input
            type="number"
            value={block.duration}
            onChange={e => onChange({ ...block, duration: Number(e.target.value) || 0 })}
            placeholder="再生時間 (ミリ秒)"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#06C755]/40"
          />
        </div>
      )}

      {block.type === 'template' && block.template.type === 'buttons' && (
        <PanelEditor block={block as PanelBlock} onChange={onChange} templates={templates} />
      )}
      {block.type === 'template' && block.template.type === 'carousel' && (
        <CarouselEditor block={block as CarouselBlock} onChange={onChange} templates={templates} />
      )}
    </div>
  )
}

function MediaPair({
  accept, urlLabel, previewLabel, previewAccept, url, previewUrl, onUrlChange, onPreviewChange,
}: {
  accept: string; urlLabel: string; previewLabel: string; previewAccept?: string
  url: string; previewUrl: string
  onUrlChange: (v: string) => void; onPreviewChange: (v: string) => void
}) {
  return (
    <div className="space-y-2">
      <DropUpload accept={accept} value={url} onChange={onUrlChange} placeholder={urlLabel} />
      <DropUpload accept={previewAccept || accept} value={previewUrl} onChange={onPreviewChange} placeholder={previewLabel} compact />
      {url && /\.(jpe?g|png|gif|webp)(\?|$)/i.test(url) && (
        <img src={url} alt="" className="max-h-32 rounded border border-slate-200 dark:border-slate-700" onError={e => (e.currentTarget.style.display = 'none')} />
      )}
    </div>
  )
}

function DropUpload({
  accept, value, onChange, placeholder, compact = false,
}: {
  accept: string; value: string; onChange: (v: string) => void; placeholder: string; compact?: boolean
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)

  const uploadFile = async (file: File) => {
    setUploading(true)
    setProgress(0)
    try {
      setProgress(30)
      const url = await uploadToStorage(file)
      setProgress(100)
      onChange(url)
    } catch (err) {
      alert('アップロード失敗: ' + (err instanceof Error ? err.message : '不明なエラー'))
    } finally {
      setUploading(false)
      setProgress(0)
    }
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) uploadFile(file)
  }

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`relative rounded-lg border ${dragging ? 'border-[#06C755] bg-[#06C755]/5' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'} transition-colors`}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-slate-900 dark:text-white text-sm focus:outline-none"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 text-xs font-medium cursor-pointer disabled:opacity-50"
        >
          <Upload size={12} />
          {uploading ? `${progress}%` : 'アップロード'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) uploadFile(file)
            e.target.value = ''
          }}
        />
      </div>
      {dragging && !compact && (
        <div className="absolute inset-0 flex items-center justify-center text-sm font-medium text-[#06C755] pointer-events-none">
          ドロップしてアップロード
        </div>
      )}
    </div>
  )
}

// カルーセル/パネル サムネイル用のコンパクトなドラッグ&ドロップ＆ファイル選択
function ThumbDropUpload({ value, onChange, aspect = 'rectangle' }: { value: string; onChange: (v: string) => void; aspect?: 'rectangle' | 'square' }) {
  const aspectCls = aspect === 'square' ? 'aspect-square' : 'aspect-[1.51/1]'
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)

  const uploadFile = async (file: File) => {
    setUploading(true)
    setProgress(0)
    try {
      setProgress(30)
      const url = await uploadToStorage(file)
      setProgress(100)
      onChange(url)
    } catch (err) {
      alert('アップロード失敗: ' + (err instanceof Error ? err.message : '不明なエラー'))
    } finally {
      setUploading(false)
      setProgress(0)
    }
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) uploadFile(file)
  }

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`rounded border ${dragging ? 'border-[#06C755] bg-[#06C755]/5' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'} transition-colors overflow-hidden`}
    >
      {value ? (
        <div className="relative">
          <img
            src={value}
            alt=""
            className={`w-full object-cover ${aspectCls}`}
            onError={e => (e.currentTarget.style.display = 'none')}
          />
          <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="px-2 py-1 rounded bg-white text-slate-900 text-[10px] font-medium cursor-pointer disabled:opacity-50"
            >
              {uploading ? `${progress}%` : '変更'}
            </button>
            <button
              type="button"
              onClick={() => onChange('')}
              className="px-2 py-1 rounded bg-red-500 text-white text-[10px] font-medium cursor-pointer"
            >
              削除
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className={`w-full flex flex-col items-center justify-center gap-1 text-slate-400 hover:text-[#06C755] text-[10px] cursor-pointer disabled:opacity-50 ${aspectCls}`}
        >
          <Upload size={16} />
          {uploading ? `アップロード中 ${progress}%` : 'クリック / ドロップ'}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = '' }}
      />
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="または画像URL"
        className="w-full px-2 py-1 border-t border-slate-200 dark:border-slate-700 bg-transparent text-slate-900 dark:text-white text-[10px] focus:outline-none"
      />
    </div>
  )
}

function PanelEditor({ block, onChange, templates }: { block: PanelBlock; onChange: (b: MessageBlock) => void; templates: Template[] }) {
  const tmpl = block.template
  const updateTmpl = (patch: Partial<PanelBlock['template']>) =>
    onChange({ ...block, template: { ...tmpl, ...patch } })
  const replaceAction = (i: number, next: ButtonAction) => {
    const nextActions = tmpl.actions.map((a, idx) => (idx === i ? next : a))
    updateTmpl({ actions: nextActions })
  }
  const updateAction = (i: number, patch: Partial<ButtonAction>) => {
    const curr = tmpl.actions[i] as ButtonAction
    replaceAction(i, { ...curr, ...patch } as ButtonAction)
  }
  const changeType = (i: number, type: ButtonAction['type']) => {
    const curr = tmpl.actions[i]
    const label = curr.label
    if (type === 'message') replaceAction(i, { type: 'message', label, text: '' })
    else if (type === 'uri') replaceAction(i, { type: 'uri', label, uri: '' })
    else if (type === 'postback') replaceAction(i, { type: 'postback', label, data: '' })
  }
  const addAction = () => {
    if (tmpl.actions.length >= 4) return
    updateTmpl({ actions: [...tmpl.actions, { type: 'message', label: `ボタン${tmpl.actions.length + 1}`, text: '' }] })
  }
  const removeAction = (i: number) => {
    updateTmpl({ actions: tmpl.actions.filter((_, idx) => idx !== i) })
  }
  // postback の data からテンプレートID を抽出
  const parseTemplateId = (data: string): string => {
    const m = data.match(/template_id=([0-9a-f-]+)/)
    return m ? m[1] : ''
  }
  return (
    <div className="space-y-2">
      <ThumbDropUpload
        value={tmpl.thumbnailImageUrl || ''}
        onChange={v => updateTmpl({ thumbnailImageUrl: v || undefined })}
      />
      <input
        type="text"
        value={tmpl.title || ''}
        onChange={e => updateTmpl({ title: e.target.value || undefined })}
        placeholder="タイトル（任意・40文字以内）"
        maxLength={40}
        className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#06C755]/40"
      />
      <input
        type="text"
        value={tmpl.text}
        onChange={e => updateTmpl({ text: e.target.value })}
        placeholder="本文（画像ありは60字・画像なしは160字）"
        maxLength={160}
        className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#06C755]/40"
      />
      <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-700">
        <p className="text-xs font-medium text-slate-500">ボタン（最大4個）</p>
        {tmpl.actions.map((a, i) => (
          <div key={i} className="flex items-center gap-2">
            <select
              value={a.type}
              onChange={e => changeType(i, e.target.value as ButtonAction['type'])}
              className="px-2 py-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs"
            >
              <option value="message">送信</option>
              <option value="uri">URL</option>
              <option value="postback">テンプレート</option>
            </select>
            <input
              type="text"
              value={a.label}
              onChange={e => updateAction(i, { label: e.target.value })}
              placeholder="ラベル（20字）"
              maxLength={20}
              className="flex-1 px-2 py-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs"
            />
            {a.type === 'message' ? (
              <input
                type="text"
                value={a.text || ''}
                onChange={e => updateAction(i, { text: e.target.value })}
                placeholder="送信テキスト"
                className="flex-1 px-2 py-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs"
              />
            ) : a.type === 'uri' ? (
              <input
                type="text"
                value={a.uri || ''}
                onChange={e => updateAction(i, { uri: e.target.value })}
                placeholder="https://..."
                className="flex-1 px-2 py-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs"
              />
            ) : (
              <select
                value={parseTemplateId(a.data)}
                onChange={e => {
                  const id = e.target.value
                  const name = templates.find(t => t.id === id)?.name || ''
                  replaceAction(i, {
                    type: 'postback',
                    label: a.label,
                    data: id ? `action=send_template&template_id=${id}` : '',
                    displayText: name,
                  })
                }}
                className="flex-1 px-2 py-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs"
              >
                <option value="">テンプレートを選択...</option>
                {templates.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}
            <button onClick={() => removeAction(i)} className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-400 hover:text-red-500 cursor-pointer">
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {tmpl.actions.length < 4 && (
          <button onClick={addAction} className="flex items-center gap-1 text-xs text-[#06C755] hover:underline cursor-pointer">
            <Plus size={12} /> ボタン追加
          </button>
        )}
      </div>
    </div>
  )
}

// ─────────────── Carousel Editor ───────────────
function CarouselEditor({ block, onChange, templates }: { block: CarouselBlock; onChange: (b: MessageBlock) => void; templates: Template[] }) {
  const columns = block.template.columns
  const updateColumn = (i: number, next: CarouselColumn) => {
    onChange({
      ...block,
      template: { ...block.template, columns: columns.map((c, idx) => idx === i ? next : c) },
    })
  }
  const addColumn = () => {
    if (columns.length >= 10) { alert('カルーセルは最大10カラムまでです'); return }
    updateColumns([...columns, { title: '', text: '', actions: [{ type: 'message', label: 'ボタン1', text: '' }] }])
  }
  const removeColumn = (i: number) => {
    if (columns.length <= 1) return
    updateColumns(columns.filter((_, idx) => idx !== i))
  }
  const moveColumn = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= columns.length) return
    const next = [...columns]
    ;[next[i], next[j]] = [next[j], next[i]]
    updateColumns(next)
  }
  const updateColumns = (next: CarouselColumn[]) => {
    onChange({ ...block, template: { ...block.template, columns: next } })
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">カラム数: {columns.length} / 10（最大）・各カラム最大3ボタン</p>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {columns.map((col, i) => (
          <CarouselColumnEditor
            key={i}
            index={i}
            total={columns.length}
            column={col}
            templates={templates}
            onChange={next => updateColumn(i, next)}
            onRemove={() => removeColumn(i)}
            onMoveLeft={() => moveColumn(i, -1)}
            onMoveRight={() => moveColumn(i, 1)}
          />
        ))}
        {columns.length < 10 && (
          <button
            type="button"
            onClick={addColumn}
            className="flex-shrink-0 w-56 flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg text-slate-400 hover:text-[#06C755] hover:border-[#06C755] cursor-pointer"
          >
            <Plus size={24} />
            <span className="text-xs">カラムを追加</span>
          </button>
        )}
      </div>
    </div>
  )
}

function CarouselColumnEditor({
  index, total, column, templates, onChange, onRemove, onMoveLeft, onMoveRight,
}: {
  index: number
  total: number
  column: CarouselColumn
  templates: Template[]
  onChange: (c: CarouselColumn) => void
  onRemove: () => void
  onMoveLeft: () => void
  onMoveRight: () => void
}) {
  const update = (patch: Partial<CarouselColumn>) => onChange({ ...column, ...patch })
  const updateAction = (i: number, next: ButtonAction) => {
    onChange({ ...column, actions: column.actions.map((a, idx) => idx === i ? next : a) })
  }
  const changeActionType = (i: number, type: ButtonAction['type']) => {
    const label = column.actions[i].label
    let next: ButtonAction
    if (type === 'message') next = { type: 'message', label, text: '' }
    else if (type === 'uri') next = { type: 'uri', label, uri: '' }
    else next = { type: 'postback', label, data: '' }
    updateAction(i, next)
  }
  const addAction = () => {
    if (column.actions.length >= 3) return
    update({ actions: [...column.actions, { type: 'message', label: `ボタン${column.actions.length + 1}`, text: '' }] })
  }
  const removeAction = (i: number) => update({ actions: column.actions.filter((_, idx) => idx !== i) })
  const parseTemplateId = (data: string): string => {
    const m = data.match(/template_id=([0-9a-f-]+)/)
    return m ? m[1] : ''
  }
  return (
    <div className="flex-shrink-0 w-64 border border-slate-200 dark:border-slate-700 rounded-lg p-3 bg-white dark:bg-slate-800">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-mono bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded">#{index + 1}</span>
        <div className="flex items-center gap-0.5">
          <button onClick={onMoveLeft} disabled={index === 0} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">
            <ChevronLeft size={13} />
          </button>
          <button onClick={onMoveRight} disabled={index === total - 1} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">
            <ChevronRight size={13} />
          </button>
          <button onClick={onRemove} disabled={total <= 1} className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-500 hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      <div className="mb-2">
        <ThumbDropUpload
          value={column.thumbnailImageUrl || ''}
          onChange={v => update({ thumbnailImageUrl: v || undefined })}
          aspect="square"
        />
      </div>
      <input
        type="text"
        value={column.title || ''}
        onChange={e => update({ title: e.target.value || undefined })}
        placeholder="タイトル（40字）"
        maxLength={40}
        className="w-full px-2 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs mb-2"
      />
      <input
        type="text"
        value={column.text}
        onChange={e => update({ text: e.target.value })}
        placeholder="本文（120字）"
        maxLength={120}
        className="w-full px-2 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs mb-2"
      />
      <div className="space-y-1.5 pt-2 border-t border-slate-200 dark:border-slate-700">
        <p className="text-[10px] font-medium text-slate-500">ボタン（最大3個）</p>
        {column.actions.map((a, i) => (
          <div key={i} className="space-y-1">
            <div className="flex items-center gap-1">
              <select
                value={a.type}
                onChange={e => changeActionType(i, e.target.value as ButtonAction['type'])}
                className="px-1.5 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-[10px]"
              >
                <option value="message">送信</option>
                <option value="uri">URL</option>
                <option value="postback">テンプレ</option>
              </select>
              <input
                type="text"
                value={a.label}
                onChange={e => updateAction(i, { ...a, label: e.target.value })}
                placeholder="ラベル"
                maxLength={20}
                className="flex-1 px-1.5 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-[10px]"
              />
              <button onClick={() => removeAction(i)} className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-400 hover:text-red-500 cursor-pointer">
                <Trash2 size={11} />
              </button>
            </div>
            {a.type === 'message' && (
              <input type="text" value={a.text || ''} onChange={e => updateAction(i, { type: 'message', label: a.label, text: e.target.value })} placeholder="送信テキスト"
                className="w-full px-1.5 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-[10px]" />
            )}
            {a.type === 'uri' && (
              <input type="text" value={a.uri || ''} onChange={e => updateAction(i, { type: 'uri', label: a.label, uri: e.target.value })} placeholder="https://..."
                className="w-full px-1.5 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-[10px]" />
            )}
            {a.type === 'postback' && (
              <select
                value={parseTemplateId(a.data)}
                onChange={e => {
                  const id = e.target.value
                  const name = templates.find(t => t.id === id)?.name || ''
                  updateAction(i, {
                    type: 'postback', label: a.label,
                    data: id ? `action=send_template&template_id=${id}` : '',
                    displayText: name,
                  })
                }}
                className="w-full px-1.5 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-[10px]"
              >
                <option value="">テンプレート選択...</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
          </div>
        ))}
        {column.actions.length < 3 && (
          <button onClick={addAction} className="flex items-center gap-1 text-[10px] text-[#06C755] hover:underline cursor-pointer">
            <Plus size={10} /> ボタン追加
          </button>
        )}
      </div>
    </div>
  )
}
