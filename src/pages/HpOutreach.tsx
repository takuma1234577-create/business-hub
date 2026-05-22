import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Search, MapPin, Globe, RefreshCw, Plus, Mail,
  ExternalLink, Send, FileCode, X, CheckCircle,
  Phone, Building2, Sparkles, Copy, Check, ChevronDown
} from 'lucide-react'

// Instagram icon (not in lucide-react)
const InstagramIcon = ({ size = 16, className = '' }: { size?: number; className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect width="20" height="20" x="2" y="2" rx="5" ry="5"/><circle cx="12" cy="12" r="5"/><circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none"/>
  </svg>
)

interface Business {
  place_id: string
  name: string
  address: string
  phone: string
  website: string
  google_maps_url: string
  types: string[]
  has_website: boolean
  rating: number
  user_ratings_total: number
  business_status: string
  editorial_summary: string
  reviews: { text: string; rating: number }[]
  photos: { url: string; name: string }[]
  hours: string[]
}

interface Analysis {
  business_type: string
  business_description: string
  strengths: string
  target_audience: string
  lp_keywords: string
}

interface Contact {
  emails?: string[]
  instagrams?: string[]
  twitters?: string[]
  facebooks?: string[]
}

interface SheetLead {
  row_index: number
  name: string
  business_type: string
  business_description: string
  email: string
  instagram: string
  phone: string
  address: string
  google_maps_url: string
  lp_url: string
  status: string
  place_id: string
}

type TabId = 'search' | 'leads' | 'lp' | 'dm'

interface DmLead {
  id: string
  name: string
  business_type: string
  business_description: string
  instagram: string
  address: string
  phone: string
  google_maps_url: string
  lp_url: string
  status: string
  proposal_body: string | null
}

interface OutreachStats {
  total: number
  no_contact: number
  has_email: number
  has_instagram: number
  email_sent: number
  dm_sent: number
  lp_created: number
  new_leads: number
}

const CATEGORIES = [
  '飲食店', 'カフェ', 'ラーメン', '居酒屋', 'レストラン',
  'フィットネスジム', 'ヨガスタジオ', 'パーソナルジム',
  '美容院', 'ネイルサロン', 'エステサロン', 'マッサージ',
  'クリニック', '歯科医院', '整骨院', '整体院',
  '学習塾', '英会話教室', 'ピアノ教室',
  '花屋', 'ペットショップ', '写真スタジオ',
  '不動産', '工務店', 'リフォーム',
]

const STATUS_COLORS: Record<string, string> = {
  '未対応': 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  'LP作成済': 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
  'メール送信済': 'bg-yellow-50 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400',
  'Instagram送信済': 'bg-pink-50 text-pink-600 dark:bg-pink-900/30 dark:text-pink-400',
  '返信あり': 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400',
  '成約': 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  '対象外': 'bg-red-50 text-red-500 dark:bg-red-900/30 dark:text-red-400',
}

export default function HpOutreach() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<TabId>('search')

  // Search
  const [area, setArea] = useState('')
  const [category, setCategory] = useState('')
  const [keyword, setKeyword] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<Business[]>([])
  const [showOnlyNoWebsite, setShowOnlyNoWebsite] = useState(true)
  const [noWebsiteCount, setNoWebsiteCount] = useState(0)

  // Analysis
  const [analyzingId, setAnalyzingId] = useState<string | null>(null)
  const [analyses, setAnalyses] = useState<Record<string, { analysis: Analysis; contact: Contact }>>({})

  // Add to sheet
  const [addingId, setAddingId] = useState<string | null>(null)
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set())

  // Sheet leads
  const [leads, setLeads] = useState<SheetLead[]>([])
  const [loadingLeads, setLoadingLeads] = useState(false)

  // LP Generation
  const [generatingLp, setGeneratingLp] = useState<number | null>(null)
  const [lpPreview, setLpPreview] = useState<{ html: string; name: string } | null>(null)

  // Proposal
  const [sendingProposal, _setSendingProposal] = useState<number | null>(null); void sendingProposal; void _setSendingProposal
  const [proposalPreview, setProposalPreview] = useState<{ subject: string; body: string; lead: SheetLead } | null>(null)
  const [copied, setCopied] = useState(false)

  // Expanded detail
  const [expandedBiz, setExpandedBiz] = useState<string | null>(null)

  // DM tab
  const [dmLeads, setDmLeads] = useState<DmLead[]>([])
  const [loadingDm, setLoadingDm] = useState(false)
  const [enriching, setEnriching] = useState(false)
  const [enrichResult, setEnrichResult] = useState<{ processed: number; emails_found: number; instagrams_found: number } | null>(null)
  const [generatingDm, setGeneratingDm] = useState<string | null>(null)
  const [dmTexts, setDmTexts] = useState<Record<string, string>>({})
  const [dmCopied, setDmCopied] = useState<string | null>(null)
  const [stats, setStats] = useState<OutreachStats | null>(null)

  const fetchLeads = useCallback(async () => {
    setLoadingLeads(true)
    try {
      const res = await fetch('/api/hp-outreach/sheet')
      if (res.ok) setLeads(await res.json())
    } catch {} finally { setLoadingLeads(false) }
  }, [])

  const fetchDmQueue = useCallback(async () => {
    setLoadingDm(true)
    try {
      const res = await fetch('/api/hp-outreach/dm-queue')
      if (res.ok) {
        const data = await res.json()
        setDmLeads(data)
        // Pre-populate DM texts from pipeline-generated proposal_body
        const preTexts: Record<string, string> = {}
        for (const l of data) {
          if (l.proposal_body && l.status === 'dm_ready') preTexts[l.id] = l.proposal_body
        }
        if (Object.keys(preTexts).length > 0) setDmTexts(prev => ({ ...prev, ...preTexts }))
      }
    } catch {} finally { setLoadingDm(false) }
  }, [])

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/hp-outreach/outreach-stats')
      if (res.ok) setStats(await res.json())
    } catch {}
  }, [])

  const handleEnrichContacts = async () => {
    setEnriching(true)
    setEnrichResult(null)
    try {
      const res = await fetch('/api/hp-outreach/enrich-contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 15 }),
      })
      if (res.ok) {
        const data = await res.json()
        setEnrichResult(data.results)
        fetchDmQueue()
        fetchStats()
      }
    } catch {} finally { setEnriching(false) }
  }

  const handleGenerateDm = async (lead: DmLead) => {
    setGeneratingDm(lead.id)
    try {
      const res = await fetch('/api/hp-outreach/generate-dm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead }),
      })
      if (res.ok) {
        const data = await res.json()
        setDmTexts(prev => ({ ...prev, [lead.id]: data.dm_text }))
      }
    } catch {} finally { setGeneratingDm(null) }
  }

  const handleCopyDm = async (leadId: string, text: string) => {
    await navigator.clipboard.writeText(text)
    setDmCopied(leadId)
    setTimeout(() => setDmCopied(null), 2000)
  }

  // ワンタップ: コピー → Instagram DM画面を開く
  const handleOneTapDm = async (lead: DmLead) => {
    const text = dmTexts[lead.id]
    if (!text) return
    await navigator.clipboard.writeText(text)
    setDmCopied(lead.id)
    setTimeout(() => setDmCopied(null), 3000)
    // ig.me/m/USERNAME でInstagramアプリのDMスレッドを直接開く
    window.open(`https://ig.me/m/${lead.instagram}`, '_blank')
  }

  const handleMarkDmSent = async (leadId: string) => {
    await fetch('/api/hp-outreach/mark-dm-sent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lead_id: leadId }),
    })
    setDmLeads(prev => prev.filter(l => l.id !== leadId))
    fetchStats()
  }

  useEffect(() => { if (tab === 'leads' || tab === 'lp') fetchLeads() }, [tab, fetchLeads])
  useEffect(() => { if (tab === 'dm') { fetchDmQueue(); fetchStats() } }, [tab, fetchDmQueue, fetchStats])

  // Google Maps 検索
  const handleSearch = async () => {
    if (!area.trim()) return
    setSearching(true)
    setResults([])
    try {
      const res = await fetch('/api/hp-outreach/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ area, category, keyword }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || '検索に失敗しました')
      }
      const data = await res.json()
      setResults(data.businesses || [])
      setNoWebsiteCount(data.no_website_count || 0)
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : '検索エラー')
    } finally { setSearching(false) }
  }

  // AI分析
  const handleAnalyze = async (biz: Business) => {
    setAnalyzingId(biz.place_id)
    try {
      const res = await fetch('/api/hp-outreach/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ place: biz }),
      })
      if (res.ok) {
        const data = await res.json()
        setAnalyses(prev => ({ ...prev, [biz.place_id]: data }))
      }
    } catch {} finally { setAnalyzingId(null) }
  }

  // スプレッドシートに追加
  const handleAddToSheet = async (biz: Business) => {
    setAddingId(biz.place_id)
    const a = analyses[biz.place_id]
    try {
      const res = await fetch('/api/hp-outreach/add-to-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business: {
            name: biz.name,
            address: biz.address,
            phone: biz.phone,
            google_maps_url: biz.google_maps_url,
            business_type: a?.analysis?.business_type || biz.types[0] || '',
            business_description: a?.analysis?.business_description || biz.editorial_summary || '',
            email: a?.contact?.emails?.[0] || '',
            instagram: a?.contact?.instagrams?.[0] || '',
          },
        }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.added) {
          setAddedIds(prev => new Set([...prev, biz.place_id]))
        } else {
          alert(data.message || '追加済み')
        }
      }
    } catch {} finally { setAddingId(null) }
  }

  // LP生成
  const [currentLpLead, setCurrentLpLead] = useState<SheetLead | null>(null)
  const handleGenerateLp = async (lead: SheetLead) => {
    setGeneratingLp(lead.row_index)
    setCurrentLpLead(lead)
    try {
      const res = await fetch('/api/hp-outreach/generate-lp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead }),
      })
      if (res.ok) {
        const data = await res.json()
        setLpPreview(data)
      }
    } catch {} finally { setGeneratingLp(null) }
  }

  // LP公開
  const [publishing, setPublishing] = useState(false)
  const handlePublishLp = async () => {
    if (!lpPreview || !currentLpLead) return
    setPublishing(true)
    try {
      const res = await fetch('/api/hp-outreach/publish-lp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead: currentLpLead, html: lpPreview.html }),
      })
      if (res.ok) {
        const data = await res.json()
        alert(`LP公開完了!\nURL: ${window.location.origin}${data.lp_url}`)
        // リード一覧を更新
        fetchLeads()
      }
    } catch {} finally { setPublishing(false) }
  }

  // 営業メール送信（プラン付き）
  const [sendingSalesEmail, setSendingSalesEmail] = useState<number | null>(null)
  const handleSendSalesEmail = async (lead: SheetLead) => {
    if (!lead.email) { alert('メールアドレスがありません'); return }
    if (!lead.lp_url) { alert('先にLPを生成・公開してください'); return }
    if (!confirm(`${lead.name} (${lead.email}) に営業メール（プラン提案付き）を送信しますか？`)) return
    setSendingSalesEmail(lead.row_index)
    try {
      const res = await fetch('/api/hp-outreach/send-sales-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead, lp_url: lead.lp_url }),
      })
      if (res.ok) {
        alert('営業メール送信完了!')
        fetchLeads()
      } else {
        const err = await res.json()
        alert('送信エラー: ' + (err.error || ''))
      }
    } catch {} finally { setSendingSalesEmail(null) }
  }

  // 旧営業メール生成は不要（send-sales-emailに統合済み）

  // メール実送信
  const handleActualSend = async () => {
    if (!proposalPreview) return
    const { lead } = proposalPreview
    if (!lead.email) {
      alert('メールアドレスがありません')
      return
    }
    try {
      const res = await fetch('/api/hp-outreach/send-proposal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead, lp_url: lead.lp_url, message_type: 'email' }),
      })
      if (res.ok) {
        alert('メール送信完了!')
        setProposalPreview(null)
        fetchLeads()
      }
    } catch (err) {
      alert('送信エラー')
    }
  }

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const displayedResults = showOnlyNoWebsite ? results.filter(b => !b.has_website) : results

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      {/* Header */}
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-4">
          <button onClick={() => navigate('/')} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 cursor-pointer"><ArrowLeft size={20} /></button>
          <div className="flex items-center gap-3 flex-1">
            <div className="w-8 h-8 rounded-lg bg-cyan-500 flex items-center justify-center">
              <Globe size={16} className="text-white" />
            </div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-white">HP制作 自動営業</h1>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex gap-1 -mb-px">
            {([
              ['search', 'Google Maps検索'],
              ['leads', 'リード一覧'],
              ['lp', 'LP生成 & 営業'],
              ['dm', 'Instagram DM'],
            ] as [TabId, string][]).map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors cursor-pointer ${tab === id ? 'border-cyan-500 text-cyan-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
              >{label}</button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6">

        {/* ══ Google Maps 検索タブ ══ */}
        {tab === 'search' && (
          <div className="space-y-5">
            {/* Search Form */}
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
              <h3 className="font-medium text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                <MapPin size={16} className="text-cyan-500" /> Google Maps 店舗検索
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">エリア *</label>
                  <input type="text" value={area} onChange={e => setArea(e.target.value)}
                    placeholder="例: 渋谷区、新宿、大阪市北区"
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/40" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">業種</label>
                  <div className="relative">
                    <select value={category} onChange={e => setCategory(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/40 appearance-none cursor-pointer">
                      <option value="">全て</option>
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">追加キーワード</label>
                  <input type="text" value={keyword} onChange={e => setKeyword(e.target.value)}
                    placeholder="例: 個人経営、人気"
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/40" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={handleSearch} disabled={searching || !area.trim()}
                  className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-600 text-white text-sm font-medium disabled:opacity-50 cursor-pointer">
                  {searching ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
                  {searching ? '検索中...' : '検索'}
                </button>
                <p className="text-xs text-slate-400">Google Mapsからホームページを持っていない店舗を発掘します</p>
              </div>
            </div>

            {/* Results */}
            {results.length > 0 && (
              <div className="space-y-3">
                {/* Stats */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      <span className="font-semibold text-slate-900 dark:text-white">{results.length}</span>件の店舗が見つかりました
                      <span className="ml-2 text-cyan-600 font-medium">（HP無し: {noWebsiteCount}件）</span>
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
                    <input type="checkbox" checked={showOnlyNoWebsite} onChange={e => setShowOnlyNoWebsite(e.target.checked)}
                      className="rounded border-slate-300 text-cyan-500 focus:ring-cyan-500" />
                    HP無しのみ表示
                  </label>
                </div>

                {/* Business list */}
                {displayedResults.map(biz => {
                  const a = analyses[biz.place_id]
                  const isExpanded = expandedBiz === biz.place_id
                  const isAdded = addedIds.has(biz.place_id)

                  return (
                    <div key={biz.place_id} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                      {/* Photo strip */}
                      {biz.photos && biz.photos.length > 0 && (
                        <div className="flex gap-0.5 h-24 overflow-hidden">
                          {biz.photos.slice(0, 3).map((p, i) => (
                            <img key={i} src={p.url} alt="" className="flex-1 object-cover min-w-0" loading="lazy" />
                          ))}
                        </div>
                      )}
                      {/* Main row */}
                      <div className="flex items-start gap-3 p-4 cursor-pointer" onClick={() => setExpandedBiz(isExpanded ? null : biz.place_id)}>
                        <div className={`mt-0.5 w-3 h-3 rounded-full shrink-0 ${biz.has_website ? 'bg-green-400' : 'bg-red-400'}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{biz.name}</h4>
                            {!biz.has_website && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-500 dark:bg-red-900/30 font-medium">HP無し</span>
                            )}
                            {biz.has_website && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-600 dark:bg-green-900/30 font-medium">HP有り</span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">{biz.address}</p>
                          <div className="flex items-center gap-3 mt-1">
                            {biz.rating > 0 && (
                              <span className="text-xs text-yellow-600">{'★'.repeat(Math.round(biz.rating))} {biz.rating} ({biz.user_ratings_total})</span>
                            )}
                            {biz.phone && <span className="text-xs text-slate-400 flex items-center gap-1"><Phone size={10} />{biz.phone}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {!biz.has_website && !a && (
                            <button onClick={e => { e.stopPropagation(); handleAnalyze(biz) }}
                              disabled={analyzingId === biz.place_id}
                              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-purple-50 text-purple-600 text-xs font-medium hover:bg-purple-100 disabled:opacity-50 cursor-pointer dark:bg-purple-900/30 dark:text-purple-400">
                              {analyzingId === biz.place_id ? <RefreshCw size={12} className="animate-spin" /> : <Sparkles size={12} />}
                              AI分析
                            </button>
                          )}
                          {!biz.has_website && a && !isAdded && (
                            <button onClick={e => { e.stopPropagation(); handleAddToSheet(biz) }}
                              disabled={addingId === biz.place_id}
                              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cyan-50 text-cyan-600 text-xs font-medium hover:bg-cyan-100 disabled:opacity-50 cursor-pointer dark:bg-cyan-900/30 dark:text-cyan-400">
                              {addingId === biz.place_id ? <RefreshCw size={12} className="animate-spin" /> : <Plus size={12} />}
                              リストに追加
                            </button>
                          )}
                          {isAdded && (
                            <span className="flex items-center gap-1 px-3 py-1.5 text-xs text-green-600">
                              <CheckCircle size={12} /> 追加済み
                            </span>
                          )}
                          <a href={biz.google_maps_url} target="_blank" rel="noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400">
                            <ExternalLink size={14} />
                          </a>
                        </div>
                      </div>

                      {/* Expanded details */}
                      {isExpanded && (
                        <div className="border-t border-slate-100 dark:border-slate-700 px-4 py-3 bg-slate-50/50 dark:bg-slate-900/30">
                          {biz.editorial_summary && (
                            <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">{biz.editorial_summary}</p>
                          )}
                          {biz.website && (
                            <p className="text-xs text-slate-500 mb-2">
                              <Globe size={10} className="inline mr-1" />
                              <a href={biz.website} target="_blank" rel="noreferrer" className="text-cyan-600 underline">{biz.website}</a>
                            </p>
                          )}
                          {biz.reviews.length > 0 && (
                            <div className="mt-2">
                              <p className="text-[10px] font-medium text-slate-400 uppercase mb-1">レビュー抜粋</p>
                              {biz.reviews.map((r, i) => (
                                <p key={i} className="text-xs text-slate-500 dark:text-slate-400 mb-1 pl-2 border-l-2 border-slate-200 dark:border-slate-700">
                                  {'★'.repeat(r.rating)} {r.text?.slice(0, 100)}{r.text?.length > 100 ? '...' : ''}
                                </p>
                              ))}
                            </div>
                          )}

                          {/* AI Analysis Results */}
                          {a && (
                            <div className="mt-3 p-3 rounded-lg bg-purple-50/50 dark:bg-purple-900/10 border border-purple-100 dark:border-purple-900/30">
                              <p className="text-xs font-semibold text-purple-700 dark:text-purple-400 mb-2 flex items-center gap-1">
                                <Sparkles size={12} /> AI分析結果
                              </p>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                                <div>
                                  <span className="text-slate-400">業種:</span>
                                  <span className="ml-1 text-slate-700 dark:text-slate-300">{a.analysis.business_type}</span>
                                </div>
                                <div>
                                  <span className="text-slate-400">ターゲット:</span>
                                  <span className="ml-1 text-slate-700 dark:text-slate-300">{a.analysis.target_audience}</span>
                                </div>
                              </div>
                              <div className="mt-2">
                                <span className="text-[10px] text-slate-400">ビジネス概要:</span>
                                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">{a.analysis.business_description}</p>
                              </div>
                              <div className="mt-2">
                                <span className="text-[10px] text-slate-400">強み:</span>
                                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">{a.analysis.strengths}</p>
                              </div>

                              {/* Contact info */}
                              {a.contact && (a.contact.emails?.length || a.contact.instagrams?.length) ? (
                                <div className="mt-2 pt-2 border-t border-purple-100 dark:border-purple-900/30">
                                  <p className="text-[10px] text-slate-400 mb-1">連絡先:</p>
                                  {a.contact.emails?.map((e, i) => (
                                    <span key={i} className="inline-flex items-center gap-1 text-xs bg-white dark:bg-slate-800 px-2 py-0.5 rounded mr-1 mb-1 text-slate-700 dark:text-slate-300">
                                      <Mail size={10} /> {e}
                                    </span>
                                  ))}
                                  {a.contact.instagrams?.map((ig, i) => (
                                    <span key={i} className="inline-flex items-center gap-1 text-xs bg-white dark:bg-slate-800 px-2 py-0.5 rounded mr-1 mb-1 text-pink-600">
                                      <InstagramIcon size={10} /> @{ig}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ══ リード一覧タブ ══ */}
        {tab === 'leads' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1">
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                  <p className="text-xs text-slate-500 mb-1">総リード</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-white">{leads.length}</p>
                </div>
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                  <p className="text-xs text-slate-500 mb-1">メール有</p>
                  <p className="text-2xl font-bold text-cyan-600">{leads.filter(l => l.email).length}</p>
                </div>
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                  <p className="text-xs text-slate-500 mb-1">Instagram有</p>
                  <p className="text-2xl font-bold text-pink-600">{leads.filter(l => l.instagram).length}</p>
                </div>
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                  <p className="text-xs text-slate-500 mb-1">LP作成済</p>
                  <p className="text-2xl font-bold text-blue-600">{leads.filter(l => l.lp_url).length}</p>
                </div>
              </div>
            </div>

            <div className="flex justify-end mb-3">
              <button onClick={fetchLeads} disabled={loadingLeads}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
                <RefreshCw size={14} className={loadingLeads ? 'animate-spin' : ''} />
                更新
              </button>
            </div>

            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 text-xs font-medium text-slate-500">
                <span className="w-48">店舗名</span>
                <span className="w-24">業種</span>
                <span className="flex-1 hidden md:block">ビジネス内容</span>
                <span className="w-36">連絡先</span>
                <span className="w-20">ステータス</span>
              </div>

              {leads.length === 0 ? (
                <div className="text-center py-16 text-slate-400">
                  <Building2 size={32} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm">リードがありません。Google Maps検索タブから店舗を追加してください</p>
                </div>
              ) : leads.map(lead => (
                <div key={lead.row_index} className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                  <div className="w-48 min-w-0">
                    <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{lead.name}</p>
                    <p className="text-[10px] text-slate-400 truncate">{lead.address}</p>
                  </div>
                  <span className="w-24 text-xs text-slate-600 dark:text-slate-400 truncate">{lead.business_type}</span>
                  <p className="flex-1 text-xs text-slate-500 dark:text-slate-400 truncate hidden md:block">{lead.business_description?.slice(0, 60)}...</p>
                  <div className="w-36 min-w-0">
                    {lead.email && <p className="text-[10px] text-slate-600 dark:text-slate-400 truncate flex items-center gap-0.5"><Mail size={9} />{lead.email}</p>}
                    {lead.instagram && <p className="text-[10px] text-pink-500 truncate flex items-center gap-0.5"><InstagramIcon size={9} />{lead.instagram}</p>}
                    {!lead.email && !lead.instagram && <span className="text-[10px] text-slate-300">未取得</span>}
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium w-20 text-center whitespace-nowrap ${STATUS_COLORS[lead.status] || STATUS_COLORS['未対応']}`}>
                    {lead.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══ LP生成 & 営業タブ ══ */}
        {tab === 'lp' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button onClick={fetchLeads} disabled={loadingLeads}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
                <RefreshCw size={14} className={loadingLeads ? 'animate-spin' : ''} />
                更新
              </button>
            </div>

            {leads.length === 0 ? (
              <div className="text-center py-16 text-slate-400 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                <Building2 size={32} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">リードがありません</p>
              </div>
            ) : leads.map(lead => (
              <div key={lead.row_index} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{lead.name}</h4>
                    <p className="text-xs text-slate-400 mt-0.5">{lead.business_type} | {lead.address}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">{lead.business_description}</p>
                    <div className="flex items-center gap-3 mt-2">
                      {lead.email && <span className="text-xs text-slate-500 flex items-center gap-1"><Mail size={10} />{lead.email}</span>}
                      {lead.instagram && <span className="text-xs text-pink-500 flex items-center gap-1"><InstagramIcon size={10} />{lead.instagram}</span>}
                      {lead.phone && <span className="text-xs text-slate-400 flex items-center gap-1"><Phone size={10} />{lead.phone}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[lead.status] || STATUS_COLORS['未対応']}`}>
                      {lead.status}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 flex-wrap">
                  {/* Step 1: LP生成 */}
                  <button onClick={() => handleGenerateLp(lead)}
                    disabled={generatingLp === lead.row_index}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-cyan-50 text-cyan-600 text-xs font-medium hover:bg-cyan-100 disabled:opacity-50 cursor-pointer dark:bg-cyan-900/30 dark:text-cyan-400">
                    {generatingLp === lead.row_index ? <RefreshCw size={12} className="animate-spin" /> : <FileCode size={12} />}
                    {lead.lp_url ? 'LP再生成' : 'LP生成'}
                  </button>
                  {/* Step 2: 営業メール送信（LP公開済みの場合） */}
                  {lead.lp_url && lead.email && (
                    <button onClick={() => handleSendSalesEmail(lead)}
                      disabled={sendingSalesEmail === lead.row_index}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-orange-500 text-white text-xs font-medium hover:bg-orange-600 disabled:opacity-50 cursor-pointer">
                      {sendingSalesEmail === lead.row_index ? <RefreshCw size={12} className="animate-spin" /> : <Send size={12} />}
                      営業メール送信
                    </button>
                  )}
                  {/* LP公開済みならURLを表示 */}
                  {lead.lp_url && (
                    <a href={lead.lp_url} target="_blank" rel="noreferrer"
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-green-50 text-green-600 text-xs font-medium no-underline dark:bg-green-900/30 dark:text-green-400">
                      <ExternalLink size={12} /> LP公開中
                    </a>
                  )}
                  {lead.google_maps_url && (
                    <a href={lead.google_maps_url} target="_blank" rel="noreferrer"
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 no-underline">
                      <MapPin size={12} /> Maps
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {/* ══ Instagram DM タブ ══ */}
        {tab === 'dm' && (
          <div className="space-y-5">
            {/* Stats */}
            {stats && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                  <p className="text-xs text-slate-500 mb-1">全リード</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.total}</p>
                </div>
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                  <p className="text-xs text-slate-500 mb-1">連絡先なし</p>
                  <p className="text-2xl font-bold text-red-500">{stats.no_contact}</p>
                </div>
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                  <p className="text-xs text-slate-500 mb-1">メール取得済</p>
                  <p className="text-2xl font-bold text-cyan-600">{stats.has_email}</p>
                </div>
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                  <p className="text-xs text-slate-500 mb-1">Instagram取得済</p>
                  <p className="text-2xl font-bold text-pink-500">{stats.has_instagram}</p>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3 flex-wrap">
              <button onClick={handleEnrichContacts} disabled={enriching}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-600 text-white text-sm font-medium disabled:opacity-50 cursor-pointer">
                {enriching ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
                {enriching ? '連絡先を検索中...' : '連絡先を一括検索（15件）'}
              </button>
              <button onClick={() => { fetchDmQueue(); fetchStats() }} disabled={loadingDm}
                className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-50 cursor-pointer">
                <RefreshCw size={14} className={loadingDm ? 'animate-spin' : ''} />
                更新
              </button>
            </div>

            {/* Enrich result */}
            {enrichResult && (
              <div className="bg-cyan-50 dark:bg-cyan-900/20 border border-cyan-200 dark:border-cyan-800 rounded-xl px-4 py-3">
                <p className="text-sm text-cyan-700 dark:text-cyan-400">
                  検索完了: {enrichResult.processed}件処理 / メール {enrichResult.emails_found}件 / Instagram {enrichResult.instagrams_found}件 発見
                </p>
              </div>
            )}

            {/* DM Queue */}
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
                <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                  <InstagramIcon size={14} className="text-pink-500" />
                  Instagram DM ({dmLeads.length}件)
                </h3>
                <p className="text-xs text-slate-400 mt-1">「DM送信」をタップ → 文面コピー＋InstagramのDM画面が開く → 貼り付けて送信 → 「済」</p>
              </div>

              {dmLeads.length === 0 ? (
                <div className="text-center py-16 text-slate-400">
                  <InstagramIcon size={32} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm">DM送信対象のリードがありません</p>
                  <p className="text-xs mt-1">cronで自動的にInstagramアカウントが取得されます</p>
                </div>
              ) : dmLeads.map(lead => (
                <div key={lead.id} className="border-b border-slate-100 dark:border-slate-700/50 px-4 py-3">
                  {/* Main row: name + one-tap buttons */}
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-white truncate">{lead.name}</h4>
                        <span className="text-[10px] text-pink-500 shrink-0">@{lead.instagram}</span>
                      </div>
                      <p className="text-[11px] text-slate-400 truncate">{lead.business_type} · {lead.address}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {/* DM文面がない場合: 生成ボタン */}
                      {!dmTexts[lead.id] ? (
                        <button onClick={() => handleGenerateDm(lead)}
                          disabled={generatingDm === lead.id}
                          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-pink-50 text-pink-600 text-xs font-medium hover:bg-pink-100 disabled:opacity-50 cursor-pointer dark:bg-pink-900/30 dark:text-pink-400">
                          {generatingDm === lead.id ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
                          {generatingDm === lead.id ? '生成中...' : 'DM生成'}
                        </button>
                      ) : (
                        <>
                          {/* ワンタップDM送信: コピー + Instagram DM画面を開く */}
                          <button onClick={() => handleOneTapDm(lead)}
                            className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white text-sm font-bold shadow-lg shadow-pink-500/25 cursor-pointer active:scale-95 transition-all">
                            {dmCopied === lead.id ? <Check size={16} /> : <Send size={16} />}
                            {dmCopied === lead.id ? 'コピー済み！貼り付けて送信' : 'DM送信'}
                          </button>
                          {/* 送信済みマーク */}
                          <button onClick={() => handleMarkDmSent(lead.id)}
                            className="flex items-center gap-1 px-3 py-2.5 rounded-xl bg-green-500 hover:bg-green-600 text-white text-xs font-medium cursor-pointer active:scale-95 transition-all">
                            <CheckCircle size={14} /> 済
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Expandable DM preview */}
                  {dmTexts[lead.id] && (
                    <details className="mt-2">
                      <summary className="text-[11px] text-slate-400 cursor-pointer hover:text-slate-600">DM文面を確認・編集</summary>
                      <pre className="mt-2 text-xs text-slate-600 dark:text-slate-400 whitespace-pre-wrap leading-relaxed bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3 max-h-48 overflow-y-auto">{dmTexts[lead.id]}</pre>
                      <div className="flex items-center gap-2 mt-2">
                        <button onClick={() => handleCopyDm(lead.id, dmTexts[lead.id])}
                          className="text-[11px] text-slate-500 hover:text-pink-500 cursor-pointer flex items-center gap-1">
                          <Copy size={10} /> コピーのみ
                        </button>
                        <button onClick={() => handleGenerateDm(lead)}
                          disabled={generatingDm === lead.id}
                          className="text-[11px] text-slate-500 hover:text-pink-500 cursor-pointer flex items-center gap-1 disabled:opacity-50">
                          <RefreshCw size={10} className={generatingDm === lead.id ? 'animate-spin' : ''} /> 再生成
                        </button>
                      </div>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* ── LP Preview Modal ── */}
      {lpPreview && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 shrink-0">
              <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <FileCode size={16} className="text-cyan-500" />
                LP プレビュー: {lpPreview.name}
              </h3>
              <div className="flex items-center gap-2">
                <button onClick={handlePublishLp} disabled={publishing}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-green-500 hover:bg-green-600 text-white text-xs font-medium cursor-pointer disabled:opacity-50">
                  {publishing ? <RefreshCw size={12} className="animate-spin" /> : <Globe size={12} />}
                  {publishing ? '公開中...' : 'Web公開する'}
                </button>
                <button onClick={() => handleCopy(lpPreview.html)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-400 cursor-pointer hover:bg-slate-50">
                  {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                  {copied ? 'コピー済み' : 'HTMLコピー'}
                </button>
                <button onClick={() => setLpPreview(null)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 cursor-pointer">
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              <iframe
                srcDoc={lpPreview.html}
                className="w-full h-full min-h-[600px] border-0"
                title="LP Preview"
                sandbox="allow-scripts"
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Proposal Preview Modal ── */}
      {proposalPreview && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
              <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <Mail size={16} className="text-orange-500" />
                営業メール: {proposalPreview.lead.name}
              </h3>
              <button onClick={() => setProposalPreview(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 cursor-pointer">
                <X size={18} />
              </button>
            </div>
            <div className="px-6 py-5 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">件名</label>
                <p className="text-sm text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-900 rounded-lg px-3 py-2">{proposalPreview.subject}</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">本文</label>
                <pre className="text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-900 rounded-lg px-3 py-3 whitespace-pre-wrap max-h-64 overflow-y-auto">{proposalPreview.body}</pre>
              </div>
              {proposalPreview.lead.email && (
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Mail size={12} /> 送信先: {proposalPreview.lead.email}
                </div>
              )}
              {!proposalPreview.lead.email && proposalPreview.lead.instagram && (
                <div className="flex items-center gap-1.5 text-xs text-pink-500">
                  <InstagramIcon size={12} /> Instagram DM用: {proposalPreview.lead.instagram}
                  <button onClick={() => handleCopy(proposalPreview.body)}
                    className="ml-2 px-2 py-1 rounded bg-pink-50 text-pink-600 text-[10px] cursor-pointer hover:bg-pink-100">
                    {copied ? 'コピー済み' : 'DM本文をコピー'}
                  </button>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700">
              <button onClick={() => handleCopy(`${proposalPreview.subject}\n\n${proposalPreview.body}`)}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-600 cursor-pointer flex items-center gap-1.5">
                {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                全文コピー
              </button>
              {proposalPreview.lead.email && (
                <button onClick={handleActualSend}
                  className="px-5 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium cursor-pointer flex items-center gap-1.5">
                  <Send size={14} /> メール送信
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
