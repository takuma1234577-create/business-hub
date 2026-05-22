import { useState, useEffect, useCallback } from 'react'
import { ClipboardList, Star, ExternalLink, ChevronLeft, ChevronRight, ArrowLeft, MousePointerClick, AlertTriangle, TrendingUp, RefreshCw } from 'lucide-react'
import axios from 'axios'
import SurveyFollowups from './SurveyFollowups'

const api = axios.create({ baseURL: '/api/line-crm' })
api.interceptors.request.use((config) => { const token = localStorage.getItem('auth_token'); if (token) config.headers.Authorization = `Bearer ${token}`; return config })
interface Survey {
  id: string
  user_id: string
  line_user_id: string | null
  product_name: string
  rating: number
  positive_points: string[]
  usage_scene: string | null
  improvement_text: string | null
  recommendation_text: string | null
  routed_to: 'amazon_review' | 'amazon_support'
  amazon_button_clicked_at: string | null
  coupon_id: string | null
  date_of_birth: string | null
  created_at: string
  coupon?: { coupon_code: string; status: string; expires_at: string } | null
  friend?: { id: string; display_name: string; picture_url: string | null } | null
}

interface Stats {
  total: number
  avgRating: number
  ratingDistribution: number[]
  reviewClicked: number
  reviewClickRate: number
  supportRouted: number
  sentCount: number
  urlClickCount: number
}

export default function FitpeakDashboard() {
  const [subTab, setSubTab] = useState<'dashboard' | 'followups'>('dashboard')
  const [view, setView] = useState<'list' | 'detail'>('list')
  const [surveys, setSurveys] = useState<Survey[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [selectedSurvey, setSelectedSurvey] = useState<Survey | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [filterRating, setFilterRating] = useState('')
  const perPage = 20

  const fetchSurveys = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string | number> = { page, per_page: perPage }
      if (filterRating) params.rating = filterRating
      const res = await api.get('/fitpeak/surveys', { params })
      setSurveys(res.data.data)
      setTotal(res.data.total)
    } catch { /* ignore */ }
    setLoading(false)
  }, [page, filterRating])

  const fetchStats = useCallback(async () => {
    try {
      const res = await api.get('/fitpeak/stats')
      setStats(res.data)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { fetchSurveys() }, [fetchSurveys])
  useEffect(() => { fetchStats() }, [fetchStats])

  const openDetail = async (id: string) => {
    try {
      const res = await api.get(`/fitpeak/surveys/${id}`)
      setSelectedSurvey(res.data)
      setView('detail')
    } catch { /* ignore */ }
  }

  const totalPages = Math.ceil(total / perPage)

  const formatDate = (d: string | null) => {
    if (!d) return '-'
    return new Date(d).toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n)

  const ratingColor = (n: number) => {
    if (n >= 4) return 'text-[#06C755]'
    if (n >= 3) return 'text-yellow-500'
    return 'text-red-500'
  }

  // Sub-tab: フォローアップ
  if (subTab === 'followups') {
    return (
      <div>
        <div className="flex items-center gap-2 mb-6">
          <button
            onClick={() => setSubTab('dashboard')}
            className="px-3 py-1.5 text-sm font-medium rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
          >
            ダッシュボード
          </button>
          <button
            onClick={() => setSubTab('followups')}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-[#06C755] text-white cursor-pointer"
          >
            <RefreshCw size={14} className="inline mr-1" />
            フォローアップ
          </button>
        </div>
        <SurveyFollowups />
      </div>
    )
  }

  // Detail View
  if (view === 'detail' && selectedSurvey) {
    const s = selectedSurvey
    return (
      <div>
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => setView('list')} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 cursor-pointer">
            <ArrowLeft size={20} />
          </button>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">アンケート詳細</h2>
        </div>

        <div className="space-y-4">
          {/* 基本情報 */}
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
            <div className="flex items-center gap-4 mb-4">
              {s.friend?.picture_url ? (
                <img src={s.friend.picture_url} alt="" className="w-12 h-12 rounded-full object-cover" />
              ) : (
                <div className="w-12 h-12 rounded-full bg-slate-200 dark:bg-slate-600" />
              )}
              <div>
                <p className="font-medium text-slate-900 dark:text-white">{s.friend?.display_name || s.user_id || '不明'}</p>
                <p className="text-xs text-slate-500">{formatDate(s.created_at)}</p>
              </div>
              <div className="ml-auto text-right">
                <p className={`text-2xl font-bold ${ratingColor(s.rating)}`}>{stars(s.rating)}</p>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  s.routed_to === 'amazon_review' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
                }`}>
                  {s.routed_to === 'amazon_review' ? 'レビュー誘導' : 'サポート誘導'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3">
                <p className="text-xs text-slate-500 mb-1">商品</p>
                <p className="font-medium text-slate-900 dark:text-white">{s.product_name}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3">
                <p className="text-xs text-slate-500 mb-1">レビューボタン</p>
                <p className={`font-medium ${s.amazon_button_clicked_at ? 'text-[#06C755]' : 'text-slate-400'}`}>
                  {s.amazon_button_clicked_at ? `クリック済 (${formatDate(s.amazon_button_clicked_at)})` : '未クリック'}
                </p>
              </div>
              {s.date_of_birth && (
                <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3">
                  <p className="text-xs text-slate-500 mb-1">生年月日</p>
                  <p className="font-medium text-slate-900 dark:text-white">{s.date_of_birth}</p>
                </div>
              )}
              {s.coupon && (
                <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3">
                  <p className="text-xs text-slate-500 mb-1">クーポン</p>
                  <p className="font-mono text-sm text-slate-900 dark:text-white">{s.coupon.coupon_code}</p>
                  <p className="text-xs text-slate-400">{s.coupon.status} / {formatDate(s.coupon.expires_at)}まで</p>
                </div>
              )}
            </div>
          </div>

          {/* 気に入った点 */}
          {s.positive_points && s.positive_points.length > 0 && (
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
              <h3 className="text-sm font-medium text-slate-900 dark:text-white mb-3">気に入った点</h3>
              <div className="flex flex-wrap gap-2">
                {s.positive_points.map((p, i) => (
                  <span key={i} className="text-xs px-3 py-1 rounded-full bg-[#06C755]/10 text-[#06C755] font-medium">{p}</span>
                ))}
              </div>
            </div>
          )}

          {/* テキスト回答 */}
          {(s.usage_scene || s.improvement_text || s.recommendation_text) && (
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 space-y-4">
              <h3 className="text-sm font-medium text-slate-900 dark:text-white">テキスト回答</h3>
              {s.usage_scene && (
                <div>
                  <p className="text-xs text-slate-500 mb-1">使用シーン</p>
                  <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{s.usage_scene}</p>
                </div>
              )}
              {s.improvement_text && (
                <div>
                  <p className="text-xs text-slate-500 mb-1">改善希望</p>
                  <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{s.improvement_text}</p>
                </div>
              )}
              {s.recommendation_text && (
                <div>
                  <p className="text-xs text-slate-500 mb-1">おすすめコメント</p>
                  <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{s.recommendation_text}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  // List View
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
          <ClipboardList size={20} className="text-orange-500" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">My FITPEAK ダッシュボード</h2>
          <p className="text-sm text-slate-500">アンケート回答 {total} 件</p>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-6">
        <button
          onClick={() => setSubTab('dashboard')}
          className="px-3 py-1.5 text-sm font-medium rounded-lg bg-[#06C755] text-white cursor-pointer"
        >
          ダッシュボード
        </button>
        <button
          onClick={() => setSubTab('followups')}
          className="px-3 py-1.5 text-sm font-medium rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
        >
          <RefreshCw size={14} className="inline mr-1" />
          フォローアップ
        </button>
      </div>

      {/* Funnel */}
      {stats && (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 mb-6">
          <h3 className="text-sm font-medium text-slate-900 dark:text-white mb-4">アンケートファネル</h3>
          <div className="flex items-end gap-2">
            {[
              { label: 'アンケート送信', value: stats.sentCount, color: 'bg-slate-400' },
              { label: 'URLクリック', value: stats.urlClickCount, color: 'bg-blue-400' },
              { label: 'アンケート回答', value: stats.total, color: 'bg-[#06C755]' },
              { label: 'レビュークリック', value: stats.reviewClicked, color: 'bg-orange-400' },
            ].map((step, i) => {
              const maxVal = Math.max(stats.sentCount, stats.urlClickCount, stats.total, stats.reviewClicked, 1)
              const height = Math.max(20, (step.value / maxVal) * 120)
              const prevValue = i === 0 ? null : [stats.sentCount, stats.urlClickCount, stats.total][i - 1]
              const rate = prevValue && prevValue > 0 ? Math.round(step.value / prevValue * 100) : null
              return (
                <div key={step.label} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-lg font-bold text-slate-900 dark:text-white">{step.value}</span>
                  {rate !== null && (
                    <span className="text-xs text-slate-400">{rate}%</span>
                  )}
                  <div className={`w-full rounded-t-lg ${step.color}`} style={{ height: `${height}px` }} />
                  <span className="text-xs text-slate-500 text-center mt-1">{step.label}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
            <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
              <ClipboardList size={14} />
              回答数
            </div>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.total}</p>
          </div>
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
            <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
              <Star size={14} />
              平均評価
            </div>
            <p className={`text-2xl font-bold ${ratingColor(Math.round(stats.avgRating))}`}>{stats.avgRating}</p>
          </div>
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
            <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
              <MousePointerClick size={14} />
              レビュークリック率
            </div>
            <p className="text-2xl font-bold text-[#06C755]">{stats.reviewClickRate}%</p>
          </div>
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
            <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
              <AlertTriangle size={14} />
              サポート誘導
            </div>
            <p className="text-2xl font-bold text-orange-500">{stats.supportRouted}</p>
          </div>
        </div>
      )}

      {/* Rating Distribution */}
      {stats && (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 mb-6">
          <h3 className="text-sm font-medium text-slate-900 dark:text-white mb-3 flex items-center gap-2">
            <TrendingUp size={14} />
            評価分布
          </h3>
          <div className="space-y-1.5">
            {[5, 4, 3, 2, 1].map(r => {
              const count = stats.ratingDistribution[r - 1]
              const pct = stats.total > 0 ? (count / stats.total) * 100 : 0
              return (
                <div key={r} className="flex items-center gap-2 text-sm">
                  <span className="w-8 text-right text-slate-500">★{r}</span>
                  <div className="flex-1 h-5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${r >= 4 ? 'bg-[#06C755]' : r === 3 ? 'bg-yellow-400' : 'bg-red-400'}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-10 text-right text-xs text-slate-500">{count}件</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-2 mb-4">
        <select
          value={filterRating}
          onChange={e => { setFilterRating(e.target.value); setPage(1) }}
          className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white"
        >
          <option value="">全ての評価</option>
          {[5, 4, 3, 2, 1].map(r => <option key={r} value={r}>★{r}</option>)}
        </select>
      </div>

      {/* Survey List */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-2 border-[#06C755] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : surveys.length === 0 ? (
          <div className="text-center py-16 text-slate-400">アンケート回答はありません</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                <th className="text-left px-4 py-3 font-medium text-slate-500">日時</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">ユーザー</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">商品</th>
                <th className="text-center px-4 py-3 font-medium text-slate-500">評価</th>
                <th className="text-center px-4 py-3 font-medium text-slate-500">ルート</th>
                <th className="text-center px-4 py-3 font-medium text-slate-500">レビュー</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {surveys.map(s => (
                <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 cursor-pointer" onClick={() => openDetail(s.id)}>
                  <td className="px-4 py-3 text-xs text-slate-500">{formatDate(s.created_at)}</td>
                  <td className="px-4 py-3 text-slate-900 dark:text-white">{s.user_id === 'anonymous' ? '匿名' : (s.user_id || '-').slice(0, 20)}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400 truncate max-w-[150px]">{s.product_name}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`font-bold ${ratingColor(s.rating)}`}>{stars(s.rating)}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      s.routed_to === 'amazon_review' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                    }`}>
                      {s.routed_to === 'amazon_review' ? 'レビュー' : 'サポート'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {s.amazon_button_clicked_at ? (
                      <MousePointerClick size={16} className="mx-auto text-[#06C755]" />
                    ) : (
                      <span className="text-slate-300">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <ExternalLink size={14} className="text-slate-400" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-slate-500">{(page - 1) * perPage + 1} - {Math.min(page * perPage, total)} / {total}</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 cursor-pointer"><ChevronLeft size={16} /></button>
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{page}/{totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 cursor-pointer"><ChevronRight size={16} /></button>
          </div>
        </div>
      )}
    </div>
  )
}
