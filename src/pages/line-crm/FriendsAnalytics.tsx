import { useState, useEffect } from 'react'
import { Users, UserPlus, UserMinus, TrendingUp, TrendingDown, Minus } from 'lucide-react'

interface DailyData {
  date: string
  added: number
  removed: number
  cumulative: number
}

interface Summary {
  total: number
  active: number
  unfollowed: number
  addedInPeriod: number
  removedInPeriod: number
  netChange: number
}

interface AnalyticsData {
  summary: Summary
  daily: DailyData[]
}

export default function FriendsAnalytics() {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(30)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/line-crm/friends-analytics?days=${days}`)
      .then(r => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [days])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-[#06C755] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!data) return <p className="text-slate-400 text-center py-10">データを取得できませんでした</p>

  const { summary, daily } = data
  const maxVal = Math.max(...daily.map(d => Math.max(d.added, d.removed)), 1)
  const maxCum = Math.max(...daily.map(d => d.cumulative), 1)
  const minCum = Math.min(...daily.map(d => d.cumulative), 0)
  const cumRange = maxCum - minCum || 1

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">友だち増減</h2>
        <div className="flex gap-1">
          {[7, 14, 30, 90].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                days === d
                  ? 'bg-[#06C755] text-white'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
              }`}
            >
              {d}日
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          label="アクティブ"
          value={summary.active}
          icon={<Users size={18} />}
          color="text-[#06C755]"
          bgColor="bg-[#06C755]/10"
        />
        <SummaryCard
          label={`新規 (${days}日)`}
          value={summary.addedInPeriod}
          icon={<UserPlus size={18} />}
          color="text-blue-600"
          bgColor="bg-blue-50 dark:bg-blue-900/20"
        />
        <SummaryCard
          label={`ブロック (${days}日)`}
          value={summary.removedInPeriod}
          icon={<UserMinus size={18} />}
          color="text-red-500"
          bgColor="bg-red-50 dark:bg-red-900/20"
        />
        <SummaryCard
          label={`純増減 (${days}日)`}
          value={summary.netChange}
          icon={summary.netChange > 0 ? <TrendingUp size={18} /> : summary.netChange < 0 ? <TrendingDown size={18} /> : <Minus size={18} />}
          color={summary.netChange > 0 ? 'text-emerald-600' : summary.netChange < 0 ? 'text-red-500' : 'text-slate-500'}
          bgColor={summary.netChange > 0 ? 'bg-emerald-50 dark:bg-emerald-900/20' : summary.netChange < 0 ? 'bg-red-50 dark:bg-red-900/20' : 'bg-slate-50 dark:bg-slate-800'}
          prefix={summary.netChange > 0 ? '+' : ''}
        />
      </div>

      {/* Cumulative chart */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">友だち数の推移</h3>
        <div className="h-48 flex items-end gap-px relative">
          {/* Y axis labels */}
          <div className="absolute left-0 top-0 bottom-0 w-10 flex flex-col justify-between text-[10px] text-slate-400 pr-1 pointer-events-none">
            <span>{maxCum}</span>
            <span>{minCum}</span>
          </div>
          <div className="flex items-end gap-px flex-1 ml-12 h-full">
            {daily.map((d, i) => {
              const h = ((d.cumulative - minCum) / cumRange) * 100
              return (
                <div key={i} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                  <div
                    className="w-full bg-[#06C755]/60 hover:bg-[#06C755] rounded-t-sm transition-colors min-h-[2px]"
                    style={{ height: `${Math.max(h, 1)}%` }}
                  />
                  {/* Tooltip */}
                  <div className="absolute bottom-full mb-2 hidden group-hover:block z-10">
                    <div className="bg-slate-900 text-white text-[10px] rounded px-2 py-1 whitespace-nowrap shadow-lg">
                      <div className="font-medium">{formatDate(d.date)}</div>
                      <div>友だち数: {d.cumulative}</div>
                      {d.added > 0 && <div className="text-green-300">+{d.added} 追加</div>}
                      {d.removed > 0 && <div className="text-red-300">-{d.removed} ブロック</div>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        {/* X axis */}
        <div className="flex ml-12 mt-1">
          {daily.map((d, i) => {
            const showLabel = days <= 14 || (days <= 30 && i % 3 === 0) || (days > 30 && i % 7 === 0)
            return (
              <div key={i} className="flex-1 text-center">
                {showLabel && <span className="text-[9px] text-slate-400">{d.date.slice(5)}</span>}
              </div>
            )
          })}
        </div>
      </div>

      {/* Daily bar chart */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">日別の追加・ブロック</h3>
        <div className="h-40 flex items-end gap-px">
          {daily.map((d, i) => {
            const addH = (d.added / maxVal) * 100
            const remH = (d.removed / maxVal) * 100
            return (
              <div key={i} className="flex-1 flex flex-col items-center justify-end h-full gap-px group relative">
                {d.removed > 0 && (
                  <div
                    className="w-full bg-red-400/60 hover:bg-red-400 rounded-t-sm transition-colors"
                    style={{ height: `${remH}%` }}
                  />
                )}
                {d.added > 0 && (
                  <div
                    className="w-full bg-blue-400/60 hover:bg-blue-400 rounded-t-sm transition-colors"
                    style={{ height: `${addH}%` }}
                  />
                )}
                {d.added === 0 && d.removed === 0 && (
                  <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-t-sm" style={{ height: '2px' }} />
                )}
                {/* Tooltip */}
                <div className="absolute bottom-full mb-2 hidden group-hover:block z-10">
                  <div className="bg-slate-900 text-white text-[10px] rounded px-2 py-1 whitespace-nowrap shadow-lg">
                    <div className="font-medium">{formatDate(d.date)}</div>
                    <div className="text-blue-300">+{d.added} 追加</div>
                    <div className="text-red-300">-{d.removed} ブロック</div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        <div className="flex mt-2 gap-4 justify-center">
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="w-3 h-3 bg-blue-400/60 rounded-sm" /> 追加
          </span>
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="w-3 h-3 bg-red-400/60 rounded-sm" /> ブロック
          </span>
        </div>
      </div>
    </div>
  )
}

function SummaryCard({ label, value, icon, color, bgColor, prefix = '' }: {
  label: string; value: number; icon: React.ReactNode; color: string; bgColor: string; prefix?: string
}) {
  return (
    <div className={`${bgColor} rounded-xl p-4 border border-slate-200/50 dark:border-slate-700/50`}>
      <div className={`${color} mb-2`}>{icon}</div>
      <p className={`text-2xl font-bold ${color}`}>{prefix}{value.toLocaleString()}</p>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{label}</p>
    </div>
  )
}

function formatDate(iso: string) {
  const [, m, d] = iso.split('-')
  return `${parseInt(m)}/${parseInt(d)}`
}
