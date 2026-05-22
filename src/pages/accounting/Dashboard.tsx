import { useState, useEffect } from 'react'
import { fiscalSummaryApi } from './api'
import type { FiscalSummary } from './api'
import { useFiscalYear } from '../AccountingTool'
import {
  TrendingUp, TrendingDown, DollarSign,
  BookOpen, FileText, PieChart,
} from 'lucide-react'

const fmt = (n: number) => `¥${Math.round(n).toLocaleString()}`
const fmtCompact = (n: number) => {
  if (Math.abs(n) >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}億`
  if (Math.abs(n) >= 10_000) return `${Math.round(n / 10_000).toLocaleString()}万`
  return `¥${Math.round(n).toLocaleString()}`
}

export function Dashboard() {
  const { fiscalYear, allYears } = useFiscalYear()
  const [summary, setSummary] = useState<FiscalSummary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    // 全期: 全年度の最古〜最新、個別期: 選択年度の期間
    let startDate: string, endDate: string
    if (fiscalYear) {
      startDate = fiscalYear.start_date
      endDate = fiscalYear.end_date
    } else if (allYears.length > 0) {
      startDate = allYears[allYears.length - 1].start_date
      endDate = allYears[0].end_date
    } else {
      setLoading(false); return
    }
    fiscalSummaryApi.get(startDate, endDate)
      .then(setSummary)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [fiscalYear, allYears])

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-28 bg-gray-100 rounded-lg animate-pulse" />
        ))}
      </div>
    )
  }

  if (!summary) return <p className="text-gray-500">データの取得に失敗しました</p>

  const profitMargin = summary.totalRevenue > 0 ? (summary.netIncome / summary.totalRevenue * 100) : 0

  return (
    <div className="space-y-6">
      {/* KPIカード */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard
          label="売上高"
          value={fmtCompact(summary.salesRevenue)}
          icon={TrendingUp}
          color="blue"
        />
        <KPICard
          label="営業利益"
          value={fmtCompact(summary.operatingIncome)}
          icon={summary.operatingIncome >= 0 ? TrendingUp : TrendingDown}
          color={summary.operatingIncome >= 0 ? 'emerald' : 'red'}
        />
        <KPICard
          label="当期純利益"
          value={fmtCompact(summary.netIncome)}
          icon={DollarSign}
          color={summary.netIncome >= 0 ? 'violet' : 'red'}
          sub={summary.totalRevenue > 0 ? `利益率 ${profitMargin.toFixed(1)}%` : undefined}
        />
        <KPICard
          label="仕訳件数"
          value={`${summary.journalCount}件`}
          icon={BookOpen}
          color="gray"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ミニP/L */}
        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <div className="flex items-center gap-2 mb-4">
            <FileText size={16} className="text-violet-500" />
            <h3 className="text-sm font-medium text-gray-700">損益計算書サマリー</h3>
          </div>
          <div className="space-y-2">
            <PLRow label="売上高" amount={summary.salesRevenue} bold />
            <PLRow label="売上原価" amount={summary.costOfSales} indent />
            <PLRow label="売上総利益" amount={summary.grossProfit} border />
            <PLRow label="販売費及び一般管理費" amount={summary.sgaExpenses} indent />
            <PLRow label="営業利益" amount={summary.operatingIncome} bold border />
            <div className="pt-1" />
            <PLRow label="経費合計" amount={summary.totalExpenses} indent />
            <PLRow label="当期純利益" amount={summary.netIncome} bold highlight />
          </div>
        </div>

        {/* ミニB/S */}
        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <div className="flex items-center gap-2 mb-4">
            <PieChart size={16} className="text-violet-500" />
            <h3 className="text-sm font-medium text-gray-700">貸借対照表サマリー</h3>
          </div>
          <div className="space-y-3">
            <BSBar label="資産合計" amount={summary.totalAssets} color="bg-blue-500" total={summary.totalAssets} />
            <BSBar label="負債合計" amount={summary.totalLiabilities} color="bg-red-400" total={summary.totalAssets} />
            <BSBar label="純資産合計" amount={summary.totalEquity} color="bg-emerald-500" total={summary.totalAssets} />
          </div>
          <div className="mt-4 pt-3 border-t border-gray-100">
            <div className="flex justify-between text-xs text-gray-500">
              <span>負債・純資産合計</span>
              <span className="font-mono">{fmt(summary.totalLiabilities + summary.totalEquity)}</span>
            </div>
            {Math.abs(summary.totalAssets - (summary.totalLiabilities + summary.totalEquity)) < 1 ? (
              <p className="text-xs text-emerald-600 mt-1">貸借一致</p>
            ) : (
              <p className="text-xs text-red-500 mt-1">
                貸借不一致: 差額 {fmt(Math.abs(summary.totalAssets - (summary.totalLiabilities + summary.totalEquity)))}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function KPICard({ label, value, icon: Icon, color, sub }: {
  label: string; value: string; icon: any; color: string; sub?: string
}) {
  const colorMap: Record<string, { bg: string; text: string }> = {
    blue: { bg: 'bg-blue-50', text: 'text-blue-600' },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600' },
    violet: { bg: 'bg-violet-50', text: 'text-violet-600' },
    red: { bg: 'bg-red-50', text: 'text-red-600' },
    gray: { bg: 'bg-gray-50', text: 'text-gray-600' },
  }
  const c = colorMap[color] || colorMap.gray
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${c.bg}`}>
          <Icon size={18} className={c.text} />
        </div>
        <div>
          <p className="text-xl font-bold text-gray-900">{value}</p>
          <p className="text-xs text-gray-500">{label}</p>
          {sub && <p className="text-xs text-gray-400">{sub}</p>}
        </div>
      </div>
    </div>
  )
}

function PLRow({ label, amount, bold, indent, border, highlight }: {
  label: string; amount: number; bold?: boolean; indent?: boolean; border?: boolean; highlight?: boolean
}) {
  return (
    <div className={`flex justify-between py-1 text-sm ${border ? 'border-t border-gray-200 pt-2' : ''} ${highlight ? 'bg-violet-50 px-3 -mx-3 rounded py-2' : ''}`}>
      <span className={`${bold ? 'font-medium text-gray-900' : 'text-gray-600'} ${indent ? 'pl-3' : ''}`}>{label}</span>
      <span className={`font-mono ${bold ? 'font-medium' : ''} ${amount >= 0 ? 'text-gray-900' : 'text-red-600'}`}>
        {fmt(amount)}
      </span>
    </div>
  )
}

function BSBar({ label, amount, color, total }: { label: string; amount: number; color: string; total: number }) {
  const pct = total > 0 ? Math.max((amount / total) * 100, 2) : 0
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-700">{label}</span>
        <span className="font-mono text-gray-900">{fmt(amount)}</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
