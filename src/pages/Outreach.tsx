import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Search, Plus, Send, Mail, Trash2, RefreshCw, Globe, CheckSquare, Square, Users, X, FileText } from 'lucide-react'

interface Lead {
  id: string
  company_name: string
  seller_name: string | null
  amazon_url: string | null
  website_url: string | null
  email: string | null
  category: string | null
  estimated_revenue: string | null
  source: string
  status: string
  notes: string | null
  last_emailed_at: string | null
  email_count: number
  created_at: string
}

interface Template {
  id: string
  name: string
  subject: string
  body: string
  is_default: boolean
}

interface AmazonSeller {
  seller_name: string
  product_title: string
  product_url: string | null
  price: string
  category: string
}

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  new: { label: '新規', cls: 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' },
  contacted: { label: '送信済', cls: 'bg-yellow-50 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400' },
  replied: { label: '返信あり', cls: 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400' },
  meeting: { label: '面談予定', cls: 'bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400' },
  lost: { label: '対象外', cls: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400' },
}

type TabId = 'leads' | 'search' | 'templates'

export default function Outreach() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<TabId>('leads')
  const [leads, setLeads] = useState<Lead[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [_loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filterStatus, setFilterStatus] = useState('all')
  const [searchQ, setSearchQ] = useState('')

  // Search tab
  const [amazonKeyword, setAmazonKeyword] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<AmazonSeller[]>([])

  // Email extraction
  const [extractUrl, setExtractUrl] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [extractedEmails, setExtractedEmails] = useState<string[]>([])

  // Send modal
  const [showSendModal, setShowSendModal] = useState(false)
  const [sendTemplateId, setSendTemplateId] = useState('')
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<{ sent: number; total: number } | null>(null)

  // Add lead modal
  const [showAddModal, setShowAddModal] = useState(false)
  const [addForm, setAddForm] = useState({ company_name: '', email: '', website_url: '', category: '', amazon_url: '' })

  const fetchLeads = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/outreach/leads')
      if (res.ok) setLeads(await res.json())
    } catch {} finally { setLoading(false) }
  }, [])

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/outreach/templates')
      if (res.ok) {
        const data = await res.json()
        setTemplates(data)
        const def = data.find((t: Template) => t.is_default)
        if (def) setSendTemplateId(def.id)
      }
    } catch {}
  }, [])

  useEffect(() => { fetchLeads(); fetchTemplates() }, [fetchLeads, fetchTemplates])

  // Amazon検索
  const handleAmazonSearch = async () => {
    if (!amazonKeyword.trim()) return
    setSearching(true)
    setSearchResults([])
    try {
      const res = await fetch('/api/outreach/search-amazon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: amazonKeyword }),
      })
      if (res.ok) {
        const data = await res.json()
        setSearchResults(data.sellers || [])
      }
    } catch {} finally { setSearching(false) }
  }

  // メール抽出
  const handleExtractEmail = async () => {
    if (!extractUrl.trim()) return
    setExtracting(true)
    setExtractedEmails([])
    try {
      const res = await fetch('/api/outreach/extract-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: extractUrl }),
      })
      if (res.ok) {
        const data = await res.json()
        setExtractedEmails(data.emails || [])
      }
    } catch {} finally { setExtracting(false) }
  }

  // リード追加
  const handleAddLead = async () => {
    if (!addForm.company_name.trim()) return
    try {
      await fetch('/api/outreach/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addForm),
      })
      setShowAddModal(false)
      setAddForm({ company_name: '', email: '', website_url: '', category: '', amazon_url: '' })
      fetchLeads()
    } catch {}
  }

  // 検索結果からリードに追加
  const addSellerAsLead = async (seller: AmazonSeller) => {
    try {
      await fetch('/api/outreach/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: seller.seller_name,
          seller_name: seller.seller_name,
          amazon_url: seller.product_url,
          category: seller.category,
          source: 'amazon_search',
        }),
      })
      fetchLeads()
    } catch {}
  }

  // 一括メール送信
  const handleBulkSend = async () => {
    if (selected.size === 0 || !sendTemplateId) return
    setSending(true)
    setSendResult(null)
    try {
      const res = await fetch('/api/outreach/send-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_ids: [...selected], template_id: sendTemplateId }),
      })
      if (res.ok) {
        const data = await res.json()
        setSendResult(data)
        setSelected(new Set())
        fetchLeads()
      }
    } catch {} finally { setSending(false) }
  }

  // 削除
  const handleDelete = async (id: string) => {
    await fetch(`/api/outreach/leads/${id}`, { method: 'DELETE' })
    fetchLeads()
  }

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selected.size === filteredLeads.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filteredLeads.map(l => l.id)))
    }
  }

  const filteredLeads = leads.filter(l => {
    if (filterStatus !== 'all' && l.status !== filterStatus) return false
    if (searchQ) {
      const q = searchQ.toLowerCase()
      return l.company_name.toLowerCase().includes(q) || (l.email || '').toLowerCase().includes(q)
    }
    return true
  })

  const statusCounts = leads.reduce<Record<string, number>>((a, l) => { a[l.status] = (a[l.status] || 0) + 1; return a }, {})

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-4">
          <button onClick={() => navigate('/')} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 cursor-pointer"><ArrowLeft size={20} /></button>
          <div className="flex items-center gap-3 flex-1">
            <div className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center">
              <Send size={16} className="text-white" />
            </div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-white">セラー発掘 & 自動メール</h1>
          </div>
        </div>
        {/* Tabs */}
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex gap-1 -mb-px">
            {([['leads', 'リード一覧'], ['search', 'Amazon検索'], ['templates', 'テンプレート']] as [TabId, string][]).map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors cursor-pointer ${tab === id ? 'border-orange-500 text-orange-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
              >{label}</button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6">
        {/* ── リード一覧 ── */}
        {tab === 'leads' && (
          <div>
            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                <p className="text-xs text-slate-500 mb-1">総リード</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">{leads.length}</p>
              </div>
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                <p className="text-xs text-slate-500 mb-1">メール済</p>
                <p className="text-2xl font-bold text-yellow-600">{statusCounts['contacted'] || 0}</p>
              </div>
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                <p className="text-xs text-slate-500 mb-1">返信あり</p>
                <p className="text-2xl font-bold text-green-600">{statusCounts['replied'] || 0}</p>
              </div>
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                <p className="text-xs text-slate-500 mb-1">メール有リード</p>
                <p className="text-2xl font-bold text-orange-600">{leads.filter(l => l.email).length}</p>
              </div>
            </div>

            {/* Actions bar */}
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="text" value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="検索..."
                  className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500/40" />
              </div>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                className="px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white cursor-pointer">
                <option value="all">全て ({leads.length})</option>
                {Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label} ({statusCounts[k] || 0})</option>)}
              </select>
              <button onClick={() => setShowAddModal(true)} className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 cursor-pointer">
                <Plus size={14} /> 手動追加
              </button>
              {selected.size > 0 && (
                <button onClick={() => setShowSendModal(true)} className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium cursor-pointer">
                  <Mail size={14} /> {selected.size}件にメール送信
                </button>
              )}
            </div>

            {/* Lead list */}
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
              {/* Header row */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 text-xs font-medium text-slate-500">
                <button onClick={toggleSelectAll} className="cursor-pointer">
                  {selected.size === filteredLeads.length && filteredLeads.length > 0 ? <CheckSquare size={16} className="text-orange-500" /> : <Square size={16} />}
                </button>
                <span className="flex-1">会社名 / セラー名</span>
                <span className="w-48 hidden sm:block">メール</span>
                <span className="w-20">ステータス</span>
                <span className="w-16">送信数</span>
                <span className="w-8"></span>
              </div>

              {filteredLeads.length === 0 ? (
                <div className="text-center py-16 text-slate-400">
                  <Users size={32} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm">リードがありません。「Amazon検索」タブからセラーを発掘してください</p>
                </div>
              ) : filteredLeads.map(lead => {
                const st = STATUS_MAP[lead.status] || STATUS_MAP.new
                return (
                  <div key={lead.id} className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                    <button onClick={() => toggleSelect(lead.id)} className="cursor-pointer">
                      {selected.has(lead.id) ? <CheckSquare size={16} className="text-orange-500" /> : <Square size={16} className="text-slate-300" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{lead.company_name}</p>
                      <p className="text-xs text-slate-400 truncate">{lead.category || lead.seller_name || ''}</p>
                    </div>
                    <div className="w-48 hidden sm:block">
                      {lead.email ? (
                        <p className="text-xs text-slate-600 dark:text-slate-400 truncate">{lead.email}</p>
                      ) : (
                        <span className="text-xs text-slate-300">未取得</span>
                      )}
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium w-20 text-center ${st.cls}`}>{st.label}</span>
                    <span className="text-xs text-slate-400 w-16 text-center">{lead.email_count}</span>
                    <button onClick={() => handleDelete(lead.id)} className="p-1 rounded hover:bg-red-50 text-slate-300 hover:text-red-500 cursor-pointer"><Trash2 size={14} /></button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Amazon検索 ── */}
        {tab === 'search' && (
          <div className="space-y-6">
            {/* Amazon keyword search */}
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
              <h3 className="font-medium text-slate-900 dark:text-white mb-3 flex items-center gap-2">
                <Search size={16} /> Amazonセラー検索
              </h3>
              <div className="flex gap-2 mb-2">
                <input type="text" value={amazonKeyword} onChange={e => setAmazonKeyword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAmazonSearch()}
                  placeholder="キーワード（例: プロテイン、ヨガマット）"
                  className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500/40" />
                <button onClick={handleAmazonSearch} disabled={searching}
                  className="px-5 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium disabled:opacity-50 cursor-pointer flex items-center gap-1.5">
                  {searching ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
                  検索
                </button>
              </div>
              <p className="text-xs text-slate-400">Amazon.co.jpから販売者/ブランドを抽出します</p>
            </div>

            {/* Search results */}
            {searchResults.length > 0 && (
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
                <h3 className="font-medium text-slate-900 dark:text-white mb-3">{searchResults.length}件のセラーが見つかりました</h3>
                <div className="space-y-2">
                  {searchResults.map((s, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-lg border border-slate-100 dark:border-slate-700">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 dark:text-white">{s.seller_name}</p>
                        <p className="text-xs text-slate-400 truncate">{s.product_title}</p>
                        {s.price && <span className="text-xs text-orange-600">{s.price}</span>}
                      </div>
                      <button onClick={() => addSellerAsLead(s)}
                        className="px-3 py-1.5 rounded-lg bg-orange-50 text-orange-600 text-xs font-medium hover:bg-orange-100 cursor-pointer whitespace-nowrap">
                        <Plus size={12} className="inline mr-1" />リードに追加
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Email extraction */}
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
              <h3 className="font-medium text-slate-900 dark:text-white mb-3 flex items-center gap-2">
                <Globe size={16} /> Webサイトからメール抽出
              </h3>
              <div className="flex gap-2 mb-2">
                <input type="url" value={extractUrl} onChange={e => setExtractUrl(e.target.value)}
                  placeholder="https://example.co.jp"
                  className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500/40" />
                <button onClick={handleExtractEmail} disabled={extracting}
                  className="px-5 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium disabled:opacity-50 cursor-pointer">
                  {extracting ? '抽出中...' : 'メール抽出'}
                </button>
              </div>
              {extractedEmails.length > 0 && (
                <div className="mt-3 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                  <p className="text-xs font-medium text-green-700 dark:text-green-400 mb-1">{extractedEmails.length}件のメールを発見</p>
                  {extractedEmails.map((e, i) => (
                    <span key={i} className="inline-block text-xs bg-white dark:bg-slate-800 px-2 py-1 rounded mr-1.5 mb-1 text-slate-700 dark:text-slate-300">{e}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── テンプレート ── */}
        {tab === 'templates' && (
          <div className="space-y-4">
            {templates.map(t => (
              <div key={t.id} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-2">
                  <FileText size={16} className="text-orange-500" />
                  <h3 className="font-medium text-slate-900 dark:text-white">{t.name}</h3>
                  {t.is_default && <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-50 text-orange-600 font-medium">デフォルト</span>}
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-400 mb-1"><span className="text-xs text-slate-400">件名: </span>{t.subject}</p>
                <pre className="text-xs text-slate-500 dark:text-slate-400 whitespace-pre-wrap bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3 max-h-48 overflow-y-auto mt-2">{t.body}</pre>
                <p className="text-xs text-slate-400 mt-2">変数: {'{company_name}'}, {'{category}'}, {'{seller_name}'}, {'{estimated_revenue}'}</p>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Add Lead Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
              <h3 className="font-semibold text-slate-900 dark:text-white">リードを追加</h3>
              <button onClick={() => setShowAddModal(false)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 cursor-pointer"><X size={18} /></button>
            </div>
            <div className="px-6 py-5 space-y-3">
              {[
                { key: 'company_name', label: '会社名 *', placeholder: '株式会社〇〇' },
                { key: 'email', label: 'メールアドレス', placeholder: 'info@example.co.jp' },
                { key: 'website_url', label: 'Webサイト', placeholder: 'https://example.co.jp' },
                { key: 'amazon_url', label: 'Amazon商品URL', placeholder: 'https://amazon.co.jp/dp/...' },
                { key: 'category', label: 'カテゴリ', placeholder: 'サプリメント' },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">{f.label}</label>
                  <input type="text" value={(addForm as Record<string, string>)[f.key]} onChange={e => setAddForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                    placeholder={f.placeholder} className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500/40" />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700">
              <button onClick={() => setShowAddModal(false)} className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-600 cursor-pointer">キャンセル</button>
              <button onClick={handleAddLead} disabled={!addForm.company_name.trim()} className="px-5 py-2 rounded-lg bg-orange-500 text-white text-sm font-medium disabled:opacity-40 cursor-pointer">追加</button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Send Modal */}
      {showSendModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
              <h3 className="font-semibold text-slate-900 dark:text-white">一括メール送信</h3>
              <button onClick={() => { setShowSendModal(false); setSendResult(null) }} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 cursor-pointer"><X size={18} /></button>
            </div>
            <div className="px-6 py-5">
              {sendResult ? (
                <div className="text-center py-4">
                  <Mail size={32} className="mx-auto text-orange-500 mb-3" />
                  <p className="text-lg font-semibold text-slate-900 dark:text-white mb-1">{sendResult.sent} / {sendResult.total} 件送信完了</p>
                  <p className="text-sm text-slate-500">メールアドレスがないリードはスキップされました</p>
                </div>
              ) : (
                <>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">{selected.size}件のリードにメールを送信します</p>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">テンプレート</label>
                    <select value={sendTemplateId} onChange={e => setSendTemplateId(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white cursor-pointer">
                      {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                </>
              )}
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700">
              <button onClick={() => { setShowSendModal(false); setSendResult(null) }} className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-600 cursor-pointer">閉じる</button>
              {!sendResult && (
                <button onClick={handleBulkSend} disabled={sending || !sendTemplateId}
                  className="px-5 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium disabled:opacity-50 cursor-pointer flex items-center gap-1.5">
                  {sending ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                  {sending ? '送信中...' : '送信する'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
