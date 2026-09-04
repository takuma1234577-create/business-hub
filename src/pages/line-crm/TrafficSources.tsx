import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Trash2, Copy, Check, QrCode, Users, MousePointerClick, TrendingUp, X, Pencil, Target } from 'lucide-react'
import { getChannelId } from './lineAccount'

interface TrafficSource {
  id: string
  name: string
  code: string
  description: string | null
  click_count: number
  friend_count: number
  created_at: string
  tag_ids?: string[]
  greeting_template_id?: string | null
}

interface TagItem { id: string; name: string; color?: string | null }
interface TemplateItem { id: string; name: string }

export default function TrafficSources() {
  const [sources, setSources] = useState<TrafficSource[]>([])
  const [loading, setLoading] = useState(false)
  const [days, setDays] = useState(30)
  const [analytics, setAnalytics] = useState<{
    daily: { date: string; clicks: number; friends: number }[]
    summary: { clicks: number; friends: number }
    bySource: { name: string; friends: number }[]
  } | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [qrSource, setQrSource] = useState<TrafficSource | null>(null)
  const [tags, setTags] = useState<TagItem[]>([])
  const [templates, setTemplates] = useState<TemplateItem[]>([])
  const [formTagIds, setFormTagIds] = useState<string[]>([])
  const [formGreetingTemplateId, setFormGreetingTemplateId] = useState<string>('')

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''

  const fetchSources = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/line-crm/traffic-sources?channel_id=${getChannelId()}`)
      if (res.ok) setSources(await res.json())
    } catch (err) {
      console.error('Failed to fetch traffic sources:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchSources() }, [fetchSources])

  useEffect(() => {
    fetch(`/api/line-crm/traffic-sources/analytics?days=${days}&channel_id=${getChannelId()}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => setAnalytics(d))
      .catch(() => {})
  }, [days])

  useEffect(() => {
    fetch(`/api/line-crm/tags?channel_id=${getChannelId()}`).then(r => r.ok ? r.json() : []).then(d => setTags(Array.isArray(d) ? d : [])).catch(() => {})
    fetch(`/api/line-crm/message-templates?channel_id=${getChannelId()}`).then(r => r.ok ? r.json() : []).then(d => setTemplates(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  const toggleFormTag = (id: string) =>
    setFormTagIds(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id])

  const handleCreate = async () => {
    if (!formName.trim()) return
    try {
      const res = await fetch('/api/line-crm/traffic-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: formName.trim(), description: formDesc.trim() || null, tag_ids: formTagIds, greeting_template_id: formGreetingTemplateId || null, channel_id: getChannelId() }),
      })
      if (res.ok) {
        setShowForm(false)
        setFormName('')
        setFormDesc('')
        setFormTagIds([])
        setFormGreetingTemplateId('')
        fetchSources()
      }
    } catch (err) {
      console.error('Failed to create traffic source:', err)
    }
  }

  const handleUpdate = async () => {
    if (!editId || !formName.trim()) return
    try {
      await fetch(`/api/line-crm/traffic-sources/${editId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: formName.trim(), description: formDesc.trim() || null, tag_ids: formTagIds, greeting_template_id: formGreetingTemplateId || null }),
      })
      setEditId(null)
      setFormName('')
      setFormDesc('')
      setFormTagIds([])
      setFormGreetingTemplateId('')
      setShowForm(false)
      fetchSources()
    } catch (err) {
      console.error('Failed to update traffic source:', err)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('この流入経路を削除しますか？')) return
    try {
      await fetch(`/api/line-crm/traffic-sources/${id}`, { method: 'DELETE' })
      fetchSources()
    } catch (err) {
      console.error('Failed to delete traffic source:', err)
    }
  }

  const getTrackUrl = (code: string) => `${baseUrl}/api/line-crm/track/${code}`

  const copyUrl = (source: TrafficSource) => {
    navigator.clipboard.writeText(getTrackUrl(source.code))
    setCopiedId(source.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const startEdit = (source: TrafficSource) => {
    setEditId(source.id)
    setFormName(source.name)
    setFormDesc(source.description || '')
    setFormTagIds(source.tag_ids || [])
    setFormGreetingTemplateId(source.greeting_template_id || '')
    setShowForm(true)
  }

  const getQrUrl = (code: string) => {
    const trackUrl = encodeURIComponent(getTrackUrl(code))
    return `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${trackUrl}`
  }

  const cvr = (source: TrafficSource) => {
    if (source.click_count === 0) return '-'
    return ((source.friend_count / source.click_count) * 100).toFixed(1) + '%'
  }

  const totalClicks = sources.reduce((s, v) => s + v.click_count, 0)
  const totalFriends = sources.reduce((s, v) => s + v.friend_count, 0)

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#06C755]/10 flex items-center justify-center">
            <TrendingUp size={20} className="text-[#06C755]" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">流入経路</h2>
            <p className="text-sm text-slate-500">友だち追加の経路を追跡・分析</p>
          </div>
        </div>
        <button
          onClick={() => { setShowForm(true); setEditId(null); setFormName(''); setFormDesc(''); setFormTagIds([]); setFormGreetingTemplateId('') }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#06C755] hover:bg-[#05b34c] text-white text-sm font-medium transition-colors cursor-pointer"
        >
          <Plus size={16} />
          新規作成
        </button>
      </div>

      {/* Stats */}
      {sources.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1.5">
              <TrendingUp size={13} className="text-slate-400" /> 経路数
            </div>
            <p className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">{sources.length}</p>
          </div>
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1.5">
              <MousePointerClick size={13} className="text-sky-500" /> 総クリック数
            </div>
            <p className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">{totalClicks.toLocaleString()}</p>
          </div>
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1.5">
              <Users size={13} className="text-[#06C755]" /> 経路経由の友だち
            </div>
            <p className="text-2xl font-bold text-[#06C755] tabular-nums">{totalFriends.toLocaleString()}</p>
          </div>
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1.5">
              <Target size={13} className="text-slate-400" /> 平均CVR
            </div>
            <p className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
              {totalClicks > 0 ? ((totalFriends / totalClicks) * 100).toFixed(1) + '%' : '-'}
            </p>
          </div>
        </div>
      )}

      {/* 日別の推移（クリック / 友だち登録） */}
      {sources.length > 0 && analytics && (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 mb-6">
          <div className="flex items-start justify-between mb-4 gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">日別の推移</h3>
              <p className="text-xs text-slate-500 mt-0.5">経路経由のクリックと友だち登録</p>
            </div>
            <div className="flex gap-1 bg-slate-100 dark:bg-slate-700/50 rounded-lg p-0.5">
              {[7, 14, 30, 90].map(d => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={`px-3 py-1 text-xs font-medium rounded-md cursor-pointer transition-colors ${days === d ? 'bg-white dark:bg-slate-800 text-[#06C755] shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                >
                  {d}日
                </button>
              ))}
            </div>
          </div>

          {/* 期間サマリー */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-3">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-sm bg-[#06C755] inline-block" />
              <span className="text-xs text-slate-500">友だち登録</span>
              <span className="text-lg font-bold text-[#06C755] tabular-nums leading-none">{analytics.summary.friends.toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-sm bg-sky-200 dark:bg-sky-500/40 inline-block" />
              <span className="text-xs text-slate-500">クリック</span>
              <span className="text-lg font-bold text-slate-700 dark:text-slate-200 tabular-nums leading-none">{analytics.summary.clicks.toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">期間CVR</span>
              <span className="text-lg font-bold text-slate-700 dark:text-slate-200 tabular-nums leading-none">
                {analytics.summary.clicks > 0 ? ((analytics.summary.friends / analytics.summary.clicks) * 100).toFixed(1) + '%' : '-'}
              </span>
            </div>
          </div>

          <DailyBarChart data={analytics.daily} />

          {analytics.bySource.length > 0 && (
            <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-700">
              <p className="text-xs font-medium text-slate-500 mb-3">経路別の友だち登録（期間内）</p>
              <div className="space-y-2.5">
                {[...analytics.bySource].sort((a, b) => b.friends - a.friends).map(s => {
                  const maxF = Math.max(...analytics.bySource.map(x => x.friends), 1)
                  return (
                    <div key={s.name} className="flex items-center gap-3 text-xs">
                      <span className="w-32 truncate text-slate-700 dark:text-slate-300" title={s.name}>{s.name}</span>
                      <div className="flex-1 h-5 bg-slate-100 dark:bg-slate-700/50 rounded-md overflow-hidden">
                        <div className="h-full bg-[#06C755] rounded-md transition-all" style={{ width: `${(s.friends / maxF) * 100}%` }} />
                      </div>
                      <span className="w-8 text-right font-semibold text-slate-900 dark:text-white tabular-nums">{s.friends}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Source List */}
      <div className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-[#06C755] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : sources.length === 0 ? (
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-center py-20 text-slate-400">
            <TrendingUp size={40} className="mx-auto mb-3 opacity-50" />
            <p className="mb-2">流入経路がまだありません</p>
            <p className="text-xs">「新規作成」から経路を追加すると、専用の友だち追加URLとQRコードが発行されます</p>
          </div>
        ) : (
          sources.map(source => (
            <div
              key={source.id}
              className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-medium text-slate-900 dark:text-white">{source.name}</h3>
                  </div>
                  {source.description && (
                    <p className="text-sm text-slate-500 mb-2">{source.description}</p>
                  )}

                  {/* Stats row */}
                  <div className="flex items-center gap-5 text-xs text-slate-400 mb-3">
                    <span className="flex items-center gap-1">
                      <MousePointerClick size={12} />
                      クリック: <span className="font-medium text-slate-600 dark:text-slate-300">{source.click_count}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <Users size={12} />
                      友だち: <span className="font-medium text-[#06C755]">{source.friend_count}</span>
                    </span>
                    <span>
                      CVR: <span className="font-medium text-slate-600 dark:text-slate-300">{cvr(source)}</span>
                    </span>
                    <span>
                      作成: {new Date(source.created_at).toLocaleDateString('ja-JP')}
                    </span>
                  </div>

                  {/* URL */}
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-600 dark:text-slate-400 truncate">
                      {getTrackUrl(source.code)}
                    </code>
                    <button
                      onClick={() => copyUrl(source)}
                      className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 transition-colors cursor-pointer"
                      title="URLをコピー"
                    >
                      {copiedId === source.id ? <Check size={16} className="text-[#06C755]" /> : <Copy size={16} />}
                    </button>
                    <button
                      onClick={() => setQrSource(source)}
                      className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 transition-colors cursor-pointer"
                      title="QRコード表示"
                    >
                      <QrCode size={16} />
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => startEdit(source)}
                    className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 transition-colors cursor-pointer"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(source.id)}
                    className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-400 hover:text-red-500 transition-colors cursor-pointer"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Create/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
              <h3 className="font-semibold text-slate-900 dark:text-white">
                {editId ? '流入経路を編集' : '新しい流入経路'}
              </h3>
              <button onClick={() => { setShowForm(false); setEditId(null) }} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 cursor-pointer">
                <X size={18} />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4 flex-1 overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">経路名</label>
                <input
                  type="text"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="例: Instagram広告、店舗POP、YouTube概要欄"
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755] text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">説明（任意）</label>
                <input
                  type="text"
                  value={formDesc}
                  onChange={e => setFormDesc(e.target.value)}
                  placeholder="例: 2026年4月のキャンペーン用"
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755] text-sm"
                />
              </div>

              {/* 自動付与タグ */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">この経路で自動付与するタグ（任意）</label>
                {tags.length === 0 ? (
                  <p className="text-xs text-slate-400">タグがありません（タグ管理で作成できます）</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {tags.map(tag => {
                      const on = formTagIds.includes(tag.id)
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => toggleFormTag(tag.id)}
                          className={`px-3 py-1.5 rounded-full text-xs font-medium border cursor-pointer transition ${on ? 'bg-[#06C755] text-white border-[#06C755]' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-[#06C755]'}`}
                        >
                          {on ? '✓ ' : ''}{tag.name}
                        </button>
                      )
                    })}
                  </div>
                )}
                <p className="mt-1 text-xs text-slate-400">この経路から友だち追加した人に自動でタグを付けます。</p>
              </div>

              {/* 専用の挨拶メッセージ */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">専用の挨拶メッセージ（任意）</label>
                <select
                  value={formGreetingTemplateId}
                  onChange={e => setFormGreetingTemplateId(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755] text-sm"
                >
                  <option value="">（全体の挨拶を使用）</option>
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-400">設定すると、この経路の友だちには全体の挨拶の代わりにこのテンプレを送ります。</p>
              </div>

              {!editId && (
                <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3">
                  <p className="text-xs text-slate-500 leading-relaxed">
                    作成すると専用の友だち追加URLとQRコードが自動発行されます。
                    このURLからLINEを追加した友だちは、自動でこの経路に紐づけられます。
                  </p>
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex-shrink-0">
              <button
                onClick={() => { setShowForm(false); setEditId(null) }}
                className="px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-sm font-medium cursor-pointer"
              >
                キャンセル
              </button>
              <button
                onClick={editId ? handleUpdate : handleCreate}
                disabled={!formName.trim()}
                className="px-5 py-2.5 rounded-lg bg-[#06C755] hover:bg-[#05b34c] text-white text-sm font-medium disabled:opacity-40 cursor-pointer"
              >
                {editId ? '保存' : '作成'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QR Code Modal */}
      {qrSource && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
              <h3 className="font-semibold text-slate-900 dark:text-white">QRコード</h3>
              <button onClick={() => setQrSource(null)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 cursor-pointer">
                <X size={18} />
              </button>
            </div>
            <div className="px-6 py-6 text-center">
              <p className="text-sm font-medium text-slate-900 dark:text-white mb-1">{qrSource.name}</p>
              <p className="text-xs text-slate-500 mb-4">このQRコードから友だち追加すると「{qrSource.name}」として記録されます</p>
              <div className="bg-white p-4 rounded-xl inline-block border border-slate-200">
                <img
                  src={getQrUrl(qrSource.code)}
                  alt={`QR: ${qrSource.name}`}
                  className="w-64 h-64"
                />
              </div>
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => copyUrl(qrSource)}
                  className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 text-sm cursor-pointer"
                >
                  {copiedId === qrSource.id ? <Check size={14} className="text-[#06C755]" /> : <Copy size={14} />}
                  URLをコピー
                </button>
                <a
                  href={getQrUrl(qrSource.code)}
                  download={`qr-${qrSource.name}.png`}
                  className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-[#06C755] hover:bg-[#05b34c] text-white text-sm font-medium cursor-pointer"
                >
                  <QrCode size={14} />
                  ダウンロード
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────── 日別バーチャート ───────────────
// クリック(薄いトラック)の上に友だち登録(緑)を重ねて、同一軸でCVRを直感的に見せる。
function niceNum(x: number): number {
  if (x <= 0) return 1
  const pow = Math.pow(10, Math.floor(Math.log10(x)))
  const f = x / pow
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10
  return nf * pow
}

function DailyBarChart({ data }: { data: { date: string; clicks: number; friends: number }[] }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setWidth(e.contentRect.width)
    })
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const H = 200
  const padL = 30, padR = 8, padT = 10, padB = 22
  const plotH = H - padT - padB
  const n = data.length

  const rawMax = Math.max(1, ...data.map(d => Math.max(d.clicks, d.friends)))
  const tick = Math.max(1, Math.round(niceNum(rawMax / 4)))
  const niceMax = Math.max(tick, Math.ceil(rawMax / tick) * tick)
  const ticks: number[] = []
  for (let v = 0; v <= niceMax + 1e-9; v += tick) ticks.push(v)

  const plotW = Math.max(0, width - padL - padR)
  const bandW = n > 0 ? plotW / n : 0
  const barW = Math.min(26, Math.max(3, bandW * 0.6))
  const bx = (i: number) => padL + bandW * i + (bandW - barW) / 2
  const by = (v: number) => padT + plotH - (v / niceMax) * plotH
  const bh = (v: number) => (v / niceMax) * plotH
  const rx = Math.min(3, barW / 2)

  const labelStep = Math.max(1, Math.ceil(n / 6))
  const md = (d: string) => d.slice(5).replace('-', '/')

  const hd = hover != null ? data[hover] : null
  const hoverCvr = hd ? (hd.clicks > 0 ? ((hd.friends / hd.clicks) * 100).toFixed(1) + '%' : '-') : ''
  const tipX = hover != null ? bx(hover) + barW / 2 : 0

  return (
    <div ref={wrapRef} className="relative w-full" style={{ height: H }}>
      {width > 0 && (
        <svg width={width} height={H} className="block overflow-visible">
          {/* グリッド線 + Y軸ラベル */}
          {ticks.map((t, i) => (
            <g key={`g${i}`}>
              <line
                x1={padL} y1={by(t)} x2={width - padR} y2={by(t)}
                className={t === 0 ? 'stroke-slate-200 dark:stroke-slate-600' : 'stroke-slate-100 dark:stroke-slate-700/60'}
                strokeWidth={1}
              />
              <text x={padL - 6} y={by(t)} textAnchor="end" dominantBaseline="middle" className="fill-slate-400 dark:fill-slate-500" fontSize={10}>{t}</text>
            </g>
          ))}
          {/* バー */}
          {data.map((d, i) => {
            const active = hover === i
            return (
              <g key={`b${i}`}>
                {d.clicks > 0 && (
                  <rect x={bx(i)} y={by(d.clicks)} width={barW} height={bh(d.clicks)} rx={rx} className="fill-sky-200 dark:fill-sky-500/30" />
                )}
                {d.friends > 0 && (
                  <rect x={bx(i)} y={by(d.friends)} width={barW} height={bh(d.friends)} rx={rx} className="fill-[#06C755]" />
                )}
                {active && <rect x={padL + bandW * i} y={padT} width={bandW} height={plotH} className="fill-slate-400/10" pointerEvents="none" />}
                <rect
                  x={padL + bandW * i} y={padT} width={bandW} height={plotH} fill="transparent"
                  onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(h => (h === i ? null : h))}
                />
              </g>
            )
          })}
          {/* X軸ラベル（日付） */}
          {data.map((d, i) => (
            (i % labelStep === 0 || i === n - 1) ? (
              <text key={`x${i}`} x={bx(i) + barW / 2} y={H - 6} textAnchor="middle" className="fill-slate-400 dark:fill-slate-500" fontSize={10}>{md(d.date)}</text>
            ) : null
          ))}
        </svg>
      )}
      {hd && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg bg-slate-900 text-white text-xs px-2.5 py-1.5 shadow-lg whitespace-nowrap"
          style={{ left: Math.min(Math.max(tipX, 64), Math.max(64, width - 64)), top: 0 }}
        >
          <div className="font-medium mb-1">{md(hd.date)}</div>
          <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-[#06C755]" />友だち {hd.friends}</div>
          <div className="flex items-center gap-1.5 mt-0.5"><span className="w-2 h-2 rounded-sm bg-sky-300" />クリック {hd.clicks}</div>
          <div className="text-slate-300 mt-1 pt-1 border-t border-white/15">CVR {hoverCvr}</div>
        </div>
      )}
    </div>
  )
}
