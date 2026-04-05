import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { BookOpen, Search, Trash2, Plus, RefreshCw, Zap, X, Upload } from 'lucide-react'

interface Chunk {
  id: string
  source: string
  source_id: string
  category: string
  title: string
  content: string
  metadata: Record<string, unknown> | null
  updated_at: string
}

interface SearchResult extends Chunk {
  similarity: number
}

const api = axios.create({ baseURL: '/api/line-crm' })

export default function KnowledgeChunks() {
  const [chunks, setChunks] = useState<Chunk[]>([])
  const [stats, setStats] = useState<{ total: number; bySource: Record<string, number>; byCategory: Record<string, number> } | null>(null)
  const [sourceFilter, setSourceFilter] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [showSearchDialog, setShowSearchDialog] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [addForm, setAddForm] = useState({ category: 'faq', title: '', content: '' })
  const [adding, setAdding] = useState(false)
  const [showBulkForm, setShowBulkForm] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [bulkCategory, setBulkCategory] = useState('faq')
  const [bulkDelimiter, setBulkDelimiter] = useState<'blank' | 'dash' | 'linebreak'>('blank')
  const [bulkUploading, setBulkUploading] = useState(false)

  const fetchStats = useCallback(async () => {
    try {
      const r = await api.get('/knowledge-chunks/stats')
      setStats(r.data)
    } catch (err) {
      console.error('stats fetch failed:', err)
    }
  }, [])

  const fetchChunks = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.get('/knowledge-chunks', {
        params: {
          source: sourceFilter || undefined,
          search: search || undefined,
          pageSize: 50,
        },
      })
      setChunks(r.data.data || [])
    } catch (err) {
      console.error('chunks fetch failed:', err)
    } finally {
      setLoading(false)
    }
  }, [sourceFilter, search])

  useEffect(() => {
    fetchStats()
  }, [fetchStats])
  useEffect(() => {
    fetchChunks()
  }, [fetchChunks])

  const handleDelete = async (id: string) => {
    if (!confirm('このナレッジを削除しますか？')) return
    try {
      await api.delete(`/knowledge-chunks/${id}`)
      fetchChunks()
      fetchStats()
    } catch (err) {
      console.error('delete failed:', err)
    }
  }

  const handleSearch = async () => {
    if (!searchQuery.trim()) return
    setSearching(true)
    try {
      const r = await api.post('/knowledge-chunks/search', { query: searchQuery, limit: 10 })
      setSearchResults(r.data.results || [])
    } catch (err) {
      console.error('search failed:', err)
      alert('検索に失敗しました: ' + (err instanceof Error ? err.message : ''))
    } finally {
      setSearching(false)
    }
  }

  const splitBulkText = (text: string, delim: 'blank' | 'dash' | 'linebreak'): string[] => {
    if (delim === 'blank') return text.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean)
    if (delim === 'dash') return text.split(/\n-{3,}\n/).map(s => s.trim()).filter(Boolean)
    return text.split(/\n/).map(s => s.trim()).filter(Boolean)
  }

  const bulkPreview = bulkText.trim() ? splitBulkText(bulkText, bulkDelimiter) : []

  const handleBulkUpload = async () => {
    const chunks = bulkPreview
    if (chunks.length === 0) { alert('テキストを入力してください'); return }
    if (chunks.length > 64) { alert(`一度に登録できるのは64件までです（${chunks.length}件検出）`); return }
    setBulkUploading(true)
    try {
      const items = chunks.map(c => ({ content: c, category: bulkCategory }))
      const r = await api.post<{ inserted: number }>('/knowledge-chunks/bulk', { items, category: bulkCategory, source: 'manual' })
      alert(`${r.data.inserted}件 取り込みました`)
      setBulkText('')
      setShowBulkForm(false)
      fetchChunks()
      fetchStats()
    } catch (err) {
      alert('取り込み失敗: ' + (axios.isAxiosError(err) ? err.response?.data?.error || err.message : ''))
    } finally {
      setBulkUploading(false)
    }
  }

  const handleAdd = async () => {
    if (!addForm.title.trim() || !addForm.content.trim()) return
    setAdding(true)
    try {
      await api.post('/knowledge-chunks', addForm)
      setAddForm({ category: 'faq', title: '', content: '' })
      setShowAddForm(false)
      fetchChunks()
      fetchStats()
    } catch (err) {
      alert('追加失敗: ' + (err instanceof Error ? err.message : ''))
    } finally {
      setAdding(false)
    }
  }

  const sourceColor = (s: string) => {
    switch (s) {
      case 'shopify': return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
      case 'amazon': return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
      case 'manual': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
      default: return 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#06C755]/10 flex items-center justify-center">
            <BookOpen size={20} className="text-[#06C755]" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">RAGナレッジ</h2>
            <p className="text-sm text-slate-500">
              {stats ? `${stats.total.toLocaleString()} 件のチャンク` : '...'}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setShowSearchDialog(true); setSearchResults([]); setSearchQuery('') }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-sm font-medium cursor-pointer"
          >
            <Zap size={16} />
            検索テスト
          </button>
          <button
            onClick={() => setShowBulkForm(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-sm font-medium cursor-pointer"
          >
            <Upload size={16} />
            一括取り込み
          </button>
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#06C755] hover:bg-[#05b34c] text-white text-sm font-medium cursor-pointer"
          >
            <Plus size={16} />
            手動追加
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-3">
            <p className="text-xs text-slate-500">合計</p>
            <p className="text-xl font-semibold text-slate-900 dark:text-white">{stats.total}</p>
          </div>
          {Object.entries(stats.bySource).map(([k, v]) => (
            <div key={k} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-3">
              <p className="text-xs text-slate-500 uppercase">{k}</p>
              <p className="text-xl font-semibold text-slate-900 dark:text-white">{v}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filter bar */}
      <div className="flex gap-3 mb-4">
        <div className="flex-1 relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="タイトル・本文で検索..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755]"
          />
        </div>
        <select
          value={sourceFilter}
          onChange={e => setSourceFilter(e.target.value)}
          className="px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#06C755]/40"
        >
          <option value="">すべてのソース</option>
          <option value="shopify">Shopify</option>
          <option value="amazon">Amazon</option>
          <option value="manual">手動</option>
        </select>
        <button
          onClick={() => { fetchChunks(); fetchStats() }}
          className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {/* List */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-[#06C755] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : chunks.length === 0 ? (
          <div className="text-center py-20 text-slate-400">
            <BookOpen size={40} className="mx-auto mb-3 opacity-50" />
            <p>ナレッジがありません</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-700">
            {chunks.map(c => (
              <li key={c.id} className="px-5 py-4 hover:bg-slate-50 dark:hover:bg-slate-700/30">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sourceColor(c.source)}`}>
                        {c.source}
                      </span>
                      <span className="text-xs text-slate-500">{c.category}</span>
                    </div>
                    <p className="font-medium text-slate-900 dark:text-white truncate">{c.title}</p>
                    <p className="text-sm text-slate-500 dark:text-slate-400 line-clamp-2 mt-1">{c.content}</p>
                  </div>
                  <button
                    onClick={() => handleDelete(c.id)}
                    className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-400 hover:text-red-500 cursor-pointer"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Search Dialog */}
      {showSearchDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
              <h3 className="font-semibold text-slate-900 dark:text-white">ベクトル検索テスト</h3>
              <button onClick={() => setShowSearchDialog(false)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 cursor-pointer">
                <X size={18} />
              </button>
            </div>
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  placeholder="質問文を入力してベクトル検索..."
                  className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755]"
                />
                <button
                  onClick={handleSearch}
                  disabled={searching || !searchQuery.trim()}
                  className="px-5 py-2.5 rounded-lg bg-[#06C755] hover:bg-[#05b34c] text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  {searching ? '検索中...' : '検索'}
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {searchResults.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-10">
                  {searching ? 'Voyage APIで埋め込み生成中...' : '検索結果はここに表示されます'}
                </p>
              ) : (
                <ul className="space-y-3">
                  {searchResults.map((r, i) => (
                    <li key={r.id} className="border border-slate-200 dark:border-slate-700 rounded-lg p-4">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded">#{i + 1}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sourceColor(r.source)}`}>{r.source}</span>
                          <span className="text-xs text-slate-500">{r.category}</span>
                        </div>
                        <span className="text-xs font-mono text-[#06C755]">
                          similarity: {r.similarity.toFixed(3)}
                        </span>
                      </div>
                      <p className="font-medium text-slate-900 dark:text-white text-sm">{r.title}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-3 mt-1">{r.content}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bulk Import Dialog */}
      {showBulkForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
              <h3 className="font-semibold text-slate-900 dark:text-white">ナレッジ一括取り込み</h3>
              <button onClick={() => setShowBulkForm(false)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 cursor-pointer">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">カテゴリ</label>
                  <select
                    value={bulkCategory}
                    onChange={e => setBulkCategory(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#06C755]/40"
                  >
                    <option value="faq">FAQ</option>
                    <option value="message">過去のLINEメッセージ</option>
                    <option value="product">商品</option>
                    <option value="campaign">キャンペーン</option>
                    <option value="policy">ポリシー</option>
                    <option value="other">その他</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">分割方法</label>
                  <select
                    value={bulkDelimiter}
                    onChange={e => setBulkDelimiter(e.target.value as 'blank' | 'dash' | 'linebreak')}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#06C755]/40"
                  >
                    <option value="blank">空行区切り（推奨）</option>
                    <option value="dash">--- 区切り</option>
                    <option value="linebreak">改行ごと</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  テキスト <span className="text-xs text-slate-400 font-normal">（最大64件・1件あたり2000字目安）</span>
                </label>
                <textarea
                  value={bulkText}
                  onChange={e => setBulkText(e.target.value)}
                  placeholder={'例：\n配送は3〜5営業日です。\n\n返品は商品到着後30日以内であれば承ります。\n\nキャンペーン中は送料無料です。'}
                  rows={12}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 resize-none font-mono"
                />
              </div>
              {bulkPreview.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-slate-500 mb-2">
                    プレビュー: <span className="text-[#06C755]">{bulkPreview.length}件</span> として登録されます
                    {bulkPreview.length > 64 && <span className="text-red-500 ml-2">※64件を超えています</span>}
                  </p>
                  <ul className="space-y-1.5 max-h-48 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-lg p-3 bg-slate-50 dark:bg-slate-900/50">
                    {bulkPreview.slice(0, 20).map((c, i) => (
                      <li key={i} className="text-xs text-slate-700 dark:text-slate-300 flex gap-2">
                        <span className="font-mono text-slate-400 flex-shrink-0">#{i + 1}</span>
                        <span className="line-clamp-2">{c}</span>
                      </li>
                    ))}
                    {bulkPreview.length > 20 && <li className="text-xs text-slate-400">...他 {bulkPreview.length - 20}件</li>}
                  </ul>
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex-shrink-0">
              <button onClick={() => setShowBulkForm(false)} className="px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-sm font-medium cursor-pointer">
                キャンセル
              </button>
              <button
                onClick={handleBulkUpload}
                disabled={bulkUploading || bulkPreview.length === 0 || bulkPreview.length > 64}
                className="px-5 py-2.5 rounded-lg bg-[#06C755] hover:bg-[#05b34c] text-white text-sm font-medium disabled:opacity-40 cursor-pointer"
              >
                {bulkUploading ? '埋め込み生成中...' : `${bulkPreview.length}件 取り込み`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Form Dialog */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
              <h3 className="font-semibold text-slate-900 dark:text-white">ナレッジを手動追加</h3>
              <button onClick={() => setShowAddForm(false)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 cursor-pointer">
                <X size={18} />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">カテゴリ</label>
                <select
                  value={addForm.category}
                  onChange={e => setAddForm(f => ({ ...f, category: e.target.value }))}
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755]"
                >
                  <option value="faq">FAQ</option>
                  <option value="product">商品</option>
                  <option value="campaign">キャンペーン</option>
                  <option value="policy">ポリシー</option>
                  <option value="other">その他</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">タイトル</label>
                <input
                  type="text"
                  value={addForm.title}
                  onChange={e => setAddForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="例: パワーグリップのサイズ選び"
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">本文</label>
                <textarea
                  value={addForm.content}
                  onChange={e => setAddForm(f => ({ ...f, content: e.target.value }))}
                  placeholder="ナレッジの内容を入力..."
                  rows={6}
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755] resize-none"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700">
              <button
                onClick={() => setShowAddForm(false)}
                className="px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-sm font-medium cursor-pointer"
              >
                キャンセル
              </button>
              <button
                onClick={handleAdd}
                disabled={adding || !addForm.title.trim() || !addForm.content.trim()}
                className="px-5 py-2.5 rounded-lg bg-[#06C755] hover:bg-[#05b34c] text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                {adding ? '埋め込み生成中...' : '追加'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
