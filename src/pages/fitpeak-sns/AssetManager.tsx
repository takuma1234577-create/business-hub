import { useState, useEffect, useRef } from 'react'
import { Upload, Trash2, Film, Music, ShoppingBag } from 'lucide-react'
import { fetchAssets, uploadAsset, deleteAsset } from './api'
import { PRODUCT_OPTIONS } from './types'
import type { SnsAsset } from './types'

const CATEGORIES = [
  { id: 'background', label: '背景動画', icon: <Film size={16} />, accept: 'video/*' },
  { id: 'product', label: '商品クリップ', icon: <ShoppingBag size={16} />, accept: 'video/*' },
  { id: 'bgm', label: 'BGM', icon: <Music size={16} />, accept: 'audio/*' },
] as const

export default function AssetManager() {
  const [assets, setAssets] = useState<SnsAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadCategory, setUploadCategory] = useState<string>('background')
  const [uploadProduct, setUploadProduct] = useState<string>('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try { setAssets(await fetchAssets()) } catch { /* */ }
    setLoading(false)
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        await uploadAsset(file, uploadCategory, uploadCategory === 'product' ? uploadProduct : undefined)
      }
      await load()
    } catch (err: any) {
      alert('アップロードエラー: ' + err.message)
    }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleDelete(asset: SnsAsset) {
    if (!confirm(`${asset.file_name} を削除しますか？`)) return
    try {
      await deleteAsset(asset.id)
      setAssets(prev => prev.filter(a => a.id !== asset.id))
    } catch (err: any) {
      alert('削除エラー: ' + err.message)
    }
  }

  const grouped = {
    background: assets.filter(a => a.category === 'background'),
    product: assets.filter(a => a.category === 'product'),
    bgm: assets.filter(a => a.category === 'bgm'),
  }

  const currentCat = CATEGORIES.find(c => c.id === uploadCategory)

  return (
    <div className="space-y-6">
      {/* アップロード */}
      <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">素材アップロード</h3>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-500 mb-1">カテゴリ</label>
            <select
              value={uploadCategory}
              onChange={e => setUploadCategory(e.target.value)}
              className="px-3 py-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
            >
              {CATEGORIES.map(c => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </div>
          {uploadCategory === 'product' && (
            <div>
              <label className="block text-xs text-slate-500 mb-1">商品</label>
              <select
                value={uploadProduct}
                onChange={e => setUploadProduct(e.target.value)}
                className="px-3 py-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
              >
                <option value="">選択</option>
                {Object.entries(PRODUCT_OPTIONS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <input
              ref={fileRef}
              type="file"
              accept={currentCat?.accept}
              multiple
              onChange={handleUpload}
              className="hidden"
              id="asset-upload"
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading || (uploadCategory === 'product' && !uploadProduct)}
              className="flex items-center gap-2 px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              <Upload size={16} />
              {uploading ? 'アップロード中...' : 'ファイル選択'}
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">読み込み中...</p>
      ) : (
        <>
          {CATEGORIES.map(cat => (
            <div key={cat.id}>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2 flex items-center gap-2">
                {cat.icon} {cat.label}
                <span className="text-xs font-normal text-slate-400">({grouped[cat.id as keyof typeof grouped].length})</span>
              </h3>
              {grouped[cat.id as keyof typeof grouped].length === 0 ? (
                <p className="text-xs text-slate-400 mb-4">素材なし</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-4">
                  {grouped[cat.id as keyof typeof grouped].map(asset => (
                    <div
                      key={asset.id}
                      className="flex items-center justify-between gap-2 p-3 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950"
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-slate-900 dark:text-white truncate">{asset.file_name}</p>
                        <p className="text-xs text-slate-400">
                          {asset.product_key && <span className="mr-2">{PRODUCT_OPTIONS[asset.product_key] || asset.product_key}</span>}
                          {(asset.file_size / 1024 / 1024).toFixed(1)}MB
                        </p>
                      </div>
                      <button
                        onClick={() => handleDelete(asset)}
                        className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950 text-slate-400 hover:text-red-500 cursor-pointer"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  )
}
