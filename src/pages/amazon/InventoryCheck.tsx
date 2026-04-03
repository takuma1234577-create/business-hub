import { useState } from 'react'
import { Search, Package, Loader2 } from 'lucide-react'
import { inventoryApi } from './api'
import type { InventorySummary } from './types'

export default function InventoryCheck() {
  const [skuInput, setSkuInput] = useState('')
  const [results, setResults] = useState<InventorySummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  const handleCheck = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const skus = skuInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    if (skus.length === 0) {
      setError('SKUを入力してください')
      return
    }

    setLoading(true)
    setSearched(true)
    try {
      const data = await inventoryApi.check(skus)
      setResults(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : '在庫確認に失敗しました')
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Search Form */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4 flex items-center gap-2">
          <Search size={16} />
          SKUで在庫確認
        </h3>

        <form onSubmit={handleCheck} className="flex gap-3">
          <div className="flex-1">
            <input
              type="text"
              value={skuInput}
              onChange={(e) => setSkuInput(e.target.value)}
              placeholder="SKUをカンマ区切りで入力（例: SKU-001, SKU-002, SKU-003）"
              className="w-full px-4 py-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-300 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-2 whitespace-nowrap"
          >
            {loading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Search size={16} />
            )}
            確認
          </button>
        </form>

        {error && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>

      {/* Results Table */}
      {searched && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-400 dark:text-slate-500">
              <Loader2 size={24} className="animate-spin mr-2" />
              在庫情報を取得中...
            </div>
          ) : results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500">
              <Package size={40} className="mb-2" />
              <p>該当する在庫情報が見つかりません</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                  <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">
                    SKU
                  </th>
                  <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">
                    ASIN
                  </th>
                  <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">
                    FN SKU
                  </th>
                  <th className="text-right px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">
                    出荷可能数
                  </th>
                  <th className="text-right px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">
                    入庫中数
                  </th>
                  <th className="text-right px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">
                    合計数
                  </th>
                </tr>
              </thead>
              <tbody>
                {results.map((item) => {
                  const inboundTotal =
                    item.inboundWorkingQuantity +
                    item.inboundShippedQuantity +
                    item.inboundReceivingQuantity

                  return (
                    <tr
                      key={item.sellerSku}
                      className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-xs font-medium text-slate-700 dark:text-slate-300">
                        {item.sellerSku}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-400">
                        {item.asin}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-400">
                        {item.fnSku}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className={`font-semibold ${
                            item.fulfillableQuantity > 0
                              ? 'text-green-600 dark:text-green-400'
                              : 'text-red-600 dark:text-red-400'
                          }`}
                        >
                          {item.fulfillableQuantity.toLocaleString()}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400">
                        {inboundTotal.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-700 dark:text-slate-300">
                        {item.totalQuantity.toLocaleString()}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
