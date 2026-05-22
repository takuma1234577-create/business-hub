import { useState, useEffect, useRef } from 'react'
import { RefreshCw, Trash2, Copy, ExternalLink, CheckCircle, AlertCircle, Loader } from 'lucide-react'
import { fetchVideos, pollVideo, deleteVideo } from './api'
import { PRODUCT_OPTIONS } from './types'
import type { SnsVideo } from './types'

const STATUS_LABELS: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending: { label: '待機中', color: 'text-slate-500', icon: <Loader size={14} className="animate-spin" /> },
  rendering: { label: 'レンダリング中', color: 'text-blue-500', icon: <Loader size={14} className="animate-spin" /> },
  done: { label: '完了', color: 'text-green-600', icon: <CheckCircle size={14} /> },
  error: { label: 'エラー', color: 'text-red-500', icon: <AlertCircle size={14} /> },
}

export default function VideoList() {
  const [videos, setVideos] = useState<SnsVideo[]>([])
  const [loading, setLoading] = useState(true)
  const [polling, setPolling] = useState<Set<string>>(new Set())
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    load()
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [])

  // レンダリング中の動画を自動ポーリング
  useEffect(() => {
    const renderingVideos = videos.filter(v => v.status === 'rendering')
    if (renderingVideos.length > 0) {
      if (intervalRef.current) clearInterval(intervalRef.current)
      intervalRef.current = setInterval(async () => {
        for (const v of renderingVideos) {
          try {
            const updated = await pollVideo(v.id)
            setVideos(prev => prev.map(p => p.id === updated.id ? updated : p))
          } catch { /* */ }
        }
      }, 10000)
    } else {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    }
  }, [videos.filter(v => v.status === 'rendering').length])

  async function load() {
    setLoading(true)
    try { setVideos(await fetchVideos()) } catch { /* */ }
    setLoading(false)
  }

  async function handlePoll(video: SnsVideo) {
    setPolling(prev => new Set(prev).add(video.id))
    try {
      const updated = await pollVideo(video.id)
      setVideos(prev => prev.map(v => v.id === updated.id ? updated : v))
    } catch { /* */ }
    setPolling(prev => { const s = new Set(prev); s.delete(video.id); return s })
  }

  async function handleDelete(id: string) {
    if (!confirm('この動画を削除しますか？')) return
    try {
      await deleteVideo(id)
      setVideos(prev => prev.filter(v => v.id !== id))
    } catch (err: any) {
      alert('削除エラー: ' + err.message)
    }
  }

  function copyCaption(caption: string) {
    navigator.clipboard.writeText(caption)
    alert('キャプションをコピーしました')
  }

  if (loading) return <p className="text-sm text-slate-500">読み込み中...</p>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">生成動画一覧</h3>
        <button
          onClick={load}
          className="flex items-center gap-1 px-3 py-1.5 rounded-md text-sm text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
        >
          <RefreshCw size={14} /> 更新
        </button>
      </div>

      {videos.length === 0 ? (
        <p className="text-sm text-slate-400">生成された動画はありません。台本タブから動画生成を実行してください。</p>
      ) : (
        <div className="space-y-3">
          {videos.map(video => {
            const st = STATUS_LABELS[video.status] || STATUS_LABELS.pending
            return (
              <div key={video.id} className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono text-slate-400">#{video.script_number}</span>
                      <span className="text-sm font-medium text-slate-900 dark:text-white">{video.theme}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500">
                        {PRODUCT_OPTIONS[video.product] || video.product}
                      </span>
                    </div>
                    <div className={`flex items-center gap-1 text-xs ${st.color}`}>
                      {st.icon} {st.label}
                      {video.render_status && video.status === 'rendering' && (
                        <span className="text-slate-400 ml-1">({video.render_status})</span>
                      )}
                    </div>
                    {video.error_message && (
                      <p className="text-xs text-red-400 mt-1">{video.error_message}</p>
                    )}
                    <p className="text-xs text-slate-400 mt-1">
                      {new Date(video.created_at).toLocaleString('ja-JP')}
                    </p>
                  </div>

                  <div className="flex items-center gap-1">
                    {video.status === 'rendering' && (
                      <button
                        onClick={() => handlePoll(video)}
                        disabled={polling.has(video.id)}
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950 cursor-pointer disabled:opacity-50"
                      >
                        <RefreshCw size={12} className={polling.has(video.id) ? 'animate-spin' : ''} /> 確認
                      </button>
                    )}
                    {video.status === 'done' && video.video_url && (
                      <a
                        href={video.video_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs text-green-600 hover:bg-green-50 dark:hover:bg-green-950 no-underline"
                      >
                        <ExternalLink size={12} /> 動画を開く
                      </a>
                    )}
                    {video.caption && (
                      <button
                        onClick={() => copyCaption(video.caption!)}
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        <Copy size={12} /> キャプション
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(video.id)}
                      className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950 text-slate-400 hover:text-red-500 cursor-pointer"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
