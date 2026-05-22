import { useState, useEffect } from 'react'
import { profitLossApi } from './api'
import { useFiscalYear } from '../AccountingTool'
import { FileText, Loader2 } from 'lucide-react'

const fmt = (n: number) => `¥${Math.round(n).toLocaleString()}`

interface PLItem { id: string; code: string; name: string; balance: number }
interface PLData {
  dateFrom: string; dateTo: string
  salesRevenue: PLItem[]; costOfSales: PLItem[]; grossProfit: number
  sgaExpenses: PLItem[]; operatingIncome: number
  otherRevenue: PLItem[]; otherExpenses: PLItem[]; ordinaryIncome: number
  specialRevenue: PLItem[]; specialExpenses: PLItem[]; incomeBeforeTax: number
  taxExpenses: PLItem[]; netIncome: number
  totalRevenue: number; totalExpenses: number
}

function LineItems({ items }: { items: PLItem[] }) {
  return (
    <>
      {items.map(item => (
        <div key={item.id} className="flex justify-between py-0.5 text-sm pl-4">
          <span className="text-gray-700">{item.name}</span>
          <span className="text-gray-900 font-mono">{fmt(item.balance)}</span>
        </div>
      ))}
    </>
  )
}

function SubTotal({ label, amount, bold, highlight }: { label: string; amount: number; bold?: boolean; highlight?: boolean }) {
  return (
    <div className={`flex justify-between py-1.5 border-t ${bold ? 'border-gray-800 border-t-2' : 'border-gray-300'} ${highlight ? 'bg-violet-50 px-3 -mx-3 rounded' : ''}`}>
      <span className={`text-sm ${bold ? 'font-bold text-gray-900' : 'font-medium text-gray-700'}`}>{label}</span>
      <span className={`font-mono text-sm ${amount >= 0 ? 'text-gray-900' : 'text-red-600'} ${bold ? 'font-bold' : ''}`}>{fmt(amount)}</span>
    </div>
  )
}

export function ProfitLoss() {
  const { fiscalYear } = useFiscalYear()
  const [data, setData] = useState<PLData | null>(null)
  const [loading, setLoading] = useState(false)

  // 年度が変わったら自動取得
  useEffect(() => {
    if (!fiscalYear) return
    setLoading(true)
    profitLossApi.get(fiscalYear.start_date, fiscalYear.end_date)
      .then(setData)
      .catch(err => { console.error(err); alert('取得に失敗しました') })
      .finally(() => setLoading(false))
  }, [fiscalYear])

  if (!fiscalYear) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-gray-400">
        <FileText size={32} className="mx-auto mb-2" />
        <p>事業年度を選択してください</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-400">
        <Loader2 size={20} className="animate-spin mr-2" /> 計算中...
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-lg p-6 max-w-2xl">
        <div className="text-center mb-6">
          <h2 className="text-lg font-bold text-gray-900">損益計算書</h2>
          <p className="text-sm text-gray-500">{fiscalYear.year_label} — {data.dateFrom} 〜 {data.dateTo}</p>
        </div>

        {data.totalRevenue === 0 && data.totalExpenses === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <FileText size={32} className="mx-auto mb-2" />
            <p>仕訳データがありません</p>
          </div>
        ) : (
          <div className="space-y-4">
            {data.salesRevenue.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-gray-500 mb-1">売上高</h3>
                <LineItems items={data.salesRevenue} />
              </div>
            )}

            {data.costOfSales.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-gray-500 mb-1">売上原価</h3>
                <LineItems items={data.costOfSales} />
              </div>
            )}

            <SubTotal label="売上総利益" amount={data.grossProfit} />

            {data.sgaExpenses.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-gray-500 mb-1">販売費及び一般管理費</h3>
                <LineItems items={data.sgaExpenses} />
              </div>
            )}

            <SubTotal label="営業利益" amount={data.operatingIncome} bold />

            {data.otherRevenue.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-gray-500 mb-1">営業外収益</h3>
                <LineItems items={data.otherRevenue} />
              </div>
            )}

            {data.otherExpenses.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-gray-500 mb-1">営業外費用</h3>
                <LineItems items={data.otherExpenses} />
              </div>
            )}

            <SubTotal label="経常利益" amount={data.ordinaryIncome} bold />

            {data.specialRevenue.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-gray-500 mb-1">特別利益</h3>
                <LineItems items={data.specialRevenue} />
              </div>
            )}

            {data.specialExpenses.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-gray-500 mb-1">特別損失</h3>
                <LineItems items={data.specialExpenses} />
              </div>
            )}

            <SubTotal label="税引前当期純利益" amount={data.incomeBeforeTax} />

            {data.taxExpenses.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-gray-500 mb-1">法人税等</h3>
                <LineItems items={data.taxExpenses} />
              </div>
            )}

            <SubTotal label="当期純利益" amount={data.netIncome} bold highlight />
          </div>
        )}
      </div>
    </div>
  )
}
