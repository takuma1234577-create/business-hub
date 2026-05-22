import { useState, useEffect, useRef } from 'react'
import { Play, Trash2, X, ChevronDown, ChevronUp, Upload, FileText, Loader2, Link2 } from 'lucide-react'
import { fetchProfiles, fetchJobs, fetchJob, createJob, processJob, uploadAndProcess, processUrl, deleteJob } from './api'
import type { StreamerProfile, StreamerJob, StreamerCandidate } from './types'

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  uploaded: { label: 'アップロード済', color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  transcribing: { label: '文字起こし中', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300' },
  processing: { label: 'AI分析中', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' },
  awaiting_review: { label: 'レビュー待ち', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300' },
  completed: { label: '完了', color: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' },
  error: { label: 'エラー', color: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' },
}

type InputMode = 'clip' | 'url' | 'text'
const ACCEPT_TYPES = '.mp3,.mp4,.m4a,.wav,.webm,.ogg,.flac,.mpeg,.mpga,.mov'

export default function JobList() {
  const [profiles, setProfiles] = useState<StreamerProfile[]>([])
  const [jobs, setJobs] = useState<StreamerJob[]>([])
  const [filterProfile, setFilterProfile] = useState('')
  const [loading, setLoading] = useState(true)
  const [expandedJob, setExpandedJob] = useState<string | null>(null)
  const [expandedCandidates, setExpandedCandidates] = useState<StreamerCandidate[]>([])

  // Modal
  const [showModal, setShowModal] = useState(false)
  const [profileId, setProfileId] = useState('')
  const [mode, setMode] = useState<InputMode>('clip')
  const [file, setFile] = useState<File | null>(null)
  const [sourceUrl, setSourceUrl] = useState('')
  const [inputUrl, setInputUrl] = useState('')
  const [textFilename, setTextFilename] = useState('')
  const [textTranscript, setTextTranscript] = useState('')
  const [processing, setProcessing] = useState(false)
  const [step, setStep] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = () => {
    setLoading(true)
    Promise.all([fetchProfiles(), fetchJobs(filterProfile || undefined)])
      .then(([p, j]) => { setProfiles(p); setJobs(j) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(load, [filterProfile])

  const openModal = () => {
    setFile(null); setSourceUrl(''); setInputUrl(''); setTextFilename(''); setTextTranscript('')
    setResult(null); setError(null); setStep(''); setMode('clip'); setDragOver(false)
    if (profiles.length > 0 && !profileId) setProfileId(profiles[0].id)
    setShowModal(true)
  }

  const handleProcess = async () => {
    if (!profileId) return
    setProcessing(true); setResult(null); setError(null)

    try {
      if (mode === 'clip') {
        if (!file) { setProcessing(false); return }
        setStep('Whisper文字起こし → AI和訳・解説生成中...')
        const res = await uploadAndProcess(profileId, file)
        const dur = Math.floor(res.duration_seconds)
        setResult(
          `分析完了 (${Math.floor(dur/60)}分${dur%60}秒)\n` +
          `コスト: $${res.cost.total.toFixed(4)}`
        )
      } else if (mode === 'url') {
        if (!inputUrl.trim()) { setProcessing(false); return }
        setStep('字幕取得 → AI分析中...')
        const res = await processUrl(profileId, inputUrl.trim())
        setResult(
          `「${res.title}」を分析完了\n` +
          `コスト: $${res.cost.total.toFixed(4)}`
        )
      } else {
        if (!textTranscript.trim() || !textFilename.trim()) { setProcessing(false); return }
        setStep('ジョブ作成中...')
        const job = await createJob({ profile_id: profileId, video_filename: textFilename.trim() })
        setStep('AI分析中...')
        const res = await processJob(job.id, textTranscript)
        setResult(`分析完了 (コスト: $${res.cost_usd.toFixed(4)})`)
      }
      load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '処理に失敗しました')
    } finally {
      setProcessing(false); setStep('')
    }
  }

  const isDisabled = processing || profiles.length === 0 || (
    mode === 'clip' ? !file :
    mode === 'url' ? !inputUrl.trim() :
    (!textTranscript.trim() || !textFilename.trim())
  )

  const handleDelete = async (id: string) => {
    if (!confirm('このジョブを削除しますか？')) return
    try { await deleteJob(id); load() } catch {}
  }

  const toggleExpand = async (jobId: string) => {
    if (expandedJob === jobId) { setExpandedJob(null); return }
    try {
      const job = await fetchJob(jobId)
      setExpandedCandidates(job.candidates || [])
      setExpandedJob(jobId)
    } catch {}
  }

  const fmtTime = (s: number) => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">ジョブ一覧</h2>
          <select value={filterProfile} onChange={e => setFilterProfile(e.target.value)} className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-300">
            <option value="">すべて</option>
            {profiles.map(p => <option key={p.id} value={p.id}>{p.display_name}</option>)}
          </select>
        </div>
        <button onClick={openModal} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition cursor-pointer">
          <Upload size={16} /> クリップを分析
        </button>
      </div>

      {loading ? (
        <p className="text-slate-500 dark:text-slate-400">読み込み中...</p>
      ) : jobs.length === 0 ? (
        <div className="text-center py-16">
          <Upload size={48} className="mx-auto text-slate-300 dark:text-slate-600 mb-4" />
          <p className="text-slate-500 dark:text-slate-400 mb-2">まだジョブがありません</p>
          <p className="text-sm text-slate-400 dark:text-slate-500 mb-6">OpusClipなどで切り抜いたクリップをアップロードして、和訳・解説を自動生成しましょう</p>
          <button onClick={openModal} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 cursor-pointer">
            最初のクリップを分析
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map(j => {
            const st = STATUS_LABELS[j.status] || STATUS_LABELS.uploaded
            const isExpanded = expandedJob === j.id
            return (
              <div key={j.id} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
                <div className="flex items-center justify-between p-4">
                  <button onClick={() => toggleExpand(j.id)} className="flex items-center gap-3 text-left flex-1 cursor-pointer">
                    {isExpanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                    <div>
                      <p className="font-medium text-slate-900 dark:text-white">{j.video_filename}</p>
                      <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                        <span>{j.streamer_profiles?.display_name || j.profile_id}</span>
                        <span>・</span>
                        <span>{new Date(j.created_at).toLocaleString('ja-JP')}</span>
                        {j.video_url && (
                          <>
                            <span>・</span>
                            <a href={j.video_url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline" onClick={e => e.stopPropagation()}>元動画</a>
                          </>
                        )}
                      </div>
                    </div>
                  </button>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-500 dark:text-slate-400">${(j.total_cost_usd || 0).toFixed(2)}</span>
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${st.color}`}>{st.label}</span>
                    <button onClick={() => handleDelete(j.id)} className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950 text-red-400 cursor-pointer" title="削除">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {j.error_message && <p className="px-4 pb-3 text-sm text-red-600 dark:text-red-400">{j.error_message}</p>}
                {isExpanded && expandedCandidates.length > 0 && (
                  <div className="border-t border-slate-100 dark:border-slate-800 px-4 py-3 space-y-3">
                    {expandedCandidates.map(c => {
                      const meta = c.metadata as Record<string, unknown>
                      const titles = Array.isArray(meta?.title_jp) ? meta.title_jp as string[] : []
                      const subs = Array.isArray(meta?.subtitles) ? meta.subtitles as Array<Record<string, unknown>> : []
                      const topPanels = Array.isArray(meta?.top_panels) ? meta.top_panels as Array<Record<string, unknown>> : []
                      return (
                        <div key={c.id} className="space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="font-medium text-slate-900 dark:text-white">{c.title_jp}</p>
                            <span className={`text-xs px-2 py-1 rounded-full ${
                              c.status === 'approved' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' :
                              c.status === 'published' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' :
                              'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                            }`}>{c.status === 'pending' ? '未レビュー' : c.status === 'approved' ? '承認済' : c.status === 'rejected' ? '却下' : c.status === 'published' ? '公開済' : c.status}</span>
                          </div>
                          {/* タイトル候補 */}
                          {titles.length > 1 && (
                            <div className="text-sm text-slate-600 dark:text-slate-400">
                              <span className="text-xs font-medium text-slate-500 dark:text-slate-500">タイトル候補: </span>
                              {titles.map((t, i) => <span key={i} className="mr-3">{i+1}. {t as string}</span>)}
                            </div>
                          )}
                          {/* 上段パネル */}
                          {topPanels.length > 0 && (
                            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950 space-y-1">
                              <p className="text-xs font-medium text-amber-600 dark:text-amber-400 mb-1">上段（ワード解説）</p>
                              {topPanels.map((p, i) => (
                                <div key={i} className="text-sm">
                                  <span className="font-bold text-slate-900 dark:text-white">{String(p.word)}</span>
                                  <span className="text-amber-700 dark:text-amber-300 ml-2">{String(p.meaning)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {/* 下段字幕 */}
                          {subs.length > 0 && (
                            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 space-y-1 max-h-48 overflow-y-auto">
                              <p className="text-xs font-medium text-slate-500 dark:text-slate-500 mb-1">下段（字幕）</p>
                              {subs.slice(0, 10).map((s, i) => (
                                <div key={i} className="text-sm">
                                  <span className="text-slate-400 text-xs mr-2">{fmtTime(Number(s.start))}</span>
                                  <span className="text-slate-500 dark:text-slate-400">{String(s.en)}</span>
                                  <span className="mx-1 text-slate-300">→</span>
                                  <span className="text-slate-900 dark:text-white font-medium">{String(s.jp)}</span>
                                </div>
                              ))}
                              {subs.length > 10 && <p className="text-xs text-slate-400">...他{subs.length - 10}件</p>}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
                {isExpanded && expandedCandidates.length === 0 && (
                  <div className="border-t border-slate-100 dark:border-slate-800 px-4 py-3">
                    <p className="text-sm text-slate-500 dark:text-slate-400">分析データなし</p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl bg-white dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">クリップ分析</h3>
              <button onClick={() => setShowModal(false)} disabled={processing} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 cursor-pointer disabled:opacity-50"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-5 flex-1 overflow-y-auto">
              {/* Profile */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">配信者プロファイル</label>
                <select value={profileId} onChange={e => setProfileId(e.target.value)} disabled={processing} className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white disabled:opacity-50">
                  {profiles.map(p => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                </select>
              </div>

              {/* Mode Toggle */}
              <div className="flex gap-2">
                {([
                  { id: 'clip' as InputMode, icon: <Upload size={16} />, label: 'クリップ動画' },
                  { id: 'url' as InputMode, icon: <Link2 size={16} />, label: 'YouTube URL' },
                  { id: 'text' as InputMode, icon: <FileText size={16} />, label: 'テキスト' },
                ]).map(m => (
                  <button key={m.id} onClick={() => setMode(m.id)} disabled={processing}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition cursor-pointer ${
                      mode === m.id ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-transparent hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >{m.icon} {m.label}</button>
                ))}
              </div>

              {/* Clip Upload */}
              {mode === 'clip' && (
                <div>
                  <div
                    onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={e => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]) }}
                    onClick={() => fileRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition ${
                      dragOver ? 'border-blue-400 bg-blue-50 dark:bg-blue-950'
                        : file ? 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950'
                        : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600'
                    }`}
                  >
                    <input ref={fileRef} type="file" accept={ACCEPT_TYPES} onChange={e => { if (e.target.files?.[0]) setFile(e.target.files[0]) }} className="hidden" />
                    {file ? (
                      <div>
                        <Upload size={32} className="mx-auto text-green-500 mb-2" />
                        <p className="font-medium text-slate-900 dark:text-white">{file.name}</p>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
                      </div>
                    ) : (
                      <div>
                        <Upload size={32} className="mx-auto text-slate-400 dark:text-slate-500 mb-2" />
                        <p className="font-medium text-slate-700 dark:text-slate-300">OpusClipで切り抜いたクリップをドラッグ&ドロップ</p>
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">MP4, MP3, M4A, WAV, MOV等 (25MBまで)</p>
                      </div>
                    )}
                  </div>
                  <div className="mt-2">
                    <input value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="元動画URL（任意）" className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm" />
                  </div>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">
                    Whisperで文字起こし → Claude AIが和訳字幕・単語解説・タイトル案を自動生成
                  </p>
                </div>
              )}

              {/* URL Mode */}
              {mode === 'url' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">YouTube URL</label>
                  <input value={inputUrl} onChange={e => setInputUrl(e.target.value)} disabled={processing} placeholder="https://www.youtube.com/watch?v=..." className="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm disabled:opacity-50" />
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">字幕が有効な動画のみ対応。字幕なしの場合はクリップ動画をアップロードしてください。</p>
                </div>
              )}

              {/* Text Mode */}
              {mode === 'text' && (
                <div className="space-y-3">
                  <input value={textFilename} onChange={e => setTextFilename(e.target.value)} disabled={processing} placeholder="動画名" className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm disabled:opacity-50" />
                  <textarea value={textTranscript} onChange={e => setTextTranscript(e.target.value)} disabled={processing} rows={8} placeholder="英語の文字起こしテキスト..." className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm font-mono disabled:opacity-50" />
                </div>
              )}

              {processing && (
                <div className="flex items-center gap-3 p-4 rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800">
                  <Loader2 size={20} className="text-blue-600 dark:text-blue-400 animate-spin flex-shrink-0" />
                  <p className="text-sm text-blue-700 dark:text-blue-300 font-medium">{step}</p>
                </div>
              )}
              {result && (
                <div className="p-4 rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800">
                  <p className="text-sm text-green-700 dark:text-green-300 font-medium whitespace-pre-line">{result}</p>
                  <p className="text-xs text-green-600 dark:text-green-400 mt-2">「レビュー」タブで和訳・解説を確認できます</p>
                </div>
              )}
              {error && (
                <div className="p-4 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800">
                  <p className="text-sm text-red-700 dark:text-red-300 whitespace-pre-line">{error}</p>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 p-6 border-t border-slate-200 dark:border-slate-800">
              <button onClick={() => setShowModal(false)} disabled={processing} className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-sm cursor-pointer disabled:opacity-50">
                {result ? '閉じる' : 'キャンセル'}
              </button>
              {!result && (
                <button onClick={handleProcess} disabled={isDisabled} className="flex items-center gap-2 px-5 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 cursor-pointer">
                  {processing ? <><Loader2 size={16} className="animate-spin" /> 処理中...</> : <><Play size={16} /> 分析開始</>}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
