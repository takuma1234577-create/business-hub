import { useState } from 'react'
import { balanceSheetApi } from './api'
import { FileText } from 'lucide-react'

const fmt = (n: number) => `¥${n.toLocaleString()}`

interface BSItem { id: string; code: string; name: string; subcategory: string; balance: number }
interface BSData {
  asOfDate: string; assets: BSItem[]; liabilities: BSItem[]; equity: BSItem[]
  totalAssets: number; totalLiabilities: number; totalEquity: number; netIncome: number
}

function Section({ title, items, total, totalLabel }: { title: string; items: BSItem[]; total: number; totalLabel: string }) {
  const grouped = items.reduce<Record<string, BSItem[]>>((g, item) => {
    const key = item.subcategory || '未分類'
    if (!g[key]) g[key] = []
    g[key].push(item)
    return g
  }, {})

  return (
    <div>
      <h3 className="text-sm font-bold text-gray-800 border-b-2 border-gray-800 pb-1 mb-2">{title}</h3>
      {Object.entries(grouped).map(([sub, subItems]) => (
        <div key={sub} className="mb-3">
          <p className="text-xs font-medium text-gray-600 mb-1">{sub}</p>
          {subItems.map(item => (
            <div key={item.id} className="flex justify-between py-0.5 text-sm">
              <span className="text-gray-700">{item.name}</span>
              <span className="text-gray-900 font-mono">{fmt(item.balance)}</span>
            </div>
          ))}
          <div className="flex justify-between py-0.5 text-xs border-t border-gray-200 mt-1">
            <span className="text-gray-500">{sub} 計</span>
            <span className="text-gray-700 font-mono">{fmt(subItems.reduce((s, i) => s + i.balance, 0))}</span>
          </div>
        </div>
      ))}
      <div className="flex justify-between py-1 text-sm font-bold border-t-2 border-gray-800 mt-2">
        <span>{totalLabel}</span>
        <span className="font-mono">{fmt(total)}</span>
      </div>
    </div>
  )
}

export function BalanceSheet() {
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().split('T')[0])
  const [data, setData] = useState<BSData | null>(null)
  const [loading, setLoading] = useState(false)

  const handleFetch = async () => {
    setLoading(true)
    try { setData(await balanceSheetApi.get(asOfDate)) }
    catch (err) { console.error(err); alert('取得に失敗しました') }
    finally { setLoading(false) }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <label className="text-sm text-gray-500">基準日:</label>
        <input type="date" value={asOfDate} onChange={e => setAsOfDate(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        <button onClick={handleFetch} disabled={loading}
          className="px-4 py-2 bg-violet-600 text-white text-sm rounded-lg hover:bg-violet-700 disabled:opacity-50">
          {loading ? '計算中...' : '表示'}
        </button>
      </div>

      {data && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="text-center mb-6">
            <h2 className="text-lg font-bold text-gray-900">貸借対照表</h2>
            <p className="text-sm text-gray-500">{data.asOfDate} 現在</p>
          </div>

          {data.assets.length === 0 && data.liabilities.length === 0 && data.equity.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <FileText size={32} className="mx-auto mb-2" />
              <p>仕訳データがありません</p>
              <p className="text-xs mt-1">仕訳帳タブから仕訳を入力するか、決算書を取り込んでください</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* 資産の部 */}
              <Section title="資産の部" items={data.assets} total={data.totalAssets} totalLabel="資産合計" />

              {/* 負債・純資産の部 */}
              <div className="space-y-6">
                <Section title="負債の部" items={data.liabilities} total={data.totalLiabilities} totalLabel="負債合計" />

                <div>
                  <h3 className="text-sm font-bold text-gray-800 border-b-2 border-gray-800 pb-1 mb-2">純資産の部</h3>
                  {data.equity.map(item => (
                    <div key={item.id} className="flex justify-between py-0.5 text-sm">
                      <span className="text-gray-700">{item.name}</span>
                      <span className="text-gray-900 font-mono">{fmt(item.balance)}</span>
                    </div>
                  ))}
                  {data.netIncome !== 0 && (
                    <div className="flex justify-between py-0.5 text-sm text-blue-700">
                      <span>当期純利益</span>
                      <span className="font-mono">{fmt(data.netIncome)}</span>
                    </div>
                  )}
                  <div className="flex justify-between py-1 text-sm font-bold border-t-2 border-gray-800 mt-2">
                    <span>純資産合計</span>
                    <span className="font-mono">{fmt(data.totalEquity)}</span>
                  </div>
                </div>

                <div className="flex justify-between py-2 text-sm font-bold bg-gray-100 px-3 rounded-lg">
                  <span>負債・純資産合計</span>
                  <span className="font-mono">{fmt(data.totalLiabilities + data.totalEquity)}</span>
                </div>
              </div>
            </div>
          )}

          {/* 貸借バランスチェック */}
          {data.totalAssets > 0 && (
            <div className={`mt-6 p-3 rounded-lg text-sm text-center ${
              Math.abs(data.totalAssets - (data.totalLiabilities + data.totalEquity)) < 1
                ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
            }`}>
              {Math.abs(data.totalAssets - (data.totalLiabilities + data.totalEquity)) < 1
                ? '貸借一致 ✓' : `貸借不一致: 差額 ${fmt(Math.abs(data.totalAssets - (data.totalLiabilities + data.totalEquity)))}`}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
