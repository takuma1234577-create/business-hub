import { useState, useEffect } from 'react'
import {
  Plus,
  Trash2,
  ShoppingBag,
  Music,
  Loader2,
  Link,
} from 'lucide-react'
import { skuMappingApi } from './api'
import type { SkuMapping, Channel } from './types'

export default function SkuMappings() {
  const [mappings, setMappings] = useState<SkuMapping[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Form state
  const [channel, setChannel] = useState<Channel>('SHOPIFY')
  const [channelSku, setChannelSku] = useState('')
  const [amazonSku, setAmazonSku] = useState('')
  const [error, setError] = useState<string | null>(null)

  const fetchMappings = async () => {
    setLoading(true)
    try {
      const data = await skuMappingApi.list()
      setMappings(data)
    } catch (err) {
      console.error('Failed to fetch SKU mappings', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMappings()
  }, [])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!channelSku.trim() || !amazonSku.trim()) {
      setError('全てのフィールドを入力してください')
      return
    }

    setSubmitting(true)
    try {
      await skuMappingApi.create({
        channel,
        channelSku: channelSku.trim(),
        amazonSku: amazonSku.trim(),
      })
      setChannelSku('')
      setAmazonSku('')
      await fetchMappings()
    } catch (err) {
      setError(err instanceof Error ? err.message : '追加に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このマッピングを削除しますか？')) return

    setDeleting(id)
    try {
      await skuMappingApi.delete(id)
      await fetchMappings()
    } catch (err) {
      console.error('Failed to delete mapping', err)
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Add Form */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4 flex items-center gap-2">
          <Plus size={16} />
          新規マッピング追加
        </h3>

        <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500 dark:text-slate-400">
              チャネル
            </label>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as Channel)}
              className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="SHOPIFY">Shopify</option>
              <option value="TIKTOK">TikTok</option>
            </select>
          </div>

          <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
            <label className="text-xs text-slate-500 dark:text-slate-400">
              チャネルSKU
            </label>
            <input
              type="text"
              value={channelSku}
              onChange={(e) => setChannelSku(e.target.value)}
              placeholder="例: SHOP-SKU-001"
              className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-300 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
            <label className="text-xs text-slate-500 dark:text-slate-400">
              Amazon SKU
            </label>
            <input
              type="text"
              value={amazonSku}
              onChange={(e) => setAmazonSku(e.target.value)}
              placeholder="例: AMZ-SKU-001"
              className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-300 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-2"
          >
            {submitting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Plus size={14} />
            )}
            追加
          </button>
        </form>

        {error && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>

      {/* Mappings Table */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400 dark:text-slate-500">
            <Loader2 size={24} className="animate-spin mr-2" />
            読み込み中...
          </div>
        ) : mappings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500">
            <Link size={40} className="mb-2" />
            <p>SKUマッピングがありません</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">
                  チャネル
                </th>
                <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">
                  チャネルSKU
                </th>
                <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">
                  Amazon SKU
                </th>
                <th className="text-left px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">
                  作成日
                </th>
                <th className="w-16 px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {mappings.map((mapping) => (
                <tr
                  key={mapping.id}
                  className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                >
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                      {mapping.channel === 'SHOPIFY' ? (
                        <>
                          <ShoppingBag
                            size={14}
                            className="text-green-600 dark:text-green-400"
                          />
                          Shopify
                        </>
                      ) : (
                        <>
                          <Music
                            size={14}
                            className="text-pink-600 dark:text-pink-400"
                          />
                          TikTok
                        </>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-400">
                    {mapping.channelSku}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-400">
                    {mapping.amazonSku}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                    {new Date(mapping.createdAt).toLocaleDateString('ja-JP')}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleDelete(mapping.id)}
                      disabled={deleting === mapping.id}
                      className="p-1.5 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500 dark:text-red-400 transition-colors cursor-pointer disabled:opacity-50"
                      title="削除"
                    >
                      {deleting === mapping.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Trash2 size={14} />
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
