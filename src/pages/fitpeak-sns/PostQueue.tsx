import { useState, useEffect, useCallback } from 'react'
import {
  RefreshCw, Send, SkipForward, CheckCircle, Plus, Copy, Check, Clock,
  PenLine, Save, ExternalLink,
} from 'lucide-react'

interface QueueVideo {
  video_url: string | null
  theme: string | null
  product: string | null
  script_number: number | null
}

interface QueueItem {
  id: string
  video_id: string
  platform: 'tiktok' | 'instagram'
  caption: string
  hashtags: string[]
  scheduled_for: string | null
  status: 'queued' | 'posted' | 'skipped' | 'failed'
  post_url: string | null
  posted_at: string | null
  sns_videos: QueueVideo | null
}

interface DoneVideo {
  id: string
  script_number: number | null
  theme: string | null
  product: string | null
  status: string
  video_url: string | null
}

const PLATFORM_LABEL: Record<string, string> = { tiktok: 'TikTok', instagram: 'Instagram' }
const PLATFORM_COLOR: Record<string, string> = {
  tiktok: 'bg-slate-900 text-white dark:bg-white dark:text-slate-900',
  instagram: 'bg-gradient-to-r from-purple-500 to-pink-500 text-white',
}

export default function PostQueue() {
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [posted, setPosted] = useState<QueueItem[]>([])
  const [doneVideos, setDoneVideos] = useState<DoneVideo[]>([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [queueingId, setQueueingId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editCaption, setEditCaption] = useState('')
  const [editTags, setEditTags] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  const flash = (type: 'success' | 'error', msg: string) => {
    setBanner({ type, msg }); setTimeout(() => setBanner(null), 4000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [qRes, pRes, vRes] = await Promise.all([
        fetch('/api/fitpeak-sns/post-queue?status=queued'),
        fetch('/api/fitpeak-sns/post-queue?status=posted'),
        fetch('/api/fitpeak-sns/videos'),
      ])
      if (qRes.ok) setQueue(await qRes.json())
      if (pRes.ok) setPosted(await pRes.json())
      if (vRes.ok) {
        const vids: DoneVideo[] = await vRes.json()
        setDoneVideos(vids.filter(v => v.status === 'done' && v.video_url))
      }
    } catch {
      flash('error', '読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // 既にキュー済みの動画IDセット（重複追加の抑止用）
  const queuedVideoIds = new Set([...queue, ...posted].map(q => q.video_id))

  const handleQueue = async (videoId: string) => {
    setQueueingId(videoId)
    try {
      const res = await fetch(`/api/fitpeak-sns/videos/${videoId}/queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platforms: ['tiktok', 'instagram'] }),
      })
      const data = await res.json()
      if (res.ok) {
        flash('success', `${data.created?.length || 0}件の投稿文をAIで生成しました`)
        await load()
      } else {
        flash('error', data.error || 'キュー追加に失敗しました')
      }
    } catch {
      flash('error', 'キュー追加でエラーが発生しました')
    } finally {
      setQueueingId(null)
    }
  }

  const startEdit = (item: QueueItem) => {
    setEditId(item.id)
    setEditCaption(item.caption)
    setEditTags((item.hashtags || []).join(' '))
  }

  const saveEdit = async (id: string) => {
    setBusyId(id)
    try {
      const hashtags = editTags.split(/\s+/).filter(Boolean)
      const res = await fetch(`/api/fitpeak-sns/post-queue/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caption: editCaption, hashtags }),
      })
      if (res.ok) { setEditId(null); await load() }
      else flash('error', '保存に失敗しました')
    } catch { flash('error', '保存に失敗しました') } finally { setBusyId(null) }
  }

  const fullText = (item: QueueItem) => `${item.caption}\n\n${(item.hashtags || []).join(' ')}`.trim()

  const handlePublish = async (item: QueueItem) => {
    setBusyId(item.id)
    try {
      const res = await fetch(`/api/fitpeak-sns/post-queue/${item.id}/publish`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { flash('error', data.error || '投稿に失敗しました'); return }

      if (data.mode === 'manual') {
        // 投稿アシスト: 投稿文をコピー + 動画を別タブで開く
        await navigator.clipboard.writeText(data.caption || fullText(item)).catch(() => {})
        if (data.video_url) window.open(data.video_url, '_blank')
        flash('success', `投稿文をコピーし、動画を開きました。${PLATFORM_LABEL[item.platform]}に投稿後「投稿済み」を押してください`)
      } else {
        flash('success', `${PLATFORM_LABEL[item.platform]}に投稿しました`)
        await load()
      }
    } catch {
      flash('error', '投稿処理でエラーが発生しました')
    } finally {
      setBusyId(null)
    }
  }

  const handleMarkPosted = async (item: QueueItem) => {
    setBusyId(item.id)
    try {
      await fetch(`/api/fitpeak-sns/post-queue/${item.id}/mark-posted`, { method: 'POST' })
      await load()
    } catch { /* noop */ } finally { setBusyId(null) }
  }

  const handleSkip = async (item: QueueItem) => {
    setBusyId(item.id)
    try {
      await fetch(`/api/fitpeak-sns/post-queue/${item.id}/skip`, { method: 'POST' })
      await load()
    } catch { /* noop */ } finally { setBusyId(null) }
  }

  const handleCopy = async (item: QueueItem) => {
    await navigator.clipboard.writeText(fullText(item))
    setCopiedId(item.id); setTimeout(() => setCopiedId(null), 2000)
  }

  const notQueued = doneVideos.filter(v => !queuedVideoIds.has(v.id))

  return (
    <div>
      {banner && (
        <div className={`mb-4 px-4 py-3 rounded-xl text-sm border ${
          banner.type === 'error'
            ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'
            : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
        }`}>{banner.msg}</div>
      )}

      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xl">
          完成動画をAIがプラットフォーム別に投稿文・ハッシュタグ・最適時間まで最適化します。内容を確認して「ワンタップ投稿」。公式API接続前は、投稿文コピー＋動画DLのアシスト投稿になります。
        </p>
        <button onClick={load} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 cursor-pointer">
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* 完成動画 → キュー追加 */}
      {notQueued.length > 0 && (
        <div className="mb-6 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
          <h3 className="text-sm font-medium text-slate-900 dark:text-white mb-3">キューに追加できる完成動画</h3>
          <div className="space-y-2">
            {notQueued.map(v => (
              <div key={v.id} className="flex items-center gap-3 text-sm">
                <span className="flex-1 text-slate-700 dark:text-slate-300 truncate">
                  #{v.script_number} {v.theme || ''} <span className="text-slate-400">({v.product})</span>
                </span>
                <button onClick={() => handleQueue(v.id)} disabled={queueingId === v.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-xs font-medium disabled:opacity-50 cursor-pointer">
                  {queueingId === v.id ? <RefreshCw size={12} className="animate-spin" /> : <Plus size={12} />}
                  {queueingId === v.id ? 'AI生成中...' : 'TikTok/IG用に生成'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 投稿待ちキュー */}
      {queue.length === 0 ? (
        <div className="text-center py-12 text-slate-400 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl">
          <Send size={28} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm">投稿待ちの項目はありません</p>
          {notQueued.length === 0 && <p className="text-xs mt-1">「生成動画」タブで動画をレンダリングするとここに表示されます</p>}
        </div>
      ) : (
        <div className="space-y-3">
          {queue.map(item => (
            <div key={item.id} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
              <div className="flex gap-4">
                {/* video preview */}
                {item.sns_videos?.video_url && (
                  <video src={item.sns_videos.video_url} className="w-24 h-40 object-cover rounded-lg bg-black shrink-0" controls preload="metadata" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${PLATFORM_COLOR[item.platform]}`}>{PLATFORM_LABEL[item.platform]}</span>
                    <span className="text-xs text-slate-500">#{item.sns_videos?.script_number} {item.sns_videos?.theme}</span>
                    {item.scheduled_for && (
                      <span className="text-[11px] text-slate-400 flex items-center gap-1">
                        <Clock size={11} /> 推奨 {new Date(item.scheduled_for).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>

                  {editId === item.id ? (
                    <div className="space-y-2">
                      <textarea value={editCaption} onChange={e => setEditCaption(e.target.value)} rows={4}
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white resize-y" />
                      <input value={editTags} onChange={e => setEditTags(e.target.value)} placeholder="#筋トレ #宅トレ ..."
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white" />
                      <div className="flex gap-2">
                        <button onClick={() => saveEdit(item.id)} disabled={busyId === item.id}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-500 text-white text-xs cursor-pointer disabled:opacity-50"><Save size={12} /> 保存</button>
                        <button onClick={() => setEditId(null)} className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-500 cursor-pointer">キャンセル</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">{item.caption}</p>
                      <p className="text-xs text-blue-500 dark:text-blue-400 mt-1.5 break-words">{(item.hashtags || []).join(' ')}</p>
                    </>
                  )}
                </div>
              </div>

              {editId !== item.id && (
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 flex-wrap">
                  <button onClick={() => startEdit(item)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"><PenLine size={12} /> 編集</button>
                  <button onClick={() => handleCopy(item)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer">
                    {copiedId === item.id ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}{copiedId === item.id ? 'コピー済み' : '投稿文コピー'}</button>
                  <button onClick={() => handleSkip(item)} disabled={busyId === item.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer disabled:opacity-40"><SkipForward size={12} /> スキップ</button>
                  <button onClick={() => handleMarkPosted(item)} disabled={busyId === item.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-green-200 dark:border-green-800 text-xs text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 cursor-pointer disabled:opacity-40"><CheckCircle size={12} /> 投稿済みにする</button>
                  <button onClick={() => handlePublish(item)} disabled={busyId === item.id}
                    className="ml-auto flex items-center gap-1.5 px-5 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium disabled:opacity-50 cursor-pointer">
                    {busyId === item.id ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />} ワンタップ投稿</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 投稿済み */}
      {posted.length > 0 && (
        <div className="mt-8">
          <h3 className="text-sm font-medium text-slate-500 mb-3">投稿済み ({posted.length})</h3>
          <div className="space-y-2">
            {posted.map(item => (
              <div key={item.id} className="flex items-center gap-3 px-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm">
                <CheckCircle size={14} className="text-green-500 shrink-0" />
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${PLATFORM_COLOR[item.platform]}`}>{PLATFORM_LABEL[item.platform]}</span>
                <span className="flex-1 text-slate-600 dark:text-slate-400 truncate">#{item.sns_videos?.script_number} {item.sns_videos?.theme}</span>
                {item.post_url && <a href={item.post_url} target="_blank" rel="noreferrer" className="text-blue-500 cursor-pointer"><ExternalLink size={14} /></a>}
                <span className="text-xs text-slate-400">{item.posted_at ? new Date(item.posted_at).toLocaleDateString('ja-JP') : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
