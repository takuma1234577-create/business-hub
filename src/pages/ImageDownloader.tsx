import { useState } from 'react'
import { Images, Download, Loader2, Link2, CheckSquare, Square, AlertTriangle } from 'lucide-react'
import ToolLayout from '../components/ToolLayout'
import { createApi } from '../lib/api'

const api = createApi('/api/image-downloader')

interface Img {
  url: string
  thumb: string
}

const SOURCE_LABEL: Record<string, string> = {
  yahoo: 'ヤフオク',
  'yahoo-shopping': 'Yahoo!ショッピング',
  amazon: 'Amazon',
  rakuten: '楽天',
  mercari: 'メルカリ',
  suruga: '駿河屋',
  generic: 'その他サイト',
}

export default function ImageDownloader() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [zipping, setZipping] = useState(false)
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  const [source, setSource] = useState('')
  const [title, setTitle] = useState('')
  const [images, setImages] = useState<Img[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())

  async function extract() {
    setError('')
    setWarning('')
    setImages([])
    setSelected(new Set())
    setTitle('')
    setSource('')
    if (!/^https?:\/\//.test(url.trim())) {
      setError('http/https で始まる商品ページのURLを入力してください')
      return
    }
    setLoading(true)
    try {
      const { data } = await api.post('/extract', { url: url.trim() })
      setSource(data.source || '')
      setTitle(data.title || '')
      setImages(data.images || [])
      setSelected(new Set((data.images || []).map((i: Img) => i.url)))
      if (data.warning) setWarning(data.warning)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      setError(err.response?.data?.error || '画像の抽出に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  function toggle(u: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(u)) next.delete(u)
      else next.add(u)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === images.length) setSelected(new Set())
    else setSelected(new Set(images.map((i) => i.url)))
  }

  async function downloadZip() {
    if (!selected.size) return
    setZipping(true)
    setError('')
    try {
      const res = await api.post(
        '/zip',
        { url: url.trim(), images: [...selected], name: title || source || 'images' },
        { responseType: 'blob' },
      )
      const blob = new Blob([res.data], { type: 'application/zip' })
      const a = document.createElement('a')
      const href = URL.createObjectURL(blob)
      a.href = href
      a.download = `${(title || source || 'product-images').slice(0, 40).replace(/[^\w\-一-龠ぁ-んァ-ヶ]+/g, '_')}.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(href)
    } catch (e: unknown) {
      // blobで受けるとエラーJSONもblobになるため読み直す
      const err = e as { response?: { data?: Blob } }
      let msg = 'ZIPの作成に失敗しました'
      try {
        if (err.response?.data) {
          const text = await err.response.data.text()
          msg = JSON.parse(text).error || msg
        }
      } catch {
        /* noop */
      }
      setError(msg)
    } finally {
      setZipping(false)
    }
  }

  return (
    <ToolLayout title="商品画像 一括ダウンロード">
      <div className="space-y-6">
        {/* 入力 */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-5">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
            商品ページのURL
          </label>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            ヤフオク・Amazon・楽天・メルカリ・駿河屋などの商品ページに対応
          </p>
          <div className="mt-3 flex gap-2">
            <div className="relative flex-1">
              <Link2
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !loading && extract()}
                placeholder="https://..."
                className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              />
            </div>
            <button
              onClick={extract}
              disabled={loading}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-medium hover:opacity-90 transition disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Images size={16} />}
              画像を取得
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-700 dark:text-red-300">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            {error}
          </div>
        )}
        {warning && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            {warning}
          </div>
        )}

        {/* 結果 */}
        {images.length > 0 && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <div className="flex items-center gap-2">
                  {source && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                      {SOURCE_LABEL[source] || source}
                    </span>
                  )}
                  <span className="text-sm font-medium text-slate-900 dark:text-white">
                    {images.length}枚検出 / {selected.size}枚選択中
                  </span>
                </div>
                {title && (
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 line-clamp-1 max-w-md">
                    {title}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={toggleAll}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer"
                >
                  {selected.size === images.length ? <Square size={15} /> : <CheckSquare size={15} />}
                  {selected.size === images.length ? '全解除' : '全選択'}
                </button>
                <button
                  onClick={downloadZip}
                  disabled={!selected.size || zipping}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-medium hover:opacity-90 transition disabled:opacity-50 cursor-pointer"
                >
                  {zipping ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                  ZIPで一括DL
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {images.map((img) => {
                const isSel = selected.has(img.url)
                return (
                  <button
                    key={img.url}
                    onClick={() => toggle(img.url)}
                    className={`group relative aspect-square rounded-lg overflow-hidden border-2 transition cursor-pointer ${
                      isSel
                        ? 'border-slate-900 dark:border-white'
                        : 'border-transparent hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                  >
                    <img
                      src={img.thumb}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover bg-slate-100 dark:bg-slate-800"
                    />
                    <div
                      className={`absolute top-1.5 left-1.5 w-5 h-5 rounded flex items-center justify-center ${
                        isSel ? 'bg-slate-900 dark:bg-white' : 'bg-white/80 dark:bg-slate-900/80'
                      }`}
                    >
                      {isSel && <CheckSquare size={13} className="text-white dark:text-slate-900" />}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </ToolLayout>
  )
}
