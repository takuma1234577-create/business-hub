import { useState, useEffect } from 'react'
import { Check, X as XIcon, ExternalLink, CheckCheck, XCircle } from 'lucide-react'
import { fetchProfiles, fetchCandidates, updateCandidate, publishCandidate } from './api'
import type { StreamerProfile, StreamerCandidate } from './types'

export default function ReviewCandidates() {
  const [profiles, setProfiles] = useState<StreamerProfile[]>([])
  const [candidates, setCandidates] = useState<StreamerCandidate[]>([])
  const [filterProfile, setFilterProfile] = useState('')
  const [filterStatus, setFilterStatus] = useState('pending')
  const [loading, setLoading] = useState(true)
  const [publishModal, setPublishModal] = useState<string | null>(null)
  const [youtubeId, setYoutubeId] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const load = () => {
    setLoading(true)
    const params: Record<string, string> = {}
    if (filterProfile) params.profile_id = filterProfile
    if (filterStatus) params.status = filterStatus
    Promise.all([fetchProfiles(), fetchCandidates(params)])
      .then(([p, c]) => { setProfiles(p); setCandidates(c); setSelected(new Set()) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(load, [filterProfile, filterStatus])

  const handleApprove = async (id: string) => {
    try { await updateCandidate(id, 'approved'); load() } catch {}
  }

  const handleReject = async (id: string) => {
    try { await updateCandidate(id, 'rejected'); load() } catch {}
  }

  const handlePublish = async () => {
    if (!publishModal || !youtubeId.trim()) return
    try { await publishCandidate(publishModal, youtubeId.trim()); setPublishModal(null); setYoutubeId(''); load() } catch {}
  }

  const handleBulkApprove = async () => {
    for (const id of selected) {
      try { await updateCandidate(id, 'approved') } catch {}
    }
    load()
  }

  const handleBulkReject = async () => {
    for (const id of selected) {
      try { await updateCandidate(id, 'rejected') } catch {}
    }
    load()
  }

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === candidates.length) setSelected(new Set())
    else setSelected(new Set(candidates.map(c => c.id)))
  }

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60)
    const s = Math.floor(sec % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const profileName = (id: string) => profiles.find(p => p.id === id)?.display_name || id

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">候補レビュー</h2>
          <select value={filterProfile} onChange={e => setFilterProfile(e.target.value)} className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-300">
            <option value="">すべて</option>
            {profiles.map(p => <option key={p.id} value={p.id}>{p.display_name}</option>)}
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-300">
            <option value="">すべてのステータス</option>
            <option value="pending">未レビュー</option>
            <option value="approved">承認済</option>
            <option value="rejected">却下</option>
            <option value="published">公開済</option>
          </select>
        </div>
        {selected.size > 0 && filterStatus === 'pending' && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-500 dark:text-slate-400">{selected.size}件選択</span>
            <button onClick={handleBulkApprove} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-600 text-white text-sm hover:bg-green-700 cursor-pointer">
              <CheckCheck size={14} /> 一括承認
            </button>
            <button onClick={handleBulkReject} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm hover:bg-red-700 cursor-pointer">
              <XCircle size={14} /> 一括却下
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-slate-500 dark:text-slate-400">読み込み中...</p>
      ) : candidates.length === 0 ? (
        <p className="text-slate-500 dark:text-slate-400">該当する候補がありません</p>
      ) : (
        <div className="space-y-3">
          {filterStatus === 'pending' && candidates.length > 0 && (
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 cursor-pointer">
              <input type="checkbox" checked={selected.size === candidates.length} onChange={toggleAll} className="rounded" />
              すべて選択
            </label>
          )}
          {candidates.map(c => (
            <div key={c.id} className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
              <div className="flex items-start gap-3">
                {filterStatus === 'pending' && (
                  <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} className="mt-1 rounded" />
                )}
                <div className="flex-1">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h3 className="font-semibold text-slate-900 dark:text-white">{c.title_jp}</h3>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        {profileName(c.profile_id)} ・ {formatTime(c.start_seconds)} - {formatTime(c.end_seconds)} ・ プラグイン: {c.plugin_used}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-lg font-bold ${c.score >= 8 ? 'text-green-600' : c.score >= 6 ? 'text-yellow-600' : 'text-red-600'}`}>
                        {c.score}/10
                      </span>
                    </div>
                  </div>

                  {/* Metadata */}
                  {c.metadata && Object.keys(c.metadata).length > 0 && (() => {
                    const meta = c.metadata as Record<string, unknown>
                    const subs = Array.isArray(meta.subtitles) ? meta.subtitles as Array<Record<string, unknown>> : []
                    const titles = Array.isArray(meta.title_jp) ? meta.title_jp as string[] : []
                    const descJp = typeof meta.description_jp === 'string' ? meta.description_jp : ''
                    const tags = Array.isArray(meta.tags) ? meta.tags as string[] : []
                    const topPanels = Array.isArray(meta.top_panels) ? meta.top_panels as Array<Record<string, string>> : []
                    const vocab = Array.isArray(meta.vocabulary) ? meta.vocabulary as Array<Record<string, string>> : []
                    const slangs = Array.isArray(meta.slang_terms) ? meta.slang_terms as Array<Record<string, string>> : []
                    const highlightQ = typeof meta.highlight_quote === 'string' ? meta.highlight_quote : ''
                    const quoteJp = typeof meta.quote_jp === 'string' ? meta.quote_jp : ''

                    return (
                      <div className="mt-3 space-y-3">
                        {/* タイトル候補 */}
                        {titles.length > 0 && (
                          <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950">
                            <p className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-1">タイトル候補</p>
                            {titles.map((t, i) => (
                              <p key={i} className="text-sm text-slate-800 dark:text-slate-200">{i + 1}. {t}</p>
                            ))}
                          </div>
                        )}

                        {/* 上段パネル（ワード解説） */}
                        {topPanels.length > 0 && (
                          <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800">
                            <p className="text-xs font-medium text-amber-600 dark:text-amber-400 mb-2">上段パネル（ワード解説）</p>
                            <div className="space-y-2">
                              {topPanels.map((p, i) => (
                                <div key={i} className="flex gap-3 items-start">
                                  <span className="text-xs text-amber-500 font-mono mt-0.5 flex-shrink-0">{formatTime(Number(p.start))}</span>
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <span className="font-bold text-sm text-slate-900 dark:text-white">{p.word}</span>
                                      {p.reading && <span className="text-xs text-slate-500 dark:text-slate-400">({p.reading})</span>}
                                      <span className="text-sm text-amber-700 dark:text-amber-300">{p.meaning}</span>
                                    </div>
                                    {p.note && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{p.note}</p>}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* 下段字幕（英語+日本語） */}
                        {subs.length > 0 && (
                          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 max-h-64 overflow-y-auto">
                            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">下段字幕（英語 + 日本語）</p>
                            <div className="space-y-1.5">
                              {subs.map((s, i) => (
                                <div key={i} className="text-sm">
                                  <span className="text-slate-400 text-xs mr-2 font-mono">{formatTime(Number(s.start))}</span>
                                  <span className="text-slate-500 dark:text-slate-400">{String(s.en)}</span>
                                  <br />
                                  <span className="text-slate-400 text-xs mr-2 font-mono">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
                                  <span className="text-slate-900 dark:text-white">→ {String(s.jp)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* 単語リスト */}
                        {vocab.length > 0 && (
                          <div className="p-3 rounded-lg bg-green-50 dark:bg-green-950">
                            <p className="text-xs font-medium text-green-600 dark:text-green-400 mb-1">注目単語</p>
                            {vocab.map((v, i) => (
                              <div key={i} className="text-sm text-slate-700 dark:text-slate-300">
                                <span className="font-semibold">{v.word}</span>
                                {v.ipa && <span className="text-slate-500 ml-1">[{v.ipa}]</span>}
                                {v.cefr_level && <span className="ml-2 px-1.5 py-0.5 rounded text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300">{v.cefr_level}</span>}
                                {v.meaning_jp && <span className="ml-2">{v.meaning_jp}</span>}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* ハイライト */}
                        {highlightQ && (
                          <div className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-950">
                            <p className="text-xs font-medium text-yellow-600 dark:text-yellow-400 mb-1">ハイライト</p>
                            <p className="text-sm text-slate-700 dark:text-slate-300 italic">"{highlightQ}"</p>
                            {quoteJp && <p className="text-sm text-slate-800 dark:text-slate-200 mt-1">→ {quoteJp}</p>}
                          </div>
                        )}

                        {/* スラング */}
                        {slangs.length > 0 && (
                          <div className="p-3 rounded-lg bg-purple-50 dark:bg-purple-950">
                            <p className="text-xs font-medium text-purple-600 dark:text-purple-400 mb-1">スラング解説</p>
                            {slangs.map((s, i) => (
                              <div key={i} className="text-sm text-slate-700 dark:text-slate-300 mb-1">
                                <span className="font-semibold">{s.term}</span>
                                {s.meaning_jp && <span className="ml-2">{s.meaning_jp}</span>}
                                {s.cultural_context && <p className="text-xs text-slate-500 dark:text-slate-400">{s.cultural_context}</p>}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* 説明文・タグ */}
                        {(descJp || tags.length > 0) && (
                          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900">
                            {descJp && (
                              <>
                                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">YouTube説明文</p>
                                <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-line mb-2">{descJp}</p>
                              </>
                            )}
                            {tags.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {tags.map((t, i) => (
                                  <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400">{t}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })()}

                  {/* Actions */}
                  <div className="flex items-center gap-2 mt-3">
                    {c.status === 'pending' && (
                      <>
                        <button onClick={() => handleApprove(c.id)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-600 text-white text-sm hover:bg-green-700 cursor-pointer">
                          <Check size={14} /> 承認
                        </button>
                        <button onClick={() => handleReject(c.id)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm hover:bg-red-50 dark:hover:bg-red-950 cursor-pointer">
                          <XIcon size={14} /> 却下
                        </button>
                      </>
                    )}
                    {c.status === 'approved' && (
                      <button onClick={() => { setPublishModal(c.id); setYoutubeId('') }} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 cursor-pointer">
                        <ExternalLink size={14} /> 公開済にする
                      </button>
                    )}
                    {c.youtube_video_id && (
                      <a href={`https://www.youtube.com/watch?v=${c.youtube_video_id}`} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
                        YouTube で見る
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Publish Modal */}
      {publishModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl">
            <div className="p-6 space-y-4">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">公開済みにする</h3>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">YouTube動画ID</label>
                <input value={youtubeId} onChange={e => setYoutubeId(e.target.value)} placeholder="例: dQw4w9WgXcQ" className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm" />
              </div>
              <div className="flex justify-end gap-3">
                <button onClick={() => setPublishModal(null)} className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-sm cursor-pointer">キャンセル</button>
                <button onClick={handlePublish} disabled={!youtubeId.trim()} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 cursor-pointer">公開済にする</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
