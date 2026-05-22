import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Users, Mail, ExternalLink, Trash2, ChevronDown, Search, RefreshCw } from 'lucide-react'

interface Submission {
  id: string
  company: string
  name: string
  email: string
  revenue: string | null
  product_url: string | null
  category: string | null
  challenges: string[]
  message: string | null
  status: string
  submitted_at: string
}

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  new: { label: '新規', cls: 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' },
  booked: { label: '面談予約済', cls: 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400' },
  contacted: { label: '連絡済み', cls: 'bg-yellow-50 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400' },
  negotiating: { label: '商談中', cls: 'bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400' },
  contracted: { label: '成約', cls: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400' },
  lost: { label: '失注', cls: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400' },
}

export default function AmazonConsulting() {
  const navigate = useNavigate()
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const fetchSubmissions = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/consulting/submissions')
      if (res.ok) setSubmissions(await res.json())
    } catch (err) {
      console.error('Failed to fetch submissions:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchSubmissions() }, [fetchSubmissions])

  const updateStatus = async (id: string, status: string) => {
    try {
      await fetch(`/api/consulting/submissions/${id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      setSubmissions(prev => prev.map(s => s.id === id ? { ...s, status } : s))
    } catch (err) {
      console.error('Status update failed:', err)
    }
  }

  const deleteSubmission = async (id: string) => {
    if (!confirm('この申込を削除しますか？')) return
    try {
      await fetch(`/api/consulting/submissions/${id}`, { method: 'DELETE' })
      setSubmissions(prev => prev.filter(s => s.id !== id))
    } catch (err) {
      console.error('Delete failed:', err)
    }
  }

  const filtered = submissions.filter(s => {
    if (filterStatus !== 'all' && s.status !== filterStatus) return false
    if (search) {
      const q = search.toLowerCase()
      return s.company.toLowerCase().includes(q) || s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q)
    }
    return true
  })

  const statusCounts = submissions.reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] || 0) + 1
    return acc
  }, {})

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-4">
          <button onClick={() => navigate('/')} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 transition-colors cursor-pointer">
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-3 flex-1">
            <div className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center">
              <Users size={16} className="text-white" />
            </div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Amazonコンサル管理</h1>
          </div>
          <button onClick={fetchSubmissions} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 transition-colors cursor-pointer">
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
            <p className="text-xs text-slate-500 mb-1">総申込数</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{submissions.length}</p>
          </div>
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
            <p className="text-xs text-slate-500 mb-1">新規</p>
            <p className="text-2xl font-bold text-blue-600">{statusCounts['new'] || 0}</p>
          </div>
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
            <p className="text-xs text-slate-500 mb-1">商談中</p>
            <p className="text-2xl font-bold text-purple-600">{(statusCounts['booked'] || 0) + (statusCounts['negotiating'] || 0)}</p>
          </div>
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
            <p className="text-xs text-slate-500 mb-1">成約</p>
            <p className="text-2xl font-bold text-emerald-600">{statusCounts['contracted'] || 0}</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="会社名・名前・メールで検索..."
              className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/40 focus:border-orange-500"
            />
          </div>
          <div className="flex gap-1.5 overflow-x-auto">
            <button
              onClick={() => setFilterStatus('all')}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${filterStatus === 'all' ? 'bg-orange-500 text-white' : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}
            >
              全て ({submissions.length})
            </button>
            {Object.entries(STATUS_MAP).map(([key, { label }]) => (
              <button
                key={key}
                onClick={() => setFilterStatus(key)}
                className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${filterStatus === key ? 'bg-orange-500 text-white' : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}
              >
                {label} ({statusCounts[key] || 0})
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        <div className="space-y-2">
          {loading && submissions.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-center py-20 text-slate-400">
              <Users size={40} className="mx-auto mb-3 opacity-50" />
              <p>申込がありません</p>
            </div>
          ) : (
            filtered.map(sub => {
              const st = STATUS_MAP[sub.status] || STATUS_MAP.new
              const expanded = expandedId === sub.id
              return (
                <div key={sub.id} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                  {/* Summary row */}
                  <div
                    className="flex items-center gap-4 p-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors"
                    onClick={() => setExpandedId(expanded ? null : sub.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-medium text-slate-900 dark:text-white text-sm">{sub.company}</span>
                        <span className="text-slate-500 text-xs">{sub.name}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${st.cls}`}>{st.label}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-400">
                        <span>{sub.email}</span>
                        {sub.revenue && <span>月商: {sub.revenue}</span>}
                        <span>{new Date(sub.submitted_at).toLocaleDateString('ja-JP')}</span>
                      </div>
                    </div>
                    <ChevronDown size={16} className={`text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                  </div>

                  {/* Expanded details */}
                  {expanded && (
                    <div className="border-t border-slate-200 dark:border-slate-700 px-4 py-4 bg-slate-50 dark:bg-slate-900/50">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                        <div>
                          <p className="text-xs text-slate-500 mb-1">商品カテゴリ</p>
                          <p className="text-sm text-slate-900 dark:text-white">{sub.category || '未入力'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 mb-1">商品URL</p>
                          {sub.product_url ? (
                            <a href={sub.product_url} target="_blank" rel="noopener noreferrer" className="text-sm text-orange-600 hover:underline flex items-center gap-1">
                              リンクを開く <ExternalLink size={12} />
                            </a>
                          ) : <p className="text-sm text-slate-400">未入力</p>}
                        </div>
                      </div>

                      {sub.challenges && sub.challenges.length > 0 && (
                        <div className="mb-4">
                          <p className="text-xs text-slate-500 mb-1.5">課題</p>
                          <div className="flex flex-wrap gap-1.5">
                            {sub.challenges.map((c, i) => (
                              <span key={i} className="text-xs px-2.5 py-1 rounded-full bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400">{c}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {sub.message && (
                        <div className="mb-4">
                          <p className="text-xs text-slate-500 mb-1">メッセージ</p>
                          <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{sub.message}</p>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex items-center gap-2 pt-3 border-t border-slate-200 dark:border-slate-700">
                        <select
                          value={sub.status}
                          onChange={e => updateStatus(sub.id, e.target.value)}
                          className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white cursor-pointer"
                        >
                          {Object.entries(STATUS_MAP).map(([key, { label }]) => (
                            <option key={key} value={key}>{label}</option>
                          ))}
                        </select>
                        <a
                          href={`mailto:${sub.email}`}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                        >
                          <Mail size={14} /> メール
                        </a>
                        <button
                          onClick={() => deleteSubmission(sub.id)}
                          className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-400 hover:text-red-500 transition-colors cursor-pointer ml-auto"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </main>
    </div>
  )
}
