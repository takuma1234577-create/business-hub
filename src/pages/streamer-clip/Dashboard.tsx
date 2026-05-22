import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, Film, CheckCircle, DollarSign } from 'lucide-react'
import { fetchStats, fetchJobs } from './api'
import type { ProfileStats, StreamerJob } from './types'

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  uploaded: { label: 'アップロード済', color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  processing: { label: '処理中', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' },
  awaiting_review: { label: 'レビュー待ち', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300' },
  completed: { label: '完了', color: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' },
  error: { label: 'エラー', color: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' },
}

export default function Dashboard() {
  const [stats, setStats] = useState<ProfileStats[]>([])
  const [recentJobs, setRecentJobs] = useState<StreamerJob[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([fetchStats(), fetchJobs()])
      .then(([s, j]) => { setStats(s); setRecentJobs(j.slice(0, 5)) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const totalProfiles = stats.length
  const totalJobs = stats.reduce((s, r) => s + (r.total_jobs || 0), 0)
  const totalPublished = stats.reduce((s, r) => s + (r.total_published || 0), 0)
  const totalCost = stats.reduce((s, r) => s + (r.total_cost_usd || 0), 0)

  const summaryCards = [
    { label: 'プロファイル数', value: totalProfiles, icon: <BarChart3 size={20} />, color: 'text-blue-600 dark:text-blue-400' },
    { label: '総ジョブ数', value: totalJobs, icon: <Film size={20} />, color: 'text-orange-600 dark:text-orange-400' },
    { label: '公開済み', value: totalPublished, icon: <CheckCircle size={20} />, color: 'text-green-600 dark:text-green-400' },
    { label: '総コスト', value: `$${totalCost.toFixed(2)}`, icon: <DollarSign size={20} />, color: 'text-violet-600 dark:text-violet-400' },
  ]

  if (loading) return <p className="text-slate-500 dark:text-slate-400">読み込み中...</p>

  return (
    <div className="space-y-8">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {summaryCards.map(c => (
          <div key={c.label} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
            <div className={`mb-2 ${c.color}`}>{c.icon}</div>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{c.value}</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Profile Stats */}
      {stats.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">プロファイル別統計</h2>
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900">
                <tr>
                  <th className="text-left px-4 py-3 text-slate-600 dark:text-slate-400 font-medium">配信者</th>
                  <th className="text-right px-4 py-3 text-slate-600 dark:text-slate-400 font-medium">ジョブ数</th>
                  <th className="text-right px-4 py-3 text-slate-600 dark:text-slate-400 font-medium">公開数</th>
                  <th className="text-right px-4 py-3 text-slate-600 dark:text-slate-400 font-medium">コスト</th>
                  <th className="text-right px-4 py-3 text-slate-600 dark:text-slate-400 font-medium">最終公開</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-slate-950 divide-y divide-slate-100 dark:divide-slate-800">
                {stats.map(s => (
                  <tr key={s.profile_id}>
                    <td className="px-4 py-3 text-slate-900 dark:text-white font-medium">
                      {s.streamer_profiles?.display_name || s.profile_id}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700 dark:text-slate-300">{s.total_jobs}</td>
                    <td className="px-4 py-3 text-right text-slate-700 dark:text-slate-300">{s.total_published}</td>
                    <td className="px-4 py-3 text-right text-slate-700 dark:text-slate-300">${(s.total_cost_usd || 0).toFixed(2)}</td>
                    <td className="px-4 py-3 text-right text-slate-500 dark:text-slate-400">
                      {s.last_published_at ? new Date(s.last_published_at).toLocaleDateString('ja-JP') : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent Jobs */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">最近のジョブ</h2>
          <Link to="/streamer-clip/jobs" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">すべて見る</Link>
        </div>
        {recentJobs.length === 0 ? (
          <p className="text-slate-500 dark:text-slate-400 text-sm">まだジョブがありません</p>
        ) : (
          <div className="space-y-2">
            {recentJobs.map(j => {
              const st = STATUS_LABELS[j.status] || STATUS_LABELS.uploaded
              return (
                <div key={j.id} className="flex items-center justify-between p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
                  <div>
                    <p className="font-medium text-slate-900 dark:text-white">{j.video_filename}</p>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {j.streamer_profiles?.display_name || j.profile_id} ・ {new Date(j.created_at).toLocaleDateString('ja-JP')}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-slate-500 dark:text-slate-400">${(j.total_cost_usd || 0).toFixed(2)}</span>
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${st.color}`}>{st.label}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
